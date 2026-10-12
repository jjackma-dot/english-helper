// 2) 한영/영한 사전: 뜻·예문·발음·이미지

import { h, btn, iconBtn, clear, section, toast, errorMessage, externalLink } from '../ui.js';
import { icon } from '../icons.js';
import { geminiEnabled, addWord, hasWord, getDictHistory, pushDictHistory, clearDictHistory } from '../store.js';
import { detectLang, normalizeTerm, lemmaCandidates } from '../lib/lang.js';
import { entryView, imageQuery } from '../lib/dict-entry.js';
import { freeDictionary, wiktionary, searchImages, aiEntry, externalLinks } from '../services/dictionary.js';
import { wordMeanings, translate } from '../services/translate.js';
import { speak, playAudio, listenOnce, sttSupported } from '../speech.js';

let input;
let results;
let recentBox;
let ctrl;
let voiceLang = 'en-US';

export function init(root) {
  input = h('input', {
    type: 'search',
    placeholder: '영어 또는 한국어 단어·표현',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': '검색어',
  });
  const langChip = h(
    'button',
    {
      type: 'button',
      class: 'chip small',
      title: '음성 검색 언어 바꾸기',
      onclick: () => {
        voiceLang = voiceLang === 'en-US' ? 'ko-KR' : 'en-US';
        langChip.textContent = voiceLang === 'en-US' ? 'EN' : '한';
      },
    },
    'EN'
  );
  const micBtn = iconBtn('mic', '음성으로 검색', async () => {
    micBtn.classList.add('recording');
    try {
      const said = await listenOnce(voiceLang);
      if (said) search(said);
      else toast('말소리를 듣지 못했습니다.');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      micBtn.classList.remove('recording');
    }
  });
  const form = h(
    'form',
    {
      class: 'search-bar',
      role: 'search',
      onsubmit: (e) => {
        e.preventDefault();
        search(input.value);
      },
    },
    icon('search'),
    input,
    sttSupported ? langChip : null,
    sttSupported ? micBtn : null,
    h('button', { class: 'btn primary small', type: 'submit' }, '검색')
  );
  recentBox = h('div', { class: 'recent' });
  results = h('div', { class: 'results', 'aria-live': 'polite' });
  root.append(form, recentBox, results);
  renderRecent();
}

export function show(params) {
  const q = params.get('q');
  if (q && normalizeTerm(q) !== input.value) search(q);
  else if (!results.childElementCount) input.focus({ preventScroll: true });
}

function renderRecent() {
  clear(recentBox);
  const list = getDictHistory();
  if (!list.length) return;
  recentBox.append(
    h(
      'div',
      { class: 'chips' },
      h('span', { class: 'muted small' }, '최근'),
      list.slice(0, 12).map((t) => h('button', { type: 'button', class: 'chip', onclick: () => search(t) }, t)),
      h(
        'button',
        { type: 'button', class: 'chip ghost', onclick: () => (clearDictHistory(), renderRecent()) },
        '지우기'
      )
    )
  );
}

function searchLink(text) {
  return h('button', { type: 'button', class: 'linkish', lang: 'en', onclick: () => search(text) }, text);
}

function speakBtn(text, lang = 'en-US') {
  return iconBtn('volume', '발음 듣기', () => speak(text, { lang }), 'icon-btn small');
}

function saveBtn(getItem) {
  const b = iconBtn(
    'star',
    '단어장에 저장',
    () => {
      const item = getItem();
      addWord(item);
      b.classList.add('on');
      toast(`'${item.text}' 단어장에 저장했습니다`);
    },
    'icon-btn small'
  );
  return b;
}

/** 영어 예문 + 발음 + (번역 없으면) 해석 버튼. translatable: false면 해석 버튼을 달지 않는다 (번역이 곧 도착할 때) */
function exampleItem(en, ko, { translatable = true } = {}) {
  const koLine = h('div', { class: 'muted' }, ko || '');
  const transBtn =
    ko || !translatable
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'chip small',
            onclick: async () => {
              transBtn.disabled = true;
              try {
                koLine.textContent = (await translate(en, 'en', 'ko')).text;
                transBtn.remove();
              } catch (e) {
                toast(errorMessage(e));
                transBtn.disabled = false;
              }
            },
          },
          '해석'
        );
  return h(
    'li',
    { class: 'example' },
    h('div', { class: 'row' }, h('span', { lang: 'en', class: 'grow' }, en), speakBtn(en), transBtn),
    koLine
  );
}

async function search(raw) {
  const q = normalizeTerm(raw);
  if (!q) return;
  input.value = q;
  input.blur();
  ctrl?.abort();
  ctrl = new AbortController();
  const { signal } = ctrl;
  pushDictHistory(q);
  renderRecent();
  if (location.hash.split('?')[0] === '#/dict') history.replaceState(null, '', `#/dict?q=${encodeURIComponent(q)}`);

  const lang = detectLang(q) || 'en';
  const useAi = geminiEnabled();
  clear(results);

  // 지금까지 찾은 뜻과 영어 단어 (단어장 저장·이미지 검색어에 쓴다)
  let aiMeaning = '';
  let freeMeaning = '';
  const found = { aiWords: [], candidates: [] };

  // 표제어 머리
  const phon = h('span', { class: 'ipa' });
  const audioRow = h('span', { class: 'row' });
  const head = h(
    'div',
    { class: 'result-head' },
    h('div', { class: 'row wrap' }, h('h2', { class: 'headword', lang }, q), phon),
    h(
      'div',
      { class: 'row wrap' },
      h('span', { class: 'badge' }, lang === 'en' ? '영 → 한' : '한 → 영'),
      lang === 'en' ? audioRow : null,
      lang === 'en' ? btn('읽기', () => speak(q), { cls: 'chip', ico: 'volume' }) : null,
      lang === 'en' ? btn('천천히', () => speak(q, { rate: 0.6 }), { cls: 'chip' }) : null,
      lang === 'en'
        ? saveBtn(() => ({ text: q, meaning: aiMeaning || freeMeaning, type: 'word', source: '사전' }))
        : null
    )
  );
  if (lang === 'en' && hasWord(q)) head.querySelector('.icon-btn')?.classList.add('on');
  results.append(head);

  const aiSec = useAi ? section('AI 사전 (Gemini)', { ico: 'zap', cls: 'ai' }) : null;
  const meanSec = section(lang === 'en' ? '한국어 뜻' : '영어로는', { ico: 'globe' });
  const defSec = lang === 'en' ? section('영영 풀이 · 예문', { ico: 'book' }) : null;
  const wikiSec = lang === 'ko' ? section('위키낱말사전 풀이', { ico: 'book' }) : null;
  const imgSec = section('이미지', { ico: 'image' });
  const linkSec = section('다른 사전에서 보기', { ico: 'external' });
  for (const s of [aiSec, meanSec, defSec, wikiSec, imgSec, linkSec]) if (s) results.append(s.el);
  linkSec.set(
    h(
      'div',
      { class: 'chips' },
      externalLinks(q, lang).map((l) => externalLink(l.label, l.href))
    )
  );

  // 이미지는 눌렀을 때만, 그때까지 나온 가장 알맞은 영어 단어로 찾는다
  imgSec.set(
    btn('이미지 보기', () => loadImages(imgSec, imageQuery(q, lang, found), signal), { cls: 'chip', ico: 'image' })
  );

  // AI 풀이와 무료 사전을 함께 시작한다 (AI를 기다리지 않고 무료 결과부터 보인다)
  if (useAi) {
    runAi(aiSec, q, lang, signal, (v) => {
      if (lang === 'en' && v.pronunciation && !phon.textContent) phon.textContent = v.pronunciation;
      const done = v.senses.filter((s) => s.complete);
      found.aiWords = done.map((s) => s.english);
      aiMeaning = done
        .slice(0, 3)
        .map((s) => s.korean)
        .filter(Boolean)
        .join(' / ');
    });
  }

  meanSec.loading();
  wordMeanings(q, lang, lang === 'en' ? 'ko' : 'en', { signal })
    .then((list) => {
      if (!list.length) {
        meanSec.set(
          h('p', { class: 'muted' }, '번역 메모리에서 뜻을 찾지 못했습니다. 아래 다른 사전을 이용해 보세요.')
        );
        return;
      }
      if (lang === 'en') {
        freeMeaning = list.slice(0, 3).join(', ');
        meanSec.set(
          h('p', { class: 'meaning' }, list.join(' · ')),
          h('p', { class: 'hint' }, '무료 번역 메모리(MyMemory) 결과라 부정확할 수 있습니다.')
        );
        return;
      }
      found.candidates = list;
      meanSec.set(
        h(
          'ul',
          { class: 'cand-list' },
          list.map((w) =>
            h(
              'li',
              { class: 'row' },
              searchLink(w),
              speakBtn(w),
              saveBtn(() => ({ text: w, meaning: q, type: 'word', source: '사전' }))
            )
          )
        ),
        h('p', { class: 'hint' }, '단어를 누르면 영영 풀이와 발음을 볼 수 있습니다.')
      );
    })
    .catch((e) => {
      if (e.name !== 'AbortError') meanSec.error(errorMessage(e));
    });

  if (defSec) {
    defSec.loading();
    (async () => {
      for (const cand of lemmaCandidates(q)) {
        const d = await freeDictionary(cand, { signal });
        if (d) return d;
      }
      return null;
    })()
      .then((d) => {
        if (!d) {
          defSec.set(h('p', { class: 'muted' }, '영영사전에 없는 단어·표현입니다.'));
          return;
        }
        if (d.phonetic) phon.textContent = d.phonetic;
        clear(audioRow);
        for (const a of d.audios.slice(0, 2)) {
          audioRow.append(
            btn(a.accent ? `${a.accent} 원음` : '원음', () => playAudio(a.url, q), { cls: 'chip', ico: 'volume' })
          );
        }
        renderFreeDict(defSec, d);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') defSec.error(errorMessage(e));
      });
  }

  if (wikiSec) {
    wikiSec.loading();
    wiktionary(q, 'ko', { signal })
      .then((secs) => {
        if (!secs.length) return wikiSec.hide();
        wikiSec.set(
          secs.map((s) =>
            h(
              'div',
              { class: 'sense' },
              h('span', { class: 'tag' }, s.pos),
              h(
                'ul',
                null,
                s.defs.map((d) => h('li', { lang: 'en' }, d))
              )
            )
          ),
          h('p', { class: 'hint' }, '출처: Wiktionary (CC BY-SA)')
        );
      })
      .catch(() => wikiSec.hide());
  }
}

/**
 * AI 사전 풀이. 받는 대로 한 화면에 한 번씩 그리고, 끝나면 '저장된 풀이' 표시와 새로 풀이 버튼,
 * 실패하면 받은 데까지는 두고 오류와 다시 시도 버튼을 보여 준다.
 * @param {(view: object) => void} onView 그릴 때마다 entryView 결과로 불린다 (발음·저장할 뜻·이미지 검색어)
 * @param {boolean} [fresh] 보관함을 건너뛰고 새로 풀이
 */
function runAi(sec, q, lang, signal, onView, fresh = false) {
  const senses = h('div', { class: 'ai-senses' });
  const synonyms = h('div', { class: 'chips', hidden: true });
  const tip = h('p', { class: 'callout', hidden: true });
  const status = h('div', { class: 'row wrap ai-status' });
  const setStatus = (...nodes) => clear(status).append(...nodes.filter(Boolean));
  const rerun = (useFresh) => () => runAi(sec, q, lang, signal, onView, useFresh);
  sec.set(
    senses,
    synonyms,
    tip,
    status,
    h('p', { class: 'hint' }, 'AI가 만든 풀이는 틀릴 수 있습니다. 중요한 내용은 다른 사전으로 확인하세요.')
  );
  setStatus(h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), 'Gemini가 풀이를 쓰는 중…'));

  let synCount = 0;
  const draw = (entry, done) => {
    const v = entryView(entry, { done });
    // 다 받은 뜻은 한 번만 그리고, 자라는 중인 마지막 뜻만 다시 그린다 (누르던 버튼이 바뀌지 않게)
    v.senses.forEach((s, i) => {
      const old = senses.children[i];
      if (old?.dataset.complete) return;
      const el = senseEl(s, lang, q);
      if (old) old.replaceWith(el);
      else senses.append(el);
    });
    if (v.synonyms.length !== synCount) {
      synCount = v.synonyms.length;
      clear(synonyms).append(
        h('span', { class: 'muted small' }, '비슷한 말'),
        ...v.synonyms
          .slice(0, 8)
          .map((s) => h('button', { type: 'button', class: 'chip', onclick: () => search(s) }, s))
      );
      synonyms.hidden = !synCount;
    }
    tip.hidden = !v.tip;
    clear(tip).append(icon('info'), ' ', v.tip);
    onView(v);
    return v;
  };

  let latest;
  let frame = 0;
  aiEntry(q, lang, {
    signal,
    fresh,
    onPartial: (partial) => {
      latest = partial;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!signal.aborted) draw(latest, false);
      });
    },
  })
    .then(({ entry, cached }) => {
      cancelAnimationFrame(frame);
      if (signal.aborted) return;
      if (!draw(entry, true).senses.length) senses.append(h('p', { class: 'muted' }, '풀이를 만들지 못했습니다.'));
      setStatus(
        cached ? h('span', { class: 'badge saved' }, '저장된 풀이') : null,
        h('span', { class: 'grow' }),
        btn('새로 풀이', rerun(true), { cls: 'chip small', ico: 'back' })
      );
    })
    .catch((e) => {
      cancelAnimationFrame(frame);
      if (signal.aborted) return;
      if (latest) draw(latest, false);
      setStatus(
        h('p', { class: 'error-text grow' }, errorMessage(e)),
        btn('다시 시도', rerun(fresh), { cls: 'chip small', ico: 'back' })
      );
    });
}

/** AI 풀이의 뜻 하나. 아직 받는 중인 뜻은 글자가 잘려 있을 수 있어 저장·검색·번역 버튼을 달지 않는다 */
function senseEl(s, lang, q) {
  // 한→영에서는 영어 단어가 표제어
  let english = null;
  if (lang === 'ko' && s.english) {
    english = s.complete
      ? [
          searchLink(s.english),
          speakBtn(s.english),
          saveBtn(() => ({ text: s.english, meaning: s.korean || q, type: 'word', source: '사전' })),
        ]
      : h('b', { lang: 'en' }, s.english);
  }
  return h(
    'div',
    { class: 'sense', dataset: s.complete ? { complete: '1' } : null },
    h(
      'div',
      { class: 'row wrap' },
      s.partOfSpeech ? h('span', { class: 'tag' }, s.partOfSpeech) : null,
      english,
      h('span', { class: lang === 'en' ? 'meaning' : 'muted' }, s.korean)
    ),
    s.nuance ? h('p', { class: 'nuance' }, s.nuance) : null,
    s.examples.length
      ? h(
          'ul',
          { class: 'examples' },
          s.examples.map((x) => exampleItem(x.en, x.ko, { translatable: s.complete }))
        )
      : null
  );
}

function renderFreeDict(sec, d) {
  sec.set(
    d.meanings.map((m) =>
      h(
        'div',
        { class: 'sense' },
        h('span', { class: 'tag' }, m.pos),
        h(
          'ol',
          { class: 'defs' },
          m.defs
            .slice(0, 6)
            .map((x) =>
              h(
                'li',
                null,
                h('span', { lang: 'en' }, x.def),
                x.example ? h('ul', { class: 'examples' }, exampleItem(x.example)) : null
              )
            )
        ),
        m.synonyms.length
          ? h(
              'div',
              { class: 'chips' },
              h('span', { class: 'muted small' }, '유의어'),
              m.synonyms
                .slice(0, 6)
                .map((s) => h('button', { type: 'button', class: 'chip', onclick: () => search(s) }, s))
            )
          : null
      )
    ),
    h('p', { class: 'hint' }, '출처: Free Dictionary API (Wiktionary, CC BY-SA)')
  );
}

async function loadImages(sec, query, signal) {
  sec.loading('이미지를 찾는 중…');
  const google = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  try {
    const imgs = await searchImages(query, { signal });
    const more = externalLink('구글 이미지에서 더 보기', google);
    if (!imgs.length) {
      sec.set(h('p', { class: 'muted' }, `'${query}' 이미지가 없습니다.`), more);
      return;
    }
    sec.set(
      h(
        'div',
        { class: 'img-grid' },
        imgs.map((im) =>
          h(
            'a',
            {
              href: im.link,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: [im.title, im.credit].filter(Boolean).join(' — '),
            },
            h('img', { src: im.thumb, alt: im.title || query, loading: 'lazy', referrerpolicy: 'no-referrer' })
          )
        )
      ),
      h('p', { class: 'hint' }, `'${query}' · 출처: Openverse (자유 이용 이미지, 각 이미지의 라이선스를 따름)`),
      more
    );
  } catch (e) {
    if (e.name === 'AbortError') return;
    sec.set(
      h('p', { class: 'error-text' }, errorMessage(e)),
      h(
        'div',
        { class: 'chips' },
        btn('다시 시도', () => loadImages(sec, query, signal), { cls: 'chip', ico: 'back' }),
        externalLink('구글 이미지에서 보기', google)
      )
    );
  }
}

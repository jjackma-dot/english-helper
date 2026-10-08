// 2) 한영/영한 사전: 뜻·예문·발음·이미지

import { h, btn, iconBtn, clear, section, toast, errorMessage, externalLink } from '../ui.js';
import { icon } from '../icons.js';
import { geminiEnabled, addWord, hasWord, getDictHistory, pushDictHistory, clearDictHistory } from '../store.js';
import { detectLang, normalizeTerm, lemmaCandidates } from '../lib/lang.js';
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

/** 영어 예문 + 발음 + (번역 없으면) 해석 버튼 */
function exampleItem(en, ko) {
  const koLine = h('div', { class: 'muted' }, ko || '');
  const transBtn = ko
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

  // 표제어 머리
  let meaningForSave = '';
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
      lang === 'en' ? saveBtn(() => ({ text: q, meaning: meaningForSave, type: 'word', source: '사전' })) : null
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

  // 이미지는 영어 검색어로 찾는 편이 결과가 좋다
  let imageQueryResolved;
  const imageQuery = new Promise((r) => (imageQueryResolved = r));
  if (lang === 'en') imageQueryResolved(q);
  loadImages(imgSec, imageQuery, signal);

  const loadFreeMeanings = async () => {
    meanSec.loading();
    try {
      const list = await wordMeanings(q, lang, lang === 'en' ? 'ko' : 'en', { signal });
      if (!list.length) {
        meanSec.set(
          h('p', { class: 'muted' }, '번역 메모리에서 뜻을 찾지 못했습니다. 아래 다른 사전을 이용해 보세요.')
        );
        imageQueryResolved(lang === 'ko' ? '' : q);
        return;
      }
      if (lang === 'en') {
        meaningForSave = list.slice(0, 3).join(', ');
        meanSec.set(
          h('p', { class: 'meaning' }, list.join(' · ')),
          h('p', { class: 'hint' }, '무료 번역 메모리(MyMemory) 결과라 부정확할 수 있습니다.')
        );
      } else {
        imageQueryResolved(list[0]);
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
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      meanSec.error(errorMessage(e));
      imageQueryResolved(lang === 'ko' ? '' : q);
    }
  };

  if (useAi) {
    meanSec.hide();
    aiSec.loading('Gemini가 풀이를 만드는 중…');
    aiEntry(q, lang, { signal })
      .then((entry) => {
        renderAiEntry(aiSec, entry, lang, q);
        const first = entry.entries?.[0];
        if (lang === 'en') {
          meaningForSave = (entry.entries || [])
            .slice(0, 3)
            .map((e) => e.korean)
            .join(' / ');
          if (entry.pronunciation && !phon.textContent) phon.textContent = entry.pronunciation;
        } else imageQueryResolved(first?.english || '');
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        aiSec.error(`${errorMessage(e)} — 무료 사전 결과를 대신 보여 드립니다.`);
        meanSec.el.hidden = false;
        loadFreeMeanings();
      });
  } else {
    loadFreeMeanings();
  }

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

function renderAiEntry(sec, entry, lang, q) {
  const entries = Array.isArray(entry.entries) ? entry.entries : [];
  if (!entries.length) {
    sec.set(h('p', { class: 'muted' }, '풀이를 만들지 못했습니다.'));
    return;
  }
  sec.set(
    entries.map((e) =>
      h(
        'div',
        { class: 'sense' },
        h(
          'div',
          { class: 'row wrap' },
          e.partOfSpeech ? h('span', { class: 'tag' }, e.partOfSpeech) : null,
          lang === 'ko' ? searchLink(e.english) : null,
          lang === 'ko' ? speakBtn(e.english) : null,
          lang === 'ko'
            ? saveBtn(() => ({ text: e.english, meaning: e.korean || q, type: 'word', source: '사전' }))
            : null,
          h('span', { class: lang === 'en' ? 'meaning' : 'muted' }, e.korean)
        ),
        e.nuance ? h('p', { class: 'nuance' }, e.nuance) : null,
        Array.isArray(e.examples) && e.examples.length
          ? h(
              'ul',
              { class: 'examples' },
              e.examples.map((x) => exampleItem(x.en, x.ko))
            )
          : null
      )
    ),
    Array.isArray(entry.synonyms) && entry.synonyms.length
      ? h(
          'div',
          { class: 'chips' },
          h('span', { class: 'muted small' }, '비슷한 말'),
          entry.synonyms
            .slice(0, 8)
            .map((s) => h('button', { type: 'button', class: 'chip', onclick: () => search(s) }, s))
        )
      : null,
    entry.tip ? h('p', { class: 'callout' }, icon('info'), ' ', entry.tip) : null,
    h('p', { class: 'hint' }, 'AI가 만든 풀이는 틀릴 수 있습니다. 중요한 내용은 다른 사전으로 확인하세요.')
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

async function loadImages(sec, queryPromise, signal) {
  sec.loading('이미지를 찾는 중…');
  const query = await queryPromise;
  if (signal.aborted) return;
  if (!query) {
    sec.set(h('p', { class: 'muted' }, '이미지 검색어를 정하지 못했습니다.'));
    return;
  }
  try {
    const imgs = await searchImages(query, { signal });
    const more = externalLink(
      '구글 이미지에서 더 보기',
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
    );
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
      externalLink('구글 이미지에서 보기', `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`)
    );
  }
}

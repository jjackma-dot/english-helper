// 단어를 탭하면 아래에서 올라오는 간단 사전 (OTT 대사·번역 결과에서 사용)

import { h, btn, clear, openSheet, toast, errorMessage } from '../ui.js';
import { geminiEnabled, addWord } from '../store.js';
import { lemmaCandidates, tokenizeEnglish } from '../lib/lang.js';
import { freeDictionary, aiWordInContext } from '../services/dictionary.js';
import { wordMeanings } from '../services/translate.js';
import { speak, playAudio } from '../speech.js';

async function findInFreeDictionary(word, signal) {
  for (const cand of lemmaCandidates(word)) {
    const r = await freeDictionary(cand, { signal });
    if (r) return r;
  }
  return null;
}

/** 영어 문장을 단어마다 누를 수 있게 만든다. 누르면 단어 시트가 열린다 */
export function tappableEnglish(text, { source = '', tag = 'span', cls = '' } = {}) {
  const el = h(tag, { class: `tappable ${cls}`.trim(), lang: 'en' });
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (i) el.append(h('br'));
    for (const tok of tokenizeEnglish(line)) {
      if (!tok.word) el.append(tok.text);
      else
        el.append(
          h(
            'button',
            {
              type: 'button',
              class: 'w',
              onclick: () => openWordSheet(tok.text, { context: text.replace(/\n/g, ' '), source }),
            },
            tok.text
          )
        );
    }
  });
  return el;
}

/**
 * @param {string} word
 * @param {{context?: string, source?: string}} [opts] context: 단어가 나온 문장
 */
export function openWordSheet(word, { context = '', source = '' } = {}) {
  const ctrl = new AbortController();
  const body = h('div', { class: 'word-sheet' });
  openSheet({ title: word, content: body, onClose: () => ctrl.abort() });

  let meaningForSave = '';
  let headword = word;

  const actions = h(
    'div',
    { class: 'row wrap' },
    btn('발음', () => speak(headword), { ico: 'volume', cls: 'btn' }),
    btn(
      '단어장 저장',
      () => {
        addWord({ text: headword, meaning: meaningForSave, type: 'word', source, context });
        toast(`'${headword}' 저장했습니다`);
      },
      { ico: 'star', cls: 'btn' }
    ),
    h(
      'a',
      {
        class: 'btn ghost',
        href: `#/dict?q=${encodeURIComponent(headword)}`,
        onclick: () => document.querySelector('dialog.sheet')?.close(),
      },
      '사전에서 자세히'
    )
  );
  const content = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), '뜻을 찾는 중…')
  );
  body.append(content, actions);

  const render = (...nodes) => {
    clear(content);
    content.append(...nodes.filter(Boolean));
  };

  if (geminiEnabled() && context) {
    aiWordInContext(word, context, { signal: ctrl.signal })
      .then((r) => {
        headword = r.word || word;
        meaningForSave = r.meaning || '';
        render(
          h(
            'div',
            { class: 'headline' },
            h('strong', { class: 'big' }, headword),
            r.ipa ? h('span', { class: 'ipa' }, r.ipa) : null,
            r.partOfSpeech ? h('span', { class: 'tag' }, r.partOfSpeech) : null
          ),
          h('p', null, h('b', null, '뜻 '), r.meaning || ''),
          r.inContext ? h('p', { class: 'callout' }, h('b', null, '이 문장에서 '), r.inContext) : null,
          h(
            'blockquote',
            { class: 'quote' },
            h('div', { lang: 'en' }, context),
            r.sentenceKo ? h('div', { class: 'muted' }, r.sentenceKo) : null
          ),
          h('p', { class: 'muted small' }, 'Gemini 해설')
        );
      })
      .catch((e) => {
        if (e.name !== 'AbortError') fallback(errorMessage(e));
      });
  } else {
    fallback();
  }

  function fallback(notice) {
    Promise.allSettled([
      findInFreeDictionary(word, ctrl.signal),
      wordMeanings(word.toLowerCase(), 'en', 'ko', { signal: ctrl.signal }),
    ]).then(([dict, ko]) => {
      if (ctrl.signal.aborted) return;
      const d = dict.status === 'fulfilled' ? dict.value : null;
      const meanings = ko.status === 'fulfilled' ? ko.value : [];
      if (d) headword = d.word;
      meaningForSave = meanings.slice(0, 3).join(', ');
      const defs = d
        ? d.meanings.flatMap((m) => m.defs.slice(0, 2).map((x) => ({ pos: m.pos, def: x.def }))).slice(0, 4)
        : [];
      if (!d && !meanings.length) {
        render(
          h('p', { class: 'error-text' }, ko.status === 'rejected' ? errorMessage(ko.reason) : '뜻을 찾지 못했습니다.')
        );
        return;
      }
      render(
        notice ? h('p', { class: 'muted small' }, notice) : null,
        h(
          'div',
          { class: 'headline' },
          h('strong', { class: 'big' }, headword),
          d?.phonetic ? h('span', { class: 'ipa' }, d.phonetic) : null,
          d?.audios?.[0]
            ? btn(d.audios[0].accent || '원음', () => playAudio(d.audios[0].url, headword), {
                ico: 'volume',
                cls: 'chip',
              })
            : null
        ),
        meanings.length ? h('p', null, h('b', null, '뜻 '), meanings.join(', ')) : null,
        defs.length
          ? h(
              'ol',
              { class: 'defs' },
              defs.map((x) => h('li', null, h('span', { class: 'tag' }, x.pos), ' ', h('span', { lang: 'en' }, x.def)))
            )
          : null,
        context ? h('blockquote', { class: 'quote', lang: 'en' }, context) : null
      );
    });
  }
}

// 단어장: 사전·번역·OTT에서 저장한 단어와 문장

import { h, btn, iconBtn, clear, toast, segmented, toggle } from '../ui.js';
import { icon } from '../icons.js';
import { listWords, removeWord, importWords } from '../store.js';
import { speak } from '../speech.js';

let listBox;
let countEl;
let filter = 'all';
let query = '';
let quiz = false;

function render() {
  if (!listBox) return;
  const all = listWords();
  const q = query.trim().toLowerCase();
  const items = all.filter(
    (w) =>
      (filter === 'all' || w.type === filter) &&
      (!q || w.text.toLowerCase().includes(q) || (w.meaning || '').toLowerCase().includes(q))
  );
  countEl.textContent = `${items.length} / ${all.length}개`;
  clear(listBox);
  if (!all.length) {
    listBox.append(
      h(
        'div',
        { class: 'empty' },
        icon('star', { size: 32 }),
        h('p', null, '아직 저장한 단어가 없습니다.'),
        h('p', { class: 'hint' }, '사전·번역·OTT 화면에서 ⭐ 또는 "저장"을 누르면 여기에 모입니다.')
      )
    );
    return;
  }
  for (const w of items) {
    const meaning = h('div', { class: `meaning${quiz ? ' spoiler' : ''}` }, w.meaning || '(뜻 없음)');
    if (quiz) meaning.addEventListener('click', () => meaning.classList.toggle('revealed'));
    listBox.append(
      h(
        'li',
        { class: 'word-item' },
        h(
          'div',
          { class: 'grow stack tight' },
          h('div', { class: `word-text ${w.type}`, lang: 'en' }, w.text),
          meaning,
          w.source || w.context
            ? h('div', { class: 'muted small' }, [w.source, w.context].filter(Boolean).join(' · '))
            : null
        ),
        h(
          'div',
          { class: 'word-actions' },
          iconBtn('volume', '발음 듣기', () => speak(w.text)),
          w.type === 'word'
            ? h(
                'a',
                {
                  class: 'icon-btn',
                  href: `#/dict?q=${encodeURIComponent(w.text)}`,
                  title: '사전에서 보기',
                  'aria-label': '사전에서 보기',
                },
                icon('search')
              )
            : null,
          iconBtn('trash', '삭제', () => {
            removeWord(w.id);
            toast(`'${w.text.slice(0, 30)}' 삭제했습니다`);
          })
        )
      )
    );
  }
}

function exportWords() {
  const data = { app: 'english-helper', version: 1, exportedAt: new Date().toISOString(), words: listWords() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `english-helper-words-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function init(root) {
  const search = h('input', {
    type: 'search',
    placeholder: '단어장 검색',
    'aria-label': '단어장 검색',
    oninput: () => {
      query = search.value;
      render();
    },
  });
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden',
    onchange: async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const added = importWords(JSON.parse(await f.text()));
        toast(`${added}개를 가져왔습니다`);
      } catch (e) {
        toast(e instanceof SyntaxError ? 'JSON 파일을 읽을 수 없습니다.' : e.message);
      }
      fileInput.value = '';
    },
  });
  countEl = h('span', { class: 'muted small' });
  listBox = h('ul', { class: 'word-list' });

  root.append(
    h('div', { class: 'search-bar' }, icon('search'), search),
    h(
      'div',
      { class: 'row between wrap' },
      segmented(
        [
          { value: 'all', label: '전체' },
          { value: 'word', label: '단어' },
          { value: 'sentence', label: '문장' },
        ],
        filter,
        (v) => {
          filter = v;
          render();
        },
        { label: '종류' }
      ),
      countEl
    ),
    toggle(
      '뜻 가리기 (암기 확인)',
      quiz,
      (v) => {
        quiz = v;
        render();
      },
      '뜻을 누르면 보입니다'
    ),
    listBox,
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'card-title' }, icon('chat'), '복습 · 백업'),
      h(
        'div',
        { class: 'stack actions' },
        h(
          'a',
          { class: 'btn primary', href: '#/tutor?scenario=review' },
          icon('chat'),
          h('span', null, 'AI 튜터와 단어장 복습하기')
        ),
        h(
          'div',
          { class: 'row wrap' },
          btn('내보내기 (JSON)', exportWords, { cls: 'btn ghost', ico: 'download' }),
          btn('가져오기', () => fileInput.click(), { cls: 'btn ghost', ico: 'upload' }),
          fileInput
        ),
        h(
          'p',
          { class: 'hint' },
          '단어장은 이 휴대폰(브라우저)에만 저장됩니다. 앱을 지우거나 사이트 데이터를 삭제하기 전에 내보내 두세요.'
        )
      )
    )
  );
  window.addEventListener('words-changed', render);
  render();
}

export function show() {
  render();
}

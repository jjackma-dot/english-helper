// 1) AI 영어회화 튜터: 프롬프트를 만들어 휴대폰의 ChatGPT·Gemini 앱으로 보낸다

import { h, btn, toast, copyText, copyWithToast, shareText, isAndroid, segmented, field, toggle } from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, listWords } from '../store.js';
import {
  SCENARIOS,
  LEVELS,
  CORRECTIONS,
  AI_APPS,
  FOLLOW_UPS,
  buildTutorPrompt,
  buildAppLaunchUrl,
  getScenario,
} from '../lib/prompts.js';

let state;
let promptBox;
let edited = false;
let regenBtn;
let topicField;
let topicInput;
let scenarioSelect;
let openBtnLabel;
let wordsNote;

function save() {
  updateSettings({ tutor: { ...state } });
}

function regenerate(force = false) {
  if (edited && !force) return;
  promptBox.value = buildTutorPrompt({ ...state, words: listWords() });
  edited = false;
  regenBtn.hidden = true;
}

function onOptionChange(patch) {
  Object.assign(state, patch);
  save();
  syncDependentUi();
  regenerate();
}

function syncDependentUi() {
  const sc = getScenario(state.scenario);
  topicField.querySelector('.field-label').textContent =
    sc.topic === 'required' ? (sc.id === 'custom' ? '상황 설명 (필수)' : '토론 주제 (필수)') : '추가 요청 (선택)';
  topicInput.placeholder =
    sc.id === 'custom'
      ? '예: 미국 회사 동료와 점심 메뉴 정하기'
      : sc.id === 'debate'
        ? '예: Is remote work better than office work?'
        : '예: 여행 관련 표현 위주로, 내 직업은 간호사';
  const count = listWords().length;
  wordsNote.hidden = !sc.words;
  wordsNote.textContent = count
    ? `단어장에 저장한 ${Math.min(count, 30)}개 표현을 연습합니다.`
    : '단어장이 비어 있어 AI가 수준에 맞는 표현을 골라 줍니다. 사전·OTT 화면에서 ⭐로 저장해 보세요.';
  openBtnLabel.textContent = `복사하고 ${AI_APPS[state.app].label} 열기`;
}

async function sendViaShare() {
  const text = currentPrompt();
  if (!text) return;
  const ok = await shareText(text);
  if (!ok) {
    await copyWithToast(text, '공유를 지원하지 않아 복사했습니다. 앱에 붙여넣으세요.');
  }
}

async function copyAndOpen() {
  const text = currentPrompt();
  if (!text) return;
  const copied = await copyText(text);
  toast(
    copied
      ? `프롬프트를 복사했습니다. ${AI_APPS[state.app].label} 입력창을 길게 눌러 붙여넣고 보내세요.`
      : '복사하지 못했습니다. 미리보기의 글을 길게 눌러 직접 복사하세요.',
    { ms: 5000 }
  );
  const url = buildAppLaunchUrl(state.app, text, { android: isAndroid });
  if (isAndroid) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

function currentPrompt() {
  const sc = getScenario(state.scenario);
  if (sc.topic === 'required' && !String(state.topic || '').trim()) {
    toast(sc.id === 'custom' ? '상황 설명을 입력하세요.' : '토론 주제를 입력하세요.');
    topicInput.focus();
    return '';
  }
  return promptBox.value.trim();
}

export function init(root) {
  state = { ...getSettings().tutor };

  scenarioSelect = h('select', {
    onchange: () => onOptionChange({ scenario: scenarioSelect.value }),
  });
  const groups = new Map();
  for (const s of SCENARIOS) {
    if (!groups.has(s.group)) groups.set(s.group, h('optgroup', { label: s.group }));
    groups.get(s.group).append(h('option', { value: s.id, selected: s.id === state.scenario }, s.label));
  }
  scenarioSelect.append(...groups.values());

  topicInput = h('input', {
    type: 'text',
    value: state.topic || '',
    oninput: () => onOptionChange({ topic: topicInput.value }),
  });
  topicField = field('추가 요청 (선택)', topicInput);
  wordsNote = h('p', { class: 'hint', hidden: true });

  const correctionSelect = h(
    'select',
    { onchange: () => onOptionChange({ correction: correctionSelect.value }) },
    Object.entries(CORRECTIONS).map(([v, c]) => h('option', { value: v, selected: v === state.correction }, c.label))
  );

  promptBox = h('textarea', {
    class: 'prompt-box',
    rows: 12,
    spellcheck: 'false',
    'aria-label': '튜터 요청 프롬프트',
    oninput: () => {
      edited = true;
      regenBtn.hidden = false;
    },
  });
  regenBtn = btn('설정대로 다시 만들기', () => regenerate(true), { cls: 'btn small ghost', ico: 'back' });
  regenBtn.hidden = true;

  openBtnLabel = h('span');
  const openBtn = h('button', { class: 'btn', type: 'button', onclick: copyAndOpen }, icon('external'), openBtnLabel);

  root.append(
    h(
      'div',
      { class: 'intro' },
      h(
        'p',
        null,
        '상황과 수준을 고르면 영어 튜터 요청문을 만들어 휴대폰의 ',
        h('b', null, 'ChatGPT · Gemini'),
        ' 앱으로 보내 줍니다.'
      )
    ),
    h(
      'section',
      { class: 'card' },
      field(
        'AI 앱',
        segmented(
          Object.entries(AI_APPS).map(([v, a]) => ({ value: v, label: a.label })),
          state.app,
          (v) => onOptionChange({ app: v }),
          { label: 'AI 앱' }
        )
      ),
      field('대화 상황', scenarioSelect),
      wordsNote,
      topicField,
      field(
        '내 영어 수준',
        segmented(
          Object.entries(LEVELS).map(([v, l]) => ({ value: v, label: `${l.label} ${l.hint}` })),
          state.level,
          (v) => onOptionChange({ level: v }),
          { label: '영어 수준' }
        )
      ),
      field('틀린 표현 교정', correctionSelect),
      toggle(
        '한국어 설명 포함',
        state.koreanHelp,
        (v) => onOptionChange({ koreanHelp: v }),
        '교정·정리는 한국어로, 대화는 영어로'
      ),
      toggle(
        '음성 대화용',
        state.voice,
        (v) => onOptionChange({ voice: v }),
        '짧은 문장·기호 없이 (ChatGPT 음성 모드, Gemini Live)'
      )
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h3', { class: 'card-title' }, icon('file'), '튜터 요청문'), regenBtn),
      h('p', { class: 'hint' }, '보내기 전에 자유롭게 고쳐도 됩니다.'),
      promptBox,
      h(
        'div',
        { class: 'stack actions' },
        navigator.share
          ? btn('공유로 보내기 (ChatGPT·Gemini 선택)', sendViaShare, { cls: 'btn primary', ico: 'share' })
          : null,
        openBtn,
        btn('복사만 하기', () => copyWithToast(promptBox.value), { cls: 'btn ghost', ico: 'copy' })
      )
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'card-title' }, icon('chat'), '대화 중에 쓰는 요청'),
      h('p', { class: 'hint' }, '누르면 복사됩니다. AI 앱 대화창에 붙여넣으세요.'),
      h(
        'div',
        { class: 'chips' },
        FOLLOW_UPS.map((f) =>
          h(
            'button',
            { class: 'chip', type: 'button', onclick: () => copyWithToast(f.text, `복사: ${f.text}`) },
            f.label
          )
        )
      )
    ),
    h(
      'details',
      { class: 'card tips' },
      h('summary', null, icon('info'), ' 사용 방법'),
      h(
        'ol',
        null,
        h(
          'li',
          null,
          h('b', null, '공유로 보내기'),
          '를 누르고 목록에서 ChatGPT 또는 Gemini를 고르면 요청문이 새 대화로 들어갑니다. 목록에 없으면 ',
          h('b', null, '복사하고 열기'),
          '를 쓰세요.'
        ),
        h(
          'li',
          null,
          '음성으로 대화하려면 요청문을 보낸 뒤 같은 대화방에서 음성 버튼을 누르세요 (ChatGPT: 음성 모드, Gemini: Live). 앱 버전에 따라 음성 모드가 앞의 요청문을 이어받지 못하면, 음성으로 "Please be my English tutor"라고 시작하세요.'
        ),
        h('li', null, '대화를 끝낼 때 "end session"이라고 말하면 틀린 표현과 유용한 표현을 정리해 줍니다.')
      )
    )
  );
  syncDependentUi();
  regenerate(true);
  window.addEventListener('words-changed', () => {
    syncDependentUi();
    if (getScenario(state.scenario).words) regenerate();
  });
}

/** #/tutor?scenario=review 처럼 상황을 지정해 열 수 있다 */
export function show(params) {
  const sc = params.get('scenario');
  if (sc && SCENARIOS.some((s) => s.id === sc) && sc !== state.scenario) {
    scenarioSelect.value = sc;
    onOptionChange({ scenario: sc });
  }
}

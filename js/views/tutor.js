// 1) AI 영어회화 튜터: 앱 안에서 바로 하는 음성 대화(Gemini Live)와,
//    요청문을 만들어 휴대폰의 ChatGPT·Gemini 앱으로 보내는 기능

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
  buildGeminiLiveUrl,
  buildSpokenOpener,
  getScenario,
} from '../lib/prompts.js';
import { createVoiceTutor } from '../components/voice-tutor.js';

let state;
let promptBox;
let edited = false;
let regenBtn;
let topicField;
let topicInput;
let scenarioSelect;
let openBtnLabel;
let wordsNote;
let openerText;
let voice;

function save() {
  updateSettings({ tutor: { ...state } });
}

function regenerate(force = false) {
  openerText.textContent = buildSpokenOpener({ ...state, words: listWords() });
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

function openApp(url) {
  if (isAndroid) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
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
  const label = AI_APPS[state.app].label;
  toast(
    copied
      ? `요청문을 복사했습니다. ${label}에 요청문이 들어가지 않았으면 입력창을 길게 눌러 붙여넣으세요.`
      : '복사하지 못했습니다. 미리보기의 글을 길게 눌러 직접 복사하세요.',
    { ms: 5000 }
  );
  openApp(buildAppLaunchUrl(state.app, text, { android: isAndroid }));
}

function openGeminiLive() {
  if (!topicReady()) return;
  toast('Gemini Live가 열리면 화면에 보이던 첫 문장을 소리 내어 말하세요.', { ms: 5000 });
  openApp(buildGeminiLiveUrl({ android: isAndroid }));
}

/** 필수 입력(토론 주제·상황 설명)이 비었으면 알리고 false */
function topicReady() {
  const sc = getScenario(state.scenario);
  if (sc.topic !== 'required' || String(state.topic || '').trim()) return true;
  toast(sc.id === 'custom' ? '상황 설명을 입력하세요.' : '토론 주제를 입력하세요.');
  topicInput.focus();
  return false;
}

function currentPrompt() {
  return topicReady() ? promptBox.value.trim() : '';
}

export function init(root) {
  state = { ...getSettings().tutor };
  voice = createVoiceTutor({ getOptions: () => (topicReady() ? { ...state, words: listWords() } : null) });

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
  openerText = h('p', { class: 'callout', lang: 'en' });

  root.append(
    h(
      'div',
      { class: 'intro' },
      h(
        'p',
        null,
        '버튼 하나로 AI 튜터와 바로 ',
        h('b', null, '영어로 말하며'),
        ' 연습하세요. 요청문을 휴대폰의 ChatGPT·Gemini 앱으로 보낼 수도 있습니다.'
      )
    ),
    voice.el,
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'card-title' }, icon('target'), '대화 설정'),
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
      )
    ),
    h('h2', { class: 'group-title' }, '다른 앱으로 연습 (ChatGPT·Gemini 앱)'),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h3', { class: 'card-title' }, icon('file'), '튜터 요청문'), regenBtn),
      field(
        'AI 앱',
        segmented(
          Object.entries(AI_APPS).map(([v, a]) => ({ value: v, label: a.label })),
          state.app,
          (v) => onOptionChange({ app: v }),
          { label: 'AI 앱' }
        )
      ),
      toggle(
        '음성 대화용',
        state.voice,
        (v) => onOptionChange({ voice: v }),
        '짧은 문장·기호 없이 (ChatGPT 음성 모드용)'
      ),
      h('p', { class: 'hint' }, '보내기 전에 자유롭게 고쳐도 됩니다. ChatGPT는 열리면 요청문이 바로 보내집니다.'),
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
      h('h3', { class: 'card-title' }, icon('mic'), '앱의 음성 모드로 바로 말하기'),
      h('p', { class: 'hint' }, 'Gemini Live는 요청문을 받을 수 없습니다. 열리면 먼저 이 문장을 소리 내어 말하세요.'),
      openerText,
      h('div', { class: 'stack actions' }, btn('Gemini Live 열기', openGeminiLive, { cls: 'btn', ico: 'external' })),
      h(
        'p',
        { class: 'hint' },
        h('b', null, 'ChatGPT 음성'),
        ': 휴대폰 설정에서 기본 디지털 어시스턴트 앱을 ChatGPT로 바꿔 두면(한 번만), 전원(측면) 버튼을 길게 눌러 바로 음성 대화를 열 수 있습니다. 열리면 위 문장으로 시작하세요.'
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
          h('b', null, '음성으로 바로 대화 시작'),
          '을 누르면 마이크 허용 → 연결 → 튜터의 첫인사까지 자동으로 이어집니다. 튜터가 말을 마치면 그냥 말하면 되고, 틀린 표현은 교정 카드로 보여 줍니다.'
        ),
        h(
          'li',
          null,
          '다른 앱을 쓰려면 ',
          h('b', null, '공유로 보내기'),
          '에서 ChatGPT 또는 Gemini를 고르세요. 목록에 없으면 ',
          h('b', null, '복사하고 열기'),
          '를 쓰세요. 음성으로 이어 가려면 같은 대화방에서 음성 버튼을 누르세요.'
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

/** 다른 탭으로 가면 음성 대화를 끝낸다 (마이크·연결·화면 켜짐 유지 정리) */
export function hide() {
  voice.stop();
}

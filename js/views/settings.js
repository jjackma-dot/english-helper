// 설정: Gemini 키, 무료 번역, 발음, 앱 설치·데이터 관리

import { h, btn, clear, toast, field, toggle, errorMessage, externalLink } from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, clearAllData, DEFAULT_GEMINI_MODEL } from '../store.js';
import { generate, listModels } from '../services/gemini.js';
import { getVoices, speak, ttsSupported } from '../speech.js';
import { VERSION } from '../version.js';
import { canInstall, promptInstall } from '../install.js';

function geminiSection() {
  const s = getSettings();
  const keyInput = h('input', {
    type: 'password',
    value: s.geminiKey,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'AIza…',
  });
  const modelInput = h('input', {
    type: 'text',
    value: s.geminiModel || DEFAULT_GEMINI_MODEL,
    list: 'gemini-models',
    spellcheck: 'false',
    autocapitalize: 'off',
  });
  const datalist = h('datalist', { id: 'gemini-models' });
  const modelsBox = h('div', { class: 'chips' });
  const status = h('p', { class: 'hint' });

  const saveKey = () => {
    updateSettings({ geminiKey: keyInput.value.trim(), geminiModel: modelInput.value.trim() || DEFAULT_GEMINI_MODEL });
  };
  keyInput.addEventListener('change', saveKey);
  modelInput.addEventListener('change', saveKey);

  const showKey = h('input', {
    type: 'checkbox',
    onchange: () => (keyInput.type = showKey.checked ? 'text' : 'password'),
  });

  const testBtn = btn(
    '연결 테스트',
    async () => {
      saveKey();
      if (!keyInput.value.trim()) return toast('키를 먼저 입력하세요.');
      testBtn.disabled = true;
      status.textContent = '확인 중…';
      try {
        const r = await generate({ prompt: 'Reply with the single word: OK', temperature: 0 });
        status.textContent = `연결 성공 (${getSettings().geminiModel}): ${String(r).trim().slice(0, 20)}`;
        status.className = 'hint ok-text';
      } catch (e) {
        status.textContent = errorMessage(e);
        status.className = 'hint error-text';
      } finally {
        testBtn.disabled = false;
      }
    },
    { cls: 'btn', ico: 'check' }
  );

  const listBtn = btn(
    '모델 목록 확인',
    async () => {
      saveKey();
      if (!keyInput.value.trim()) return toast('키를 먼저 입력하세요.');
      listBtn.disabled = true;
      try {
        const names = (await listModels()).filter(
          (n) => /gemini/i.test(n) && !/embedding|aqa|image|tts|live|audio/i.test(n)
        );
        clear(datalist).append(...names.map((n) => h('option', { value: n })));
        clear(modelsBox).append(
          ...names.slice(0, 30).map((n) =>
            h(
              'button',
              {
                type: 'button',
                class: `chip small${n === modelInput.value ? ' on' : ''}`,
                onclick: () => {
                  modelInput.value = n;
                  saveKey();
                  toast(`모델: ${n}`);
                  for (const c of modelsBox.children) c.classList.toggle('on', c.textContent === n);
                },
              },
              n
            )
          )
        );
        if (!names.length) modelsBox.append(h('span', { class: 'muted small' }, '사용할 수 있는 모델이 없습니다.'));
      } catch (e) {
        toast(errorMessage(e), { ms: 4000 });
      } finally {
        listBtn.disabled = false;
      }
    },
    { cls: 'btn ghost', ico: 'list' }
  );

  return h(
    'section',
    { class: 'card' },
    h('h3', { class: 'card-title' }, icon('zap'), 'Gemini API 키 (선택)'),
    h(
      'p',
      { class: 'hint' },
      '키를 넣으면 AI 한영사전·예문, 더 자연스러운 번역, 녹음 받아쓰기, OTT 대사 해설을 쓸 수 있습니다. Google AI Studio에서 무료 등급 키를 발급받을 수 있으며, 무료 등급에서는 입력 내용이 Google의 서비스 개선에 쓰일 수 있습니다.'
    ),
    externalLink('Google AI Studio에서 키 발급', 'https://aistudio.google.com/apikey'),
    field('API 키', keyInput),
    h('label', { class: 'inline-check' }, showKey, ' 키 보기'),
    field('모델', modelInput, `기본값 ${DEFAULT_GEMINI_MODEL} (최신 Flash 모델을 자동으로 사용)`),
    datalist,
    h('div', { class: 'row wrap' }, testBtn, listBtn),
    status,
    modelsBox,
    toggle(
      '사전·번역에 Gemini 사용',
      s.useGemini,
      (v) => updateSettings({ useGemini: v }),
      '끄면 키가 있어도 무료 API만 씁니다'
    ),
    btn(
      '키 지우기',
      () => {
        keyInput.value = '';
        saveKey();
        status.textContent = '';
        toast('키를 지웠습니다');
      },
      { cls: 'btn small ghost', ico: 'trash' }
    ),
    h(
      'p',
      { class: 'hint' },
      icon('info', { size: 14 }),
      ' 키는 이 기기의 브라우저 저장소에만 보관되고 Google API 호출에만 쓰입니다. 공용 기기에서는 넣지 마세요.'
    )
  );
}

function myMemorySection() {
  const s = getSettings();
  const email = h('input', {
    type: 'email',
    value: s.myMemoryEmail,
    placeholder: 'you@example.com',
    autocomplete: 'email',
    onchange: () => updateSettings({ myMemoryEmail: email.value.trim() }),
  });
  return h(
    'section',
    { class: 'card' },
    h('h3', { class: 'card-title' }, icon('globe'), '무료 번역 (MyMemory)'),
    h(
      'p',
      { class: 'hint' },
      'Gemini 키가 없을 때 쓰는 무료 번역입니다. 하루 사용량 제한이 있으며(익명 약 5,000자), 이메일을 넣으면 한도가 약 50,000자로 늘어납니다. 이메일은 MyMemory에만 전달됩니다.'
    ),
    field('이메일 (선택)', email)
  );
}

function speechSection() {
  const s = getSettings();
  const voiceSelect = h('select', { onchange: () => updateSettings({ voiceURI: voiceSelect.value }) });
  const fillVoices = () => {
    const current = getSettings().voiceURI;
    const voices = getVoices('en');
    clear(voiceSelect).append(
      h('option', { value: '' }, '자동 (미국 영어 우선)'),
      ...voices.map((v) =>
        h('option', { value: v.voiceURI, selected: v.voiceURI === current }, `${v.name} (${v.lang})`)
      )
    );
  };
  fillVoices();
  window.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
  const rateOut = h('output', null, `${s.ttsRate.toFixed(2)}배`);
  const rate = h('input', {
    type: 'range',
    min: '0.5',
    max: '1.3',
    step: '0.05',
    value: String(s.ttsRate),
    oninput: () => {
      rateOut.textContent = `${(+rate.value).toFixed(2)}배`;
      updateSettings({ ttsRate: +rate.value });
    },
  });
  return h(
    'section',
    { class: 'card' },
    h('h3', { class: 'card-title' }, icon('volume'), '발음 듣기'),
    ttsSupported ? null : h('p', { class: 'error-text' }, '이 브라우저는 음성 읽기를 지원하지 않습니다.'),
    field('영어 음성', voiceSelect, '휴대폰에 설치된 음성 엔진 목록입니다 (안드로이드: 설정 → 텍스트 음성 변환).'),
    field('읽기 속도', h('div', { class: 'row' }, rate, rateOut)),
    btn('들어보기', () => speak('Hello! Nice to meet you. How was your day?'), { cls: 'btn ghost', ico: 'volume' })
  );
}

function appSection() {
  const installBox = h('div');
  const renderInstall = () => {
    clear(installBox).append(
      canInstall()
        ? btn('홈 화면에 앱 설치', promptInstall, { cls: 'btn primary', ico: 'download' })
        : h(
            'p',
            { class: 'hint' },
            matchMedia('(display-mode: standalone)').matches
              ? '앱으로 설치되어 실행 중입니다.'
              : '크롬 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 쓸 수 있습니다.'
          )
    );
  };
  renderInstall();
  window.addEventListener('install-state', renderInstall);
  return h(
    'section',
    { class: 'card' },
    h('h3', { class: 'card-title' }, icon('settings'), '앱'),
    installBox,
    btn(
      '모든 데이터 지우기',
      async () => {
        if (!confirm('단어장, 기록, 자막 보관함, 설정(Gemini 키 포함)을 모두 지울까요? 되돌릴 수 없습니다.')) return;
        await clearAllData();
        toast('모두 지웠습니다. 다시 불러옵니다.');
        setTimeout(() => location.reload(), 800);
      },
      { cls: 'btn danger ghost', ico: 'trash' }
    ),
    h(
      'details',
      null,
      h('summary', null, '사용하는 외부 서비스 · 출처'),
      h(
        'ul',
        { class: 'small' },
        h('li', null, '영영사전·발음: Free Dictionary API (dictionaryapi.dev, Wiktionary 기반 CC BY-SA)'),
        h('li', null, '한→영 풀이: Wiktionary (CC BY-SA)'),
        h('li', null, '무료 번역: MyMemory (Translated)'),
        h('li', null, '이미지: Openverse (각 이미지의 CC 라이선스)'),
        h('li', null, 'AI 기능(선택): Google Gemini API'),
        h('li', null, '아이콘: Feather Icons (MIT)')
      )
    ),
    h('p', { class: 'muted small' }, `English Helper · 버전 ${VERSION}`)
  );
}

export function init(root) {
  root.append(geminiSection(), myMemorySection(), speechSection(), appSection());
}

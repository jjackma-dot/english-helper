// 설정: Gemini 키, 무료 번역, 발음, 앱 설치·데이터 관리

import {
  h,
  btn,
  clear,
  toast,
  field,
  toggle,
  errorMessage,
  externalLink,
  isIOS,
  inAppBrowser,
  isStandalone,
} from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, clearAllData, DEFAULT_GEMINI_MODEL } from '../store.js';
import { generate, listModels } from '../services/gemini.js';
import { getVoices, speak, ttsSupported } from '../speech.js';
import { VERSION } from '../version.js';
import { canInstall, promptInstall, IOS_INSTALL_SHORT } from '../install.js';

// 글로 답하지 않는 모델 (음성·이미지·영상 생성, 받아쓰기 전용 등): 고르면 사전·번역이 모두 실패한다
const NOT_TEXT_MODEL = /embedding|aqa|image|tts|live|audio|transcribe|nano-banana|omni|robotics|veo|imagen|lyria/i;

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
        let used = getSettings().geminiModel;
        const r = await generate({
          prompt: 'Reply with the single word: OK',
          fallback: false,
          onMeta: (m) => (used = m.modelVersion),
        });
        status.textContent = `연결 성공 (${used}): ${String(r).trim().slice(0, 20)}`;
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
        const names = (await listModels()).filter((n) => /gemini/i.test(n) && !NOT_TEXT_MODEL.test(n));
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
      '키를 넣으면 앱 안에서 바로 하는 AI 음성 영어회화, AI 한영사전·예문, 더 자연스러운 번역, 녹음 받아쓰기, OTT 대사 해설을 쓸 수 있습니다. Google AI Studio에서 무료 등급 키를 발급받을 수 있습니다.'
    ),
    h(
      'p',
      { class: 'hint' },
      'Gemini API 약관상 만 18세 이상만 쓸 수 있어요. 무료 등급에서는 입력 내용(음성 포함)이 Google의 서비스 개선에 쓰이고 Google 검토자가 볼 수도 있으니 민감한 내용은 넣지 마세요.'
    ),
    // 아이폰 Safari 탭은 7일 동안 열지 않으면 저장소가 지워질 수 있다 (홈 화면 앱은 예외)
    isIOS && !isStandalone() && !inAppBrowser
      ? h(
          'p',
          { class: 'callout warn' },
          '아이폰 Safari 탭에서 쓰면 7일 넘게 열지 않을 때 키·단어장이 지워질 수 있어요. 홈 화면에 추가한 앱에서 쓰세요.'
        )
      : null,
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
      ' 키·단어장·기록은 이 기기(브라우저)에만 저장돼요. 다른 기기(가족 휴대폰 등)에서는 그 기기에서 따로 넣어야 해요. 키는 Google API 호출에만 쓰이니 공용 기기에서는 넣지 마세요.'
    ),
    h('p', { class: 'hint' }, '같은 키(같은 Google 프로젝트)를 여러 기기에서 쓰면 하루 무료 한도를 함께 써요.')
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
    field(
      '영어 음성',
      voiceSelect,
      isIOS
        ? '휴대폰에 설치된 음성 목록입니다 (아이폰: 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 영어에서 더 자연스러운 음성을 내려받을 수 있어요).'
        : '휴대폰에 설치된 음성 엔진 목록입니다 (안드로이드: 설정 → 텍스트 음성 변환).'
    ),
    field('읽기 속도', h('div', { class: 'row' }, rate, rateOut)),
    btn('들어보기', () => speak('Hello! Nice to meet you. How was your day?'), { cls: 'btn ghost', ico: 'volume' })
  );
}

/** 설치 버튼을 띄울 수 없을 때의 안내 (아이폰은 설치 창이 없고, 앱 안 브라우저는 설치가 안 됨) */
function installHint() {
  if (isStandalone()) return '앱으로 설치되어 실행 중입니다.';
  if (inAppBrowser) {
    return '카카오톡 같은 앱 안의 브라우저에서는 설치할 수 없어요. 메뉴의 "다른 브라우저로 열기"(아이폰은 Safari, 안드로이드는 크롬)로 여세요.';
  }
  if (isIOS) return IOS_INSTALL_SHORT;
  return '크롬 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 쓸 수 있습니다.';
}

function appSection() {
  const installBox = h('div');
  const renderInstall = () => {
    clear(installBox).append(
      canInstall()
        ? btn('홈 화면에 앱 설치', promptInstall, { cls: 'btn primary', ico: 'download' })
        : h('p', { class: 'hint' }, installHint())
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

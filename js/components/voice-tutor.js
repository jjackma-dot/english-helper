// AI 회화 탭의 앱 안 음성 튜터: 버튼 한 번이면 마이크 → Gemini Live 연결 → 튜터가 먼저 말을 건다.
// Live를 쓸 수 없으면 기본 음성 모드(음성 인식 + Gemini 글 답변 + 기기 음성)로 저절로 바꿔 이어 간다.

import { h, btn, toast, toggle } from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, addWord } from '../store.js';
import { buildVoiceTutorSystem } from '../lib/prompts.js';
import { apiKey } from '../services/gemini.js';
import { liveBlocked, liveSupported, startLive } from '../services/live.js';
import { fallbackSupported, startFallback } from '../services/voice-fallback.js';
import { keepAwake } from '../services/wake-lock.js';

const STATUS = {
  connecting: '연결 중…',
  listening: '듣는 중 · 말해 보세요',
  thinking: '튜터가 생각하는 중…',
  speaking: '튜터가 말하는 중',
  reconnecting: '다시 연결 중…',
  paused: '일시정지됨',
};
const AWAY_MS = 3 * 60 * 1000; // 다른 앱으로 가거나 화면을 끈 채 이만큼 지나면 대화를 끝낸다 (마이크·연결 정리)
const LATE_TEXT_MS = 1500; // 차례가 끝난 뒤 이만큼 안에 온 받아쓰기는 끝난 차례의 말풍선에 붙인다 (순서가 어긋나 올 수 있음)
const BASIC_NOTE = '기본 음성 모드(음성 인식 + 기기 음성)로 대화합니다.';

/**
 * @param {{getOptions: () => object|null}} o getOptions: 지금 튜터 옵션(+words). 시작할 수 없으면 null
 * @returns {{el: HTMLElement, stop: () => void}} stop: 진행 중인 대화를 끝낸다 (다른 탭으로 갈 때)
 */
export function createVoiceTutor({ getOptions }) {
  let session = null; // 진행 중인 대화 {stop, setPaused, setDuplex?}
  let engine = '';
  let status = '';
  let paused = false;
  let autoPaused = false; // 다른 앱으로 가거나 화면이 꺼져 저절로 멈춤
  let awayTimer = 0;
  let turn = {}; // 지금 차례의 말풍선·교정 카드 {me, tutor, fix, endedAt}
  let interimEl = null;
  let level = -1;

  const startLabel = h('span', null, '음성으로 바로 대화 시작');
  const startBtn = h(
    'button',
    { class: 'btn primary voice-start', type: 'button', onclick: start },
    icon('mic', { size: 24 }),
    startLabel
  );
  const keyBox = h(
    'div',
    { class: 'stack' },
    h(
      'p',
      { class: 'callout' },
      '앱 안에서 바로 음성 대화를 하려면 무료 Gemini API 키가 필요합니다 (Google AI Studio에서 무료로 발급). 키가 없어도 아래 ',
      h('b', null, '다른 앱으로 연습'),
      '은 쓸 수 있습니다.'
    ),
    h(
      'a',
      { class: 'btn primary voice-start', href: '#/settings' },
      icon('settings', { size: 22 }),
      '설정에서 무료 키 넣기'
    )
  );
  const statusText = h('span');
  const engineBadge = h('span', { class: 'badge' });
  const statusRow = h('div', { class: 'voice-status' }, h('span', { class: 'voice-dot' }), statusText, engineBadge);
  const levelBar = h('div', { class: 'level-bar' });
  const levelBox = h('div', { class: 'level' }, levelBar);
  const log = h('div', { class: 'voice-log', role: 'log', 'aria-label': '대화 내용' });
  const pauseBtn = h('button', { class: 'btn', type: 'button', onclick: () => setPaused(!paused) });
  const controls = h(
    'div',
    { class: 'voice-controls' },
    pauseBtn,
    btn('끝내기', () => finish(), { cls: 'btn danger', ico: 'stop' })
  );
  const notice = h('p', { class: 'hint', hidden: true });
  const duplexToggle = toggle(
    '이어폰 사용 (말 끊기 허용)',
    getSettings().voiceDuplex,
    (v) => {
      updateSettings({ voiceDuplex: v });
      session?.setDuplex?.(v);
    },
    '끄면 튜터가 말하는 동안 마이크를 잠시 멈춰 스피커 소리를 다시 듣지 않습니다.'
  );

  const el = h(
    'section',
    { class: 'card voice-card' },
    h('h3', { class: 'card-title' }, icon('mic'), '음성으로 바로 대화'),
    h(
      'p',
      { class: 'hint' },
      '한 번 누르면 마이크를 켜고 AI 튜터가 먼저 영어로 말을 겁니다. 아래 대화 설정(상황·수준·교정)이 그대로 쓰입니다.'
    ),
    startBtn,
    keyBox,
    notice,
    statusRow,
    levelBox,
    log,
    controls,
    duplexToggle,
    h(
      'p',
      { class: 'hint' },
      icon('info', { size: 14 }),
      ' 대화 음성과 글은 Google Gemini로 전송되며, 무료 등급에서는 Google의 서비스 개선에 쓰일 수 있습니다.'
    )
  );

  function render() {
    const running = Boolean(session);
    const hasKey = Boolean(apiKey());
    startBtn.hidden = running || !hasKey;
    keyBox.hidden = running || hasKey;
    duplexToggle.hidden = !hasKey;
    statusRow.hidden = !running;
    controls.hidden = !running;
    levelBox.hidden = !running || engine !== 'live';
    log.hidden = !log.childElementCount;
    startLabel.textContent = log.childElementCount ? '새 대화 시작' : '음성으로 바로 대화 시작';
    pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause'), h('span', null, paused ? '이어서 대화' : '일시정지'));
    const state = paused ? 'paused' : status;
    statusRow.dataset.state = state;
    statusText.textContent = STATUS[state] || '';
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.className = isError ? 'hint error-text' : 'hint';
    notice.hidden = false;
  }

  function start() {
    const options = getOptions();
    if (!options || session) return;
    log.replaceChildren();
    turn = {};
    paused = autoPaused = false;
    notice.hidden = true;
    const blocked = liveBlocked();
    if (liveSupported && !blocked) begin('live', options);
    else if (fallbackSupported) {
      showNotice(`${blocked || '이 브라우저는 Gemini Live 음성 처리를 지원하지 않습니다.'} ${BASIC_NOTE}`);
      begin('basic', options);
    } else {
      showNotice('이 브라우저에서는 음성 대화를 할 수 없습니다. 안드로이드 크롬을 사용하세요.', true);
      return;
    }
    keepAwake('tutor', true); // 대화 중에는 화면이 꺼지지 않게
  }

  function begin(kind, options) {
    engine = kind;
    status = kind === 'live' ? 'connecting' : 'thinking';
    engineBadge.textContent = kind === 'live' ? 'Gemini Live' : '기본 음성 모드';
    const on = {
      status: (s) => {
        status = s;
        render();
      },
      userText: (t) => addText('me', t),
      tutorText: (t) => addText('tutor', t),
      interim: showInterim,
      turnStart: () => {
        if (turn.endedAt) turn = {};
      },
      turnEnd: () => (turn.endedAt = performance.now()),
      interrupted: () => {
        turn.tutor?.classList.add('cut');
        turn = {};
      },
      correction: addCorrection,
      level: setLevel,
      idle: () => {
        setPaused(true);
        showNotice('한동안 말소리가 없어 잠시 멈췄습니다. "이어서 대화"를 누르면 다시 듣습니다.');
      },
      fail: (info) => failed(kind, options, info),
    };
    session =
      kind === 'live'
        ? startLive({ system: buildVoiceTutorSystem(options), duplex: getSettings().voiceDuplex, on })
        : startFallback({ system: buildVoiceTutorSystem(options, { live: false }), on });
    render();
  }

  /** 대화 엔진이 스스로 끝났을 때: Live가 안 되면 기본 음성 모드로 이어 가고, 그 밖에는 이유를 보여 준다 */
  function failed(kind, options, info) {
    session = null;
    if (kind === 'live' && info.kind !== 'mic' && info.kind !== 'key' && fallbackSupported) {
      showNotice(`${info.message} ${BASIC_NOTE}`);
      turn = {};
      begin('basic', options);
      if (paused) session.setPaused(true);
      return;
    }
    finish(info.message);
  }

  function finish(message) {
    const s = session;
    session = null;
    s?.stop();
    clearTimeout(awayTimer);
    keepAwake('tutor', false);
    showInterim('');
    paused = autoPaused = false;
    if (message) showNotice(message, true);
    render();
  }

  function setPaused(v) {
    if (!session) return;
    paused = v;
    session.setPaused(v);
    keepAwake('tutor', !v);
    if (!v) {
      autoPaused = false;
      clearTimeout(awayTimer);
      notice.hidden = true;
    }
    render();
  }

  function autoPause() {
    if (!session || paused) return;
    setPaused(true);
    autoPaused = true;
    awayTimer = setTimeout(() => finish(), AWAY_MS);
  }

  function autoResume() {
    if (session && autoPaused) setPaused(false);
  }

  function reveal() {
    log.hidden = false;
    log.scrollTop = log.scrollHeight;
  }

  function addText(role, text) {
    if (role === 'me') showInterim('');
    if (turn.endedAt && performance.now() - turn.endedAt > LATE_TEXT_MS) turn = {};
    let b = turn[role];
    if (!b) {
      b = h('div', { class: `bubble ${role}`, lang: 'en' });
      turn[role] = b;
      // 받아쓰기는 순서가 뒤바뀌어 올 수 있다: 내 말이 튜터 답보다 늦게 오면 그 앞에 넣는다
      if (role === 'me' && turn.tutor) turn.tutor.before(b);
      else log.append(b);
    }
    b.textContent = (b.textContent + text).replace(/\s+/g, ' ').trimStart();
    reveal();
  }

  /** 기본 음성 모드에서 아직 듣는 중인 내 말 */
  function showInterim(text) {
    if (!text) {
      interimEl?.remove();
      interimEl = null;
      return;
    }
    if (!interimEl) {
      interimEl = h('div', { class: 'bubble me interim', lang: 'en' });
      log.append(interimEl);
    }
    interimEl.textContent = text;
    reveal();
  }

  function addCorrection({ original, corrected, explanation_ko: why } = {}) {
    const fixed = String(corrected || '').trim();
    if (!fixed) return;
    const said = String(original || '').trim();
    const meaning = String(why || '').trim();
    const save = btn(
      '단어장에 저장',
      () => {
        addWord({
          text: fixed,
          meaning,
          type: 'sentence',
          source: 'AI 회화',
          context: said ? `내가 한 말: ${said}` : '',
        });
        save.disabled = true;
        toast('단어장에 저장했습니다');
      },
      { cls: 'chip small', ico: 'star' }
    );
    const card = h(
      'div',
      { class: 'fix-card' },
      h('div', { class: 'fix-head' }, icon('edit', { size: 16 }), '이렇게 말하면 더 자연스러워요'),
      said ? h('p', { class: 'fix-orig', lang: 'en' }, said) : null,
      h('p', { class: 'fix-new', lang: 'en' }, fixed),
      meaning ? h('p', { class: 'hint' }, meaning) : null,
      save
    );
    const after = turn.fix || turn.me;
    if (after) after.after(card);
    else log.append(card);
    turn.fix = card;
    reveal();
  }

  function setLevel(v) {
    const pct = Math.min(100, Math.round(v * 160));
    if (pct === level) return;
    level = pct;
    levelBar.style.width = `${pct}%`;
  }

  // 다른 앱으로 가거나 화면이 꺼지면 잠시 멈추고(화면 켜짐 유지도 풀림), 돌아오면 이어 간다
  document.addEventListener('visibilitychange', () => (document.hidden ? autoPause() : autoResume()));
  window.addEventListener('settings-changed', render);
  render();

  return { el, stop: () => finish() };
}

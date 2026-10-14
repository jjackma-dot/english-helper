// AI 회화 탭의 앱 안 음성 튜터: 버튼 한 번이면 마이크 → Gemini Live 연결 → 튜터가 먼저 말을 건다.
// Live를 쓸 수 없으면 기본 음성 모드(음성 인식 + Gemini 글 답변 + 기기 음성)로 저절로 바꿔 이어 간다.
// 대화 중에는 카드가 머리글과 아래 탭 사이에 꼭 맞게 바뀌어 상태·대화·버튼이 모두 보이고, 대화 내용만 스크롤된다.

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
const FOLLOW_PX = 48; // 대화 내용이 맨 아래에서 이만큼 안이면 새 말을 따라 내려간다 (위로 올려 읽는 중이면 그대로 둔다)
const BASIC_NOTE = '기본 음성 모드(음성 인식 + 기기 음성)로 대화합니다.';

/**
 * @param {{getOptions: () => object|null}} o getOptions: 지금 튜터 옵션(+words). 시작할 수 없으면 null
 * @returns {{el: HTMLElement, stop: () => void}} stop: 진행 중인 대화를 끝낸다 (다른 탭으로 갈 때)
 */
export function createVoiceTutor({ getOptions }) {
  let session = null; // 진행 중인 대화 {stop, setPaused, interrupt, setBargeIn?}
  let engine = '';
  let status = '';
  let paused = false;
  let autoPaused = false; // 다른 앱으로 가거나 화면이 꺼져 저절로 멈춤
  let awayTimer = 0;
  let turn = {}; // 지금 차례의 말풍선·교정 카드 {me, tutor, fix, endedAt, cut}. cut: 튜터 말을 끊음 (다음 답까지 튜터 글은 버림)
  let interimEl = null;
  let level = -1;
  let follow = true; // 대화 내용을 맨 아래에 붙여 새 말을 따라간다

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
  const introHint = h(
    'p',
    { class: 'hint' },
    '한 번 누르면 마이크를 켜고 AI 튜터가 먼저 영어로 말을 겁니다. 아래 대화 설정(상황·수준·교정)이 그대로 쓰입니다.'
  );
  const statusText = h('span');
  const engineBadge = h('span', { class: 'badge' });
  const statusRow = h('div', { class: 'voice-status' }, h('span', { class: 'voice-dot' }), statusText, engineBadge);
  const levelBar = h('div', { class: 'level-bar' });
  const levelBox = h('div', { class: 'level' }, levelBar);
  const log = h('div', {
    class: 'voice-log',
    role: 'log',
    'aria-label': '대화 내용',
    onscroll: () => (follow = log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_PX),
  });
  // 안내 문구가 나타나거나 화면을 돌려 대화 칸이 작아져도 맨 아래(새 말)를 계속 보여 준다
  if (window.ResizeObserver) new ResizeObserver(() => follow && (log.scrollTop = log.scrollHeight)).observe(log);
  const cutBtn = btn('말 끊기', interrupt, { cls: 'btn primary', ico: 'volumeX' });
  const pauseBtn = h('button', { class: 'btn', type: 'button', onclick: () => setPaused(!paused) });
  const controls = h(
    'div',
    { class: 'voice-controls' },
    cutBtn,
    pauseBtn,
    btn('끝내기', () => finish(), { cls: 'btn danger', ico: 'stop' })
  );
  const notice = h('p', { class: 'hint', hidden: true });
  const bargeToggle = toggle(
    '말로 끊기',
    getSettings().voiceBargeIn,
    (v) => {
      updateSettings({ voiceBargeIn: v });
      session?.setBargeIn?.(v);
    },
    '튜터가 말하는 중에 내가 말하면 튜터가 멈춥니다. 이어폰이 가장 확실하고, 스피커로도 됩니다(휴대폰마다 다름). 튜터가 저절로 자꾸 끊기면 끄고 "말 끊기" 버튼을 쓰세요.'
  );
  const privacyHint = h(
    'p',
    { class: 'hint' },
    icon('info', { size: 14 }),
    ' 대화 음성과 글은 Google Gemini로 전송되며, 무료 등급에서는 Google의 서비스 개선에 쓰일 수 있습니다.'
  );

  const el = h(
    'section',
    { class: 'card voice-card' },
    h('h3', { class: 'card-title' }, icon('mic'), '음성으로 바로 대화'),
    introHint,
    startBtn,
    keyBox,
    notice,
    statusRow,
    levelBox,
    log,
    controls,
    bargeToggle,
    privacyHint
  );

  /** 튜터가 말하는 중 ("말 끊기"를 쓸 수 있음). 기본 음성 모드는 답을 받는 동안도 포함 */
  const tutorTalking = () =>
    Boolean(session) && !paused && (status === 'speaking' || (engine === 'basic' && status === 'thinking'));

  function render() {
    const running = Boolean(session);
    const hasKey = Boolean(apiKey());
    el.classList.toggle('running', running);
    introHint.hidden = running;
    privacyHint.hidden = running;
    startBtn.hidden = running || !hasKey;
    keyBox.hidden = running || hasKey;
    bargeToggle.hidden = !hasKey || (running && engine === 'basic'); // 기본 음성 모드는 버튼으로만 끊는다
    statusRow.hidden = !running;
    controls.hidden = !running;
    levelBox.hidden = !running || engine !== 'live';
    log.hidden = !running && !log.childElementCount; // 대화 중에는 비어 있어도 자리를 지켜 버튼이 아래에 머문다
    startLabel.textContent = log.childElementCount ? '새 대화 시작' : '음성으로 바로 대화 시작';
    cutBtn.disabled = !tutorTalking();
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
    follow = true;
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
    el.scrollIntoView({ block: 'start', behavior: 'smooth' }); // 카드를 화면 위에 맞춰 상태·대화·버튼이 모두 보이게
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
        else if (turn.barge) turn = { me: turn.me }; // 말로 끊은 내 말에 대한 답: 새 말풍선으로 내 말 아래에
        else delete turn.cut; // 끊은 뒤의 새 답: 그사이 한 내 말과 같은 차례로 쓴다
      },
      bargeIn: () => {
        // 튜터가 말하는 중에 내가 말하기 시작함: 내 말은 튜터 말풍선 아래 새 말풍선에 쓴다
        if (!turn.cut && !turn.barge) turn = { tutor: turn.tutor, barge: true };
      },
      turnEnd: () => {
        if (!turn.cut) turn.endedAt = performance.now();
      },
      interrupted: () => cutTurn(true),
      correction: addCorrection,
      level: setLevel,
      notice: (message) => showNotice(message),
      idle: () => {
        setPaused(true);
        showNotice('한동안 말소리가 없어 잠시 멈췄습니다. "이어서 대화"를 누르면 다시 듣습니다.');
      },
      fail: (info) => failed(kind, options, info),
    };
    session =
      kind === 'live'
        ? startLive({ system: buildVoiceTutorSystem(options), bargeIn: getSettings().voiceBargeIn, on })
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

  /** "말 끊기" 버튼: 튜터 말을 바로 멈추고 내 차례로 */
  function interrupt() {
    if (tutorTalking()) session.interrupt();
  }

  /** 튜터 말이 끊김: 말풍선에 끊김 표시를 하고, 다음 답이 시작될 때까지 끊은 답의 글(듣지 못한 말)은 쓰지 않는다 */
  function cutTurn(mark) {
    if (turn.cut) return;
    if (mark) turn.tutor?.classList.add('cut');
    turn = turn.barge ? { cut: true, me: turn.me } : { cut: true }; // 말로 끊었으면 이어지는 내 말은 같은 말풍선에
  }

  function setPaused(v) {
    if (!session) return;
    if (v) cutTurn(tutorTalking()); // 멈추면 만들던 답이 버려지므로, 다시 시작한 말은 새 말풍선에 쓴다
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
    if (!session) return;
    if (!paused) {
      setPaused(true);
      autoPaused = true;
    }
    // 이미 멈춘 채로 떠나도 오래 비우면 마이크·연결을 닫는다
    clearTimeout(awayTimer);
    awayTimer = setTimeout(() => finish(), AWAY_MS);
  }

  function autoResume() {
    if (session && autoPaused) setPaused(false);
  }

  /** 새 말을 보여 준다. 위로 올려 지난 말을 읽는 중이면 끌어내리지 않는다 */
  function reveal() {
    log.hidden = false;
    if (follow) log.scrollTop = log.scrollHeight;
  }

  function addText(role, text) {
    if (role === 'me') showInterim('');
    else if (turn.cut) return; // 끊은 답의 나머지는 학습자가 듣지 못한 말이다
    if (turn.endedAt && performance.now() - turn.endedAt > LATE_TEXT_MS) turn = {};
    let b = turn[role];
    if (!b) {
      b = h('div', { class: `bubble ${role}`, lang: 'en' });
      turn[role] = b;
      // 받아쓰기는 순서가 뒤바뀌어 올 수 있다: 내 말이 튜터 답보다 늦게 오면 그 앞에 넣는다 (끼어든 말은 뒤에)
      if (role === 'me' && turn.tutor && !turn.barge) turn.tutor.before(b);
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

// OTT "방금 뭐라고?": 자막 없이 보다가 놓친 대사를 버튼 한 번으로 받아쓰고 해석한다.
// 듣는 동안 마이크 소리는 이 기기 메모리에 최근 45초만 남기고 계속 지우며, 버튼을 누를 때만 그 구간을 Gemini로 보낸다.

import { h, btn, iconBtn, clear, toast, errorMessage, segmented } from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, geminiEnabled, addWord } from '../store.js';
import { recordingSupported } from '../services/recorder.js';
import { startListening, playClip } from '../services/listen-buffer.js';
import { explainClip } from '../services/translate.js';
import { keepAwake } from '../services/wake-lock.js';
import { speak } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';

const CLIP_CHOICES = [10, 20, 30];
const KEEP_SECONDS = 45;
const TAIL_MS = 1000; // 누른 뒤 1초 더 들어서 말하던 대사를 끝까지 담는다
const QUIET_RMS = 0.003; // 약 -50dBFS. 최근 5초가 이보다 작으면 마이크에 소리가 거의 안 들리는 것
const SOURCE = 'OTT 듣기';
const CONFIDENCE = {
  high: '잘 들렸어요.',
  medium: '일부 단어는 확실하지 않아요.',
  low: '잘 안 들려서 틀렸을 수 있어요. 볼륨을 키우거나 휴대폰을 스피커 가까이 두세요.',
};

const ui = {};
let listener = null; // startListening() 결과
let session = 0; // 시작·정지할 때마다 늘려서, 그사이 끝난 시작 요청을 버린다
let starting = false;
let capturing = false; // 누른 뒤 1초 더 듣는 중
let startedAt = 0;
let healthTimer = 0;
let micLost = false;
let muted = false;
let wasHidden = false;
let request = null; // 진행 중인 해석 요청 (AbortController)
let replay = null; // 재생 중인 "느리게 다시 듣기"

/* ---------- 듣기 시작·정지 ---------- */

async function start() {
  const my = ++session;
  starting = true;
  renderState();
  let l = null;
  try {
    l = await startListening({
      keepSeconds: KEEP_SECONDS,
      // -60dB(조용함) ~ -10dB(아주 큼)을 막대 0~100%로
      onLevel: (v) => (ui.meter.style.width = `${Math.max(0, Math.min(100, (Math.log10(v + 1e-6) * 20 + 60) * 2))}%`),
      onEnded: () => {
        micLost = true;
        if (document.visibilityState === 'visible') reconnect();
      },
      onMute: (m) => {
        muted = m;
        checkHealth();
      },
    });
  } catch (e) {
    if (my === session) toast(errorMessage(e), { ms: 5000 });
  }
  if (my !== session) return l?.stop(); // 그사이 정지했거나 다른 탭으로 갔다
  starting = false;
  if (l) {
    listener = l;
    startedAt = Date.now();
    micLost = muted = wasHidden = false;
    keepAwake('listen', true);
    healthTimer = setInterval(checkHealth, 1000);
  }
  renderState();
}

/** 마이크를 끄고 보관하던 소리를 지운다 (정지 버튼, 다른 탭으로 갈 때) */
export function stopListening() {
  session++;
  starting = false;
  listener?.stop();
  listener = null;
  clearInterval(healthTimer);
  keepAwake('listen', false);
  stopReplay();
  renderState();
}

/** 마이크가 끊기면(다른 앱이 가져감 등) 다시 연결한다. 연결하자마자 또 끊기면 그만둔다 */
function reconnect() {
  const quick = Date.now() - startedAt < 5000;
  stopListening();
  if (!quick) return start();
  toast('마이크 연결이 끊겼습니다. 다른 앱이 마이크를 쓰는지 확인하고 다시 시작하세요.', { ms: 5000 });
}

function onVisibility() {
  if (!listener) return;
  if (document.visibilityState === 'hidden') wasHidden = true;
  else if (micLost) reconnect();
  else checkHealth();
}

/** 듣기 상태 안내: 마이크 막힘 > 소리가 안 들림 > 화면에서 사라졌었음 */
function checkHealth() {
  const msg = !listener
    ? ''
    : micLost || muted
      ? '마이크가 막혀 있어요. 통화·녹음 앱이 마이크를 쓰고 있는지 확인하세요.'
      : Date.now() - startedAt > 5000 && listener.level(5) < QUIET_RMS
        ? '마이크에 소리가 안 들려요 (볼륨을 키우거나 휴대폰을 스피커 가까이)'
        : wasHidden
          ? '이 앱이 화면에서 사라지면 소리를 듣지 못할 수 있어요. 분할 화면이나 넷플릭스 작은 창(PIP)으로 함께 띄워 두세요.'
          : '';
  if (ui.warn.textContent !== msg) ui.warn.textContent = msg;
  ui.warn.hidden = !msg;
}

/** 키가 없으면: 듣기·느리게 다시 듣기는 되고, 받아쓰기·해석에는 무료 키가 필요하다고 알린다 */
function renderKeyHint() {
  ui.keyHint.hidden = geminiEnabled();
}

function renderState() {
  const on = Boolean(listener);
  ui.card.classList.toggle('on', on);
  ui.badge.textContent = on ? '듣는 중' : starting ? '마이크 여는 중…' : '꺼짐';
  ui.badge.classList.toggle('live', on);
  ui.live.hidden = !on;
  if (!on) ui.meter.style.width = '0%';
  ui.main.classList.toggle('idle', !on);
  ui.main.disabled = starting || capturing || !recordingSupported;
  ui.main.replaceChildren(
    icon(on ? 'back' : 'mic', { size: 26 }),
    h('span', null, capturing ? '끝까지 듣는 중…' : on ? '방금 뭐라고?' : '듣기 시작')
  );
  checkHealth();
}

/* ---------- "방금 뭐라고?" ---------- */

async function ask() {
  const seconds = getSettings().ottListenSeconds;
  const l = listener;
  capturing = true;
  wasHidden = false;
  renderState();
  await new Promise((r) => setTimeout(r, TAIL_MS));
  capturing = false;
  const clip = listener === l ? l.snapshot(seconds) : null; // 그사이 정지했으면 없음
  renderState();
  if (!clip) return;
  if (clip.seconds < 1) return toast('아직 들은 소리가 없습니다. 잠시 뒤에 다시 누르세요.');
  showClip(clip);
}

const list = (v) => (Array.isArray(v) ? v : []);

function showClip(clip) {
  request?.abort();
  stopReplay();
  const body = h('div', { class: 'stack' });
  const replayBtn = btn('느리게 다시 듣기', () => toggleReplay(clip.blob, replayBtn), { cls: 'chip', ico: 'volume' });
  clear(ui.result).append(
    h(
      'section',
      { class: 'card review-card' },
      h(
        'div',
        { class: 'row between' },
        h('h3', { class: 'card-title' }, icon('rewind'), `방금 ${Math.round(clip.seconds)}초`),
        iconBtn('x', '닫기', closeResult)
      ),
      replayBtn,
      body
    )
  );
  ui.result.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (geminiEnabled()) explain(clip, body);
  else body.append(h('p', { class: 'muted' }, '받아쓰기·해석 없이 소리만 받아 두었습니다.'));
}

async function explain(clip, body) {
  const ctl = new AbortController();
  request = ctl;
  let frame = 0;
  let latest = null;
  const draw = (r, done) => request === ctl && clear(body).append(...resultNodes(r, done));
  draw({}, false);
  try {
    const r = await explainClip(clip.blob, {
      signal: ctl.signal,
      onPartial: (p) => {
        latest = p;
        // 조각이 자주 와도 화면은 프레임마다 한 번만 다시 그린다
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          draw(latest, false);
        });
      },
    });
    cancelAnimationFrame(frame);
    draw(r, true);
  } catch (e) {
    cancelAnimationFrame(frame);
    if (request !== ctl || e.name === 'AbortError') return;
    clear(body).append(
      h('p', { class: 'error-text' }, errorMessage(e)),
      btn('다시 시도', () => explain(clip, body), { cls: 'chip', ico: 'back' })
    );
  }
  if (request === ctl) request = null;
}

function resultNodes(r, done) {
  const lines = list(r.lines).filter((l) => l?.en);
  const phrases = list(r.phrases).filter((p) => p?.phrase);
  const context = lines.map((l) => l.en).join(' ');
  return [
    r.paraphrased
      ? h('p', { class: 'hint' }, '저작권 보호 때문에 정확한 대사 대신 쉬운 영어로 요지를 보여 드립니다.')
      : null,
    ...lines.map(lineView),
    done && !lines.length ? h('p', { class: 'muted' }, '또렷한 영어 대사를 찾지 못했습니다.') : null,
    phrases.length ? h('ul', { class: 'listen-phrases' }, phrases.map((p) => phraseItem(p, context))) : null,
    r.explanationKo ? h('p', { class: 'callout ai' }, r.explanationKo) : null,
    done
      ? CONFIDENCE[r.confidence] && h('p', { class: 'hint' }, CONFIDENCE[r.confidence])
      : h(
          'p',
          { class: 'muted loading' },
          h('span', { class: 'spinner' }),
          lines.length ? '이어서 받는 중…' : 'Gemini가 듣고 받아쓰는 중…'
        ),
  ].filter(Boolean);
}

function lineView({ en, ko }) {
  return h(
    'div',
    { class: 'line' },
    tappableEnglish(en, { source: SOURCE, tag: 'div', cls: 'en-line big' }),
    ko ? h('div', { class: 'ko-line', lang: 'ko' }, ko) : null,
    h(
      'div',
      { class: 'row wrap line-actions' },
      btn('읽기', () => say(en), { cls: 'chip small', ico: 'volume' }),
      btn(
        '저장',
        () => {
          addWord({ text: en, meaning: ko, type: 'sentence', source: SOURCE });
          toast('대사를 단어장에 저장했습니다');
        },
        { cls: 'chip small', ico: 'star' }
      )
    )
  );
}

function phraseItem(p, context) {
  return h(
    'li',
    null,
    h(
      'div',
      { class: 'grow' },
      h('b', { lang: 'en' }, p.phrase),
      p.meaningKo ? ` — ${p.meaningKo}` : null,
      p.noteKo ? h('div', { class: 'muted small' }, p.noteKo) : null
    ),
    iconBtn('volume', '읽기', () => say(p.phrase), 'icon-btn small'),
    btn(
      '저장',
      () => {
        addWord({ text: p.phrase, meaning: p.meaningKo, source: SOURCE, context });
        toast(`'${p.phrase}' 저장했습니다`);
      },
      { cls: 'chip small', ico: 'star' }
    )
  );
}

function closeResult() {
  request?.abort();
  request = null;
  stopReplay();
  clear(ui.result);
}

/** 영어 읽기(TTS). 듣는 중이면 읽는 소리는 담지 않는다 */
function say(text) {
  listener?.pauseWhile(speak(text));
}

/* ---------- 느리게 다시 듣기 (기기 안에서만 재생, 키·인터넷 불필요) ---------- */

async function toggleReplay(blob, b) {
  if (replay) return stopReplay();
  b.disabled = true;
  let r;
  try {
    r = await playClip(blob, { rate: 0.75 });
  } catch (e) {
    toast(errorMessage(e));
    return;
  } finally {
    b.disabled = false;
  }
  replay = r;
  listener?.pauseWhile(r.ended); // 다시 듣는 소리가 다음 질문에 섞이지 않게
  b.classList.add('on');
  b.lastChild.textContent = '멈추기';
  await r.ended;
  if (replay === r) replay = null;
  b.classList.remove('on');
  b.lastChild.textContent = '느리게 다시 듣기';
}

function stopReplay() {
  replay?.stop();
  replay = null;
}

/* ---------- 화면 ---------- */

/** "방금 뭐라고?" 카드. 결과와 큰 버튼을 카드 맨 아래에 두어 분할 화면에서도 바로 보이게 한다 */
export function buildListenCard() {
  ui.badge = h('span', { class: 'badge' });
  ui.meter = h('div', { class: 'level-bar' });
  ui.live = h(
    'div',
    { class: 'row' },
    h('div', { class: 'level grow', 'aria-hidden': 'true' }, ui.meter),
    btn('정지', stopListening, { cls: 'btn small', ico: 'stop' })
  );
  ui.warn = h('p', { class: 'listen-warn', role: 'status', hidden: true });
  ui.result = h('div', { class: 'listen-result' });
  ui.keyHint = h(
    'p',
    { class: 'hint center' },
    '받아쓰기·해석은 무료 Gemini 키가 있어야 합니다. ',
    h('a', { href: '#/settings' }, '설정에서 키 넣기'),
    ' · 키 없이도 듣기와 "느리게 다시 듣기"는 됩니다.'
  );
  ui.main = h('button', {
    type: 'button',
    class: 'rewind-btn listen-btn',
    onclick: () => (listener ? ask() : start()),
  });
  const lengths = segmented(
    CLIP_CHOICES.map((sec) => ({ value: String(sec), label: `${sec}초` })),
    String(getSettings().ottListenSeconds),
    (v) => updateSettings({ ottListenSeconds: Number(v) }),
    { label: '보낼 길이' }
  );
  lengths.classList.add('small', 'grow');
  ui.card = h(
    'section',
    { class: 'card listen-card' },
    h('div', { class: 'row between' }, h('h3', { class: 'card-title' }, icon('mic'), '방금 뭐라고?'), ui.badge),
    h(
      'p',
      { class: 'intro listen-about' },
      '자막 없이 보다가 놓친 대사가 있으면 버튼만 누르세요. 방금 들린 영어를 받아쓰고 해석해 드립니다.'
    ),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, '최근'), lengths),
    ui.live,
    ui.warn,
    recordingSupported
      ? null
      : h('p', { class: 'error-text' }, '이 브라우저는 마이크 듣기를 지원하지 않습니다. 안드로이드 크롬을 사용하세요.'),
    h(
      'ul',
      { class: 'hint listen-about' },
      h('li', null, h('b', null, '이어폰을 쓰면 마이크가 소리를 못 들어요.'), ' TV나 휴대폰 스피커로 들으세요.'),
      h(
        'li',
        null,
        '이 앱이 화면에 떠 있어야 들을 수 있습니다. 휴대폰으로 볼 때는 분할 화면이나 넷플릭스 작은 창(PIP)으로 함께 띄우세요.'
      ),
      h(
        'li',
        null,
        `듣는 동안 소리는 이 기기 메모리에만 최근 ${KEEP_SECONDS}초가 보관되고 계속 지워집니다. `,
        '버튼을 누를 때만 그 구간이 Google Gemini로 전송됩니다(무료 등급은 Google이 서비스 개선에 쓸 수 있음).'
      )
    ),
    ui.result,
    ui.keyHint,
    ui.main
  );
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('settings-changed', renderKeyHint);
  renderKeyHint();
  renderState();
  return ui.card;
}

// OTT "방금 뭐라고?": 자막 없이 보다가 놓친 대사를 버튼 한 번으로 받아쓰고 해석한다.
// 듣는 동안 마이크 소리는 이 기기 메모리에 최근 45초만 남기고 계속 지우며, 버튼을 누를 때만 그 구간을 Gemini로 보낸다.
// 이어폰으로 볼 때는 마이크가 영상 소리를 못 들으므로, 들린 소리를 따라 말하거나 적으면 Gemini가 대사를 짐작한다.

import { h, btn, iconBtn, clear, toast, errorMessage, segmented, field } from '../ui.js';
import { icon } from '../icons.js';
import { getSettings, updateSettings, geminiEnabled, addWord } from '../store.js';
import { recordingSupported, startRecording } from '../services/recorder.js';
import { startListening, playClip } from '../services/listen-buffer.js';
import { explainClip, guessLine, GUESS_TEXT_MAX, SCENE_MAX } from '../services/translate.js';
import { keepAwake } from '../services/wake-lock.js';
import { speak } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';
import { formatClock } from '../lib/timefmt.js';

const CLIP_CHOICES = [10, 20, 30];
const KEEP_SECONDS = 45;
const TAIL_MS = 1000; // 누른 뒤 1초 더 들어서 말하던 대사를 끝까지 담는다
const QUIET_RMS = 0.003; // 약 -50dBFS. 최근 5초가 이보다 작으면 마이크에 소리가 거의 안 들리는 것
const SOURCE = 'OTT 듣기';
const MIMIC_SECONDS = 15; // 따라 말하기 최대 길이
const MIMIC_QUIET_PEAK = 0.01; // 따라 말한 녹음에서 가장 큰 소리가 이보다 작으면 목소리가 담기지 않은 것
const SCENE_KEY = 'eh.ottScene'; // 작품·장면 메모 (sessionStorage: 앱을 닫으면 지워짐)
const LEFT = 'left'; // 다른 화면으로 가서 멈춘 요청 (abort 이유)
const KINDS = {
  clip: {
    loading: 'Gemini가 듣고 받아쓰는 중…',
    none: '또렷한 영어 대사를 찾지 못했습니다.',
    confidence: {
      high: '잘 들렸어요.',
      medium: '일부 단어는 확실하지 않아요.',
      low: '잘 안 들려서 틀렸을 수 있어요. 볼륨을 키우거나 휴대폰을 스피커 가까이 두세요.',
    },
  },
  guess: {
    loading: 'Gemini가 어떤 대사인지 짐작하는 중…',
    none: '어떤 대사인지 짐작하지 못했어요. 조금 더 길게 하거나 작품·장면을 적어 보세요.',
    confidence: {
      high: '거의 확실해요.',
      medium: '짐작이에요. 장면과 맞는지 확인해 보세요.',
      low: '단서가 적어 틀렸을 수 있어요. 작품·장면을 적거나 조금 더 길게 해 보세요.',
    },
  },
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
let request = null; // 진행 중인 해석·짐작 요청 (AbortController)
let replay = null; // 재생 중인 "느리게 다시 듣기"
let guess = null; // 열린 "들린 대로 말하기·적어서 묻기" 칸 {mode, body, recBtn?, time?, meter?}
let mimic = null; // 따라 말하기 녹음 (startRecording 결과 + startedAt)
let mimicSession = 0; // 녹음 시작·취소할 때마다 늘려서, 그사이 열린 마이크를 바로 닫는다
let mimicStarting = false;
let mimicPeak = 0;
let mimicTick = 0;
let mimicStoppedAt = 0; // 녹음을 끝낸 시각: 바로 이어 눌린 손가락(두 번 누름·15초 자동 끝과 겹친 누름)은 새 녹음으로 보지 않는다
const RESTART_GUARD_MS = 700;

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

/** 듣기를 끄고 보관하던 소리를 지운다 (정지 버튼) */
function stopListener() {
  session++;
  starting = false;
  listener?.stop();
  listener = null;
  clearInterval(healthTimer);
  keepAwake('listen', false);
  stopReplay();
  renderState();
}

/** 다른 탭으로 갈 때: 듣기를 끄고, 따라 말하기 녹음도 버리고 짐작 요청도 멈춘다 (마이크가 켜진 채 남지 않게) */
export function stopListening() {
  stopListener();
  leaveGuess();
}

/** 마이크가 끊기면(다른 앱이 가져감 등) 다시 연결한다. 연결하자마자 또 끊기면 그만둔다 */
function reconnect() {
  const quick = Date.now() - startedAt < 5000;
  stopListener();
  if (!quick) return start();
  toast('마이크 연결이 끊겼습니다. 다른 앱이 마이크를 쓰는지 확인하고 다시 시작하세요.', { ms: 5000 });
}

function onVisibility() {
  // 따라 말하는 중에 화면을 벗어나면 녹음을 버린다 (안 보이는 채로 마이크가 켜져 있지 않게).
  // 마이크를 여는 중이면 열린 때 다시 확인한다 (권한 창이 잠깐 화면을 가려도 취소되지 않게)
  if (document.visibilityState === 'hidden' && mimic) leaveGuess();
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
        ? "마이크에 소리가 안 들려요 (볼륨을 키우거나 휴대폰을 스피커 가까이). 이어폰을 쓰는 중이면 아래 '들린 대로 말하기'를 쓰세요."
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

/** 무료 Gemini 키 안내 (설정으로 가는 링크) */
function keyHint(lead, tail = '') {
  return h('p', { class: 'hint center' }, lead, h('a', { href: '#/settings' }, '설정에서 키 넣기'), tail);
}

function renderState() {
  const on = Boolean(listener);
  ui.card.classList.toggle('on', on);
  ui.badge.textContent = on ? '듣는 중' : starting ? '마이크 여는 중…' : '꺼짐';
  ui.badge.classList.toggle('live', on);
  ui.live.hidden = !on;
  if (!on) ui.meter.style.width = '0%';
  ui.main.classList.toggle('idle', !on);
  // 따라 말하는 동안에는 듣기를 시작하지 않는다 (설정이 다른 마이크 두 개는 안드로이드에서 서로 끊긴다)
  ui.main.disabled = starting || capturing || !recordingSupported || Boolean(mimic) || mimicStarting;
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
  closeResult();
  const body = h('div', { class: 'stack' });
  const replayBtn = btn('느리게 다시 듣기', () => toggleReplay(clip.blob, replayBtn), { cls: 'chip', ico: 'volume' });
  ui.result.append(
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
  if (geminiEnabled()) stream(body, (o) => explainClip(clip.blob, o), 'clip');
  else body.append(h('p', { class: 'muted' }, '받아쓰기·해석 없이 소리만 받아 두었습니다.'));
}

/**
 * Gemini 답을 받는 대로 body에 그린다. 실패하면 오류와 '다시 시도'를 보여 준다.
 * @param {(o: {signal: AbortSignal, onPartial: (p: object) => void}) => Promise<object>} run explainClip·guessLine 호출
 * @param {'clip'|'guess'} kind 안내 문구 종류
 */
async function stream(body, run, kind) {
  request?.abort();
  const ctl = new AbortController();
  request = ctl;
  let frame = 0;
  let latest = null;
  const draw = (r, done) => request === ctl && clear(body).append(...resultNodes(r, done, kind));
  draw({}, false);
  try {
    const r = await run({
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
    if (request !== ctl) return; // 닫았거나 새 요청으로 바뀌었다
    const left = ctl.signal.reason === LEFT;
    if (e.name !== 'AbortError' || left) {
      clear(body).append(
        h('p', { class: left ? 'hint' : 'error-text' }, left ? '다른 화면으로 가서 멈췄어요.' : errorMessage(e)),
        btn('다시 시도', () => stream(body, run, kind), { cls: 'chip', ico: 'back' })
      );
    }
  }
  if (request === ctl) request = null;
}

function resultNodes(r, done, kind) {
  const t = KINDS[kind];
  const lines = list(r.lines).filter((l) => l?.en);
  const phrases = list(r.phrases).filter((p) => p?.phrase);
  const context = lines.map((l) => l.en).join(' ');
  // 짐작한 대사는 이어지는 대사가 아니라 후보들이다 (가능성 높은 순)
  const label = (i) => (kind !== 'guess' ? '' : i ? '다른 후보' : '가장 그럴듯한 대사');
  return [
    r.paraphrased
      ? h('p', { class: 'hint' }, '저작권 보호 때문에 정확한 대사 대신 쉬운 영어로 요지를 보여 드립니다.')
      : null,
    r.heard ? h('p', { class: 'hint' }, 'Gemini가 들은 내 소리: ', h('b', null, r.heard)) : null,
    ...lines.map((l, i) => lineView(l, label(i))),
    done && !lines.length ? h('p', { class: 'muted' }, t.none) : null,
    phrases.length ? h('ul', { class: 'listen-phrases' }, phrases.map((p) => phraseItem(p, context))) : null,
    r.explanationKo ? h('p', { class: 'callout ai' }, r.explanationKo) : null,
    done
      ? t.confidence[r.confidence] && h('p', { class: 'hint' }, t.confidence[r.confidence])
      : h(
          'p',
          { class: 'muted loading' },
          h('span', { class: 'spinner' }),
          lines.length ? '이어서 받는 중…' : t.loading
        ),
  ].filter(Boolean);
}

function lineView({ en, ko }, label = '') {
  return h(
    'div',
    { class: 'line' },
    label ? h('span', { class: 'tag' }, label) : null,
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

/** 결과 칸을 닫는다: 요청·다시 듣기·따라 말하기 녹음을 모두 멈춘다 */
function closeResult() {
  request?.abort();
  request = null;
  stopReplay();
  cancelMimic();
  guess = null;
  renderGuessChips();
  clear(ui.result);
}

/** 영어 읽기(TTS). 듣는 중이면 읽는 소리는 담지 않는다 */
function say(text) {
  const playing = speak(text);
  listener?.pauseWhile(playing);
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

/* ---------- 이어폰으로 볼 때: 들린 대로 말하기 · 적어서 묻기 (Gemini 키 필요) ---------- */
// 이어폰을 쓰면 마이크가 영상 소리를 못 듣고, 웹 앱은 다른 앱(넷플릭스 등)의 소리를 가져올 수 없다.
// 그래서 들린 소리를 따라 말하거나 적으면 Gemini가 원래 대사를 짐작한다. 위의 듣기는 켜지 않아도 된다.

/** 칩을 누르면 결과 칸에 녹음기나 입력 칸을 연다. 같은 칩을 다시 누르면 닫는다 */
function toggleGuess(mode) {
  if (guess?.mode === mode) return closeResult();
  closeResult();
  const voice = mode === 'voice';
  const g = { mode, body: h('div', { class: 'stack' }) };
  let controls;
  if (voice) {
    g.recBtn = h('button', { type: 'button', class: 'talk-btn', onclick: toggleMimic });
    g.time = h('span', { class: 'rec-time' });
    g.meter = h('div', { class: 'level-bar' });
    controls = h(
      'div',
      { class: 'rec-row' },
      g.recBtn,
      h('div', { class: 'stack grow' }, g.time, h('div', { class: 'level', 'aria-hidden': 'true' }, g.meter))
    );
  } else {
    const askBtn = btn('물어보기', () => askText(askBtn), { cls: 'btn primary', ico: 'send' });
    controls = [field('들린 소리', ui.heard), askBtn];
  }
  ui.result.append(
    h(
      'section',
      { class: 'card review-card guess-card' },
      h(
        'div',
        { class: 'row between' },
        h('h3', { class: 'card-title' }, icon(voice ? 'mic' : 'edit'), voice ? '들린 대로 말하기' : '적어서 묻기'),
        iconBtn('x', '닫기', closeResult)
      ),
      h(
        'p',
        { class: 'hint' },
        voice
          ? `영상을 잠깐 멈추고 들린 소리를 흉내 내듯 따라 말해 보세요. 뭉개지거나 한국어처럼 들려도 괜찮아요 (최대 ${MIMIC_SECONDS}초).`
          : '들린 소리를 영어든 한글이든 들린 대로 적어 보세요.'
      ),
      field('작품·장면 (선택)', ui.scene),
      controls,
      g.body
    )
  );
  guess = g;
  renderGuessChips();
  if (voice) renderMimic();
  ui.result.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (!voice) ui.heard.focus({ preventScroll: true });
}

function renderGuessChips() {
  for (const [mode, chip] of Object.entries({ voice: ui.voiceChip, text: ui.textChip })) {
    chip.classList.toggle('on', guess?.mode === mode);
    chip.setAttribute('aria-pressed', String(guess?.mode === mode));
  }
  ui.card.classList.toggle('guessing', Boolean(guess));
}

/** 키가 없으면 결과 칸에 안내를 보여 주고 true */
function needKey(body) {
  if (geminiEnabled()) return false;
  clear(body).append(keyHint('대사 짐작은 무료 Gemini 키가 있어야 합니다. '));
  return true;
}

const sceneText = () => ui.scene.value.trim();

function loadScene() {
  try {
    return sessionStorage.getItem(SCENE_KEY) || '';
  } catch {
    return '';
  }
}

function saveScene() {
  try {
    sessionStorage.setItem(SCENE_KEY, ui.scene.value);
  } catch {
    /* 저장 실패는 무시 */
  }
}

async function askText(b) {
  const g = guess;
  const text = ui.heard.value.trim();
  if (!text) {
    toast('들린 소리를 먼저 적어 주세요.');
    return ui.heard.focus();
  }
  if (needKey(g.body)) return;
  ui.heard.blur(); // 자판을 내려 결과가 보이게
  const scene = sceneText();
  b.disabled = true; // 두 번 눌러도 한 번만 묻는다
  await stream(g.body, (o) => guessLine({ text, scene }, o), 'guess');
  b.disabled = false;
}

/* 따라 말하기 녹음: 누르면 시작, 다시 누르면 끝내고 바로 보낸다. 최대 15초에서 저절로 끝난다 */

function toggleMimic() {
  if (mimic) finishMimic();
  else if (mimicStarting) cancelMimic(); // 마이크 여는 중(권한 창 등)에 다시 누르면 그만둔다
  else if (Date.now() - mimicStoppedAt > RESTART_GUARD_MS) startMimic();
}

async function startMimic() {
  const g = guess;
  if (needKey(g.body)) return;
  if (listener || starting) {
    // 통화용 처리를 끈 듣기와 켠 녹음, 두 마이크를 함께 열면 안드로이드에서 서로 끊긴다
    stopListener();
    toast('듣기를 끄고 내 목소리를 녹음합니다.');
  }
  request?.abort();
  request = null;
  clear(g.body);
  const my = ++mimicSession;
  mimicStarting = true;
  mimicPeak = 0;
  renderMimic();
  let r = null;
  try {
    // 내 목소리이므로 통화처럼 잡음·메아리 제거를 켠다
    r = await startRecording({
      maxSeconds: MIMIC_SECONDS,
      onLevel: (peak) => {
        mimicPeak = Math.max(mimicPeak, peak);
        g.meter.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
      },
      onLimit: finishMimic,
    });
  } catch (e) {
    if (my === mimicSession) g.body.append(h('p', { class: 'error-text' }, errorMessage(e)));
  }
  if (my !== mimicSession) return r?.cancel(); // 그사이 취소했거나 다른 탭으로 갔다
  mimicStarting = false;
  if (r && document.visibilityState === 'hidden') {
    r.cancel(); // 마이크가 열릴 때 이미 다른 앱으로 갔다
    r = null;
  }
  if (r) {
    mimic = { ...r, startedAt: Date.now() };
    mimicTick = setInterval(renderTime, 250);
  }
  renderMimic();
}

async function finishMimic() {
  if (!mimic) return;
  const r = mimic;
  const my = mimicSession;
  mimic = null;
  mimicStoppedAt = Date.now();
  clearInterval(mimicTick);
  renderMimic();
  const take = await r.stop(); // 마이크를 끄고 WAV로
  if (my !== mimicSession || !guess) return;
  const { body } = guess;
  const note = (msg) => clear(body).append(h('p', { class: 'hint' }, msg));
  if (take.seconds < 0.5) return note('너무 짧아요. 버튼을 누르고 말한 다음 다시 누르세요.');
  if (mimicPeak < MIMIC_QUIET_PEAK) {
    return note('목소리가 들리지 않았어요. 휴대폰 마이크가 꺼져 있지 않은지 확인하고 다시 말해 보세요.');
  }
  const scene = sceneText();
  stream(body, (o) => guessLine({ audio: take.blob, scene }, o), 'guess');
}

/** 따라 말하기 녹음을 버리고 마이크를 끈다 */
function cancelMimic() {
  mimicSession++;
  mimicStarting = false;
  mimic?.cancel();
  mimic = null;
  clearInterval(mimicTick);
  renderMimic();
}

/** 다른 화면으로 갈 때: 따라 말하기 녹음은 버리고(마이크 끄기) 짐작 요청은 멈춘다. 돌아와서 다시 하면 된다 */
function leaveGuess() {
  if (!guess) return;
  const recording = Boolean(mimic) || mimicStarting;
  cancelMimic();
  request?.abort(LEFT);
  if (recording) {
    clear(guess.body).append(h('p', { class: 'hint' }, '다른 화면으로 가서 녹음을 멈췄어요. 다시 눌러 말해 보세요.'));
  }
}

function renderMimic() {
  renderState(); // 따라 말하는 동안 큰 버튼을 막는다
  const g = guess;
  if (!g?.recBtn) return;
  const on = Boolean(mimic);
  g.recBtn.classList.toggle('recording', on);
  g.recBtn.replaceChildren(
    icon(on ? 'stop' : 'mic', { size: 26 }),
    h('span', null, on ? '다 말했으면 누르기' : mimicStarting ? '마이크 여는 중…' : '누르고 말하기')
  );
  if (!on) g.meter.style.width = '0%';
  renderTime();
}

function renderTime() {
  if (!guess?.time) return;
  const sec = mimic ? (Date.now() - mimic.startedAt) / 1000 : 0;
  // 마이크 소리가 끊겨 최대 길이 알림이 오지 않아도 시간이 지나면 끝낸다
  if (sec > MIMIC_SECONDS + 1) return finishMimic();
  guess.time.textContent = `${formatClock(Math.min(sec, MIMIC_SECONDS))} / ${formatClock(MIMIC_SECONDS)}`;
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
    btn('정지', stopListener, { cls: 'btn small', ico: 'stop' })
  );
  ui.warn = h('p', { class: 'listen-warn', role: 'status', hidden: true });
  ui.result = h('div', { class: 'listen-result' });
  ui.keyHint = keyHint(
    '받아쓰기·해석은 무료 Gemini 키가 있어야 합니다. ',
    ' · 키 없이도 듣기와 "느리게 다시 듣기"는 됩니다.'
  );
  // 이어폰으로 볼 때: 칩 두 개만 두고, 누르면 결과 칸에 녹음기·입력 칸이 열린다 (짧은 화면에서도 큰 버튼이 밀리지 않게)
  ui.voiceChip = btn('들린 대로 말하기', () => toggleGuess('voice'), {
    cls: 'chip',
    ico: 'mic',
    disabled: !recordingSupported,
  });
  ui.textChip = btn('적어서 묻기', () => toggleGuess('text'), { cls: 'chip', ico: 'edit' });
  // 입력 칸은 한 번만 만들어, 칸을 닫았다 열어도 적은 내용이 남게 한다
  ui.scene = h('input', {
    type: 'text',
    value: loadScene(),
    maxlength: SCENE_MAX,
    placeholder: '예: 프렌즈 시즌1',
    autocomplete: 'off',
    enterkeyhint: 'done',
    oninput: saveScene,
    onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
  });
  ui.heard = h('textarea', {
    rows: 2,
    maxlength: GUESS_TEXT_MAX,
    placeholder: '예: 아이 고나 웨더 잇',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false', // 자판이 들린 소리를 맞춤법대로 고치지 않게
  });
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
      h(
        'li',
        null,
        h('b', null, '이어폰을 쓰면 마이크가 소리를 못 들어요.'),
        " 스피커로 듣거나, 아래 '들린 대로 말하기'·'적어서 묻기'를 쓰세요."
      ),
      h(
        'li',
        null,
        h('b', null, '안드로이드 실시간 자막'),
        '도 좋아요. 휴대폰에서 나오는 영상 소리에 자막을 달아 주고, 이어폰을 쓰거나 소리를 꺼도 됩니다. ',
        "휴대폰 설정에서 '실시간 자막'을 검색해 켜세요(갤럭시는 볼륨 버튼을 누르면 나오는 창에서도 켤 수 있어요). ",
        '안드로이드 10 이상 대부분의 휴대폰에 있지만 기종·앱마다 다를 수 있으니 내 휴대폰에서 확인해 보세요.'
      ),
      h(
        'li',
        null,
        '이 앱이 화면에 떠 있어야 들을 수 있습니다. 휴대폰으로 볼 때는 분할 화면이나 넷플릭스 작은 창(PIP)으로 함께 띄우세요.'
      ),
      h(
        'li',
        null,
        `듣는 동안 소리는 이 기기 메모리에만 최근 ${KEEP_SECONDS}초가 보관되고 계속 지워집니다. `,
        '버튼을 누를 때만 그 구간(따라 말하기·적어서 묻기는 내 녹음·글)이 Google Gemini로 전송됩니다',
        '(무료 등급은 Google이 서비스 개선에 쓸 수 있음).'
      )
    ),
    h(
      'div',
      { class: 'row wrap guess-chips' },
      h('span', { class: 'hint' }, '이어폰으로 볼 때'),
      ui.voiceChip,
      ui.textChip
    ),
    ui.result,
    ui.keyHint,
    ui.main
  );
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('settings-changed', renderKeyHint);
  renderKeyHint();
  renderState();
  renderGuessChips();
  return ui.card;
}

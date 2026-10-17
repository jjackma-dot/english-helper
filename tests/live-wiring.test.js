// js/services/live.js startLive()를 가짜 마이크·스피커·WebSocket으로 시험한다:
// 첫인사, "말 끊기" 버튼, 남은 목소리 위로 새 답이 올 때, 말로 끊기(메아리 문), 다시 연결·옮겨 가기, 일시정지, 끝내기
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_STREAM_END,
  LIVE_MODELS,
  audioMessage,
  base64FromInt16,
  kickoffMessage,
  toolResponse,
} from '../js/lib/live-protocol.js';

/* ---------- 브라우저 흉내 ---------- */

globalThis.window = globalThis;
globalThis.dispatchEvent ??= () => true;
const mem = new Map([['eh.settings.v1', JSON.stringify({ geminiKey: 'test-key' })]]); // gemini.js apiKey()가 읽는 곳
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

// 가짜 시계: performance.now()(ms)와 AudioContext.currentTime(초)이 함께 간다. setTimeout은 시험마다 node:test 가짜 타이머
const clock = { ms: 0 };
performance.now = () => clock.ms;

/** 시험 하나에서 만들어진 가짜 객체들 */
const reg = {};
function resetReg() {
  Object.assign(reg, { sockets: [], contexts: [], nodes: [], tracks: [], mics: [], modules: [] });
}
resetReg();

class FakeTrack extends EventTarget {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  /** 진짜 브라우저처럼 페이지가 stop()으로 닫을 때는 'ended'를 알리지 않는다 */
  stop() {
    this.readyState = 'ended';
  }
  /** 시스템이 마이크를 끊음 (전화·권한 회수 등) */
  endBySystem() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    mediaDevices: {
      getUserMedia: async ({ audio }) => {
        reg.mics.push(audio);
        const t = new FakeTrack();
        reg.tracks.push(t);
        return { getTracks: () => [t], getAudioTracks: () => [t] };
      },
    },
  },
});

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    Object.assign(this, { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate });
  }
  copyToChannel(data, ch) {
    this.data = data;
    this.channel = ch;
  }
}

/** 재생 조각: start(when)로 예약되고, 가짜 시계가 끝 시각을 지나면 onended가 불린다 */
class FakeSource {
  buffer = null;
  when = null;
  stopped = false;
  ended = false;
  onended = null;
  constructor(ctx) {
    this.ctx = ctx;
    ctx.sources.push(this);
  }
  connect(n) {
    return n;
  }
  start(when = 0) {
    this.when = when;
  }
  stop() {
    if (this.stopped || this.ended) return;
    this.stopped = true;
    queueMicrotask(() => this.onended?.()); // 진짜 브라우저도 stop() 뒤에 ended를 알린다
  }
  get end() {
    return this.when + this.buffer.duration;
  }
  /** 아직 소리가 나는 중 (예약됨, 멈추거나 끝나지 않음) */
  get sounding() {
    return this.when != null && !this.stopped && !this.ended;
  }
}

class FakeAudioContext {
  destination = {};
  sources = [];
  closed = false;
  state = 'running';
  resumes = 0; // resume()을 부른 횟수
  onstatechange = null;
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.audioWorklet = { addModule: async (url) => void reg.modules.push(String(url)) };
    reg.contexts.push(this);
  }
  get currentTime() {
    return clock.ms / 1000;
  }
  resume() {
    this.resumes++;
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
  /** 시스템이 상태를 바꿈 (아이폰: 전화·Siri 때 'interrupted', 끝나면 'running') */
  systemState(state) {
    this.state = state;
    this.onstatechange?.();
  }
  createMediaStreamSource(stream) {
    this.mic = { stream, disconnected: false, connect: (n) => n, disconnect: () => (this.mic.disconnected = true) };
    return this.mic;
  }
  createGain() {
    return { gain: { value: 1 }, connect: (n) => n, disconnect() {} };
  }
  createBuffer(ch, len, rate) {
    return new FakeBuffer(ch, len, rate);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
}
globalThis.AudioContext = FakeAudioContext;

/** 마이크 처리기: 시험이 port.onmessage로 16kHz PCM 조각(40ms = 640샘플)을 넣는다 */
globalThis.AudioWorkletNode = class {
  disconnected = false;
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
    this.port = { onmessage: null };
    reg.nodes.push(this);
  }
  connect(n) {
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
};

const enc = new TextEncoder();

/** 가짜 Gemini Live 연결: 보낸 JSON을 모으고, 시험이 서버 쪽 메시지·닫힘을 넣는다 */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent = [];
  sentAt = []; // 보낸 시각 (ms)
  closedWith = null;
  onopen = null;
  onmessage = null;
  onclose = null;
  constructor(url) {
    this.url = url;
    reg.sockets.push(this);
  }
  send(text) {
    assert.equal(this.readyState, FakeSocket.OPEN, '열린 연결로만 보낸다');
    this.sent.push(JSON.parse(text));
    this.sentAt.push(clock.ms);
  }
  close(code = 1005) {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.closedWith = code;
    queueMicrotask(() => this.onclose?.({ code, reason: '' }));
  }
  /* 아래는 서버 쪽 */
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** 진짜 서버처럼 바이너리 프레임으로 보낸다 */
  deliver(msg) {
    const u8 = enc.encode(JSON.stringify(msg));
    this.onmessage?.({ data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) });
  }
  drop(code, reason = '') {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}
globalThis.WebSocket = FakeSocket;

const { startLive, liveBlocked } = await import('../js/services/live.js');

/* ---------- 서버 메시지 (live-protocol.js parseServerMessage가 읽는 모양) ---------- */

const msg = {
  setupComplete: () => ({ setupComplete: {} }),
  audio: (data) => ({
    serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data } }] } },
  }),
  tutor: (text) => ({ serverContent: { outputTranscription: { text } } }),
  me: (text) => ({ serverContent: { inputTranscription: { text } } }),
  interrupted: () => ({ serverContent: { interrupted: true } }),
  turnComplete: () => ({ serverContent: { turnComplete: true } }),
  handle: (h) => ({ sessionResumptionUpdate: { newHandle: h, resumable: true } }),
  goAway: (timeLeft) => ({ goAway: { timeLeft } }),
};

/* ---------- 소리 ---------- */

const TUTOR_AMP = 16000; // 튜터 목소리 크기 (약 0.49)
const QUIET = 0.005; // 조용한 방
const ECHO = 0.02; // 스피커 소리가 마이크로 다시 들어온 메아리 (튜터 소리의 약 4%)
const VOICE = 0.3; // 보통 말소리
const LOUD = 0.5; // 튜터 말 위로 크게 말함

/** 튜터 목소리 ms만큼 (24kHz) */
const tutorPcm = (ms, amp = TUTOR_AMP) => new Int16Array((24000 * ms) / 1000).fill(amp);
/** 마이크 조각 하나 (40ms, 16kHz) */
const micPcm = (level) => new Int16Array(640).fill(Math.round(level * 0x7fff));

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

/** live.js가 걸어 둔 타이머 (끝낼 때 모두 지우는지 본다). 가짜 타이머를 켠 뒤에 감싼다 */
function trackTimers() {
  const pending = new Set();
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = set(() => {
      pending.delete(id);
      fn(...args);
    }, ms);
    pending.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    pending.delete(id);
    clear(id);
  };
  return pending;
}

/**
 * 대화를 시작한다 (마이크가 열리고 연결을 만들 때까지). 돌려준 객체로 시계를 돌리고, 마이크 조각과 서버 메시지를 넣는다
 * @param {{bargeIn?: boolean, stopAtOnce?: boolean}} o stopAtOnce: 마이크가 열리기 전에 바로 끝낸다
 */
async function begin(t, { bargeIn = true, stopAtOnce = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = trackTimers();
  clock.ms = 0;
  resetReg();
  const log = [];
  const levels = [];
  const fails = [];
  const hooks = {}; // 시험이 화면(voice-tutor)처럼 알림에 답하게 한다 (systemPause → setPaused(true) 등)
  const on = {
    systemPause: () => (log.push('systemPause'), hooks.systemPause?.()),
    systemResume: () => (log.push('systemResume'), hooks.systemResume?.()),
    status: (x) => log.push(`status:${x}`),
    userText: (x) => log.push(`me:${x}`),
    tutorText: (x) => log.push(`tutor:${x}`),
    turnStart: () => log.push('turnStart'),
    turnEnd: () => log.push('turnEnd'),
    interrupted: () => log.push('interrupted'),
    bargeIn: () => log.push('bargeIn'),
    correction: (c) => log.push(`correction:${c.corrected}`),
    notice: (m) => log.push(`notice:${m}`),
    fail: (c) => (fails.push(c), log.push(`fail:${c.kind}`)),
    level: (l) => levels.push(l),
  };
  const live = startLive({ system: 'Be a friendly tutor.', bargeIn, on });
  if (stopAtOnce) live.stop();
  await settle();

  const s = {
    live,
    log,
    levels,
    fails,
    hooks,
    pending,
    get ws() {
      return reg.sockets.at(-1);
    },
    get micCtx() {
      return reg.contexts[0];
    },
    get speaker() {
      return reg.contexts[1];
    },
    get node() {
      return reg.nodes.at(-1);
    },
    get track() {
      return reg.tracks.at(-1);
    },
    mark: () => log.length,
    /** from 뒤에 생긴 일 (상태 바뀜은 뺀다) */
    events: (from = 0) => log.slice(from).filter((x) => !x.startsWith('status:')),
    statuses: (from = 0) =>
      log
        .slice(from)
        .filter((x) => x.startsWith('status:'))
        .map((x) => x.slice(7)),
    status: () => s.statuses().at(-1),
    count: (name) => log.filter((x) => x === name).length,
    sources: () => s.speaker.sources,
    sounding: () => s.speaker.sources.filter((x) => x.sounding),
    sent: () => reg.sockets.flatMap((w) => w.sent),
    sentAudio: () => s.sent().filter((m) => m.realtimeInput?.audio).length,
    deliver: (m) => s.ws.deliver(m),
    audio: (ms, amp) => s.deliver(msg.audio(base64FromInt16(tutorPcm(ms, amp)))),
    say: (x) => s.deliver(msg.tutor(x)),
    heard: (x) => s.deliver(msg.me(x)),
    turnComplete: () => s.deliver(msg.turnComplete()),
    /** 시계를 10ms씩 돌린다: 타이머를 부르고, 끝 시각을 지난 재생 조각은 끝났다고 알린다 */
    advance(ms) {
      for (let left = ms; left > 0; left -= 10) {
        const d = Math.min(10, left);
        clock.ms += d;
        t.mock.timers.tick(d);
        for (const ctx of reg.contexts) {
          for (const src of ctx.sources) {
            if (src.sounding && src.end <= ctx.currentTime + 1e-6) {
              src.ended = true;
              src.onended?.();
            }
          }
        }
      }
    },
    /** 마이크 조각 n개 (40ms마다). level이 없으면 조용한 학습자 (튜터 소리가 나는 동안은 메아리만 들어온다) */
    frames(n, level) {
      let pcm;
      for (let i = 0; i < n; i++) {
        s.advance(40);
        pcm = micPcm(level ?? (s.sounding().length ? ECHO : QUIET));
        s.node?.port.onmessage?.({ data: pcm });
      }
      return pcm;
    },
    room: (n) => s.frames(n),
    talk: (n, level = VOICE) => s.frames(n, level),
    /** 조용히 기다려 상태가 status가 되게 한다 */
    waitFor(status) {
      for (let i = 0; i < 200 && s.status() !== status; i++) s.room(1);
      assert.equal(s.status(), status);
    },
  };
  return s;
}

/** 연결해서 첫인사를 끝까지 듣는다. 학습자는 조용해서 메아리 크기(k)를 배운다 */
async function greeted(t, o) {
  const s = await begin(t, o);
  s.ws.accept();
  s.deliver(msg.setupComplete());
  s.audio(500);
  s.room(10);
  s.audio(500);
  s.say('Hi! What did you do today?');
  s.turnComplete();
  s.waitFor('listening');
  s.room(3); // 튜터 차례가 끝난 뒤 첫 조각에서 메아리 크기를 배운다
  return s;
}

const LINE = 'Let me tell you about the mountains near Seoul.';

/* ---------- 1. 첫인사 ---------- */

test('첫인사: 설정이 끝나면 첫 요청을 보내고, 첫인사가 끝날 때까지 마이크를 보내지 않는다', async (t) => {
  const s = await begin(t);
  assert.deepEqual(reg.mics, [{ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }]);
  assert.ok(reg.modules[0].endsWith('/js/worklets/pcm16-capture.js'), reg.modules[0]);
  assert.equal(s.node.name, 'pcm16-capture');
  assert.equal(s.speaker.sampleRate, 24000);
  assert.equal(reg.sockets.length, 1);
  assert.match(s.ws.url, /^wss:\/\/generativelanguage\.googleapis\.com\/.*\?key=test-key$/);
  assert.equal(s.ws.binaryType, 'arraybuffer');
  assert.deepEqual(s.statuses(), ['connecting']);

  s.talk(3); // 연결하는 중
  s.ws.accept();
  const { setup } = s.ws.sent[0];
  assert.equal(setup.model, `models/${LIVE_MODELS[0]}`);
  assert.deepEqual(setup.systemInstruction, { parts: [{ text: 'Be a friendly tutor.' }] });
  assert.deepEqual(setup.sessionResumption, {});
  assert.equal(s.ws.sent.length, 1, '설정 완료 전에는 첫 요청을 보내지 않는다');

  s.deliver(msg.setupComplete());
  assert.deepEqual(s.ws.sent.slice(1), [kickoffMessage()], '튜터가 먼저 말을 걸게 한다');
  assert.equal(s.status(), 'thinking');
  s.talk(5); // 첫인사를 기다리는 동안 말해도 보내지 않는다 (주변 소리가 첫인사를 끊지 않게)

  s.audio(500);
  assert.equal(s.status(), 'speaking');
  const [first] = s.sounding();
  assert.ok(Math.abs(first.when - (s.speaker.currentTime + 0.05)) < 1e-6, '받자마자 (0.05초 여유) 튼다');
  assert.equal(first.buffer.duration, 0.5);
  assert.ok(Math.abs(first.buffer.data[0] - TUTOR_AMP / 0x8000) < 1e-6, '16비트 → 실수로 바꿔 넣는다');
  s.room(10);
  s.audio(500);
  const second = s.sounding()[1];
  assert.ok(Math.abs(second.when - first.end) < 1e-6, '다음 조각은 앞 조각 끝에 이어 붙인다');
  s.say('Hi! What did you do today?');
  s.turnComplete();
  s.room(10); // 서버는 다 보냈지만 첫인사 목소리는 아직 나온다
  assert.equal(s.sentAudio(), 0);
  assert.equal(s.status(), 'speaking');

  s.waitFor('listening');
  const firstAt = s.ws.sentAt[s.ws.sent.findIndex((x) => x.realtimeInput?.audio)];
  assert.ok(firstAt >= second.end * 1000 + 300, '첫인사 목소리와 남은 메아리(0.3초)가 끝날 때까지 보내지 않는다');
  const dropped = s.levels.length - s.sentAudio(); // 보내기 시작한 뒤로는 조각마다 보낸다
  assert.ok(dropped > 30);
  assert.ok(s.levels.slice(0, dropped).every((l) => l === 0), '보내지 않은 조각은 마이크 막대를 비운다');
  assert.deepEqual(s.statuses(), ['connecting', 'thinking', 'speaking', 'listening']);
  assert.deepEqual(s.events(), ['turnStart', 'tutor:Hi! What did you do today?', 'turnEnd']);

  const n = s.sentAudio();
  const pcm = s.talk(1);
  assert.equal(s.sentAudio(), n + 1);
  assert.deepEqual(s.sent().at(-1), audioMessage(base64FromInt16(pcm), 16000));
  assert.ok(Math.abs(s.levels.at(-1) - VOICE) < 1e-3);
  s.live.stop();
});

test('첫인사가 8초 안에 오지 않으면 기다리지 않고 듣기 시작한다', async (t) => {
  const s = await begin(t);
  s.ws.accept();
  s.deliver(msg.setupComplete());
  s.room(199); // 7.96초
  assert.equal(s.status(), 'thinking');
  assert.equal(s.sentAudio(), 0);
  s.room(1);
  assert.equal(s.status(), 'listening');
  assert.equal(s.sentAudio(), 1);
  s.live.stop();
});

/* ---------- 2. "말 끊기" 버튼 ---------- */

test('"말 끊기" 버튼: 답을 만드는 중이어도 바로 멈추고, 그 답의 나머지 소리·글은 버린 뒤 다음 답은 들려준다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('I went hiking.');
  let m = s.mark();
  s.audio(600);
  s.say('Hiking sounds');
  assert.equal(s.status(), 'speaking');
  s.room(5); // 0.2초 듣다가 누른다
  const [reply] = s.sounding();
  s.live.interrupt();
  assert.equal(reply.stopped, true, '남은 목소리를 바로 멈춘다');
  assert.equal(s.sounding().length, 0);
  assert.deepEqual(s.events(m), ['turnStart', 'tutor:Hiking sounds', 'interrupted']);

  // 서버는 아직 그 답을 보내는 중: 나머지 소리·글은 버린다
  const made = s.sources().length;
  s.audio(600);
  s.say(' like fun!');
  assert.equal(s.sources().length, made, '끊은 답의 나머지 소리는 틀지 않는다');
  s.turnComplete();
  assert.deepEqual(s.events(m), ['turnStart', 'tutor:Hiking sounds', 'interrupted', 'turnEnd']);
  s.waitFor('listening');

  // 아무것도 나오지 않을 때는 버튼이 아무 일도 하지 않는다
  m = s.mark();
  s.live.interrupt();
  s.room(10);
  assert.deepEqual(s.log.slice(m), []);

  // 다음 답은 처음부터 들려준다
  s.talk(10);
  s.heard('Where should I go?');
  s.audio(400);
  s.say('Try Bukhansan.');
  assert.equal(s.sounding().length, 1);
  assert.deepEqual(s.events(m), ['me:Where should I go?', 'turnStart', 'tutor:Try Bukhansan.']);

  // 버튼으로 끊은 뒤 내가 말해서 서버도 끊김을 알리면, 끊김을 다시 알리지 않는다
  s.live.interrupt();
  assert.equal(s.count('interrupted'), 2);
  s.waitFor('listening');
  s.talk(10);
  m = s.mark();
  s.deliver(msg.interrupted());
  s.heard('Is it far?');
  s.audio(400);
  s.say('Not at all.');
  assert.equal(s.sounding().length, 1);
  assert.deepEqual(s.events(m), ['me:Is it far?', 'turnStart', 'tutor:Not at all.']);
  assert.equal(s.count('interrupted'), 2);
  s.live.stop();
});

test('버튼으로 끊은 직후(남은 메아리 0.3초)에 바로 말해도 내 목소리는 앞부분부터 보낸다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('Hello.');
  s.audio(2000);
  s.room(10);
  s.live.interrupt();
  assert.equal(s.status(), 'speaking', '남은 메아리 동안');
  const voice = JSON.stringify(audioMessage(base64FromInt16(micPcm(VOICE)), 16000));
  const from = s.sent().length;
  s.talk(8); // 0.32초: 앞 7조각은 메아리 대기 중
  const mine = s.sent().slice(from).filter((x) => JSON.stringify(x) === voice).length;
  assert.equal(mine, 8, '붙잡아 둔 첫 조각부터 내 목소리를 모두 보낸다');
  assert.equal(s.status(), 'listening');
  s.live.stop();
});

test(
  '"말 끊기"를 빨리 두 번 눌러도 (남은 메아리 동안 버튼이 켜져 있음) 끊김은 한 번만 알린다',
  async (t) => {
    const s = await greeted(t);
    s.talk(10);
    s.audio(1000);
    s.live.interrupt();
    assert.equal(s.status(), 'speaking', '화면은 이 상태에서 "말 끊기" 버튼을 켜 둔다');
    s.live.interrupt();
    assert.equal(s.count('interrupted'), 1);
    s.live.stop();
  }
);

/* ---------- 3. 남은 목소리 위로 새 답 (수정 a) ---------- */

test('전 답의 목소리가 아직 나오는데 새 답이 오면 남은 목소리를 멈추고 (끊김 → 새 차례), 새 답은 바로 튼다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('I like mountains.');
  s.audio(3000);
  s.say('Mountains are great.');
  s.turnComplete();
  const [old] = s.sounding();
  s.room(30); // 1.2초: 서버는 다 보냈고 소리만 남았다
  assert.ok(old.sounding);
  assert.equal(
    s.sent().filter((x) => JSON.stringify(x) === JSON.stringify(AUDIO_STREAM_END)).length,
    1,
    '1초 넘게 보내지 않으면 서버의 말소리 감지에 한 번 알린다'
  );

  const m = s.mark();
  s.audio(500); // 학습자가 그 위로 말해 서버는 다음 답을 시작했다
  assert.equal(old.stopped, true);
  assert.deepEqual(s.log.slice(m), ['interrupted', 'turnStart'], '상태는 그대로 "말하는 중"');
  const fresh = s.sounding();
  assert.equal(fresh.length, 1);
  assert.ok(Math.abs(fresh[0].when - (s.speaker.currentTime + 0.05)) < 1e-6, '지금 바로 튼다');
  assert.ok(fresh[0].when < old.end, '전 답의 끝에 줄 서지 않는다');
  s.say('Which one?');
  assert.deepEqual(s.events(m), ['interrupted', 'turnStart', 'tutor:Which one?']);
  s.live.stop();
});

/* ---------- 4. 말로 끊기 (수정 b) ---------- */

test('말로 끊기: 튜터 말 위로 내 목소리가 이어지면 보내기 시작하고(bargeIn), 받아쓰기로 확인되면 그 답을 멈춘다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('I went to Bukhansan.');
  s.audio(3000);
  s.say(LINE);
  s.turnComplete();
  const [reply] = s.sounding();
  const sent = s.sentAudio();
  s.room(10);
  assert.equal(s.sentAudio(), sent, '메아리만 들어올 때는 보내지 않는다');

  const m = s.mark();
  s.talk(4, LOUD);
  assert.deepEqual(s.events(m), [], '0.2초 이어지기 전에는 열지 않는다');
  assert.equal(s.sentAudio(), sent);
  s.talk(1, LOUD);
  assert.deepEqual(s.events(m), ['bargeIn']);
  assert.equal(s.sentAudio(), sent + 8, '붙잡아 둔 직전 0.3초(8조각)부터 보낸다');
  s.talk(5, LOUD);
  assert.equal(s.sentAudio(), sent + 13);
  assert.ok(reply.sounding, '받아쓰기로 확인하기 전에는 멈추지 않는다');

  s.heard('Wait, can I ask something?');
  assert.equal(reply.stopped, true, '서버는 이미 답을 다 보냈으므로 직접 멈춘다');
  assert.deepEqual(s.events(m), ['bargeIn', 'interrupted', 'me:Wait, can I ask something?']);

  // 한국어로 끼어들면 메아리일 수 없다
  s.room(40);
  s.audio(3000);
  s.say('Sure, go ahead.');
  s.turnComplete();
  const [next] = s.sounding();
  s.room(5);
  const m2 = s.mark();
  s.talk(6, LOUD);
  s.heard('잠깐만요');
  assert.equal(next.stopped, true);
  assert.deepEqual(s.events(m2), ['bargeIn', 'interrupted', 'me:잠깐만요']);
  s.live.stop();
});

test('말로 끊은 뒤 새 답이 시작됐으면, 늦게 온 내 받아쓰기로 새 답을 멈추지 않는다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('I went to Bukhansan.');
  s.audio(3000);
  s.say(LINE);
  s.turnComplete();
  const [old] = s.sounding();
  s.room(10);

  const m = s.mark();
  s.talk(15, LOUD);
  s.room(5); // 말을 마쳤다
  assert.deepEqual(s.events(m), ['bargeIn']);
  // 서버는 내 말에 대한 답을 시작했고, 내 받아쓰기는 그 뒤에 온다
  s.audio(2000);
  s.say('Sure!');
  const [reply] = s.sounding();
  assert.equal(old.stopped, true);
  s.heard('What is the tallest one?');
  assert.ok(reply.sounding, '내 말에 대한 답은 멈추지 않는다');
  assert.deepEqual(s.events(m), ['bargeIn', 'interrupted', 'turnStart', 'tutor:Sure!', 'me:What is the tallest one?']);
  s.live.stop();
});

test('말로 끊기: 메아리가 받아써진 것이면 끊지 않고 (바로 전 답의 말과도 견준다), 세 번 잘못 열리면 끄고 알린다', async (t) => {
  const s = await greeted(t);
  const lines = [
    LINE,
    'Bukhansan has many beautiful hiking trails for everyone.',
    'Autumn is the best season to see colorful leaves there.',
    'What else would you like to know about it?',
  ];
  s.talk(10);
  s.audio(3000);
  s.say(lines[0]);
  s.turnComplete();
  for (let i = 0; i < 3; i++) {
    s.room(5);
    const m = s.mark();
    s.talk(6, LOUD); // 스피커 소리가 크게 들어와 문이 열린다
    assert.deepEqual(s.events(m), ['bargeIn'], `${i + 1}번째`);
    // 서버도 그 소리를 말로 알아듣고 새 답을 시작한 뒤, 전 답의 끝부분이 받아써져 온다
    s.audio(3000);
    s.say(lines[i + 1]);
    s.turnComplete();
    const [reply] = s.sounding();
    s.heard(lines[i].split(' ').slice(3, 8).join(' '));
    assert.ok(reply.sounding);
    assert.equal(s.log.filter((x) => x.startsWith('notice:')).length, i < 2 ? 0 : 1, `${i + 1}번째`);
  }
  assert.match(s.log.at(-2), /^notice:.*말로 끊기를 껐습니다/);

  // 이제는 버튼으로만 끊는다: 큰 소리에도 열지 않는다
  const sent = s.sentAudio();
  const m = s.mark();
  s.talk(10, LOUD);
  assert.equal(s.sentAudio(), sent);
  assert.deepEqual(s.events(m), []);
  s.live.interrupt();
  assert.deepEqual(s.events(m), ['interrupted']);
  s.live.stop();
});

test('말로 끊기를 끄면 튜터가 말하는 동안 마이크를 보내지 않고, 다시 켜면 배워 둔 메아리 크기로 바로 쓴다', async (t) => {
  const s = await greeted(t, { bargeIn: false });
  s.talk(10);
  s.audio(3000);
  s.turnComplete();
  const sent = s.sentAudio();
  const m = s.mark();
  s.talk(15, LOUD);
  assert.equal(s.sentAudio(), sent);
  assert.deepEqual(s.events(m), [], '큰 소리에도 열지 않는다');
  s.live.setBargeIn(true);
  s.talk(5, LOUD);
  assert.deepEqual(s.events(m), ['bargeIn']);
  assert.ok(s.sentAudio() > sent);
  s.live.stop();
});

// 버튼으로 끊으면 그때까지 잰 메아리로 배우고, 끊은 뒤 남은 메아리 0.3초 동안의 조각(곧바로 말한 내 목소리일 수 있음)은 재지 않는다
test(
  '첫인사를 버튼으로 끊고 바로 말해도, 그 내 목소리를 메아리로 배우지 않는다 (다음 답에서 말로 끊기가 된다)',
  async (t) => {
    const s = await begin(t);
    s.ws.accept();
    s.deliver(msg.setupComplete());
    s.audio(1500); // 첫인사 (아직 만드는 중)
    s.room(15); // 0.6초 듣다가
    s.live.interrupt();
    s.talk(8); // 누르자마자 말한다 (남은 메아리 0.3초 동안에도). 0.4초 기다렸다 말하면 통과한다
    s.heard('Sorry, can we talk about movies?');
    s.turnComplete();
    s.room(10);
    s.audio(3000);
    s.say('Sure! What movie did you see?');
    s.turnComplete();
    s.room(40); // 앞서 내 말로 열린 문이 닫힐 만큼 (1.3초 넘게) 조용히 듣는다
    const m = s.mark();
    s.talk(10, LOUD);
    assert.deepEqual(s.events(m), ['bargeIn'], '메아리(약 4%)보다 훨씬 큰 내 목소리로 열린다');
    s.live.stop();
  }
);

/* ---------- 5. 다시 연결하는 동안 (수정 d) ---------- */

test('연결이 끊겨 다시 연결하는 동안에도 남은 목소리가 나오면 "말하는 중"이고, "말 끊기"가 된다', async (t) => {
  const s = await greeted(t);
  s.deliver(msg.handle('h1'));
  s.talk(10);
  s.heard('Tell me a story.');
  s.audio(3000);
  s.say('Once upon a time');
  s.room(5);
  const old = s.ws;
  const [reply] = s.sounding();
  const sent = s.sentAudio();
  const m = s.mark();
  old.drop(1006); // 답을 만드는 중에 네트워크가 끊김
  assert.equal(s.status(), 'speaking');
  s.room(5);
  assert.deepEqual(s.log.slice(m), [], '아직 "다시 연결 중"으로 바꾸지 않는다');
  assert.equal(s.sentAudio(), sent, '다시 연결하는 동안의 마이크 조각은 버린다');

  s.live.interrupt();
  assert.equal(reply.stopped, true);
  assert.deepEqual(s.log.slice(m), ['status:reconnecting', 'interrupted']);

  s.room(25); // 1초 뒤 다시 연결
  assert.equal(reg.sockets.length, 2);
  s.ws.accept();
  assert.deepEqual(s.ws.sent[0].setup.sessionResumption, { handle: 'h1' }, '이어 말하기 정보로 붙는다');
  s.deliver(msg.setupComplete());
  assert.equal(s.ws.sent.length, 1, '첫 요청은 다시 보내지 않는다');
  assert.equal(s.status(), 'listening');
  s.audio(500);
  s.say('There was a tiger.');
  assert.equal(s.sounding().length, 1);
  assert.deepEqual(s.events(m), ['interrupted', 'turnEnd', 'turnStart', 'tutor:There was a tiger.']);
  s.live.stop();
});

test('옮겨 가기(goAway) 중에도 남은 목소리가 나오면 "말하는 중"이고, "말 끊기"가 된다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('Tell me a story.');
  s.audio(3000);
  s.say('Once upon a time');
  s.turnComplete();
  s.deliver(msg.handle('h2'));
  const old = s.ws;
  const [reply] = s.sounding();
  const m = s.mark();
  s.deliver(msg.goAway('10s'));
  assert.equal(reg.sockets.length, 2, '대화를 잃지 않는 때라 바로 옮긴다');
  await settle();
  assert.equal(old.closedWith, 1000);
  assert.equal(s.status(), 'speaking');
  assert.deepEqual(s.log.slice(m), []);
  old.deliver(msg.audio(base64FromInt16(tutorPcm(500))));
  assert.equal(s.sounding().length, 1, '옛 연결에서 늦게 온 메시지는 무시한다');

  s.live.interrupt();
  assert.equal(reply.stopped, true);
  assert.deepEqual(s.log.slice(m), ['status:reconnecting', 'interrupted']);
  s.ws.accept();
  assert.deepEqual(s.ws.sent[0].setup.sessionResumption, { handle: 'h2' });
  s.deliver(msg.setupComplete());
  s.waitFor('listening');
  assert.deepEqual(s.events(m), ['interrupted']);
  assert.equal(reg.sockets.length, 2);
  s.live.stop();
});

// 화면(voice-tutor.js)은 turnEnd·interrupted로 차례를 나눈다. 둘 다 없이 다음 turnStart가 오면 내 말은 전 튜터 말풍선 앞에,
// 새 답은 전 답 말풍선 뒤에 이어 붙는다
test(
  '답을 만드는 중에 연결이 끊겨 다시 연결하면, 버려진 그 답의 차례를 끝났다고 알린다 (다음 답이 같은 말풍선에 붙지 않게)',
  async (t) => {
    const s = await greeted(t);
    s.talk(10);
    s.heard('Tell me a story.');
    const m = s.mark();
    s.audio(1000);
    s.say('Once upon a time');
    s.ws.drop(1006); // 이 답의 나머지(turnComplete 포함)는 오지 않는다
    s.room(40); // 받은 목소리는 끝까지 나오고, 1초 뒤 다시 연결
    s.ws.accept();
    s.deliver(msg.setupComplete());
    s.talk(10);
    s.heard('Go on.');
    s.audio(500);
    s.say('There was a tiger.');
    const ev = s.events(m);
    const next = ev.lastIndexOf('turnStart');
    assert.equal(ev.indexOf('turnStart'), 0);
    assert.ok(next > 0);
    const between = ev.slice(1, next);
    assert.ok(
      between.includes('turnEnd') || between.includes('interrupted'),
      `두 turnStart 사이: ${JSON.stringify(between)}`
    );
    s.live.stop();
  }
);

/* ---------- 6. 일시정지 ---------- */

test('일시정지: 마이크 트랙을 끄고, 멈추기 전 답과 멈춘 동안 시작된 답은 버리며, 다시 시작한 뒤의 새 답은 들려준다', async (t) => {
  const s = await greeted(t);
  s.talk(10);
  s.heard('Hello.');
  s.audio(1000);
  s.say('Hi there.');
  const [reply] = s.sounding();
  const made = s.sources().length;
  const sent = s.sentAudio();
  const m = s.mark();

  s.live.setPaused(true);
  assert.equal(s.track.enabled, false);
  assert.equal(reply.stopped, true);
  s.live.interrupt(); // 멈춘 동안 버튼은 아무 일도 하지 않는다
  s.audio(1000);
  s.say(' How are you?');
  s.turnComplete();
  const lv = s.levels.length;
  s.talk(10);
  assert.equal(s.sentAudio(), sent, '멈춘 동안의 마이크 조각은 보내지 않는다');
  assert.ok(s.levels.slice(lv).every((l) => l === 0));

  // 멈춘 동안 새 답이 시작되면 듣지 못하므로 버린다 (다시 시작해도 그 답의 나머지는 버린다)
  s.audio(500);
  s.say('Are you there?');
  s.live.setPaused(false);
  assert.equal(s.track.enabled, true);
  s.audio(500);
  s.say(' Hello?');
  assert.equal(s.sources().length, made, '버린 답은 틀지 않는다');
  s.turnComplete();
  assert.deepEqual(s.events(m), ['turnEnd', 'turnEnd']);

  s.waitFor('listening');
  const before = s.sentAudio();
  s.talk(5);
  assert.equal(s.sentAudio(), before + 5);
  s.heard('Sorry, I am back.');
  s.audio(500);
  s.say('Welcome back!');
  assert.equal(s.sounding().length, 1);
  assert.deepEqual(s.events(m).slice(2), ['me:Sorry, I am back.', 'turnStart', 'tutor:Welcome back!']);
  s.live.stop();
});

test('아이폰 전화·Siri: 소리 처리가 interrupted가 되면 멈춰 달라고 한 번 알리고, 시스템이 모두 되돌리면 이어 가라고 알린다', async (t) => {
  const s = await greeted(t);
  s.hooks.systemPause = () => s.live.setPaused(true); // 화면은 다른 앱으로 갈 때처럼 잠시 멈춘다
  s.audio(1000);
  const [reply] = s.sounding();
  const m = s.mark();

  s.speaker.systemState('interrupted');
  assert.deepEqual(s.events(m), ['systemPause']);
  assert.equal(s.track.enabled, false, '마이크 트랙을 끈다');
  assert.equal(reply.stopped, true, '튜터 목소리를 멈춘다');
  s.micCtx.systemState('interrupted');
  assert.deepEqual(s.events(m), ['systemPause'], '이미 멈췄으면 다시 알리지 않는다');

  s.micCtx.systemState('running');
  assert.deepEqual(s.events(m), ['systemPause'], '하나라도 아직 멈춰 있으면 기다린다');
  s.hooks.systemResume = () => s.live.setPaused(false);
  s.speaker.systemState('running');
  assert.deepEqual(s.events(m), ['systemPause', 'systemResume']);
  assert.equal(s.track.enabled, true);
  s.speaker.systemState('running');
  assert.deepEqual(s.events(m), ['systemPause', 'systemResume'], '한 번만 알린다');

  s.waitFor('listening');
  const before = s.sentAudio();
  s.talk(3);
  assert.equal(s.sentAudio(), before + 3, '이어 가면 다시 보낸다');
  s.live.stop();
});

test('아이폰 전화·Siri: 가로채기가 끝나고 소리 처리가 suspended로 돌아와도 다시 켜고 이어 가라고 알린다', async (t) => {
  const s = await greeted(t);
  s.hooks.systemPause = () => s.live.setPaused(true);
  const m = s.mark();
  s.micCtx.systemState('interrupted');
  s.speaker.systemState('interrupted');
  assert.deepEqual(s.events(m), ['systemPause']);
  const before = [s.micCtx.resumes, s.speaker.resumes];

  s.micCtx.systemState('suspended');
  assert.deepEqual(s.events(m), ['systemPause'], '하나라도 아직 가로채여 있으면 기다린다');
  s.speaker.systemState('suspended');
  assert.deepEqual(s.events(m), ['systemPause', 'systemResume']);
  assert.deepEqual([s.micCtx.resumes, s.speaker.resumes], [before[0] + 1, before[1] + 1], 'suspended를 다시 켠다');
  assert.equal(s.micCtx.state, 'running');
  assert.equal(s.speaker.state, 'running');
  s.live.stop();
});

test('직접 일시정지한 동안의 interrupted는 알리지 않고, 시스템이 되돌려도 저절로 이어 가지 않는다', async (t) => {
  const s = await greeted(t);
  s.live.setPaused(true);
  const m = s.mark();
  s.micCtx.systemState('interrupted');
  s.speaker.systemState('interrupted');
  s.micCtx.systemState('running');
  s.speaker.systemState('running');
  assert.deepEqual(s.events(m), []);
  s.live.stop();
  s.speaker.systemState('interrupted'); // 끝낸 뒤에는 아무것도 알리지 않는다
  assert.deepEqual(s.events(m), []);
});

test('이어서 대화: 멈춰 있는(suspended·interrupted) 소리 처리를 다시 켜고, running이면 (크롬) 그대로 둔다', async (t) => {
  const s = await greeted(t);
  const before = [s.micCtx.resumes, s.speaker.resumes];
  s.live.setPaused(true);
  s.live.setPaused(false);
  assert.deepEqual([s.micCtx.resumes, s.speaker.resumes], before, 'running이면 resume()을 부르지 않는다');

  s.live.setPaused(true);
  s.micCtx.state = 'suspended';
  s.speaker.state = 'interrupted';
  s.live.setPaused(false);
  assert.deepEqual([s.micCtx.resumes, s.speaker.resumes], [before[0] + 1, before[1] + 1]);
  assert.equal(s.micCtx.state, 'running');
  assert.equal(s.speaker.state, 'running');
  s.live.stop();
});

test('시스템이 마이크를 끊으면 (전화·권한 회수 등) 연결·소리를 정리하고 마이크 실패로 한 번 알린다', async (t) => {
  const s = await greeted(t);
  const ws = s.ws;
  s.track.endBySystem();
  assert.deepEqual(s.events().slice(-1), ['fail:mic']);
  assert.equal(s.fails.at(-1).message, '마이크가 끊겼어요. 다시 시작하세요.');
  assert.equal(ws.closedWith, 1000);
  assert.ok(s.micCtx.closed && s.speaker.closed);
  assert.equal(s.pending.size, 0);
  s.track.endBySystem();
  assert.equal(s.count('fail:mic'), 1, '한 번만 알린다');
});

/* ---------- 7. 끝내기 ---------- */

test('끝내기: 예약해 둔 일을 모두 지우고 연결·마이크·소리를 닫으며, 그 뒤로는 아무것도 알리지 않는다', async (t) => {
  const s = await greeted(t);
  s.audio(400);
  s.turnComplete();
  s.room(12); // 목소리가 끝남 → 남은 메아리 대기 타이머
  s.deliver(msg.goAway('30s')); // 이어 말하기 정보가 아직 없어 옮기기를 예약한다
  s.audio(2000);
  assert.ok(s.pending.size >= 2, `걸린 타이머 ${s.pending.size}개`);
  const ws = s.ws;
  const [reply] = s.sounding();
  const m = s.mark();

  s.live.stop();
  assert.equal(s.pending.size, 0, '타이머를 모두 지운다');
  assert.equal(ws.closedWith, 1000);
  assert.equal(s.track.readyState, 'ended');
  assert.equal(reply.stopped, true);
  assert.ok(s.micCtx.closed && s.speaker.closed);
  assert.equal(s.node.port.onmessage, null);
  assert.ok(s.node.disconnected && s.micCtx.mic.disconnected);
  await settle();

  s.advance(60000);
  ws.deliver(msg.audio(base64FromInt16(tutorPcm(500))));
  s.live.interrupt();
  s.live.setPaused(false);
  s.live.stop(); // 두 번 불러도 괜찮다
  assert.deepEqual(s.log.slice(m), []);
  assert.equal(reg.sockets.length, 1);
  assert.equal(s.sounding().length, 0);
});

test('끝내기: 다시 연결을 기다리는 중이어도 다시 연결하지 않는다', async (t) => {
  const s = await greeted(t);
  s.ws.drop(1006);
  assert.equal(s.status(), 'reconnecting');
  assert.ok(s.pending.size >= 1);
  const m = s.mark();
  s.live.stop();
  assert.equal(s.pending.size, 0);
  s.advance(10000);
  assert.equal(reg.sockets.length, 1);
  assert.deepEqual(s.log.slice(m), []);
});

test('끝내기: 마이크가 열리기 전에 끝내면 늦게 열린 마이크를 바로 닫고 연결하지 않는다', async (t) => {
  const s = await begin(t, { stopAtOnce: true });
  assert.equal(reg.tracks.length, 1);
  assert.equal(reg.tracks[0].readyState, 'ended');
  assert.equal(reg.sockets.length, 0);
  assert.equal(reg.nodes.length, 0);
  s.advance(20000);
  assert.deepEqual(s.log, []);
  assert.equal(s.pending.size, 0);
});

/* ---------- 그 밖의 연결 처리 ---------- */

test('교정 도구 호출: 교정 카드를 알리고 바로 답한다', async (t) => {
  const s = await greeted(t);
  const calls = [
    { id: 'c1', name: 'show_correction', args: { original: 'I goed', corrected: 'I went', explanation_ko: '불규칙 동사' } },
  ];
  s.deliver({ toolCall: { functionCalls: calls } });
  assert.deepEqual(s.events().slice(-1), ['correction:I went']);
  assert.deepEqual(s.ws.sent.at(-1), toolResponse(calls));
  s.live.stop();
});

test('설정 전에 모델이 없다고 닫히면 다음 모델로, 하루 한도를 다 쓰면 오늘은 Live를 건너뛰고 실패를 알린다', async (t) => {
  const s = await begin(t);
  s.ws.accept();
  s.ws.drop(1008, `models/${LIVE_MODELS[0]} is not found for API version v1beta`);
  assert.equal(reg.sockets.length, 2);
  s.ws.accept();
  assert.equal(s.ws.sent[0].setup.model, `models/${LIVE_MODELS[1]}`);
  s.ws.drop(1011, 'RESOURCE_EXHAUSTED: You exceeded your current quota (limit: 0) per day');
  assert.deepEqual(s.events(), ['fail:quota']);
  assert.match(liveBlocked(), /오늘 Gemini Live 무료 사용 한도/);
  assert.equal(s.track.readyState, 'ended');
  assert.equal(s.pending.size, 0);
  mem.delete('eh.liveBlocked.v1');
});

test('설정 완료가 12초 안에 오지 않으면 연결을 닫고 실패를 알린다', async (t) => {
  const s = await begin(t);
  s.ws.accept();
  s.advance(11990);
  assert.deepEqual(s.events(), []);
  s.advance(10);
  assert.deepEqual(s.events(), ['fail:network']);
  assert.equal(reg.sockets[0].readyState, FakeSocket.CLOSED);
  assert.equal(s.track.readyState, 'ended');
  assert.equal(liveBlocked(), null, '잠깐인 실패는 기억하지 않는다');
});

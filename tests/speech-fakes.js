// 음성 읽기·음성 인식·마이크·오디오 세션 시험용 가짜 브라우저 (speech.js·recorder.js·listen-buffer.js가 쓰는 만큼만).
// ui.js는 불러올 때 userAgent로 기기를 정하므로 앱 모듈을 import하기 전에 installSpeechFakes()를 부른다.
// (테스트 파일마다 따로 실행되므로 기기마다 파일을 나눈다)

/** 음성 읽기: 대기열 맨 앞이 읽는 중. 시험이 start()·finish()로 엔진을 움직인다 */
export class FakeSynth extends EventTarget {
  queue = [];
  spoken = []; // speak()로 받은 모든 읽기
  voices = [];
  drop = false; // 아이폰: 누른 처리 밖의 읽기는 아무 알림 없이 버린다
  get speaking() {
    return this.queue.length > 0;
  }
  get pending() {
    return this.queue.length > 1;
  }
  getVoices() {
    return this.voices;
  }
  speak(u) {
    this.spoken.push(u);
    if (!this.drop) this.queue.push(u);
  }
  cancel() {
    const q = this.queue;
    this.queue = [];
    for (const u of q) u.onerror?.({ error: 'canceled' });
  }
  /** 엔진이 맨 앞 읽기를 시작함 */
  start() {
    this.queue[0]?.onstart?.();
  }
  /** 맨 앞 읽기가 끝남 */
  finish() {
    this.queue.shift()?.onend?.();
  }
}

export class FakeUtterance {
  volume = 1;
  voice = null;
  constructor(text) {
    this.text = text;
  }
}

/** 음성 인식기: 만들어질 때마다 recognitions에 쌓인다. 시험이 이벤트를 넣는다 */
export const recognitions = [];
export class FakeRecognition {
  started = false;
  stopped = false;
  aborted = false;
  constructor() {
    recognitions.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
  /* 아래는 브라우저 쪽 */
  speechStart() {
    this.onspeechstart?.();
  }
  result(text, isFinal = true) {
    const res = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [res] });
  }
  error(code) {
    this.onerror?.({ error: code });
  }
  end() {
    this.onend?.();
  }
}

/** 마이크: getUserMedia를 부른 순간의 오디오 세션 종류도 적어 둔다 */
export const mic = { calls: [], tracks: [], deny: null };
export class FakeTrack extends EventTarget {
  readyState = 'live';
  enabled = true;
  stop() {
    this.readyState = 'ended';
  }
}

/** 재생용 AudioContext (playClip·openMic이 쓰는 만큼) */
export const contexts = [];
export class FakeAudioContext {
  sampleRate = 48000;
  destination = {};
  state = 'running';
  audioWorklet = { addModule: async () => {} };
  constructor() {
    contexts.push(this);
  }
  createMediaStreamSource() {
    return { connect: (n) => n, disconnect() {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect: (n) => n };
  }
  createBufferSource() {
    const src = {
      playbackRate: { value: 1 },
      started: false,
      connect: (n) => n,
      start: () => (src.started = true),
      stop: () => queueMicrotask(() => src.onended?.()),
    };
    this.source = src;
    return src;
  }
  async decodeAudioData() {
    return { duration: 1 };
  }
  async close() {
    this.state = 'closed';
  }
}

/** 아이폰 사파리의 navigator.audioSession: 바뀐 종류를 모두 적는다 */
export function fakeAudioSession() {
  const s = { types: [], failNext: false, value: 'auto' };
  Object.defineProperty(s, 'type', {
    get: () => s.value,
    set: (v) => {
      if (s.failNext) {
        s.failNext = false;
        throw new TypeError('바꿀 수 없음');
      }
      s.value = v;
      s.types.push(v);
    },
  });
  return s;
}

/**
 * @param {{userAgent: string, navigator?: object}} o navigator: 덧붙일 navigator 속성 (audioSession 등)
 */
export function installSpeechFakes({ userAgent, navigator: extra = {} }) {
  globalThis.window = globalThis;
  globalThis.dispatchEvent ??= () => true;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const synth = new FakeSynth();
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  globalThis.webkitSpeechRecognition = FakeRecognition;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = class {
    port = { onmessage: null };
    connect = (n) => n;
    disconnect() {}
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent,
      maxTouchPoints: 5,
      mediaDevices: {
        getUserMedia: async ({ audio }) => {
          mic.calls.push({ audio, session: globalThis.navigator.audioSession?.type });
          if (mic.deny) {
            const e = new Error('denied');
            e.name = mic.deny;
            throw e;
          }
          const t = new FakeTrack();
          mic.tracks.push(t);
          return { getTracks: () => [t], getAudioTracks: () => [t] };
        },
      },
      ...extra,
    },
  });
  return { synth };
}

/** 기다리던 microtask·setImmediate를 모두 흘려보낸다 (setTimeout은 시험의 가짜 타이머) */
export const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};

/** 가짜 시계를 10ms씩 돌린다 (타이머 안에서 건 타이머도 제때 불리게) */
export function advance(t, ms) {
  for (let left = ms; left > 0; left -= 10) t.mock.timers.tick(Math.min(10, left));
}

/** promise가 끝났는지 들여다본다 */
export function watch(p) {
  const w = { done: false };
  p.then(() => (w.done = true));
  return w;
}

// "방금 뭐라고?" 듣기 서비스(가짜 마이크·오디오 그래프)와 화면 꺼짐 방지(여러 쪽이 함께 쓰기)를 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------- 브라우저 흉내 ---------- */

const docListeners = [];
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: (type, fn) => docListeners.push([type, fn]),
};
globalThis.window ??= globalThis;

let lastConstraints = null;
let lastNode = null;
let track = null;
const wakeLog = [];

class FakeTrack extends EventTarget {
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}
class FakeAudioContext {
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource = () => ({ connect: (n) => n, disconnect() {} });
  createGain = () => ({ gain: { value: 1 }, connect: (n) => n });
  close = async () => {};
}
globalThis.AudioContext = FakeAudioContext;
globalThis.AudioWorkletNode = class {
  constructor() {
    this.port = { onmessage: null };
    lastNode = this;
  }
  connect(n) {
    return n;
  }
  disconnect() {}
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async (c) => {
        lastConstraints = c;
        track = new FakeTrack();
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
    wakeLock: {
      request: async () => {
        const l = new EventTarget();
        l.release = async () => {
          wakeLog.push('release');
          l.dispatchEvent(new Event('release'));
        };
        wakeLog.push('request');
        return l;
      },
    },
  },
});

const { startListening } = await import('../js/services/listen-buffer.js');
const { keepAwake } = await import('../js/services/wake-lock.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
/** 48kHz 마이크 조각 (워클릿이 보내는 것처럼) */
const chunk = (n, v) => lastNode.port.onmessage({ data: new Float32Array(n).fill(v) });

test('startListening: 통화용 소리 처리를 끄고 듣고, 16kHz로 줄여 최근 것만 남긴다', async () => {
  const levels = [];
  const l = await startListening({ keepSeconds: 2, onLevel: (v) => levels.push(v) });
  assert.deepEqual(lastConstraints, {
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  chunk(48000, 0.1); // 1초
  assert.ok(Math.abs(levels.at(-1) - 0.1) < 1e-6);
  assert.ok(Math.abs(l.level(1) - 0.1) < 1e-6);

  const snap = l.snapshot(10); // 있는 만큼(1초)만
  assert.equal(snap.seconds, 1);
  assert.equal(snap.blob.type, 'audio/wav');
  assert.equal(snap.blob.size, 44 + 16000 * 2);
  const pcm = new DataView(await snap.blob.arrayBuffer());
  assert.equal(pcm.getUint32(24, true), 16000, 'WAV 표본화율');
  assert.ok(Math.abs(pcm.getInt16(44, true) / 0x7fff - 0.9) < 1e-3, '소리 크기를 0.9로 맞춘다');

  chunk(48000 * 3, 0.2); // 보관 한도(2초)를 넘김
  assert.equal(l.snapshot(10).seconds, 2);

  l.stop();
  assert.equal(track.readyState, 'ended', '마이크를 끈다');
  assert.equal(lastNode.port.onmessage, null);
  assert.equal(l.snapshot(10).seconds, 0, '보관하던 소리를 지운다');
});

test('pauseWhile: 휴대폰이 소리를 내는 동안은 담지 않는다', async () => {
  const l = await startListening({ keepSeconds: 5 });
  chunk(48000, 0.1);
  let done;
  l.pauseWhile(new Promise((r) => (done = r)));
  chunk(48000, 0.5); // 다시 듣기 소리
  assert.equal(l.snapshot(5).seconds, 1);
  done();
  await tick();
  chunk(48000, 0.1);
  assert.equal(l.snapshot(5).seconds, 2);
  assert.ok(l.level(2) < 0.11, '재생 소리는 섞이지 않았다');

  l.pauseWhile(Promise.reject(new Error('재생 실패')));
  await tick();
  chunk(48000, 0.1);
  assert.equal(l.snapshot(5).seconds, 3, '재생이 실패해도 다시 담는다');
  l.stop();
});

test('startListening: 마이크가 끊기거나 막히면 알린다', async () => {
  const events = [];
  const l = await startListening({ onEnded: () => events.push('ended'), onMute: (m) => events.push(`mute:${m}`) });
  track.dispatchEvent(new Event('mute'));
  track.dispatchEvent(new Event('unmute'));
  track.dispatchEvent(new Event('ended'));
  assert.deepEqual(events, ['mute:true', 'mute:false', 'ended']);
  l.stop();
});

test('keepAwake: 쓰는 쪽이 모두 끌 때만 화면 꺼짐 방지를 놓는다', async () => {
  wakeLog.length = 0;
  keepAwake('subtitle', true);
  await tick();
  keepAwake('listen', true);
  await tick();
  assert.deepEqual(wakeLog, ['request'], '이미 걸려 있으면 다시 요청하지 않는다');
  keepAwake('listen', false);
  assert.deepEqual(wakeLog, ['request'], '자막 쪽이 아직 쓰는 중');
  keepAwake('subtitle', false);
  assert.deepEqual(wakeLog, ['request', 'release']);
  keepAwake('subtitle', false); // 두 번 꺼도 괜찮다
  assert.deepEqual(wakeLog, ['request', 'release']);
});

test('keepAwake: 늦게 온 예전 잠금의 release 때문에 새 잠금을 잊지 않는다', async () => {
  wakeLog.length = 0;
  const { request } = navigator.wakeLock;
  let old;
  navigator.wakeLock.request = async () => (old = await request());
  keepAwake('listen', true);
  await tick();
  navigator.wakeLock.request = request;
  // 화면을 벗어나 브라우저가 풀었다가, 돌아와서 다시 건다
  old.dispatchEvent(new Event('release'));
  for (const [type, fn] of docListeners) if (type === 'visibilitychange') fn();
  await tick();
  old.dispatchEvent(new Event('release')); // 예전 잠금의 이벤트가 한 번 더 와도
  keepAwake('listen', false);
  assert.deepEqual(wakeLog, ['request', 'request', 'release'], '새 잠금을 놓는다');
});

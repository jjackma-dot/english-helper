// Gemini Live API 실시간 음성 대화: 마이크 → 16kHz PCM → WebSocket → 24kHz 튜터 목소리 재생.
// 기본은 반이중: 튜터 목소리가 나오는 동안(과 끝난 뒤 잠깐)은 마이크를 보내지 않아 스피커 소리를 다시 듣지 않는다.
// 연결은 약 10분마다 끊기므로 이어 말하기 정보(handle)로 자동으로 다시 연결한다.

import { apiKey } from './gemini.js';
import { getMic } from './recorder.js';
import { nextPacificMidnight } from '../lib/gemini-policy.js';
import {
  AUDIO_STREAM_END,
  LIVE_MODELS,
  MIC_RATE,
  SPEAKER_RATE,
  audioMessage,
  base64FromInt16,
  buildSetup,
  classifyLiveClose,
  decodeFrame,
  int16FromBase64,
  int16ToFloat32,
  kickoffMessage,
  liveUrl,
  parseServerMessage,
  peakLevel,
  planAfterClose,
  toolResponse,
} from '../lib/live-protocol.js';

const BLOCK_KEY = 'eh.liveBlocked.v1';
const ECHO_GUARD_MS = 300; // 튜터 목소리가 끝나고 마이크를 다시 열기까지
const STREAM_END_MS = 1000; // 마이크를 이만큼 보내지 않으면 서버에 알린다
const GREETING_WAIT_MS = 8000; // 첫인사가 이만큼 늦으면 기다리지 않고 마이크를 연다
const SETUP_WAIT_MS = 12000; // 연결하고 이만큼 설정 완료가 없으면 실패로 본다

export const liveSupported = Boolean(
  window.WebSocket && window.AudioWorkletNode && navigator.mediaDevices?.getUserMedia
);

/** 오늘 Live를 쓰지 않기로 한 이유(한도 초과·모델 없음 등). 없으면 null */
export function liveBlocked() {
  try {
    const v = JSON.parse(localStorage.getItem(BLOCK_KEY) || 'null');
    return v && v.until > Date.now() ? v.message : null;
  } catch {
    return null;
  }
}

/** 무료 한도가 다시 채워지는 태평양 시간 자정까지 Live를 건너뛴다 */
function blockForToday(message) {
  try {
    localStorage.setItem(BLOCK_KEY, JSON.stringify({ until: nextPacificMidnight(), message }));
  } catch {
    /* 저장 실패는 무시 */
  }
}

/** 받은 PCM 조각을 끊김 없이 이어서 재생한다. 말 끊김(interrupted) 때는 남은 소리를 바로 멈춘다 */
function createPlayer(onPlaying) {
  const ctx = new AudioContext({ sampleRate: SPEAKER_RATE });
  const sources = new Set();
  let head = 0;
  return {
    ctx,
    get playing() {
      return sources.size > 0;
    },
    play(samples, rate) {
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, rate);
      buf.copyToChannel(int16ToFloat32(samples), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      head = Math.max(head, ctx.currentTime + 0.05);
      src.start(head);
      head += buf.duration;
      src.onended = () => {
        sources.delete(src);
        if (!sources.size) onPlaying(false);
      };
      sources.add(src);
      if (sources.size === 1) onPlaying(true);
    },
    flush() {
      const had = sources.size > 0;
      for (const s of sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* 이미 멈춤 */
        }
      }
      sources.clear();
      head = 0;
      if (had) onPlaying(false);
    },
  };
}

/**
 * Live 음성 대화를 시작한다. 소리를 내려면 사용자가 버튼을 누른 처리 안에서 바로 불러야 한다.
 * @param {{system: string, duplex?: boolean, on: object}} o duplex: 튜터가 말하는 중에도 마이크를 보냄(이어폰용)
 *   on.status('connecting'|'thinking'|'listening'|'speaking'|'reconnecting'),
 *   on.userText(t)·on.tutorText(t): 받아쓰기 조각,
 *   on.turnStart(): 튜터 목소리가 새로 나오기 시작함, on.turnEnd(), on.interrupted(),
 *   on.correction({original, corrected, explanation_ko}), on.level(0~1),
 *   on.fail({kind, message}): Live로 계속할 수 없음 (마이크·연결은 이미 정리됨). kind 'mic'·'key'는 기본 음성 모드로도 안 됨
 * @returns {{stop: () => void, setPaused: (on: boolean) => void, setDuplex: (on: boolean) => void}}
 */
export function startLive({ system, duplex = false, on }) {
  const key = apiKey();
  let stream = null;
  let source = null;
  let node = null;
  let ws = null;
  let rate = MIC_RATE;
  let modelIdx = 0;
  let resumeHandle = null;
  let ready = false; // 지금 연결이 설정까지 마쳤는지
  let everReady = false;
  let greeted = false; // 튜터의 첫인사가 끝남 (그전에는 주변 소리가 첫인사를 끊지 않도록 마이크를 보내지 않는다)
  let stopped = false;
  let paused = false;
  let generating = false; // 튜터가 답을 만드는 중
  let reconnects = 0;
  let swapPending = false;
  let resumable = false; // 지금 옮겨도 대화를 잃지 않음 (마지막 일 뒤에 이어 말하기 정보가 새로 왔음)
  let gateUntil = 0; // 반이중: 이 시각까지는 튜터 목소리가 남아 있다고 본다
  let lastSentAt = 0;
  let streamEnded = true;
  let lastStatus = '';
  const timers = { greet: 0, setup: 0, reconnect: 0, swap: 0, gate: 0 };

  const micCtx = new AudioContext();
  const player = createPlayer((playing) => {
    if (stopped) return;
    if (!playing) {
      gateUntil = performance.now() + ECHO_GUARD_MS;
      clearTimeout(timers.gate);
      timers.gate = setTimeout(updateStatus, ECHO_GUARD_MS + 20);
    }
    updateStatus();
  });
  micCtx.resume().catch(() => {});
  player.ctx.resume().catch(() => {});

  const send = (msg) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const tutorAudible = () => player.playing || performance.now() < gateUntil;

  function currentStatus() {
    if (!ready) return everReady ? 'reconnecting' : 'connecting';
    if (tutorAudible()) return 'speaking';
    return greeted ? 'listening' : 'thinking';
  }

  function updateStatus() {
    if (stopped) return;
    const s = currentStatus();
    if (s !== lastStatus) on.status((lastStatus = s));
  }

  function micOpen() {
    return ready && greeted && !paused && (duplex || !tutorAudible());
  }

  function onChunk(pcm) {
    if (micOpen()) {
      send(audioMessage(base64FromInt16(pcm), rate));
      lastSentAt = performance.now();
      streamEnded = false;
      on.level(peakLevel(pcm));
      return;
    }
    // 다시 연결하는 동안·튜터가 말하는 동안의 조각은 버린다
    on.level(0);
    if (ready && !streamEnded && performance.now() - lastSentAt > STREAM_END_MS) {
      send(AUDIO_STREAM_END);
      streamEnded = true;
    }
  }

  function connect() {
    ready = false;
    generating = false;
    resumable = false;
    streamEnded = true;
    updateStatus();
    let sock;
    try {
      sock = new WebSocket(liveUrl(key));
    } catch (e) {
      closed({ kind: 'network', message: `Gemini Live에 연결할 수 없습니다: ${e.message}`, remember: false });
      return;
    }
    sock.binaryType = 'arraybuffer';
    ws = sock;
    clearTimeout(timers.setup);
    timers.setup = setTimeout(() => {
      if (sock !== ws || ready) return;
      ws = null;
      sock.close();
      closed({
        kind: 'network',
        message: 'Gemini Live가 응답하지 않습니다. 인터넷 연결을 확인하세요.',
        remember: false,
      });
    }, SETUP_WAIT_MS);
    sock.onopen = () =>
      sock.send(JSON.stringify(buildSetup({ model: LIVE_MODELS[modelIdx], system, handle: resumeHandle })));
    sock.onmessage = (e) => {
      if (sock !== ws) return;
      for (const ev of parseServerMessage(decodeFrame(e.data))) handleEvent(ev);
    };
    sock.onclose = (e) => {
      if (sock !== ws || stopped) return;
      ws = null;
      closed(classifyLiveClose(e.code, e.reason));
    };
  }

  function greetingDone() {
    clearTimeout(timers.greet);
    greeted = true;
    updateStatus();
  }

  /** 이어 말하기 정보로 새 연결을 열고 옛 연결은 닫는다 (마이크는 계속 켜 둔다) */
  function swap() {
    clearTimeout(timers.swap);
    swapPending = false;
    const old = ws;
    ws = null;
    old?.close(1000);
    connect();
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'setupComplete':
        clearTimeout(timers.setup);
        ready = true;
        reconnects = 0;
        if (!everReady) {
          everReady = true;
          send(kickoffMessage()); // 튜터가 먼저 말을 건다
          timers.greet = setTimeout(greetingDone, GREETING_WAIT_MS);
        }
        updateStatus();
        break;
      case 'audio':
        // 받아쓰기는 차례와 순서가 어긋나 올 수 있으므로 '답을 만드는 중'은 소리로만 판단한다
        if (!generating) {
          generating = true;
          resumable = false;
          on.turnStart?.();
        }
        if (!paused) player.play(int16FromBase64(ev.data), ev.rate);
        break;
      case 'userText':
        resumable = false; // 학습자가 말하는 중: 새 이어 말하기 정보가 올 때까지 옮기지 않는다
        on.userText(ev.text);
        break;
      case 'tutorText':
        on.tutorText(ev.text);
        break;
      case 'interrupted':
        generating = false;
        player.flush();
        on.interrupted();
        break;
      case 'turnComplete':
        generating = false;
        if (!greeted) greetingDone();
        on.turnEnd();
        break;
      case 'toolCall':
        for (const c of ev.calls) if (c.name === 'show_correction') on.correction(c.args);
        send(toolResponse(ev.calls));
        break;
      case 'resumeHandle':
        resumeHandle = ev.handle;
        resumable = true;
        if (swapPending && !generating) swap();
        break;
      case 'notResumable':
        resumable = false;
        break;
      case 'goAway':
        // 곧 끊긴다: 대화를 잃지 않는 때(이어 말하기 정보가 새로 온 뒤) 옮기고, 늦어도 끊기기 1초 전에는 옮긴다
        if (!swapPending) {
          swapPending = true;
          timers.swap = setTimeout(swap, Math.max(0, (ev.ms ?? 5000) - 1000));
        }
        if (resumable && !generating) swap();
        break;
    }
  }

  /** @param {{kind: string, message: string, remember: boolean}} c 닫힌 이유 */
  function closed(c) {
    const setupDone = ready;
    ready = false;
    clearTimeout(timers.setup);
    const plan = planAfterClose(c, { setupDone, everReady, modelIdx, reconnects });
    if (plan.action === 'next-model') {
      modelIdx++;
      connect();
    } else if (plan.action === 'reconnect') {
      if (!plan.keepHandle) resumeHandle = null;
      reconnects++;
      updateStatus();
      timers.reconnect = setTimeout(connect, plan.delayMs);
    } else {
      if (plan.remember) blockForToday(c.message);
      fail(c);
    }
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    for (const t of Object.values(timers)) clearTimeout(t);
    const sock = ws;
    ws = null;
    sock?.close(1000);
    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    player.flush();
    micCtx.close().catch(() => {});
    player.ctx.close().catch(() => {});
  }

  function fail(c) {
    cleanup();
    on.fail(c);
  }

  (async () => {
    try {
      stream = await getMic();
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      await micCtx.audioWorklet.addModule(new URL('../worklets/pcm16-capture.js', import.meta.url));
      if (stopped) return;
      source = micCtx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(micCtx, 'pcm16-capture');
      const mute = micCtx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute).connect(micCtx.destination); // 처리 그래프 유지용 (소리는 내지 않음)
      rate = Math.min(micCtx.sampleRate, MIC_RATE);
      node.port.onmessage = (e) => onChunk(e.data);
      connect();
    } catch (e) {
      if (stopped) return;
      // 마이크 권한 문제는 기본 음성 모드로도 해결되지 않는다
      fail(
        stream
          ? { kind: 'unsupported', message: `음성 처리를 시작할 수 없습니다: ${e.message}` }
          : { kind: 'mic', message: e.message }
      );
    }
  })();

  return {
    stop: cleanup,
    setPaused(v) {
      paused = v;
      if (v) player.flush();
      stream?.getTracks().forEach((t) => (t.enabled = !v));
    },
    setDuplex(v) {
      duplex = v;
    },
  };
}

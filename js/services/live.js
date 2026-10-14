// Gemini Live API 실시간 음성 대화: 마이크 → 16kHz PCM → WebSocket → 24kHz 튜터 목소리 재생.
// 튜터 목소리가 나오는 동안(과 끝난 뒤 잠깐)은 마이크 소리를 붙잡아 두고, 내 목소리로 보일 때만 보내 튜터 말을 끊는다
// (말로 끊기, lib/barge-in.js). 말로 끊기를 끄면 그동안 마이크를 보내지 않는다. "말 끊기" 버튼(interrupt)은 언제나 된다.
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
import { ECHO_AFTER_S, ECHO_BEFORE_S, createEchoGate, createFarTrack } from '../lib/barge-in.js';

const BLOCK_KEY = 'eh.liveBlocked.v1';
const ECHO_GUARD_MS = 300; // 튜터 목소리가 끝나고 마이크를 다시 열기까지 (내 목소리로 보이면 바로 연다)
const BUTTON_GUARD_MS = 100; // "말 끊기" 버튼으로 멈춘 뒤 (말로 끊기를 쓸 수 없을 때) 남은 소리만 거르는 시간
const STREAM_END_MS = 1000; // 마이크를 이만큼 보내지 않으면 서버에 알린다
const GREETING_WAIT_MS = 8000; // 첫인사가 이만큼 늦으면 기다리지 않고 마이크를 연다
const SETUP_WAIT_MS = 12000; // 연결하고 이만큼 설정 완료가 없으면 실패로 본다
const TUTOR_CHARS = 3000; // 내 받아쓰기가 메아리인지 가릴 때 견줄 튜터 답 하나의 받아쓰기 (최대 글자 수)
const BARGE_OFF =
  '스피커 소리가 마이크로 다시 들어가서 이번 대화에서는 말로 끊기를 껐습니다. 튜터 말을 끊으려면 "말 끊기" 버튼을 누르세요.';

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

/**
 * 받은 PCM 조각을 끊김 없이 이어서 재생한다. 말 끊김(interrupted) 때는 남은 소리를 바로 멈춘다.
 * 내보낸 소리의 크기를 재생 시각별로 기록해 두어, 마이크에 섞여 들어올 메아리 크기를 어림한다 (farLevel)
 */
function createPlayer(onPlaying) {
  const ctx = new AudioContext({ sampleRate: SPEAKER_RATE });
  const sources = new Set();
  const far = createFarTrack();
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
      far.prune(ctx.currentTime - 1);
      far.add(head, samples, rate);
      head += buf.duration;
      src.onended = () => {
        sources.delete(src);
        if (!sources.size) onPlaying(false);
      };
      sources.add(src);
      if (sources.size === 1) onPlaying(true);
    },
    /** 지금 마이크에 섞여 들어올 수 있는 튜터 소리의 크기 (0~1, 출력·입력 지연을 덮도록 앞뒤 구간의 최대) */
    farLevel() {
      const t = ctx.currentTime;
      return far.level(t - ECHO_BEFORE_S, t + ECHO_AFTER_S);
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
      far.cut(ctx.currentTime);
      head = 0;
      if (had) onPlaying(false);
    },
  };
}

/**
 * Live 음성 대화를 시작한다. 소리를 내려면 사용자가 버튼을 누른 처리 안에서 바로 불러야 한다.
 * @param {{system: string, bargeIn?: boolean, on: object}} o bargeIn: 튜터가 말하는 중에 내 목소리가 들리면 보내서 말을 끊는다
 *   on.status('connecting'|'thinking'|'listening'|'speaking'|'reconnecting'),
 *   on.userText(t)·on.tutorText(t): 받아쓰기 조각 (끊은 답의 나머지 글은 보내지 않는다),
 *   on.turnStart(): 튜터 목소리가 새로 나오기 시작함, on.turnEnd(), on.interrupted(): 튜터 말이 끊김 (목소리·버튼),
 *   on.correction({original, corrected, explanation_ko}), on.level(0~1),
 *   on.bargeIn(): 튜터가 말하는 중에 내 목소리가 들려 보내기 시작함 (이어지는 내 받아쓰기는 새 말풍선에),
 *   on.notice(message): 알릴 일 (말로 끊기가 자꾸 잘못 열려 이번 대화에서는 끔),
 *   on.fail({kind, message}): Live로 계속할 수 없음 (마이크·연결은 이미 정리됨). kind 'mic'·'key'는 기본 음성 모드로도 안 됨
 * @returns {{stop: () => void, setPaused: (on: boolean) => void, setBargeIn: (on: boolean) => void, interrupt: () => void}}
 *   interrupt: "말 끊기" 버튼. 튜터가 말하는 중이 아니면 아무 일도 하지 않는다
 */
export function startLive({ system, bargeIn = true, on }) {
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
  let dropping = false; // 끊은 답의 남은 소리·글을 버리는 중 (그 답이 끝나거나 서버가 끊김을 알릴 때까지)
  let reconnects = 0;
  let swapPending = false;
  let resumable = false; // 지금 옮겨도 대화를 잃지 않음 (마지막 일 뒤에 이어 말하기 정보가 새로 왔음)
  let gateUntil = 0; // 이 시각까지는 튜터 목소리(의 메아리)가 남아 있다고 본다
  let lastSentAt = 0;
  let streamEnded = true;
  let lastStatus = '';
  let tutorWords = ''; // 지금 답의 받아쓰기 (메아리 판정용)
  let prevTutorWords = ''; // 바로 전 답의 받아쓰기 (그 답의 남은 목소리가 아직 나오고 있을 수 있다)
  let gen = 0; // 튜터 답 번호 (새 답을 만들기 시작할 때마다 늘어남)
  let bargeGen = -1; // 말로 끊기가 마지막으로 열렸을 때 나오던 답 번호
  const timers = { greet: 0, setup: 0, reconnect: 0, swap: 0, gate: 0 };
  const gate = createEchoGate({ enabled: bargeIn });

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
    if (player.playing) return 'speaking'; // 다시 연결하는 동안에도 남은 목소리는 나오고 "말 끊기"도 된다
    if (!ready) return everReady ? 'reconnecting' : 'connecting';
    if (tutorAudible()) return 'speaking';
    return greeted ? 'listening' : 'thinking';
  }

  function updateStatus() {
    if (stopped) return;
    const s = currentStatus();
    if (s !== lastStatus) on.status((lastStatus = s));
  }

  function onChunk(pcm) {
    if (paused) return dropChunk();
    const now = performance.now();
    const level = peakLevel(pcm);
    const audible = tutorAudible();
    const far = audible ? player.farLevel() : 0;
    if (!ready || !greeted) {
      // 다시 연결하는 동안·첫인사 동안의 조각은 버린다 (첫인사 동안 메아리 크기는 잰다)
      gate.observe(level, { far, audible });
      return dropChunk();
    }
    noteMiss(gate.timeout(now));
    // 튜터 목소리가 안 나올 때는 모두, 나오는 동안에는 내 목소리로 보일 때만 보낸다
    const wasOpen = gate.open;
    const frames = gate.push(pcm, { level, far, audible, now });
    if (audible && !wasOpen && gate.open) {
      // 튜터가 말하는 중에 내 목소리가 들림: 이제부터 받아쓰는 내 말은 새 말풍선에 쓴다
      bargeGen = gen;
      on.bargeIn?.();
    }
    if (!frames.length) return dropChunk();
    for (const f of frames) send(audioMessage(base64FromInt16(f), rate));
    lastSentAt = now;
    streamEnded = false;
    on.level(level);
  }

  /** 보내지 않은 조각: 마이크 막대를 비우고, 오래 보내지 않았으면 서버의 말소리 감지에 알린다 */
  function dropChunk() {
    on.level(0);
    if (ready && !streamEnded && performance.now() - lastSentAt > STREAM_END_MS) {
      send(AUDIO_STREAM_END);
      streamEnded = true;
    }
  }

  /** 말로 끊기가 잘못 열렸음 ('miss'·'off'). 자꾸 그래서 이번 대화에서는 꺼졌으면 알린다 */
  function noteMiss(verdict) {
    if (verdict === 'off') on.notice?.(BARGE_OFF);
  }

  /** 튜터 목소리를 바로 멈추고, 지금 답에서 아직 오지 않은 소리·글은 버린다 */
  function cut() {
    if (generating) dropping = true;
    player.flush();
    on.interrupted();
  }

  function connect() {
    // 옮겨 가기와 다시 연결이 겹쳐도 연결이 둘 남지 않게 한다
    clearTimeout(timers.reconnect);
    if (ws) {
      const old = ws;
      ws = null;
      old.close(1000);
    }
    ready = false;
    if (generating) on.turnEnd(); // 만들던 답은 이 연결과 함께 끝났다 (다음 답은 새 말풍선에)
    generating = false;
    dropping = false;
    resumable = false;
    streamEnded = true;
    gate.reset(); // 옛 연결에서 붙잡아 둔 소리·확인 중인 말로 끊기는 버린다 (배운 메아리 크기는 둔다)
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
    connect(); // 옛 연결은 connect가 닫는다
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
          gen++;
          prevTutorWords = tutorWords;
          tutorWords = '';
          dropping = paused; // 멈춘 동안 시작된 답은 듣지 못하므로 버린다
          if (!dropping && player.playing) {
            // 전 답의 목소리가 아직 나오는데 새 답이 왔다 = 학습자가 그 위에 말해 서버는 이미 다음 차례로 넘어갔다.
            // 남은 목소리를 멈춰야 새 답이 그 뒤에 줄 서서 늦게 나오지 않는다
            player.flush();
            on.interrupted();
          }
          if (!dropping) on.turnStart?.();
        }
        if (!paused && !dropping) player.play(int16FromBase64(ev.data), ev.rate);
        break;
      case 'userText': {
        resumable = false; // 학습자가 말하는 중: 새 이어 말하기 정보가 올 때까지 옮기지 않는다
        const verdict = gate.heard(ev.text, `${prevTutorWords} ${tutorWords}`);
        // 답을 다 만든 뒤 재생만 남았을 때는 서버가 끊김을 알리지 않으므로, 내 말이 확인되면 직접 멈춘다.
        // 단, 내가 말을 걸었던 그 답이 아직 나오는 중일 때만 (그사이 새 답이 시작됐으면 그 답은 내 말에 대한 대답이다)
        if (verdict === 'real' && player.playing && bargeGen === gen) cut();
        else noteMiss(verdict);
        on.userText(ev.text);
        break;
      }
      case 'tutorText':
        if (dropping) break; // 끊은 답의 나머지는 학습자가 듣지 못한 말이다
        tutorWords = (tutorWords + ev.text).slice(-TUTOR_CHARS);
        on.tutorText(ev.text);
        break;
      case 'interrupted': {
        const cutNow = !dropping && (generating || player.playing); // 이미 끊었으면 다시 알리지 않는다
        generating = false;
        dropping = false;
        player.flush();
        if (cutNow) on.interrupted();
        break;
      }
      case 'turnComplete':
        generating = false;
        dropping = false;
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
    clearTimeout(timers.swap); // 이미 끊겼으니 예약해 둔 옮겨 가기는 다시 연결이 대신한다
    swapPending = false;
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
      if (v) {
        if (generating) dropping = true; // 멈추기 전에 만들던 답은 이어서 들려주지 않는다
        gate.spoil();
        gate.reset();
        player.flush();
      }
      stream?.getTracks().forEach((t) => (t.enabled = !v));
    },
    setBargeIn(v) {
      gate.enabled = v;
    },
    interrupt() {
      // 튜터가 말하는 중이 아니거나 이미 끊은 답이면 아무것도 하지 않는다
      if (stopped || paused || !(player.playing || (generating && !dropping))) return;
      gate.endTurn(); // 끊긴 뒤 곧바로 말한 내 목소리를 메아리로 배우지 않게
      cut();
      if (!gate.active) {
        // 말로 끊기 문이 열릴 수 없으면 남은 메아리만 잠깐(0.1초) 거르고 바로 듣는다 (내 첫마디가 잘리지 않게).
        // 열릴 수 있으면 0.3초를 두되, 그사이 바로 말하면 문이 내 목소리를 알아채 앞부분까지 보낸다
        gateUntil = performance.now() + BUTTON_GUARD_MS;
        clearTimeout(timers.gate);
        timers.gate = setTimeout(updateStatus, BUTTON_GUARD_MS + 20);
      }
      if (!greeted) greetingDone();
      updateStatus();
    },
  };
}

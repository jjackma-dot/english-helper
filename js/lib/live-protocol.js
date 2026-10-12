// Gemini Live API(실시간 음성 대화) 메시지 규칙과 음성 데이터 변환 (순수 함수, 단위 테스트 대상)
// AudioWorklet에서도 불러 쓰므로 모듈을 읽을 때 브라우저 전용 기능(TextDecoder, btoa 등)을 쓰지 않는다.

import { bareModel, parseDuration } from './gemini-policy.js';

export const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** 차례로 시도할 Live 모델 (앞 모델을 찾을 수 없다고 하면 다음 모델) */
export const LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];

export const MIC_RATE = 16000; // 보내는 마이크 소리: 16kHz 16비트 모노
export const SPEAKER_RATE = 24000; // 받는 튜터 목소리: 24kHz 16비트 모노
export const CHUNK_SAMPLES = 640; // 40ms 단위로 보낸다
export const MAX_RECONNECTS = 3; // 끊긴 연결을 이어서 다시 시도하는 횟수

/** 튜터가 먼저 말을 걸게 하는 첫 요청 (화면에는 보이지 않음) */
export const START_TEXT = 'Greet me briefly and ask one easy question to start.';

/** 브라우저에서는 키를 주소에 넣어야 한다 (WebSocket은 머리글을 붙일 수 없음) */
export function liveUrl(key) {
  return `${LIVE_ENDPOINT}?key=${encodeURIComponent(key)}`;
}

/** 학습자의 틀린 말을 화면에 교정 카드로 보여 주는 도구 (대화를 멈추지 않음) */
export const CORRECTION_TOOL = {
  name: 'show_correction',
  description: 'Show the learner a written correction of their last utterance.',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      original: { type: 'STRING' },
      corrected: { type: 'STRING' },
      explanation_ko: { type: 'STRING' },
    },
    required: ['original', 'corrected'],
  },
};

/**
 * 연결 직후 처음 보내는 설정 메시지. 다시 연결할 때도 같은 설정에 handle만 넣는다.
 * (gemini-3.8-live는 thinkingConfig·enableAffectiveDialog·proactivity를 거부하므로 넣지 않는다)
 */
export function buildSetup({ model, system, handle = null, voiceName = 'Kore' }) {
  return {
    setup: {
      model: `models/${bareModel(model)}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
      systemInstruction: { parts: [{ text: system }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          silenceDurationMs: 900,
          prefixPaddingMs: 200,
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      },
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: handle ? { handle } : {},
      tools: [{ functionDeclarations: [CORRECTION_TOOL] }],
    },
  };
}

export function kickoffMessage(text = START_TEXT) {
  return { clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } };
}

export function audioMessage(base64, rate = MIC_RATE) {
  return { realtimeInput: { audio: { data: base64, mimeType: `audio/pcm;rate=${rate}` } } };
}

/** 마이크를 1초 넘게 보내지 않을 때 서버의 말소리 감지에 알린다 */
export const AUDIO_STREAM_END = { realtimeInput: { audioStreamEnd: true } };

/** 교정 카드를 보여 줬다고 답한다 (SILENT: 튜터가 이 일로 따로 말하지 않음) */
export function toolResponse(calls) {
  return {
    toolResponse: {
      functionResponses: calls.map((c) => ({
        id: c.id,
        name: c.name,
        response: { result: 'shown' },
        scheduling: 'SILENT',
      })),
    },
  };
}

let utf8;

/** 서버 프레임(글자 또는 바이너리) → JSON 객체. 읽을 수 없으면 null */
export function decodeFrame(data) {
  try {
    const text = typeof data === 'string' ? data : (utf8 ??= new TextDecoder()).decode(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 'audio/pcm;rate=24000' → 24000 */
export function rateFromMime(mime, fallback = SPEAKER_RATE) {
  const m = String(mime || '').match(/rate=(\d+)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * 서버 메시지 하나를 처리할 사건 목록으로 바꾼다 (처리 순서대로).
 * @returns {Array<{type: 'setupComplete'|'interrupted'|'userText'|'audio'|'tutorText'|'turnComplete'|'toolCall'
 *   |'resumeHandle'|'goAway', text?: string, data?: string, rate?: number, calls?: object[], handle?: string,
 *   ms?: number|null}>}
 */
export function parseServerMessage(msg) {
  const out = [];
  if (!msg || typeof msg !== 'object') return out;
  if (msg.setupComplete) out.push({ type: 'setupComplete' });
  const sc = msg.serverContent;
  if (sc) {
    if (sc.interrupted) out.push({ type: 'interrupted' });
    if (sc.inputTranscription?.text) out.push({ type: 'userText', text: sc.inputTranscription.text });
    for (const p of sc.modelTurn?.parts || []) {
      const d = p?.inlineData;
      if (d?.data && /^audio\/pcm/i.test(d.mimeType || '')) {
        out.push({ type: 'audio', data: d.data, rate: rateFromMime(d.mimeType) });
      }
    }
    if (sc.outputTranscription?.text) out.push({ type: 'tutorText', text: sc.outputTranscription.text });
    if (sc.turnComplete) out.push({ type: 'turnComplete' });
  }
  const calls = msg.toolCall?.functionCalls;
  if (Array.isArray(calls) && calls.length) {
    out.push({ type: 'toolCall', calls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args || {} })) });
  }
  const r = msg.sessionResumptionUpdate;
  if (r?.resumable && r.newHandle) out.push({ type: 'resumeHandle', handle: r.newHandle });
  if (msg.goAway) out.push({ type: 'goAway', ms: parseDuration(msg.goAway.timeLeft) });
  return out;
}

/**
 * 연결이 닫힌 이유를 보고 다음 행동을 정한다.
 * @returns {{kind: 'key'|'quota'|'model'|'network'|'other', message: string, remember: boolean}}
 *   key: 키 문제(기본 음성 모드도 같은 키라 소용없음) / quota: 한도 초과 / model: 모델을 쓸 수 없음 / 그 밖: 이번만 대체
 *   remember: 오늘 다시 해도 같을 실패(한도 초과·모델 없음·설정 거부 1007/1008). 그날은 바로 기본 음성 모드로 시작한다
 */
export function classifyLiveClose(code, reason = '') {
  const r = String(reason || '').trim();
  const detail = `(코드 ${code}${r ? `: ${r}` : ''})`;
  if (/API[_ ]?KEY|PERMISSION_DENIED|unregistered caller/i.test(r)) {
    return {
      kind: 'key',
      message: `Gemini API 키로 음성 대화를 할 수 없습니다. 설정에서 키를 확인하세요. ${detail}`,
      remember: false,
    };
  }
  if (/RESOURCE_EXHAUSTED|quota|\b429\b|rate.?limit/i.test(r)) {
    return { kind: 'quota', message: `오늘 Gemini Live 무료 사용 한도를 다 썼습니다. ${detail}`, remember: true };
  }
  if (/not found|NOT_FOUND|not supported|unsupported|not implemented|unknown model|not available/i.test(r)) {
    return { kind: 'model', message: `Gemini Live 모델을 쓸 수 없습니다. ${detail}`, remember: true };
  }
  if (code === 1006 && !r) {
    return {
      kind: 'network',
      message: `Gemini Live에 연결하지 못했습니다. 인터넷 연결을 확인하세요. ${detail}`,
      remember: false,
    };
  }
  return {
    kind: 'other',
    message: `Gemini Live 연결이 끊어졌습니다. ${detail}`,
    remember: code === 1007 || code === 1008,
  };
}

/**
 * 연결이 닫힌 뒤 할 일을 정한다.
 * @param {{kind: string, remember: boolean}} c classifyLiveClose 결과
 * @param {{setupDone: boolean, everReady: boolean, modelIdx: number, reconnects: number}} s
 *   setupDone: 닫힌 연결이 설정까지 마쳤는지 / everReady: 이번 대화에서 한 번이라도 설정까지 마쳤는지
 *   reconnects: 설정 완료 없이 이어서 다시 연결한 횟수
 * @returns {{action: 'next-model'|'reconnect'|'fail', remember?: boolean, keepHandle?: boolean, delayMs?: number}}
 *   fail: Live를 그만두고 기본 음성 모드로 (remember: 그날은 Live를 건너뜀)
 */
export function planAfterClose(c, { setupDone, everReady, modelIdx, reconnects }) {
  if (c.kind === 'key') return { action: 'fail', remember: false };
  if (!everReady) {
    if (c.kind === 'model' && modelIdx < LIVE_MODELS.length - 1) return { action: 'next-model' };
    return { action: 'fail', remember: c.remember };
  }
  if (c.kind === 'quota') return { action: 'fail', remember: true };
  if (reconnects >= MAX_RECONNECTS) return { action: 'fail', remember: false };
  // 이어 말하기 정보로 붙지 못했으면(설정 전에 닫힘) 다음에는 새 대화로 연결한다. 인터넷 문제였으면 그대로 둔다
  return { action: 'reconnect', keepHandle: setupDone || c.kind === 'network', delayMs: 1000 * (reconnects + 1) };
}

/* ---------- 음성 데이터 ---------- */

/** -1~1 실수 → 16비트 정수 (범위를 넘으면 자른다) */
export function floatToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToFloat32(input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
  return out;
}

/** 16비트 PCM → 리틀 엔디언 바이트의 base64 */
export function base64FromInt16(samples) {
  let bin = '';
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] & 0xffff;
    bin += String.fromCharCode(v & 0xff, v >> 8);
  }
  return btoa(bin);
}

/** 리틀 엔디언 바이트의 base64 → 16비트 PCM (홀수 바이트 끝은 버린다) */
export function int16FromBase64(b64) {
  const bin = atob(b64);
  const out = new Int16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = ((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16) >> 16;
  }
  return out;
}

/** 16비트 PCM 조각의 가장 큰 소리 크기 (0~1, 마이크 막대용) */
export function peakLevel(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 4) peak = Math.max(peak, Math.abs(samples[i]));
  return peak / 0x8000;
}

/**
 * 실시간으로 들어오는 소리 블록(보통 128샘플)을 outRate로 낮춘다 (구간 평균).
 * 44.1kHz처럼 나누어떨어지지 않는 비율도 블록 사이에 이어서 계산한다. inRate가 더 낮으면 그대로 둔다.
 * @returns {(block: Float32Array) => Float32Array}
 */
export function createDownsampler(inRate, outRate = MIC_RATE) {
  const ratio = Math.max(1, inRate / outRate);
  let sum = 0;
  let count = 0;
  let seen = 0; // 지금까지 받은 샘플 수
  let edge = ratio; // 다음 출력 샘플이 끝나는 위치
  return (block) => {
    const out = new Float32Array(Math.ceil(block.length / ratio) + 1);
    let n = 0;
    for (let i = 0; i < block.length; i++) {
      sum += block[i];
      count++;
      if (++seen >= edge) {
        out[n++] = sum / count;
        sum = 0;
        count = 0;
        edge += ratio;
      }
    }
    return out.subarray(0, n);
  };
}

/* ---------- 기본 음성 모드(Live를 쓸 수 없을 때) ---------- */

/** 최근 대화 max개. Gemini에 보내는 대화는 사용자 차례로 시작해야 한다 */
export function recentTurns(turns, max = 8) {
  const out = turns.slice(-max);
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * 스트리밍으로 늘어나는 답에서 새로 끝난 문장을 꺼낸다 (끝난 문장부터 바로 읽어 주기 위해).
 * 문장 끝 기호 뒤에 공백이 와야 끝난 것으로 본다 ("3." 다음에 "5"가 올 수 있으므로). final이면 남은 글도 꺼낸다.
 * @param {number} from 이미 꺼낸 글자 수
 * @returns {{sentences: string[], end: number}}
 */
export function takeSentences(text, from = 0, final = false) {
  const s = String(text || '');
  const sentences = [];
  let end = from;
  const re = /[.!?]+["'”’)]*\s+/g;
  re.lastIndex = from;
  for (let m; (m = re.exec(s)); ) {
    const piece = s.slice(end, m.index + m[0].length).trim();
    if (piece) sentences.push(piece);
    end = m.index + m[0].length;
  }
  if (final && end < s.length) {
    const piece = s.slice(end).trim();
    if (piece) sentences.push(piece);
    end = s.length;
  }
  return { sentences, end };
}

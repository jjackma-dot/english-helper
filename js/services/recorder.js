// 마이크 녹음 → 16kHz 모노 WAV (Gemini 받아쓰기와 재생·저장에 쓰기 좋은 형식)

import { concatFloat32, downsample, encodeWav } from '../lib/wav.js';
import { isAndroid, isIOS } from '../ui.js';

export const recordingSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode);

/** 내 목소리용 (통화처럼 잡음·메아리 제거를 켠다) */
export const VOICE_AUDIO = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/**
 * 내 목소리용, 에코 제거 없이 (잡음 제거·자동 음량만).
 * 안드로이드 크롬은 에코 제거를 켠 마이크를 처음 열 때(휴대폰에 에코 제거 장치가 있으면) 휴대폰을 통화 모드
 * (MODE_IN_COMMUNICATION)로 바꾼다. 그동안 볼륨 버튼은 통화 음량을 바꾸고, 소리도 통화처럼 나간다. 열린 마이크가
 * 모두 닫혀야 돌아온다 (Chromium media/audio/android/audio_manager_android.cc, AudioManagerAndroid::MakeAudioInputStream).
 * 에코 제거를 끄면 통화 모드로 바꾸지 않는다. 잡음 제거·자동 음량은 크롬이 직접 처리해서 상관없다.
 * 휴대폰마다 다를 수 있다 (Chromium 버그 443255997)
 */
export const MEDIA_VOICE_AUDIO = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};

/** 녹음(번역 녹음·들린 대로 말하기)용: 녹음하는 동안은 소리를 내지 않으므로 에코 제거가 필요 없다. 아이폰은 그대로 */
const RECORD_AUDIO = isAndroid ? MEDIA_VOICE_AUDIO : VOICE_AUDIO;

/* ---------- 아이폰 오디오 세션 (사파리 16.4+, 크롬에는 없음) ---------- */

const audioSession = isIOS ? navigator.audioSession : null;
const openStreams = new WeakSet(); // getMic으로 열어 아직 releaseMic하지 않은 마이크
let mics = 0; // 여는 중이거나 열린 마이크 수
let clips = 0; // playbackSession으로 재생 중인 소리 수

/**
 * 마이크가 열려 있으면 녹음·재생('play-and-record'), 소리만 내는 중이면 재생('playback': 무음 스위치에
 * 묻히지 않게), 아니면 기본('auto').
 * WebKit 버그 236219: 마이크를 쓰는 동안 다른 소리가 작아지는 것은 이것으로도 막지 못한다. 마이크를 닫은 뒤에도
 * 작게 남으면 'playback'으로 바꾸는 것이 알려진 해결책인데, 여기서는 'auto'로 돌린다 (실기기 확인 필요)
 */
function applySession() {
  if (!audioSession) return;
  const type = mics ? 'play-and-record' : clips ? 'playback' : 'auto';
  try {
    if (audioSession.type !== type) audioSession.type = type;
  } catch {
    /* 무시 */
  }
}

/**
 * 아이폰: 돌려준 함수를 부를 때까지 이 페이지의 소리를 재생 세션으로 낸다 (무음 스위치를 켜도 들리게).
 * 소리를 만들기 전에 부른다. 마이크가 열려 있으면 그대로 두고, 아이폰이 아니면 아무것도 하지 않는다
 * @returns {() => void} 재생이 끝나면 부른다 (여러 번 불러도 괜찮다)
 */
export function playbackSession() {
  if (!audioSession) return () => {};
  clips++;
  applySession();
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    clips--;
    applySession();
  };
}

/** getMic으로 연 마이크를 닫는다 (여러 번 불러도 괜찮다) */
export function releaseMic(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  if (openStreams.delete(stream)) {
    mics--;
    applySession();
  }
}

/**
 * 마이크 스트림을 연다. 권한 거부 등은 알기 쉬운 오류로 바꾼다. 다 쓰면 releaseMic(stream)으로 닫는다.
 * @param {MediaTrackConstraints} audio getUserMedia 오디오 조건 (에코 제거·잡음 제거·자동 음량 등)
 */
export async function getMic(audio = VOICE_AUDIO) {
  mics++;
  applySession(); // 아이폰: 세션은 마이크를 열기 전에 바꾼다 (WebKit 버그 236219의 알려진 해결 순서)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    openStreams.add(stream);
    return stream;
  } catch (e) {
    mics--;
    applySession();
    if (e.name === 'NotAllowedError')
      throw new Error(
        isIOS
          ? '마이크 권한이 거부되었습니다. Safari의 ⋯(또는 aA) 메뉴 → 웹 사이트 설정 → 마이크, 또는 설정 → 앱 → Safari → 마이크에서 허용하세요.'
          : '마이크 권한이 거부되었습니다. 브라우저(앱) 권한에서 마이크를 허용하세요.'
      );
    if (e.name === 'NotFoundError') throw new Error('마이크를 찾을 수 없습니다.');
    if (e.name === 'NotReadableError') throw new Error('다른 앱이 마이크를 쓰고 있어 열 수 없습니다.');
    throw e;
  }
}

/**
 * 마이크를 열어 PCM 조각(약 4096 샘플씩)을 받는다. 소리는 내지 않는다.
 * @param {MediaTrackConstraints} audio getUserMedia 오디오 조건
 * @param {(chunk: Float32Array, sampleRate: number) => void} onChunk
 * @returns {Promise<{sampleRate: number, track: MediaStreamTrack, release: () => void}>}
 */
export async function openMic(audio, onChunk) {
  const stream = await getMic(audio);
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(new URL('../worklets/pcm-recorder.js', import.meta.url));
  } catch (e) {
    releaseMic(stream);
    ctx.close();
    throw new Error(`녹음 기능을 시작할 수 없습니다: ${e.message}`);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-recorder');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(ctx.destination); // 처리 그래프 유지용 (소리는 내지 않음)
  node.port.onmessage = (e) => onChunk(e.data, ctx.sampleRate);

  return {
    sampleRate: ctx.sampleRate,
    track: stream.getAudioTracks()[0],
    release() {
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        /* 무시 */
      }
      releaseMic(stream);
      ctx.close().catch(() => {});
    },
  };
}

/**
 * @param {{maxSeconds?: number, onLevel?: (level: number, seconds: number) => void, onLimit?: () => void}} [o]
 * @returns {Promise<{stop: () => Promise<{blob: Blob, seconds: number}>, cancel: () => void}>}
 */
export async function startRecording({ maxSeconds = 300, onLevel, onLimit } = {}) {
  const chunks = [];
  let samples = 0;
  const mic = await openMic(RECORD_AUDIO, (data, rate) => {
    chunks.push(data);
    samples += data.length;
    let peak = 0;
    for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]));
    const seconds = samples / rate;
    onLevel?.(peak, seconds);
    if (seconds >= maxSeconds) onLimit?.();
  });

  return {
    async stop() {
      const rate = mic.sampleRate;
      mic.release();
      const pcm = downsample(concatFloat32(chunks), rate, 16000);
      const blob = new Blob([encodeWav(pcm, Math.min(16000, rate))], { type: 'audio/wav' });
      return { blob, seconds: pcm.length / Math.min(16000, rate) };
    },
    cancel: mic.release,
  };
}

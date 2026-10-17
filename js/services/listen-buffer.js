// "방금 뭐라고?"용 듣기: 마이크 소리를 이 기기 메모리에 최근 몇십 초만 남기고 계속 덮어쓴다 (저장·전송하지 않음).
// TV·휴대폰 스피커 소리를 그대로 들어야 하므로 통화용 소리 처리를 모두 끈다. 에코 제거를 켜면 안드로이드 크롬이
// 통화 모드로 바뀌어 넷플릭스 소리를 줄이고, 휴대폰이 내는 소리를 메아리로 여겨 지워 버린다.

import { openMic, playbackSession } from './recorder.js';
import { downsample, encodeWav } from '../lib/wav.js';
import { SampleRing, normalizePeak, rms } from '../lib/ring.js';

const RATE = 16000; // Gemini에 보내기 좋은 16kHz 모노 (30초 ≈ 0.96MB)
const MAX_PAUSE_MS = 45000; // 재생이 끝났다는 알림이 오지 않아도 이만큼 지나면 다시 담는다

const SPEAKER_AUDIO = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/**
 * @param {{keepSeconds?: number, onLevel?: (rms: number) => void, onEnded?: () => void,
 *          onMute?: (muted: boolean) => void}} [o]
 *   onLevel: 조각(약 0.1초)마다 소리 크기 / onEnded: 마이크가 끊김(다른 앱·권한 회수 등)
 *   onMute: 시스템이 마이크를 잠시 막음·풂
 * @returns {Promise<{snapshot: (seconds: number) => {blob: Blob, seconds: number}, level: (seconds: number) => number,
 *          pauseWhile: (playing: Promise<unknown>) => void, stop: () => void}>}
 */
export async function startListening({ keepSeconds = 45, onLevel, onEnded, onMute } = {}) {
  const ring = new SampleRing(RATE * keepSeconds);
  let paused = 0;
  const mic = await openMic(SPEAKER_AUDIO, (chunk, inRate) => {
    // 휴대폰이 스스로 내는 소리(읽기·느리게 듣기, 단어 뜻 창의 발음 등)는 다음 질문에 섞이지 않게 담지 않는다
    if (paused || globalThis.speechSynthesis?.speaking) return onLevel?.(0);
    const pcm = downsample(chunk, inRate, RATE); // 받자마자 줄여서 보관 (45초 ≈ 2.9MB)
    ring.push(pcm);
    onLevel?.(rms(pcm));
  });
  const rate = Math.min(RATE, mic.sampleRate);
  mic.track.addEventListener('ended', () => onEnded?.());
  mic.track.addEventListener('mute', () => onMute?.(true));
  mic.track.addEventListener('unmute', () => onMute?.(false));

  return {
    /** 최근 seconds초를 WAV로. 자동 음량이 꺼져 있으므로 소리 크기를 맞춘다 */
    snapshot(seconds) {
      const pcm = normalizePeak(ring.last(seconds * rate));
      return { blob: new Blob([encodeWav(pcm, rate)], { type: 'audio/wav' }), seconds: pcm.length / rate };
    },
    /** 최근 seconds초의 소리 크기 (RMS) */
    level: (seconds) => rms(ring.last(seconds * rate)),
    /** 이 기기가 소리를 내는 동안(느리게 다시 듣기·읽기)은 그 소리가 다음 질문에 섞이지 않게 담지 않는다 */
    pauseWhile(playing) {
      paused++;
      let timer = 0;
      Promise.race([playing, new Promise((r) => (timer = setTimeout(r, MAX_PAUSE_MS)))])
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer);
          paused--;
        });
    },
    /** 마이크를 끄고 보관하던 소리를 지운다 */
    stop() {
      mic.release();
      ring.clear();
    },
  };
}

/**
 * 받아 둔 소리 조각을 이 기기에서 재생한다 (네트워크 불필요). rate 0.75 = 느리게
 * @returns {Promise<{stop: () => void, ended: Promise<void>}>}
 */
export async function playClip(blob, { rate = 0.75 } = {}) {
  const endSession = playbackSession(); // 아이폰: 무음 스위치를 켜 두어도 들리게 (마이크가 꺼져 있을 때)
  const ctx = new AudioContext();
  const src = ctx.createBufferSource();
  try {
    src.buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch (e) {
    endSession();
    ctx.close();
    throw e;
  }
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  const ended = new Promise((resolve) => (src.onended = resolve)).then(() => {
    endSession();
    return ctx.close().catch(() => {});
  });
  src.start();
  // 멈출 때도 세션을 돌려 둔다: 소리 처리가 멈춰 있으면(아이폰 전화 등) 끝 알림(onended)이 오지 않는다
  const stop = () => {
    try {
      src.stop();
    } finally {
      endSession();
    }
  };
  return { stop, ended };
}

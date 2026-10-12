// 마이크 녹음 → 16kHz 모노 WAV (Gemini 받아쓰기와 재생·저장에 쓰기 좋은 형식)

import { concatFloat32, downsample, encodeWav } from '../lib/wav.js';

export const recordingSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode);

/**
 * 마이크를 열어 PCM 조각(약 4096 샘플씩)을 받는다. 소리는 내지 않는다.
 * @param {MediaTrackConstraints} audio getUserMedia 오디오 조건 (에코 제거·잡음 제거·자동 음량 등)
 * @param {(chunk: Float32Array, sampleRate: number) => void} onChunk
 * @returns {Promise<{sampleRate: number, track: MediaStreamTrack, release: () => void}>}
 */
export async function openMic(audio, onChunk) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    if (e.name === 'NotAllowedError')
      throw new Error('마이크 권한이 거부되었습니다. 브라우저(앱) 권한에서 마이크를 허용하세요.');
    if (e.name === 'NotFoundError') throw new Error('마이크를 찾을 수 없습니다.');
    throw e;
  }
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(new URL('../worklets/pcm-recorder.js', import.meta.url));
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
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
      stream.getTracks().forEach((t) => t.stop());
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
  const mic = await openMic(
    { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    (data, rate) => {
      chunks.push(data);
      samples += data.length;
      let peak = 0;
      for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]));
      const seconds = samples / rate;
      onLevel?.(peak, seconds);
      if (seconds >= maxSeconds) onLimit?.();
    }
  );

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

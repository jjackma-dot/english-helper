// 마이크 녹음 → 16kHz 모노 WAV (Gemini 받아쓰기와 재생·저장에 쓰기 좋은 형식)

import { concatFloat32, downsample, encodeWav } from '../lib/wav.js';

export const recordingSupported = Boolean(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode);

/**
 * @param {{maxSeconds?: number, onLevel?: (level: number, seconds: number) => void, onLimit?: () => void}} [o]
 * @returns {Promise<{stop: () => Promise<{blob: Blob, seconds: number}>, cancel: () => void}>}
 */
export async function startRecording({ maxSeconds = 300, onLevel, onLimit } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
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

  const chunks = [];
  let samples = 0;
  let stopped = false;
  node.port.onmessage = (e) => {
    if (stopped) return;
    const data = e.data;
    chunks.push(data);
    samples += data.length;
    let peak = 0;
    for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]));
    const seconds = samples / ctx.sampleRate;
    onLevel?.(peak, seconds);
    if (seconds >= maxSeconds) onLimit?.();
  };

  function release() {
    stopped = true;
    node.port.onmessage = null;
    try {
      source.disconnect();
      node.disconnect();
    } catch {
      /* 무시 */
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }

  return {
    async stop() {
      const rate = ctx.sampleRate;
      release();
      const pcm = downsample(concatFloat32(chunks), rate, 16000);
      const blob = new Blob([encodeWav(pcm, Math.min(16000, rate))], { type: 'audio/wav' });
      return { blob, seconds: pcm.length / Math.min(16000, rate) };
    },
    cancel: release,
  };
}

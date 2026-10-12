// 마이크 소리를 16kHz 16비트 PCM 조각(640샘플 = 40ms)으로 바꿔 메인 스레드로 보내는 AudioWorklet (Gemini Live용)

import { CHUNK_SAMPLES, MIC_RATE, createDownsampler, floatToInt16 } from '../lib/live-protocol.js';

class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.down = createDownsampler(sampleRate, MIC_RATE);
    this.buf = new Float32Array(CHUNK_SAMPLES);
    this.len = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const s = this.down(ch);
      for (let i = 0; i < s.length; i++) {
        this.buf[this.len++] = s[i];
        if (this.len === CHUNK_SAMPLES) {
          const pcm = floatToInt16(this.buf);
          this.port.postMessage(pcm, [pcm.buffer]);
          this.len = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm16-capture', Pcm16Capture);

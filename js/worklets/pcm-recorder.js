// 마이크 PCM 데이터를 모아 메인 스레드로 보내는 AudioWorklet (약 4096 샘플 단위)
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.buf.length - this.len);
        this.buf.set(ch.subarray(i, i + n), this.len);
        this.len += n;
        i += n;
        if (this.len === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(4096);
          this.len = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);

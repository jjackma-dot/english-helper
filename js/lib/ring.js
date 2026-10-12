// 최근 소리만 남기는 고정 크기 버퍼(링 버퍼)와 소리 크기 계산 (순수 함수, 단위 테스트 대상)

/** 가장 최근 capacity개 샘플만 남기는 버퍼. 오래된 소리는 계속 덮어쓴다 */
export class SampleRing {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.end = 0; // 다음에 쓸 위치
    this.size = 0;
  }

  /** @param {Float32Array} chunk */
  push(chunk) {
    const cap = this.buf.length;
    const src = chunk.length > cap ? chunk.subarray(chunk.length - cap) : chunk;
    const first = Math.min(src.length, cap - this.end);
    this.buf.set(src.subarray(0, first), this.end);
    this.buf.set(src.subarray(first), 0);
    this.end = (this.end + src.length) % cap;
    this.size = Math.min(cap, this.size + src.length);
  }

  /** 가장 최근 n개를 오래된 것부터 순서대로. 보관한 것보다 많이 달라면 있는 만큼만 */
  last(n) {
    const cap = this.buf.length;
    const len = Math.max(0, Math.min(Math.floor(n), this.size));
    const start = (this.end - len + cap) % cap;
    const first = Math.min(len, cap - start);
    const out = new Float32Array(len);
    out.set(this.buf.subarray(start, start + first));
    out.set(this.buf.subarray(0, len - first), first);
    return out;
  }

  /** 보관한 소리를 0으로 덮어써 지운다 */
  clear() {
    this.buf.fill(0);
    this.end = 0;
    this.size = 0;
  }
}

/** 소리 크기 (RMS, 0~1) */
export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/**
 * 가장 큰 소리가 target이 되도록 음량을 맞춘 새 배열 (자동 음량 조절을 끄고 녹음하면 소리가 아주 작을 수 있다).
 * 거의 조용한 구간의 잡음을 지나치게 키우지 않도록 maxGain배까지만 키운다.
 */
export function normalizePeak(samples, target = 0.9, maxGain = 30) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak ? Math.min(target / peak, maxGain) : 1;
  return samples.map((s) => s * gain);
}

// 자막 동기화용 가상 재생 시계 (넷플릭스·웨이브 재생 위치를 손으로 맞춰 따라간다)

export class PlaybackClock {
  /** @param {{ now?: () => number }} [opts] now는 밀리초 단위 단조 증가 시계 (테스트에서 주입) */
  constructor({ now = () => performance.now() } = {}) {
    this._now = now;
    this._base = 0;
    this._stamp = 0;
    this.running = false;
    this.rate = 1;
  }

  /** 현재 재생 위치(초) */
  get time() {
    if (!this.running) return this._base;
    return this._base + ((this._now() - this._stamp) / 1000) * this.rate;
  }

  set(seconds) {
    this._base = Math.max(0, Number(seconds) || 0);
    this._stamp = this._now();
  }

  play() {
    if (this.running) return;
    this._stamp = this._now();
    this.running = true;
  }

  pause() {
    if (!this.running) return;
    this._base = this.time;
    this.running = false;
  }

  toggle() {
    if (this.running) this.pause();
    else this.play();
  }

  shift(deltaSeconds) {
    this.set(this.time + deltaSeconds);
  }

  setRate(rate) {
    const t = this.time;
    this.rate = rate > 0 ? rate : 1;
    this.set(t);
  }
}

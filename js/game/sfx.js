// 게임 효과음 (Web Audio로 그때그때 만든다: 소리 파일 없음). 꺼 두면 아무 소리도 내지 않는다.

let ctx = null;
let enabled = true;

export function setSound(on) {
  enabled = Boolean(on);
}

/** 짧은 진동 (맞힘·틀림·별 조각). 소리를 끄면 진동도 쉰다 */
function buzz(pattern) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 무시 */
  }
}

function audio() {
  if (!enabled) return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return typeof ctx.createOscillator === 'function' ? ctx : null;
  } catch {
    return null;
  }
}

/** 음 하나: freq Hz, 길이 dur초, at초 뒤 */
function tone(freq, dur = 0.15, { type = 'sine', vol = 0.18, at = 0, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  try {
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const gn = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch {
    /* 소리를 못 내도 게임은 계속 */
  }
}

/** 지지직 하는 잡음 (무전기). dur초 */
function noise(dur = 0.18, vol = 0.08, at = 0) {
  const a = audio();
  if (!a || typeof a.createBuffer !== 'function') return;
  try {
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const gn = a.createGain();
    gn.gain.value = vol;
    src.connect(gn).connect(a.destination);
    src.start(a.currentTime + at);
  } catch {
    /* 무시 */
  }
}

/** 종소리 꽃 음 (도·레·미·솔·라) */
export const FLOWER_FREQ = { pink: 523.25, orange: 587.33, yellow: 659.25, blue: 783.99, purple: 880 };

export const sfx = {
  tap: () => tone(660, 0.06, { type: 'triangle', vol: 0.08 }),
  key: () => tone(880, 0.05, { type: 'square', vol: 0.05 }),
  ok: () => {
    buzz([25, 40, 25]);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', at: i * 0.08 }));
  },
  bad: () => {
    buzz(90);
    tone(220, 0.18, { type: 'sawtooth', vol: 0.08 });
    tone(180, 0.22, { type: 'sawtooth', vol: 0.08, at: 0.12 });
  },
  collect: () => {
    buzz(20);
    [1175, 1568, 2093].forEach((f, i) => tone(f, 0.12, { type: 'sine', vol: 0.12, at: i * 0.06 }));
  },
  door: () => {
    tone(160, 0.6, { type: 'sawtooth', vol: 0.06, slide: 220 });
    tone(320, 0.5, { type: 'sine', vol: 0.08, at: 0.1, slide: 400 });
  },
  note: (color) => tone(FLOWER_FREQ[color] || 600, 0.4, { type: 'sine', vol: 0.2 }),
  alarm: () => [0, 0.32].forEach((at) => tone(740, 0.22, { type: 'square', vol: 0.05, at, slide: -200 })),
  win: () =>
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
      tone(f, 0.22, { type: 'triangle', vol: 0.14, at: i * 0.12 })
    ),
  beep: () => tone(1320, 0.08, { type: 'sine', vol: 0.08 }),
  click: () => tone(2200, 0.03, { type: 'square', vol: 0.06 }),
  tick: (n = 0) => tone(300 + n * 45, 0.05, { type: 'triangle', vol: 0.07 }),
  zap: () => {
    buzz(120);
    tone(900, 0.25, { type: 'sawtooth', vol: 0.08, slide: -700 });
    noise(0.15, 0.06);
  },
  /** 무전기: 치직- 삐빅 */
  radio: () => {
    noise(0.16, 0.07);
    tone(1400, 0.06, { type: 'sine', vol: 0.08, at: 0.18 });
    tone(1800, 0.06, { type: 'sine', vol: 0.08, at: 0.26 });
  },
  static: () => noise(0.08, 0.05),
};

/** 멜로디 (꽃 색 순서) */
export function playMelody(colors, gap = 0.42) {
  colors.forEach((c, i) => tone(FLOWER_FREQ[c] || 600, 0.38, { type: 'sine', vol: 0.2, at: i * gap }));
  return colors.length * gap * 1000;
}

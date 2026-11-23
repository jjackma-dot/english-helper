// 단서를 여는 손 미니게임 (영어 없이 손으로 하는 재미): 주파수 맞추기, 먼지 닦기, 손전등·자외선으로 비추기, 조각 돌리기, 꾹 누르기.
// 단서 내용(content)은 먼지·어둠·조각 밑에 깔려 있다가 다 하면 드러난다. 화면 크기를 잴 수 없으면(테스트 등) 바로 끝난 것으로 한다.

import { h, clear } from '../ui.js';
import { sfx } from './sfx.js';

export const GAME_INFO = {
  tune: { ico: '📻', ko: '다이얼을 돌려 신호를 찾아요!', en: 'Tune in!' },
  scratch: { ico: '🧽', ko: '손가락으로 문질러 먼지를 닦아요!', en: 'Rub to clean!' },
  scan: { ico: '🔭', ko: '손가락으로 끌어 어두운 곳을 구석구석 비춰요!', en: 'Light it up!' },
  uv: { ico: '🔦', ko: '자외선 손전등으로 숨은 잉크를 찾아요!', en: 'Find the hidden ink!' },
  rotate: { ico: '🧩', ko: '조각을 눌러 돌려요! 테두리가 바깥쪽에 오게 맞춰요.', en: 'Turn the pieces!' },
  hold: { ico: '✋', ko: '버튼을 꾹 누르고 기다려요!', en: 'Hold it!' },
};

const reduce = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const sizeOf = (el) => el.getBoundingClientRect?.() ?? { width: 0, height: 0, left: 0, top: 0 };

/**
 * @param {string} kind GAME_INFO의 키
 * @param {HTMLElement} stage 미니게임을 그릴 자리 (이미 화면에 붙어 있어야 크기를 잴 수 있다)
 * @param {{content?: Node, level?: string, rng?: () => number, label?: string, onDone: () => void}} o
 * @returns {() => void} 멈추기
 */
export function startMinigame(kind, stage, o) {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    sfx.ok();
    o.onDone();
  };
  const run = { tune, scratch, scan, uv: scan, rotate, hold }[kind] ?? ((_, __, d) => d());
  return run(stage, { ...o, uv: kind === 'uv' }, done) || (() => {});
}

/* ---------- 주파수 맞추기: 다이얼을 밀면 잡음이 줄고, 신호를 찾아 잠깐 멈추면 끝 ---------- */

function tune(stage, { level = 'im1', rng = Math.random }, done) {
  const target = 88 + Math.round(rng() * 39) / 2; // 88.0 ~ 107.5
  const tol = { basic: 1, im1: 0.8, im2: 0.6, im3: 0.4 }[level] ?? 0.7;
  let start = target > 98 ? 88 : 108;
  let hold = 0;
  let lastStatic = 0;
  const freq = h('b', { class: 'mg-freq' });
  const bars = h(
    'div',
    { class: 'mg-bars', 'aria-hidden': 'true' },
    [0, 1, 2, 3, 4].map(() => h('span'))
  );
  const fuzz = h('div', { class: 'mg-fuzz', 'aria-hidden': 'true' });
  const input = h('input', {
    type: 'range',
    class: 'mg-range',
    min: '88',
    max: '108',
    step: '0.1',
    value: String(start),
    'aria-label': '주파수',
    'data-target': String(target),
  });
  const update = () => {
    const v = Number(input.value);
    freq.textContent = `FM ${v.toFixed(1)}`;
    const strength = Math.max(0, 1 - Math.abs(v - target) / 6);
    [...bars.children].forEach((b, i) => b.classList.toggle('on', strength > i * 0.2 + 0.05));
    fuzz.style.opacity = String((1 - strength) * 0.9);
    const now = Date.now();
    if (strength < 0.75 && now - lastStatic > 140) {
      lastStatic = now;
      sfx.static();
    }
    clearTimeout(hold);
    if (Math.abs(v - target) <= tol) {
      freq.classList.add('locked');
      hold = setTimeout(done, reduce() ? 50 : 650);
    } else freq.classList.remove('locked');
  };
  input.addEventListener('input', update);
  clear(stage).append(
    h('div', { class: 'mg-radio' }, fuzz, freq, bars),
    input,
    h('div', { class: 'mg-scale' }, h('span', null, '88'), h('span', null, '98'), h('span', null, '108'))
  );
  update();
  return () => clearTimeout(hold);
}

/* ---------- 먼지 닦기: 캔버스 위 먼지를 지우개처럼 문지른다 ---------- */

function scratch(stage, { content, level = 'im1', rng = Math.random }, done) {
  const box = h('div', { class: 'mg-cover' }, content);
  clear(stage).append(box);
  const canvas = h('canvas', { class: 'mg-canvas', 'aria-label': '먼지 (문질러서 닦기)' });
  const ctx = canvas.getContext?.('2d');
  const r = sizeOf(box);
  if (!ctx || !r.width || !r.height) {
    setTimeout(done, 0);
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.scale(dpr, dpr);
  // 먼지: 회갈색 바탕에 얼룩
  ctx.fillStyle = '#5b5148';
  ctx.fillRect(0, 0, r.width, r.height);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${150 + rng() * 60},${130 + rng() * 50},${110 + rng() * 40},${0.18 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rng() * r.width, rng() * r.height, 3 + rng() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🧽  문질러요!', r.width / 2, r.height / 2);
  box.append(canvas);
  const brush = { basic: 34, im1: 28, im2: 24, im3: 20 }[level] ?? 26;
  let moves = 0;
  let down = false;
  const rub = (e) => {
    const b = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(e.clientX - b.left, e.clientY - b.top, brush, 0, Math.PI * 2);
    ctx.fill();
    if (++moves % 6 === 0) {
      if (moves % 12 === 0) sfx.static();
      if (cleared() >= 0.55) finish();
    }
  };
  const cleared = () => {
    const step = 10 * dpr;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear0 = 0;
    let all = 0;
    for (let y = 0; y < canvas.height; y += step)
      for (let x = 0; x < canvas.width; x += step) {
        all++;
        if (img[(Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3] < 40) clear0++;
      }
    return clear0 / all;
  };
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    canvas.classList.add('gone');
    setTimeout(() => canvas.remove(), 400);
    done();
  };
  canvas.addEventListener('pointerdown', (e) => {
    down = true;
    canvas.setPointerCapture?.(e.pointerId);
    rub(e);
  });
  canvas.addEventListener('pointermove', (e) => down && rub(e));
  canvas.addEventListener('pointerup', () => (down = false));
  canvas.addEventListener('pointercancel', () => (down = false));
}

/* ---------- 손전등·자외선: 어둠 속에서 손가락이 닿은 곳만 보인다. 구석구석 비추면 끝 ---------- */

function scan(stage, { content, level = 'im1', uv = false }, done) {
  const box = h('div', { class: `mg-cover${uv ? ' uv' : ''}` }, content);
  const shade = h('div', { class: `mg-shade${uv ? ' uv' : ''}`, 'aria-label': uv ? '자외선 손전등' : '손전등' });
  box.append(shade);
  clear(stage).append(box);
  const r = sizeOf(box);
  if (!r.width || !r.height) {
    setTimeout(done, 0);
    return;
  }
  const radius = { basic: 72, im1: 62, im2: 54, im3: 48 }[level] ?? 58;
  shade.style.setProperty?.('--r', `${radius}px`);
  const cols = 6;
  const rows = Math.max(3, Math.round((cols * r.height) / r.width));
  const seen = new Set();
  let over = false;
  const light = (e) => {
    const b = box.getBoundingClientRect();
    const x = e.clientX - b.left;
    const y = e.clientY - b.top;
    shade.style.setProperty?.('--x', `${x}px`);
    shade.style.setProperty?.('--y', `${y}px`);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const px = ((cx + 0.5) * b.width) / cols;
        const py = ((cy + 0.5) * b.height) / rows;
        if (Math.hypot(px - x, py - y) <= radius * 1.1) seen.add(`${cx},${cy}`);
      }
    if (!over && seen.size >= cols * rows * 0.62) {
      over = true;
      shade.classList.add('gone');
      setTimeout(() => shade.remove(), 450);
      done();
    }
  };
  let down = false;
  shade.addEventListener('pointerdown', (e) => {
    down = true;
    shade.setPointerCapture?.(e.pointerId);
    light(e);
  });
  shade.addEventListener('pointermove', (e) => (down || e.pointerType === 'mouse') && light(e));
  shade.addEventListener('pointerup', () => (down = false));
  shade.addEventListener('pointercancel', () => (down = false));
}

/* ---------- 조각 돌리기: 2×2 조각 중 몇 개가 돌아가 있다. 눌러서 90°씩 돌려 모두 바르게 ---------- */

function rotate(stage, { content, level = 'im1', rng = Math.random }, done) {
  const square = h('div', { class: 'mg-square' }, content);
  clear(stage).append(square);
  const r = sizeOf(square);
  if (!r.width || !r.height) {
    setTimeout(done, 0);
    return;
  }
  // 짧은 쪽지는 글자를 키워 네 조각 모두에 글자가 걸치게 한다 (돌아간 조각을 알아보게)
  if (content.classList?.contains('gm-paper')) {
    const chars = Math.max(1, content.textContent.length);
    content.style.fontSize = `${Math.round(Math.max(13, Math.min(26, Math.sqrt((r.width * r.width * 0.42) / chars))))}px`;
  }
  const n = { basic: 2, im1: 3, im2: 4, im3: 4 }[level] ?? 3;
  const turned = [0, 1, 2, 3].sort(() => rng() - 0.5).slice(0, n);
  const half = r.width / 2;
  const rots = [0, 1, 2, 3].map((i) => (turned.includes(i) ? [90, 180, 270][Math.floor(rng() * 3)] : 0));
  const tiles = rots.map((rot, i) => {
    const x = (i % 2) * half;
    const y = Math.floor(i / 2) * half;
    const inner = h(
      'div',
      {
        class: 'mg-tile-inner',
        style: { width: `${r.width}px`, height: `${r.width}px`, left: `${-x}px`, top: `${-y}px` },
      },
      content.cloneNode(true)
    );
    const tile = h(
      'button',
      {
        type: 'button',
        class: 'mg-tile',
        'aria-label': `조각 ${i + 1}`,
        'data-rot': String(rot),
        style: {
          left: `${x}px`,
          top: `${y}px`,
          width: `${half}px`,
          height: `${half}px`,
          transform: `rotate(${rot}deg)`,
        },
        onclick: () => {
          rots[i] = (rots[i] + 90) % 360;
          tile.setAttribute('data-rot', String(rots[i]));
          tile.style.transform = `rotate(${rots[i] === 0 ? 360 : rots[i]}deg)`;
          sfx.key();
          if (rots.every((v) => v === 0)) setTimeout(finish, 250);
        },
      },
      inner
    );
    return tile;
  });
  const board = h('div', { class: 'mg-board', style: { width: `${r.width}px`, height: `${r.width}px` } }, tiles);
  square.replaceChildren(board);
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    square.replaceChildren(content);
    done();
  };
}

/* ---------- 꾹 누르기: 누르고 있으면 고리가 차오르고, 떼면 줄어든다 ---------- */

function hold(stage, { level = 'im1', label = '꾹 누르기' }, done) {
  const need = reduce() ? 400 : ({ basic: 1300, im1: 1700, im2: 2100, im3: 2500 }[level] ?? 1800);
  let p = 0;
  let pressing = false;
  let last = 0;
  let raf = 0;
  const ring = h('span', { class: 'mg-ring', style: { '--p': '0' } });
  const tickFrame = (t) => {
    const dt = last ? t - last : 16;
    last = t;
    p = Math.max(0, Math.min(1, p + (pressing ? dt / need : -dt / 600)));
    ring.style.setProperty?.('--p', p.toFixed(3));
    ring.style.background = `conic-gradient(#7df9ff ${p * 360}deg, #23305a 0)`;
    if (pressing && Math.floor(p * 10) !== Math.floor((p - dt / need) * 10)) sfx.tick(Math.floor(p * 10));
    if (p >= 1) {
      btn.classList.add('full');
      done();
      return;
    }
    if (pressing || p > 0) raf = requestAnimationFrame(tickFrame);
  };
  const start = (e) => {
    e?.preventDefault?.();
    pressing = true;
    last = 0;
    btn.classList.add('holding');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tickFrame);
  };
  const stop = () => {
    pressing = false;
    btn.classList.remove('holding');
  };
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'mg-holdbtn',
      onpointerdown: start,
      onpointerup: stop,
      onpointerleave: stop,
      onpointercancel: stop,
      onkeydown: (e) => (e.key === ' ' || e.key === 'Enter') && start(e),
      onkeyup: (e) => (e.key === ' ' || e.key === 'Enter') && stop(),
      oncontextmenu: (e) => e.preventDefault(),
    },
    ring,
    h('b', null, label)
  );
  clear(stage).append(btn);
  return () => cancelAnimationFrame(raf);
}

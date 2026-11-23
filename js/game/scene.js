// 장면 엔진: 방 그림을 깊이가 다른 층으로 겹쳐 놓고, 손가락으로 밀면 층마다 다른 속도로 움직여 방 안을 둘러보는 느낌을 준다.
// 휴대폰을 기울여도 살짝 움직인다(자이로). 물체를 누르면 onHot, 별 조각을 누르면 onCrystal.
// 어두운 방은 손전등(누른 자리를 밝힌다)으로 본다. 문을 열면 문 쪽으로 걸어 들어가는 듯 확대하며 넘어간다.

import { h } from '../ui.js';
import { s, svg } from './svg.js';
import { H, W, crystal } from './art.js';

const DEPTH = { far: 0.55, back: 1, mid: 1.12, front: 1.24 };
// 층마다 양옆으로 더 그려 둔 폭: 깊이 차이로 가장 많이 밀리는 앞층도 약 170 정도라 이만큼이면 빈 곳이 안 보인다.
// (너무 넓으면 휴대폰이 그려 둘 그림 크기만 커진다)
const M = 260;
const reduceMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * @param {{onHot: (id: string) => void, onCrystal: (id: string) => void}} o
 */
export function createScene({ onHot, onCrystal }) {
  const root = h('div', { class: 'gm-scene' });
  const layers = {};
  for (const name of Object.keys(DEPTH)) {
    const el = svg(`${-M} 0 ${W + 2 * M} ${H}`, {
      class: `gm-layer gm-${name}`,
      preserveAspectRatio: 'xMinYMin meet',
      'aria-hidden': name === 'far' ? 'true' : null,
    });
    layers[name] = el;
    root.append(el);
  }
  const tint = h('div', { class: 'gm-tint', hidden: true });
  const dark = h('div', { class: 'gm-dark', hidden: true });
  const edgeL = h(
    'button',
    { type: 'button', class: 'gm-edge left', 'aria-label': '왼쪽 보기', onclick: () => nudge(-1) },
    '‹'
  );
  const edgeR = h(
    'button',
    { type: 'button', class: 'gm-edge right', 'aria-label': '오른쪽 보기', onclick: () => nudge(1) },
    '›'
  );
  root.append(tint, dark, edgeL, edgeR);

  let data = null;
  let scale = 1;
  let vw = W;
  let pan = 0;
  let maxPan = 0;
  let cx = 0;
  let ty = 0; // 가로 화면: 폭에 맞춰 키우고 위아래를 똑같이 잘라 낸다
  let tilt = 0;
  let anim = 0;
  let drag = null;
  let suppress = false;
  let light = { x: 0.5, y: 0.5, on: false };

  function apply() {
    for (const [name, el] of Object.entries(layers)) {
      const f = DEPTH[name];
      const tx = (-M - (pan * f - (f - 1) * cx) + (f - 1) * tilt) * scale;
      el.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0)`;
    }
    edgeL.hidden = pan <= 4;
    edgeR.hidden = pan >= maxPan - 4;
  }

  function layout() {
    const r = root.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    if (!r.width || !r.height) return;
    // 보통(세로 휴대폰)은 높이에 맞추고 옆으로 둘러본다. 화면이 방보다 넓으면(가로 화면) 폭에 맞춰 빈 곳이 없게 한다
    scale = Math.max(r.height / H, r.width / W);
    vw = r.width / scale;
    ty = (r.height - H * scale) / 2;
    maxPan = Math.max(0, W - vw);
    cx = maxPan / 2;
    for (const el of Object.values(layers)) {
      el.style.width = `${((W + 2 * M) * scale).toFixed(1)}px`;
      el.style.height = `${(H * scale).toFixed(1)}px`;
    }
    setPan(vw >= W ? (W - vw) / 2 : pan);
    paintLight();
  }

  function setPan(x) {
    pan = vw >= W ? (W - vw) / 2 : Math.min(maxPan, Math.max(0, x));
    apply();
  }

  function animateTo(x, ms = 420) {
    cancelAnimationFrame(anim);
    const from = pan;
    const to = vw >= W ? (W - vw) / 2 : Math.min(maxPan, Math.max(0, x));
    if (reduceMotion() || Math.abs(to - from) < 1) return setPan(to);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      setPan(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function nudge(dir) {
    animateTo(pan + dir * vw * 0.6);
  }

  function inertia(v) {
    cancelAnimationFrame(anim);
    if (reduceMotion()) return;
    let vel = v; // world units per ms
    let last = performance.now();
    const step = (t) => {
      const dt = Math.min(40, t - last);
      last = t;
      vel *= 0.94 ** (dt / 16);
      setPan(pan + vel * dt);
      if (Math.abs(vel) > 0.02 && pan > 0 && pan < maxPan) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /* ---------- 손전등 ---------- */

  function paintLight() {
    if (dark.hidden) return;
    const r = root.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    dark.style.setProperty?.('--lx', `${(light.x * r.width).toFixed(0)}px`);
    dark.style.setProperty?.('--ly', `${(light.y * r.height).toFixed(0)}px`);
  }

  function moveLight(e) {
    if (dark.hidden) return;
    const r = root.getBoundingClientRect();
    if (!r.width) return;
    light = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, on: true };
    paintLight();
  }

  /* ---------- 손가락 ---------- */

  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    cancelAnimationFrame(anim);
    drag = { x: e.clientX, pan, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
    moveLight(e);
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !drag) moveLight(e);
    if (!drag) return;
    moveLight(e);
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 8) {
      drag.moved = true;
      try {
        root.setPointerCapture?.(e.pointerId);
      } catch {
        /* 무시 */
      }
    }
    if (!drag.moved) return;
    setPan(drag.pan - dx / scale);
    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 0) drag.v = (-(e.clientX - drag.lastX) / scale / dt) * 0.8 + drag.v * 0.2;
    drag.lastX = e.clientX;
    drag.lastT = now;
  });
  const end = () => {
    if (drag?.moved) {
      suppress = true;
      setTimeout(() => (suppress = false), 60);
      if (performance.now() - drag.lastT < 80) inertia(drag.v);
    }
    drag = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener(
    'click',
    (e) => {
      if (suppress) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  /* ---------- 기울이기 (입체감) ---------- */

  const onTilt = (e) => {
    if (e.gamma == null || reduceMotion()) return;
    const t = Math.max(-25, Math.min(25, e.gamma)) * 2.4;
    if (Math.abs(t - tilt) < 0.8) return;
    tilt = tilt * 0.6 + t * 0.4;
    apply();
  };
  window.addEventListener('deviceorientation', onTilt);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => layout());
    ro.observe(root);
  } else window.addEventListener('resize', layout);

  /* ---------- 그리기 ---------- */

  const markGroups = {};
  function render(sceneData, { found = [] } = {}) {
    data = sceneData;
    for (const [name, el] of Object.entries(layers)) {
      while (el.firstChild) el.firstChild.remove();
      for (const n of (sceneData.layers[name] || []).flat(Infinity)) if (n) el.append(n);
      markGroups[name] = s('g', { class: 'gm-marks' });
      el.append(markGroups[name]);
    }
    for (const c of sceneData.crystals || []) {
      if (found.includes(c.id)) continue;
      layers[c.layer].append(
        s(
          'g',
          {
            class: 'gm-crystal',
            'data-crystal': c.id,
            role: 'button',
            'aria-label': '별 조각',
            onclick: (e) => collect(c.id, e.currentTarget),
          },
          crystal(c.x, c.y, 0.9),
          s('circle', { cx: c.x, cy: c.y, r: 46, fill: 'transparent' })
        )
      );
    }
    for (const hs of sceneData.hot || []) {
      layers[hs.layer].append(
        s('rect', {
          class: 'gm-hot',
          'data-hot': hs.id,
          x: hs.x,
          y: hs.y,
          width: hs.w,
          height: hs.h,
          rx: 18,
          fill: 'transparent',
          role: 'button',
          'aria-label': hs.label || hs.id,
          onclick: () => onHot(hs.id),
        })
      );
    }
    layout();
  }

  function collect(id, el) {
    el.classList?.add('got');
    setTimeout(() => el.remove(), 600);
    onCrystal(id);
  }

  /**
   * 물체 표시: 내 임무(반짝임), 팀원의 임무(얼굴 배지), 끝난 것(✓)
   * @param {Record<string, {kind: 'mine'|'team'|'done', badge?: string, glow?: boolean}>} map
   */
  function marks(map) {
    if (!data) return;
    for (const gEl of Object.values(markGroups)) while (gEl.firstChild) gEl.firstChild.remove();
    for (const hs of data.hot || []) {
      const m = map[hs.id];
      if (!m) continue;
      const gEl = markGroups[hs.layer];
      if (m.kind === 'mine' && m.glow)
        gEl.append(
          s('rect', {
            class: 'gm-mark mine',
            x: hs.x - 6,
            y: hs.y - 6,
            width: hs.w + 12,
            height: hs.h + 12,
            rx: 22,
            fill: 'none',
          })
        );
      if (m.badge || m.kind === 'done') {
        const bx = Math.min(hs.x + hs.w - 8, W - 34); // 방 끝에 붙은 물체도 배지가 잘리지 않게
        const by = Math.max(hs.y + 8, 34);
        gEl.append(
          s(
            'g',
            { class: `gm-badge ${m.kind}` },
            s('circle', { cx: bx, cy: by, r: 30 }),
            s(
              'text',
              { x: bx, y: by + 11, 'text-anchor': 'middle', 'font-size': 32 },
              m.kind === 'done' ? '✓' : m.badge
            )
          )
        );
      }
    }
  }

  /** 그 물체가 화면 가운데에 오게 */
  function focus(id, { animate = true } = {}) {
    const hs = data?.hot?.find((x) => x.id === id);
    if (!hs) return;
    const f = DEPTH[hs.layer];
    // 깊이가 다른 층의 물체는 보이는 자리가 조금 다르다: 화면 위치 = X − (pan·f − (f−1)·cx)
    const target = (hs.x + hs.w / 2 - vw / 2 + (f - 1) * cx) / f;
    if (animate) animateTo(target);
    else setPan(target);
  }

  /** 그 물체(문) 쪽으로 걸어 들어가는 듯 확대하며 사라진다 */
  function walk(id) {
    const hs = data?.hot?.find((x) => x.id === id);
    const r = root.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    if (hs && r.width) {
      const f = DEPTH[hs.layer];
      const sx = (hs.x + hs.w / 2 - (pan * f - (f - 1) * cx)) * scale;
      const sy = (hs.y + hs.h / 2) * scale + ty;
      root.style.transformOrigin = `${sx.toFixed(0)}px ${sy.toFixed(0)}px`;
    }
    root.classList.remove('gm-entering');
    root.classList.add('gm-walking');
    return new Promise((res) => setTimeout(res, reduceMotion() ? 50 : 850));
  }

  function enter() {
    root.classList.remove('gm-walking');
    root.style.transformOrigin = '';
    root.classList.add('gm-entering');
    setTimeout(() => root.classList.remove('gm-entering'), 900);
  }

  /** 어두운 방 (손전등). radius: 밝게 보이는 반지름(px) */
  function setDark(on, radius = 120) {
    dark.hidden = !on;
    tint.hidden = !on;
    dark.style.setProperty?.('--lr', `${radius}px`);
    if (on && !light.on) light = { x: 0.5, y: 0.55, on: false };
    paintLight();
  }

  return {
    el: root,
    render,
    marks,
    focus,
    walk,
    enter,
    setDark,
    layout,
    start: (x) => setPan(x ?? 0),
    destroy() {
      cancelAnimationFrame(anim);
      window.removeEventListener('deviceorientation', onTilt);
      ro?.disconnect();
      window.removeEventListener('resize', layout);
      root.remove();
    },
  };
}

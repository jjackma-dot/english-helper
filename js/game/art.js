// 게임 그림 (SVG를 코드로 그린다: 파일 없이 가볍고, 상태에 따라 바로 바뀐다).
// 방 그림은 깊이가 다른 층(far 우주 → back 벽 → mid 가구 → front 앞쪽)으로 나눠, 화면을 밀면 층마다 다르게 움직여 입체감이 난다.
// 장면에는 모두가 함께 보는 것만 그린다. 단서의 내용(숫자·색 순서 등)은 그 단서를 맡은 사람의 확대 화면(closeup)에만 나온다.

import { g, gearPath, roundRectPath, s, starPoints, svg } from './svg.js';
import { rngFor } from './logic.js';
import { COLORS, FLOWERS, PLANET_ORDER } from './puzzles.js';

export const W = 1800;
export const H = 1000;
const CEIL = 110;
const FLOOR = 760;
const FONT = 'system-ui, -apple-system, Roboto, sans-serif';

/* ---------- 기본 도형 ---------- */

const rect = (x, y, w, h, fill, o = {}) => s('rect', { x, y, width: w, height: h, fill, ...o });
const circ = (cx, cy, r, fill, o = {}) => s('circle', { cx, cy, r, fill, ...o });
const ell = (cx, cy, rx, ry, fill, o = {}) => s('ellipse', { cx, cy, rx, ry, fill, ...o });
const path = (d, fill, o = {}) => s('path', { d, fill, ...o });
const line = (x1, y1, x2, y2, stroke, w = 2, o = {}) =>
  s('line', { x1, y1, x2, y2, stroke, 'stroke-width': w, 'stroke-linecap': 'round', ...o });
const text = (x, y, str, o = {}) =>
  s('text', { x, y, 'font-family': FONT, 'font-weight': 700, 'text-anchor': 'middle', ...o }, String(str));
const at = (x, y, k, ...kids) => g({ transform: `translate(${x} ${y})${k && k !== 1 ? ` scale(${k})` : ''}` }, ...kids);
const glow = (cx, cy, r, c = 'C', o = {}) => circ(cx, cy, r, `url(#gx-glow${c})`, o);
const hex = (k) => COLORS[k]?.hex ?? k;

/* ---------- 함께 쓰는 그러데이션 (문서에 한 번만 넣는다) ---------- */

function stops(list) {
  return list.map(([o, c, a = 1]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
}
const lin = (id, list, o = {}) => s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1, ...o }, stops(list));
const rad = (id, list, o = {}) => s('radialGradient', { id, ...o }, stops(list));

export function defs() {
  return svg(
    '0 0 1 1',
    { class: 'gm-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' },
    s(
      'defs',
      null,
      lin('gx-space', [
        [0, '#060a1d'],
        [1, '#1b1448'],
      ]),
      lin('gx-wall1', [
        [0, '#323b60'],
        [1, '#1e2442'],
      ]),
      lin('gx-floor1', [
        [0, '#2a3152'],
        [1, '#11152b'],
      ]),
      lin('gx-ceil', [
        [0, '#0d1124'],
        [1, '#232a48'],
      ]),
      lin('gx-wall2', [
        [0, '#245a50'],
        [1, '#123630'],
      ]),
      lin('gx-floor2', [
        [0, '#3c6b34'],
        [1, '#1a3518'],
      ]),
      lin('gx-wall3', [
        [0, '#6b4632'],
        [1, '#3b261c'],
      ]),
      lin('gx-floor3', [
        [0, '#463a36'],
        [1, '#1f1918'],
      ]),
      lin('gx-wall4', [
        [0, '#213462'],
        [1, '#0f1937'],
      ]),
      lin('gx-floor4', [
        [0, '#1f2a4a'],
        [1, '#0a0f22'],
      ]),
      lin('gx-wall5', [
        [0, '#33215f'],
        [1, '#140c2c'],
      ]),
      lin('gx-metal', [
        [0, '#a9b4cc'],
        [1, '#5c6784'],
      ]),
      lin('gx-steel', [
        [0, '#e4e9f2'],
        [1, '#98a3bb'],
      ]),
      lin('gx-dark', [
        [0, '#4b5674'],
        [1, '#2b3249'],
      ]),
      lin('gx-orange', [
        [0, '#ffb873'],
        [1, '#e8691b'],
      ]),
      lin('gx-purple', [
        [0, '#c9a0ff'],
        [1, '#7a3fe0'],
      ]),
      lin('gx-water', [
        [0, '#73ecff'],
        [1, '#1c6aa6'],
      ]),
      lin('gx-leaf', [
        [0, '#8ae58a'],
        [1, '#2c8a3c'],
      ]),
      lin('gx-trunk', [
        [0, '#93603f'],
        [1, '#5a3725'],
      ]),
      lin('gx-crate', [
        [0, '#d39556'],
        [1, '#8d5a2b'],
      ]),
      lin('gx-wood', [
        [0, '#b98a5e'],
        [1, '#7a5636'],
      ]),
      lin('gx-screen', [
        [0, '#0f2d44'],
        [1, '#051420'],
      ]),
      lin('gx-paper', [
        [0, '#fffaf0'],
        [1, '#eadfc6'],
      ]),
      lin('gx-pot', [
        [0, '#e0814f'],
        [1, '#a64e27'],
      ]),
      lin('gx-holo', [
        [0, '#7df9ff', 0.05],
        [1, '#7df9ff', 0.45],
      ]),
      lin('gx-beam', [
        [0, '#fff8d6', 0.55],
        [1, '#fff8d6', 0],
      ]),
      rad('gx-glowC', [
        [0, '#7df9ff', 0.85],
        [0.45, '#38d5ff', 0.35],
        [1, '#38d5ff', 0],
      ]),
      rad('gx-glowO', [
        [0, '#ffd59a', 0.9],
        [0.5, '#ff8c3a', 0.35],
        [1, '#ff8c3a', 0],
      ]),
      rad('gx-glowR', [
        [0, '#ff9aa8', 0.9],
        [0.5, '#ff3355', 0.35],
        [1, '#ff3355', 0],
      ]),
      rad('gx-glowY', [
        [0, '#fff6b0', 0.95],
        [0.5, '#ffd23f', 0.35],
        [1, '#ffd23f', 0],
      ]),
      rad('gx-glowW', [
        [0, '#ffffff', 0.9],
        [0.5, '#dfe8ff', 0.3],
        [1, '#dfe8ff', 0],
      ]),
      rad('gx-glowP', [
        [0, '#ffc2ef', 0.7],
        [0.5, '#c86bff', 0.28],
        [1, '#c86bff', 0],
      ]),
      rad('gx-glowG', [
        [0, '#c8ffb0', 0.9],
        [0.5, '#5ee36b', 0.35],
        [1, '#5ee36b', 0],
      ]),
      rad(
        'gx-earth',
        [
          [0, '#8fd6ff'],
          [0.65, '#2f7fd6'],
          [1, '#173a86'],
        ],
        { cx: '0.38', cy: '0.35', r: '0.75' }
      ),
      rad(
        'gx-pip',
        [
          [0, '#ffffff'],
          [1, '#aebbd6'],
        ],
        { cx: '0.35', cy: '0.3', r: '0.8' }
      ),
      rad(
        'gx-sun',
        [
          [0, '#fff4cc', 0.95],
          [0.25, '#ffb347', 0.75],
          [0.6, '#ff6a2a', 0.25],
          [1, '#ff6a2a', 0],
        ]
      ),
      rad(
        'gx-core',
        [
          [0, '#ffffff'],
          [0.4, '#9ffcff'],
          [1, '#3c7bff'],
        ],
        { cx: '0.4', cy: '0.35', r: '0.8' }
      ),
      rad(
        'gx-moon',
        [
          [0, '#f4f4fb'],
          [1, '#9a9ab2'],
        ],
        { cx: '0.35', cy: '0.3', r: '0.8' }
      ),
      rad('gx-nebula', [
        [0, '#ff8fd8', 0.45],
        [0.6, '#8a4dff', 0.18],
        [1, '#8a4dff', 0],
      ]),
      s(
        'pattern',
        { id: 'gx-hazard', width: 40, height: 40, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        rect(0, 0, 20, 40, '#ffcf3a'),
        rect(20, 0, 20, 40, '#26283a')
      ),
      s(
        'pattern',
        { id: 'gx-grille', width: 10, height: 10, patternUnits: 'userSpaceOnUse' },
        rect(0, 0, 10, 10, '#39425c'),
        circ(5, 5, 2.4, '#151a2b')
      ),
      s(
        'pattern',
        { id: 'gx-peg', width: 26, height: 26, patternUnits: 'userSpaceOnUse' },
        rect(0, 0, 26, 26, '#c49a6c'),
        circ(13, 13, 3, '#6d4c33')
      )
    )
  );
}

/* ---------- 공통 배경 조각 ---------- */

/** 별 가득한 우주 (시드로 늘 같은 자리) */
function starfield(seed, x0, x1, y0, y1, n) {
  const r = rngFor(seed, 'stars');
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    const big = r() < 0.08;
    out.push(
      circ(x.toFixed(0), y.toFixed(0), big ? 2.6 : 1.2 + r() * 1.1, big ? '#fff7d6' : '#cfe0ff', {
        opacity: (0.45 + r() * 0.55).toFixed(2),
        class: big ? 'gm-twinkle' : null,
      })
    );
  }
  return out;
}

function earth(cx, cy, r) {
  return g(
    null,
    circ(cx, cy, r * 1.08, '#4aa8ff', { opacity: 0.18 }),
    circ(cx, cy, r, 'url(#gx-earth)'),
    path(
      `M${cx - r * 0.55} ${cy - r * 0.35}q${r * 0.2} ${-r * 0.25} ${r * 0.45} ${-r * 0.1}q${r * 0.15} ${r * 0.2} ${-r * 0.05} ${r * 0.35}q${-r * 0.25} ${r * 0.15} ${-r * 0.4} ${-r * 0.25}z`,
      '#5fcf7a',
      { opacity: 0.85 }
    ),
    path(
      `M${cx + r * 0.1} ${cy + r * 0.05}q${r * 0.3} ${-r * 0.15} ${r * 0.5} ${r * 0.1}q${-r * 0.05} ${r * 0.35} ${-r * 0.35} ${r * 0.4}q${-r * 0.25} ${-r * 0.1} ${-r * 0.15} ${-r * 0.5}z`,
      '#5fcf7a',
      { opacity: 0.85 }
    ),
    path(`M${cx - r * 0.8} ${cy + r * 0.1}q${r * 0.6} ${-r * 0.15} ${r * 1.5} ${r * 0.12}`, 'none', {
      stroke: '#ffffff',
      'stroke-width': r * 0.06,
      opacity: 0.35,
      'stroke-linecap': 'round',
    })
  );
}

/** 바닥 원근선 */
function floorLines(color, y0 = FLOOR) {
  const vx = W / 2;
  const vy = 300;
  const out = [];
  for (let xb = -600; xb <= W + 600; xb += 170) {
    const t = (y0 - vy) / (H - vy);
    out.push(line((vx + (xb - vx) * t).toFixed(0), y0, xb, H, color, 2, { opacity: 0.5 }));
  }
  for (const y of [y0 + 26, y0 + 62, y0 + 112, y0 + 180]) out.push(line(-500, y, W + 500, y, color, 2, { opacity: 0.4 }));
  return out;
}

/** 벽(구멍 뚫린 창 포함)·천장·바닥 */
function shell({ wall, floor, ceil = 'gx-ceil', holes = [], seam = '#161b33', step = 150, lit = 1, ceilLights = [] }) {
  const holeD = holes.map(([x, y, w, h, r]) => roundRectPath(x, y, w, h, r)).join('');
  const out = [
    path(`M-500 ${CEIL}H${W + 500}V${FLOOR}H-500Z${holeD}`, `url(#${wall})`, { 'fill-rule': 'evenodd' }),
  ];
  for (let x = 0; x <= W; x += step) out.push(line(x, CEIL, x, FLOOR - 14, seam, 3, { opacity: 0.55 }));
  out.push(rect(-500, 420, W + 1000, 10, seam, { opacity: 0.35 }));
  out.push(rect(-500, FLOOR - 16, W + 1000, 16, '#0b0e1c', { opacity: 0.55 }));
  out.push(rect(-500, 0, W + 1000, CEIL, `url(#${ceil})`));
  for (let x = -300; x <= W + 300; x += 300) out.push(rect(x, 0, 26, CEIL, '#0a0d1c', { opacity: 0.6 }));
  for (const x of ceilLights) {
    out.push(rect(x - 70, CEIL - 22, 140, 14, lit > 0.5 ? '#fff6dc' : '#3a4262', { rx: 7 }));
    if (lit > 0.5) out.push(path(`M${x - 70} ${CEIL - 8}L${x + 70} ${CEIL - 8}L${x + 160} ${FLOOR}L${x - 160} ${FLOOR}Z`, 'url(#gx-beam)', { opacity: 0.35 }));
  }
  out.push(rect(-500, FLOOR, W + 1000, H - FLOOR, `url(#${floor})`));
  out.push(...floorLines('#000', FLOOR));
  return out;
}

/** 문 옆 글자판: 이 폰이 아는 글자만 보인다 */
function letterSlots(x, y, letters, { vertical = false, size = 34 } = {}) {
  return g(
    null,
    rect(x - 8, y - 8, vertical ? size + 16 : letters.length * (size + 6) + 10, vertical ? letters.length * (size + 6) + 10 : size + 16, '#071321', {
      rx: 10,
      stroke: '#3fd7ff',
      'stroke-width': 2,
      opacity: 0.95,
    }),
    letters.map((ch, i) => {
      const lx = vertical ? x : x + i * (size + 6);
      const ly = vertical ? y + i * (size + 6) : y;
      return g(
        null,
        rect(lx, ly, size, size, ch ? '#0f3b52' : '#0b1a28', { rx: 6, stroke: ch ? '#7df9ff' : '#24445a', 'stroke-width': 2 }),
        text(lx + size / 2, ly + size * 0.74, ch || '?', { fill: ch ? '#bffbff' : '#35607a', 'font-size': size * 0.66 })
      );
    })
  );
}

/** 모은 별 조각(크리스털) */
export function crystal(x, y, k = 1) {
  return at(
    x,
    y,
    k,
    glow(0, 0, 34, 'C', { class: 'gm-twinkle' }),
    s('polygon', { points: '0,-20 12,-4 0,20 -12,-4', fill: '#bdfbff', stroke: '#ffffff', 'stroke-width': 2 }),
    s('polygon', { points: '0,-20 12,-4 0,-2', fill: '#ffffff', opacity: 0.7 })
  );
}

/* ---------- 인물 ---------- */

/** 도우미 로봇 핍 (가운데 기준). mood: happy | low | worried | talk */
export function pip(mood = 'happy') {
  const eye =
    mood === 'happy'
      ? path('M-12 -8q12 -14 24 0', 'none', { stroke: '#7df9ff', 'stroke-width': 6, 'stroke-linecap': 'round' })
      : g(
          null,
          circ(0, -10, 14, mood === 'low' ? '#24606e' : '#5ff0ff'),
          circ(4, -14, 4.5, '#ffffff', { opacity: mood === 'low' ? 0.3 : 0.95 }),
          mood === 'worried' ? path('M-16 -30l14 6', 'none', { stroke: '#7df9ff', 'stroke-width': 4, 'stroke-linecap': 'round' }) : null
        );
  return g(
    { class: 'gm-pip' },
    ell(0, 74, 34, 9, '#000', { opacity: 0.25 }),
    ell(0, 60, 26, 10, 'url(#gx-glowC)', { class: mood === 'low' ? null : 'gm-twinkle' }),
    line(0, -48, 0, -78, '#9fb0cc', 4),
    circ(0, -84, 8, mood === 'low' ? '#7a4d55' : '#ff6b81', { class: mood === 'low' ? null : 'gm-blink' }),
    ell(-56, 8, 11, 19, 'url(#gx-pip)', { stroke: '#8b9ab8', 'stroke-width': 2 }),
    ell(56, 8, 11, 19, 'url(#gx-pip)', { stroke: '#8b9ab8', 'stroke-width': 2 }),
    circ(0, 0, 50, 'url(#gx-pip)', { stroke: '#8b9ab8', 'stroke-width': 3 }),
    path(roundRectPath(-36, -30, 72, 40, 18), '#1a2342'),
    eye,
    mood === 'talk' ? ell(0, 26, 10, 6, '#3b4a70') : path('M-10 24q10 8 20 0', 'none', { stroke: '#5b6a8a', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    circ(-30, 18, 5, '#ffb3c7', { opacity: 0.7 }),
    circ(30, 18, 5, '#ffb3c7', { opacity: 0.7 })
  );
}

/** 볼트: 커다란 주황 수리 로봇 (발밑 가운데 기준, 높이 약 300) */
export function bolt(mood = 'calm') {
  const sweat = mood === 'nervous' ? path('M62 -268q8 14 0 20q-8 -6 0 -20z', '#8fd8ff') : null;
  return g(
    null,
    ell(0, 4, 110, 14, '#000', { opacity: 0.28 }),
    rect(-92, -52, 184, 52, '#2b2f3c', { rx: 26 }),
    [-62, -22, 18, 58].map((x) => circ(x, -26, 15, '#5b6276', { stroke: '#1a1d26', 'stroke-width': 4 })),
    rect(-116, -196, 32, 112, '#c4561c', { rx: 15 }),
    rect(84, -196, 32, 112, '#c4561c', { rx: 15 }),
    path('M-118 -86h36l-6 22h-24z', '#5b6276'),
    path('M82 -86h36l-6 22h-24z', '#5b6276'),
    rect(-82, -212, 164, 168, 'url(#gx-orange)', { rx: 26, stroke: '#b4521b', 'stroke-width': 3 }),
    circ(0, -134, 30, '#fff0d8', { stroke: '#b4521b', 'stroke-width': 4 }),
    line(0, -134, 16, -150, '#d2452b', 5),
    rect(-40, -82, 80, 12, '#b4521b', { rx: 6 }),
    rect(-14, -232, 28, 22, '#9a4a1a'),
    rect(-58, -296, 116, 74, 'url(#gx-orange)', { rx: 18, stroke: '#b4521b', 'stroke-width': 3 }),
    s('polygon', { points: '0,-322 12,-314 12,-300 0,-292 -12,-300 -12,-314', fill: '#5b6276' }),
    line(0, -296, 0, -306, '#5b6276', 5),
    circ(-24, -262, 14, '#fff6a8', { stroke: '#7a3c14', 'stroke-width': 3 }),
    circ(24, -262, 14, '#fff6a8', { stroke: '#7a3c14', 'stroke-width': 3 }),
    circ(-22, -260, 5, '#2b2f3c'),
    circ(26, -260, 5, '#2b2f3c'),
    mood === 'happy'
      ? path('M-22 -240q22 14 44 0', 'none', { stroke: '#7a3c14', 'stroke-width': 4, 'stroke-linecap': 'round' })
      : rect(-24, -244, 48, 9, '#7a3c14', { rx: 4 }),
    sweat
  );
}

/** 지크: 작은 보라 배달 드론 (가운데 기준) */
export function zeek(mood = 'calm') {
  return g(
    null,
    line(-36, -22, -60, -50, '#5b4a7a', 5),
    line(36, -22, 60, -50, '#5b4a7a', 5),
    g({ class: 'gm-spin' }, ell(-60, -54, 34, 6, '#efe3ff', { opacity: 0.85 })),
    g({ class: 'gm-spin' }, ell(60, -54, 34, 6, '#efe3ff', { opacity: 0.85 })),
    circ(-60, -54, 5, '#5b4a7a'),
    circ(60, -54, 5, '#5b4a7a'),
    ell(0, 0, 54, 36, 'url(#gx-purple)', { stroke: '#5f2fb6', 'stroke-width': 3 }),
    circ(12, -2, 17, '#ffffff', { stroke: '#5f2fb6', 'stroke-width': 3 }),
    circ(16, -2, 7.5, '#22183a'),
    circ(19, -5, 2.5, '#ffffff'),
    mood === 'happy' ? path('M-22 14q8 8 16 0', 'none', { stroke: '#3b1f78', 'stroke-width': 3, 'stroke-linecap': 'round' }) : null,
    line(-10, 34, -14, 46, '#5b4a7a', 4),
    line(10, 34, 14, 46, '#5b4a7a', 4),
    rect(-20, 44, 40, 26, '#ffffff', { rx: 3, stroke: '#c9c1e0', 'stroke-width': 2 }),
    path('M-20 46l20 13l20 -13', 'none', { stroke: '#c9c1e0', 'stroke-width': 2 }),
    mood === 'nervous' ? path('M40 -30q7 12 0 17q-7 -5 0 -17z', '#8fd8ff') : null
  );
}

/** 미라 박사: 키 큰 보라 외계인 과학자, 눈 셋 (발밑 가운데 기준) */
export function mira(mood = 'calm') {
  return g(
    null,
    ell(0, 4, 70, 11, '#000', { opacity: 0.28 }),
    rect(-26, -64, 18, 62, '#6a35c8', { rx: 8 }),
    rect(8, -64, 18, 62, '#6a35c8', { rx: 8 }),
    ell(-17, -2, 16, 7, '#3d2470'),
    ell(17, -2, 16, 7, '#3d2470'),
    path('M-58 -214L58 -214L76 -56L-76 -56Z', '#f5f7fc', { stroke: '#cfd6e6', 'stroke-width': 3 }),
    path('M-14 -214L0 -150L14 -214', 'none', { stroke: '#cfd6e6', 'stroke-width': 3 }),
    line(0, -150, 0, -60, '#cfd6e6', 3),
    circ(-8, -128, 4, '#9aa6c0'),
    circ(-8, -100, 4, '#9aa6c0'),
    path('M-58 -206q-30 50 -14 104', 'none', { stroke: '#f5f7fc', 'stroke-width': 22, 'stroke-linecap': 'round' }),
    circ(-72, -96, 12, '#9b6bf0'),
    path('M58 -206q34 30 30 86', 'none', { stroke: '#f5f7fc', 'stroke-width': 22, 'stroke-linecap': 'round' }),
    rect(70, -142, 44, 58, '#c98a4b', { rx: 4, transform: 'rotate(-8 92 -113)' }),
    rect(76, -134, 32, 42, '#ffffff', { transform: 'rotate(-8 92 -113)' }),
    circ(86, -112, 12, '#9b6bf0'),
    rect(-12, -232, 24, 22, '#9b6bf0'),
    path('M-22 -306q-18 -30 -36 -40', 'none', { stroke: '#9b6bf0', 'stroke-width': 6, 'stroke-linecap': 'round' }),
    path('M22 -306q18 -30 36 -40', 'none', { stroke: '#9b6bf0', 'stroke-width': 6, 'stroke-linecap': 'round' }),
    circ(-60, -348, 9, '#7df9ff', { class: 'gm-twinkle' }),
    circ(60, -348, 9, '#7df9ff', { class: 'gm-twinkle' }),
    ell(0, -270, 54, 58, 'url(#gx-purple)', { stroke: '#5f2fb6', 'stroke-width': 3 }),
    [
      [-24, -278],
      [0, -298],
      [24, -278],
    ].map(([x, y]) => g(null, circ(x, y, 11, '#ffffff'), circ(x + 2, y + 1, 5, '#1d1236'), circ(x + 4, y - 2, 1.8, '#fff'))),
    mood === 'sad'
      ? path('M-14 -238q14 -8 28 0', 'none', { stroke: '#3b1f78', 'stroke-width': 4, 'stroke-linecap': 'round' })
      : path('M-16 -244q16 12 32 0', 'none', { stroke: '#3b1f78', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    circ(-34, -252, 6, '#ff9fd8', { opacity: 0.6 }),
    circ(34, -252, 6, '#ff9fd8', { opacity: 0.6 }),
    mood === 'nervous' ? path('M48 -310q8 14 0 20q-8 -6 0 -20z', '#8fd8ff') : null
  );
}

/** 모모: 작은 주황 우주 햄스터 (발밑 가운데 기준) */
export function momo(mood = 'calm') {
  return g(
    null,
    ell(0, 2, 58, 9, '#000', { opacity: 0.25 }),
    circ(-38, -96, 17, '#ff9f50'),
    circ(38, -96, 17, '#ff9f50'),
    circ(-38, -96, 9, '#ffc3d1'),
    circ(38, -96, 9, '#ffc3d1'),
    ell(0, -50, 58, 50, '#ffad62', { stroke: '#e2843b', 'stroke-width': 3 }),
    ell(0, -36, 34, 30, '#fff1dc'),
    g(null, circ(-19, -64, 9, '#1d1424'), circ(-16, -67, 3, '#ffffff')),
    g(null, circ(19, -64, 9, '#1d1424'), circ(22, -67, 3, '#ffffff')),
    ell(0, -51, 6.5, 4.5, '#ff7f9f'),
    path('M-8 -44q4 5 8 0q4 5 8 0', 'none', { stroke: '#7a4a3a', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    ell(-34, -46, 9, 6, '#ff9fb4', { opacity: 0.7 }),
    ell(34, -46, 9, 6, '#ff9fb4', { opacity: 0.7 }),
    line(-30, -52, -56, -58, '#c47a45', 2),
    line(-30, -48, -56, -46, '#c47a45', 2),
    line(30, -52, 56, -58, '#c47a45', 2),
    line(30, -48, 56, -46, '#c47a45', 2),
    ell(-22, -4, 14, 7, '#ffad62', { stroke: '#e2843b', 'stroke-width': 2 }),
    ell(22, -4, 14, 7, '#ffad62', { stroke: '#e2843b', 'stroke-width': 2 }),
    mood === 'nervous' ? path('M44 -112q7 12 0 17q-7 -5 0 -17z', '#8fd8ff') : null,
    mood === 'sad' ? path('M-26 -76l12 4M26 -76l-12 4', 'none', { stroke: '#7a4a3a', 'stroke-width': 2.5 }) : null
  );
}

export const SUSPECT_ART = { bolt, zeek, mira, momo };
/** 용의자 그림을 카드에 꼭 맞게 담는 viewBox (인물마다 크기·기준점이 다르다) */
export const SUSPECT_VIEW = { bolt: '-135 -335 270 345', mira: '-125 -368 250 378', zeek: '-100 -75 200 155', momo: '-75 -125 150 135' };
export const suspectIcon = (id, mood) => svg(SUSPECT_VIEW[id], { class: 'gm-sus-art', 'aria-hidden': 'true' }, SUSPECT_ART[id](mood));

/** 로봇 강아지 스파키 (발밑 가운데 기준) */
export function sparky(awake = true) {
  return g(
    null,
    ell(0, 4, 74, 10, '#000', { opacity: 0.25 }),
    path('M52 -44q30 -16 26 -46', 'none', { stroke: '#7c8aa8', 'stroke-width': 5, 'stroke-linecap': 'round', class: awake ? 'gm-wag' : null }),
    circ(78, -92, 7, '#ff6b81', { class: 'gm-blink' }),
    rect(-58, -64, 112, 50, '#9fb0cc', { rx: 24, stroke: '#5f6f8f', 'stroke-width': 3 }),
    [-44, -18, 18, 40].map((x) => rect(x, -22, 14, 24, '#7c8aa8', { rx: 6 })),
    rect(-92, -104, 64, 52, '#b9c7df', { rx: 18, stroke: '#5f6f8f', 'stroke-width': 3 }),
    path('M-88 -100l-8 -26l22 14z', '#7c8aa8'),
    path('M-40 -100l10 -26l10 22z', '#7c8aa8'),
    rect(-112, -80, 26, 18, '#9fb0cc', { rx: 8 }),
    circ(-110, -74, 4, '#2b2f3c'),
    circ(-74, -84, 6, awake ? '#5ff0ff' : '#3a5160'),
    circ(-50, -84, 6, awake ? '#5ff0ff' : '#3a5160'),
    rect(-74, -58, 40, 8, '#ff6b81', { rx: 4 })
  );
}

/** 루나 선장 얼굴 (영상 기록용) */
export function luna() {
  return g(
    null,
    path('M-62 70q0 -48 62 -52q62 4 62 52z', '#2f5bea'),
    path('M-18 22l18 22l18 -22', '#ffd23f'),
    s('polygon', { points: starPoints(30, 46, 9, 4) , fill: '#ffd23f' }),
    rect(-12, 4, 24, 20, '#f2c3a0'),
    ell(0, -22, 40, 44, '#f6cfae'),
    path('M-42 -26q2 -46 42 -48q40 2 42 48q-14 -26 -42 -28q-28 2 -42 28z', '#3b2a2a'),
    circ(30, -64, 14, '#3b2a2a'),
    g(null, ell(-14, -22, 5, 6, '#2b1d1d'), ell(14, -22, 5, 6, '#2b1d1d')),
    path('M-12 2q12 9 24 0', 'none', { stroke: '#a34a4a', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    path('M-44 -18q-12 18 6 28', 'none', { stroke: '#38405a', 'stroke-width': 5 }),
    circ(-36, 12, 5, '#38405a')
  );
}

/* ---------- 방 1: 도킹 베이 ---------- */

function shuttle(open) {
  return g(
    null,
    path('M-260 330Q120 280 320 410Q380 470 360 560Q330 700 190 770L-260 790Z', 'url(#gx-steel)', {
      stroke: '#7d89a6',
      'stroke-width': 4,
    }),
    path('M-260 600Q100 610 345 600', 'none', { stroke: '#ff8c3a', 'stroke-width': 18 }),
    circ(170, 440, 52, '#0b1430', { stroke: '#8d99b8', 'stroke-width': 10 }),
    path('M140 410q20 -18 46 -10', 'none', { stroke: '#ffffff', 'stroke-width': 5, opacity: 0.35, 'stroke-linecap': 'round' }),
    path(roundRectPath(40, 500, 120, 255, 46), open ? '#ffe9a8' : '#0a0f22', { stroke: '#7d89a6', 'stroke-width': 6 }),
    open ? glow(100, 640, 110, 'Y', { opacity: 0.5 }) : null,
    path('M40 755L160 755L220 800L-10 800Z', '#5c6784'),
    text(-60, 420, 'CADET-1', { fill: '#4a5878', 'font-size': 34, 'text-anchor': 'start' })
  );
}

function radio(on) {
  return g(
    null,
    rect(352, 700, 9, 92, '#3a4260'),
    rect(410, 700, 9, 92, '#3a4260'),
    rect(328, 556, 116, 150, 'url(#gx-metal)', { rx: 14, stroke: '#46506d', 'stroke-width': 3 }),
    circ(362, 646, 24, 'url(#gx-grille)', { stroke: '#2b3249', 'stroke-width': 3 }),
    rect(390, 584, 42, 32, '#062018', { rx: 4 }),
    s('polyline', {
      points: '392,600 398,592 404,608 410,588 416,606 422,596 430,600',
      fill: 'none',
      stroke: on ? '#5dff9a' : '#1d4b33',
      'stroke-width': 2.5,
    }),
    circ(410, 650, 8, '#c84b4b'),
    circ(410, 676, 8, '#4bb3c8'),
    line(430, 556, 452, 492, '#9aa6c0', 4),
    circ(452, 490, 7, '#ff6b81', { class: 'gm-blink' })
  );
}

function crateBox(x, y, sz, tint = 'url(#gx-crate)') {
  return g(
    null,
    rect(x, y, sz, sz, tint, { rx: 6, stroke: '#6b4220', 'stroke-width': 4 }),
    line(x + 8, y + 8, x + sz - 8, y + sz - 8, '#7a4c24', 6, { opacity: 0.6 }),
    rect(x + sz * 0.25, y + sz * 0.36, sz * 0.5, sz * 0.28, '#f3e3c3', { rx: 3 }),
    text(x + sz / 2, y + sz * 0.57, 'CARGO', { 'font-size': sz * 0.13, fill: '#7a4c24' })
  );
}

function fusebox(solved) {
  return g(
    null,
    rect(788, 328, 98, 194, 'url(#gx-metal)', { rx: 8, stroke: '#46506d', 'stroke-width': 3 }),
    rect(788, 328, 98, 26, 'url(#gx-hazard)', { rx: 4 }),
    s('polygon', { points: '842,376 816,436 836,436 826,478 862,412 842,412 852,376', fill: '#ffd23f', stroke: '#8a6a00', 'stroke-width': 2 }),
    circ(837, 500, 8, solved ? '#5dff9a' : '#ff4d6d', { class: solved ? null : 'gm-blink' }),
    solved ? glow(837, 500, 30, 'G') : null
  );
}

function bigWindow(x, y, w, h) {
  const bolts = [];
  for (let i = 0; i < 6; i++) {
    bolts.push(circ(x + 18 + (i * (w - 36)) / 5, y - 2, 5, '#c7cfe0'));
    bolts.push(circ(x + 18 + (i * (w - 36)) / 5, y + h + 2, 5, '#c7cfe0'));
  }
  return g(
    null,
    path(roundRectPath(x, y, w, h, 40), 'none', { stroke: '#8d99b8', 'stroke-width': 18 }),
    path(roundRectPath(x + 10, y + 10, w - 20, h - 20, 32), 'none', { stroke: '#4a5575', 'stroke-width': 5 }),
    path(`M${x + 40} ${y + 40}l60 -10`, 'none', { stroke: '#ffffff', 'stroke-width': 6, opacity: 0.18, 'stroke-linecap': 'round' }),
    bolts,
    rect(x - 12, y + h + 8, w + 24, 18, '#5c6784', { rx: 6 })
  );
}

function charger(solved) {
  return g(
    null,
    ell(1040, 842, 96, 24, '#232b48', { stroke: solved ? '#7df9ff' : '#3a4566', 'stroke-width': 5 }),
    ell(1040, 838, 70, 15, solved ? 'url(#gx-glowC)' : '#2d3656'),
    text(1040, 878, solved ? '100%' : '3%', { fill: solved ? '#7df9ff' : '#ff6b81', 'font-size': 22 })
  );
}

function poster() {
  return g(
    null,
    rect(1222, 176, 116, 156, 'url(#gx-paper)', { rx: 4, stroke: '#b8a98a', 'stroke-width': 2 }),
    rect(1222, 176, 116, 28, '#e03c4b', { rx: 4 }),
    text(1280, 198, 'SAFETY', { fill: '#ffffff', 'font-size': 18 }),
    [0, 1, 2, 3].map((i) => rect(1236 + i * 25, 222, 16, 30, '#c9c2b0', { rx: 3 })),
    [0, 1, 2].map((i) => rect(1236, 270 + i * 16, 86 - i * 18, 6, '#c9c2b0', { rx: 3 }))
  );
}

function lockers(open) {
  const one = (x, opened) =>
    g(
      null,
      rect(x, 360, 70, 400, 'url(#gx-dark)', { rx: 6, stroke: '#1f2538', 'stroke-width': 3 }),
      [0, 1, 2, 3].map((i) => rect(x + 14, 392 + i * 14, 42, 5, '#1c2236', { rx: 2 })),
      opened ? rect(x + 6, 470, 58, 280, '#0d1020') : rect(x + 54, 560, 8, 40, '#9aa6c0', { rx: 3 }),
      opened
        ? g(null, rect(x + 18, 640, 34, 14, '#ffd23f', { rx: 4 }), circ(x + 52, 647, 7, '#fff6b0'), glow(x + 35, 650, 50, 'Y'))
        : null
    );
  return g(null, one(1206, false), one(1280, open), rect(1316, 512, 26, 32, '#062018', { rx: 4, stroke: open ? '#5dff9a' : '#3fd7ff', 'stroke-width': 2 }));
}

function switchPlate(solved) {
  return g(
    null,
    rect(1384, 420, 82, 142, '#c8d0e0', { rx: 10, stroke: '#7d89a6', 'stroke-width': 3 }),
    [0, 1, 2, 3].map((i) =>
      g(
        null,
        rect(1396 + (i % 2) * 36, 438 + Math.floor(i / 2) * 60, 22, 44, '#8a95ad', { rx: 5 }),
        rect(1400 + (i % 2) * 36, 446 + Math.floor(i / 2) * 60, 14, 18, '#eef2f8', { rx: 4 }),
        circ(1407 + (i % 2) * 36, 490 + Math.floor(i / 2) * 60, 3.5, solved ? '#5dff9a' : '#4a5575')
      )
    )
  );
}

function exitDoor(x, y, w, h, open, letters, { round = false } = {}) {
  const cx = x + w / 2;
  return g(
    null,
    rect(x - 14, y - 14, w + 28, h + 14, 'url(#gx-hazard)', { rx: round ? w / 2 : 14 }),
    open
      ? g(null, rect(x, y, w, h, '#fff7d6', { rx: round ? w / 2 - 12 : 8 }), glow(cx, y + h * 0.6, w * 0.9, 'Y', { opacity: 0.8 }))
      : g(
          null,
          rect(x, y, w, h, 'url(#gx-metal)', { rx: round ? w / 2 - 12 : 8, stroke: '#46506d', 'stroke-width': 4 }),
          line(cx, y + 10, cx, y + h - 6, '#3a4260', 5),
          circ(cx, y + 120, 30, '#2b3249', { stroke: '#46506d', 'stroke-width': 4 }),
          circ(cx, y + 120, 16, '#ff4d6d', { class: 'gm-blink' })
        ),
    letterSlots(cx - (letters.length * 40 - 6) / 2, y + h - 150, letters)
  );
}

export function room1(st) {
  const lit = st.lit ?? 0;
  const solved = st.solved || [];
  const far = [
    rect(-200, 0, W + 400, H, 'url(#gx-space)'),
    ...starfield(11, -200, W + 200, 0, H, 260),
    circ(870, 290, 34, 'url(#gx-moon)'),
    earth(1100, 600, 270),
  ];
  const back = [
    ...shell({ wall: 'gx-wall1', floor: 'gx-floor1', holes: [[900, 190, 290, 350, 40]], lit, ceilLights: [260, 900, 1540] }),
    shuttle(st.open),
    fusebox(solved.includes(0)),
    bigWindow(900, 190, 290, 350),
    poster(),
    lockers(solved.includes(1)),
    switchPlate(solved.includes(3)),
    exitDoor(1510, 212, 220, 548, st.open, st.letters || ['', '', '', '']),
    g({ class: lit > 0.5 ? null : 'gm-beacon' }, path('M1390 110a26 26 0 0 1 52 0z', '#ff4d6d'), glow(1416, 104, 90, 'R', { opacity: lit > 0.5 ? 0.15 : 0.9 })),
  ];
  const mid = [
    radio(solved.includes(0)),
    crateBox(470, 700, 92),
    crateBox(564, 700, 92),
    crateBox(658, 700, 92),
    crateBox(516, 606, 92),
    crateBox(610, 606, 92),
    crateBox(752, 748, 54, '#b0793f'),
    charger(solved.includes(2)),
    at(1040, 724, 1, g({ class: 'gm-float' }, pip(solved.includes(2) ? 'happy' : 'low'))),
  ];
  const front = [
    path('M-420 0Q-180 260 60 60', 'none', { stroke: '#0c0f1d', 'stroke-width': 22, 'stroke-linecap': 'round' }),
    path('M-300 0Q-120 160 140 0', 'none', { stroke: '#151a2e', 'stroke-width': 14, 'stroke-linecap': 'round' }),
    path(`M${W - 120} 0Q${W + 60} 220 ${W + 360} 20`, 'none', { stroke: '#0c0f1d', 'stroke-width': 22, 'stroke-linecap': 'round' }),
    rect(-400, 940, 520, 26, '#11152a', { rx: 13 }),
    rect(W - 40, 950, 560, 26, '#11152a', { rx: 13 }),
  ];
  return {
    layers: { far, back, mid, front },
    hot: [
      { id: 'radio', layer: 'mid', x: 318, y: 484, w: 144, h: 312 },
      { id: 'crates', layer: 'mid', x: 462, y: 598, w: 352, h: 206 },
      { id: 'window', layer: 'back', x: 896, y: 186, w: 298, h: 358 },
      { id: 'poster', layer: 'back', x: 1214, y: 168, w: 132, h: 172 },
      { id: 'fusebox', layer: 'back', x: 778, y: 318, w: 118, h: 214 },
      { id: 'locker', layer: 'back', x: 1200, y: 352, w: 160, h: 410 },
      { id: 'charger', layer: 'mid', x: 940, y: 630, w: 200, h: 262 },
      { id: 'switches', layer: 'back', x: 1374, y: 410, w: 102, h: 162 },
      { id: 'door', layer: 'back', x: 1490, y: 196, w: 260, h: 570 },
      { id: 'shuttle', layer: 'back', x: 0, y: 330, w: 310, h: 440 },
    ],
    crystals: [
      { id: 'c1', layer: 'back', x: 170, y: 440 },
      { id: 'c2', layer: 'mid', x: 800, y: 880 },
      { id: 'c3', layer: 'back', x: 1244, y: 336 },
    ],
  };
}

/* ---------- 방 2: 우주 정원 ---------- */

const FRUIT_DRAW = {
  apple: (x, y, k = 1) =>
    at(x, y, k, circ(0, 0, 20, '#e8414f'), path('M0 -18q4 -12 12 -14', 'none', { stroke: '#6b3d1f', 'stroke-width': 4 }), ell(9, -20, 8, 4, '#4fbf5a'), circ(-7, -7, 5, '#fff', { opacity: 0.4 })),
  banana: (x, y, k = 1) =>
    at(x, y, k, path('M-26 -8Q-4 30 28 -14Q20 12 -2 14Q-20 12 -26 -8Z', '#ffd84a', { stroke: '#c9a21b', 'stroke-width': 3 }), circ(28, -14, 3, '#6b4a1f')),
  grapes: (x, y, k = 1) =>
    at(
      x,
      y,
      k,
      [
        [-10, -10],
        [10, -10],
        [0, -12],
        [-14, 4],
        [0, 4],
        [14, 4],
        [-7, 17],
        [7, 17],
        [0, 29],
      ].map(([a, b]) => circ(a, b, 9, '#9b4fe0', { stroke: '#6a2db0', 'stroke-width': 2 })),
      path('M0 -20q2 -12 10 -14', 'none', { stroke: '#6b3d1f', 'stroke-width': 4 })
    ),
  orange: (x, y, k = 1) => at(x, y, k, circ(0, 0, 20, '#ff9a2e', { stroke: '#d9731a', 'stroke-width': 3 }), ell(6, -19, 7, 4, '#4fbf5a'), circ(-7, -6, 5, '#fff', { opacity: 0.35 })),
  strawberry: (x, y, k = 1) =>
    at(
      x,
      y,
      k,
      path('M0 24Q-24 6 -18 -10Q-10 -18 0 -14Q10 -18 18 -10Q24 6 0 24Z', '#ef3e4a', { stroke: '#b9212b', 'stroke-width': 2 }),
      path('M-12 -14l6 -8l6 6l6 -6l6 8z', '#3fb34c'),
      [
        [-8, -2],
        [6, -4],
        [-2, 8],
        [8, 8],
        [-9, 10],
      ].map(([a, b]) => ell(a, b, 1.6, 2.4, '#ffe27a'))
    ),
  watermelon: (x, y, k = 1) =>
    at(
      x,
      y,
      k,
      ell(0, 0, 30, 22, '#2e9e47', { stroke: '#1d6b30', 'stroke-width': 3 }),
      path('M-26 -6q26 -10 52 0M-28 6q28 -10 56 0', 'none', { stroke: '#1d6b30', 'stroke-width': 3 })
    ),
};

function fruitTree() {
  const canopy = [
    [560, 320, 170],
    [430, 360, 110],
    [690, 360, 110],
    [500, 230, 110],
    [640, 230, 110],
  ];
  return g(
    null,
    path('M540 800Q548 600 528 470L590 470Q574 600 594 800Z', 'url(#gx-trunk)'),
    path('M556 520q-50 -30 -80 -90M576 520q40 -40 90 -80', 'none', { stroke: '#7a4c2f', 'stroke-width': 14, 'stroke-linecap': 'round' }),
    canopy.map(([x, y, r]) => circ(x, y, r, 'url(#gx-leaf)', { opacity: 0.96 })),
    canopy.map(([x, y, r]) => circ(x - r * 0.3, y - r * 0.35, r * 0.35, '#b8f5a8', { opacity: 0.25 })),
    FRUIT_DRAW.apple(450, 340),
    FRUIT_DRAW.banana(560, 410),
    FRUIT_DRAW.grapes(660, 300),
    FRUIT_DRAW.orange(520, 250),
    FRUIT_DRAW.strawberry(700, 400),
    FRUIT_DRAW.watermelon(610, 190, 0.9)
  );
}

function bellFlower(x, base, hgt, color) {
  const c = hex(color);
  return g(
    { class: 'gm-sway' },
    path(`M${x} ${base}Q${x - 14} ${base - hgt / 2} ${x} ${base - hgt}`, 'none', { stroke: '#3c9a48', 'stroke-width': 7 }),
    path(`M${x} ${base - 50}q-40 -14 -46 -46q34 4 46 34z`, '#4fbf5a'),
    path(`M${x - 30} ${base - hgt + 8}Q${x - 30} ${base - hgt - 46} ${x} ${base - hgt - 48}Q${x + 30} ${base - hgt - 46} ${x + 30} ${base - hgt + 8}Q${x + 15} ${base - hgt} ${x} ${base - hgt + 10}Q${x - 15} ${base - hgt} ${x - 30} ${base - hgt + 8}Z`, c, {
      stroke: '#00000033',
      'stroke-width': 3,
    }),
    circ(x, base - hgt + 12, 7, '#fff6b0'),
    glow(x, base - hgt - 16, 46, color === 'blue' ? 'C' : color === 'yellow' ? 'Y' : color === 'orange' ? 'O' : 'P', { opacity: 0.6 })
  );
}

function bigBud(open) {
  if (open)
    return g(
      null,
      path('M1650 840Q1630 700 1648 560', 'none', { stroke: '#3c9a48', 'stroke-width': 26 }),
      path('M1640 760q-110 -10 -150 -90q110 0 150 70z', '#4fbf5a'),
      path('M1652 720q110 -30 140 -110q-110 20 -140 90z', '#4fbf5a'),
      [0, 1, 2, 3, 4, 5].map((i) =>
        path('M0 0q-40 -70 0 -150q40 80 0 150z', i % 2 ? '#ff8fc4' : '#ffb0d6', { transform: `translate(1648 470) rotate(${i * 60})`, stroke: '#e86aa5', 'stroke-width': 3 })
      ),
      circ(1648, 470, 64, '#ffe27a', { stroke: '#e8b93a', 'stroke-width': 4 }),
      g(null, path('M1624 462q8 -10 16 0', 'none', { stroke: '#7a4a1a', 'stroke-width': 4 }), path('M1656 462q8 -10 16 0', 'none', { stroke: '#7a4a1a', 'stroke-width': 4 })),
      path('M1628 486q20 18 40 0', 'none', { stroke: '#7a4a1a', 'stroke-width': 4, 'stroke-linecap': 'round' })
    );
  return g(
    { class: 'gm-sway' },
    path('M1650 840Q1630 700 1648 600', 'none', { stroke: '#3c9a48', 'stroke-width': 26 }),
    path('M1640 760q-110 -10 -150 -90q110 0 150 70z', '#4fbf5a'),
    path('M1652 720q110 -30 140 -110q-110 20 -140 90z', '#4fbf5a'),
    path('M1648 610Q1530 560 1560 400Q1590 260 1648 210Q1706 260 1736 400Q1766 560 1648 610Z', '#5cc96a', { stroke: '#2e8a3c', 'stroke-width': 5 }),
    path('M1648 610Q1600 470 1648 210Q1696 470 1648 610Z', '#43b153'),
    path('M1648 210q-14 -26 0 -50q14 24 0 50z', '#ff8fc4'),
    path('M1612 430q10 8 20 0M1664 430q10 8 20 0', 'none', { stroke: '#1e5a27', 'stroke-width': 5, 'stroke-linecap': 'round' }),
    ell(1606, 452, 12, 7, '#ff9fb4', { opacity: 0.7 }),
    ell(1690, 452, 12, 7, '#ff9fb4', { opacity: 0.7 }),
    text(1700, 330, 'z', { fill: '#d7ffe0', 'font-size': 30, class: 'gm-twinkle' }),
    text(1726, 296, 'Z', { fill: '#d7ffe0', 'font-size': 40, class: 'gm-twinkle' })
  );
}

export function room2(st) {
  const solved = st.solved || [];
  const domeLines = [];
  for (let i = 0; i <= 8; i++) {
    const x = i * 225;
    domeLines.push(path(`M${x} 430Q${x + (x < 900 ? 40 : -40)} 200 ${900 + (x - 900) * 0.25} -20`, 'none', { stroke: '#a7f0d9', 'stroke-width': 7, opacity: 0.45 }));
  }
  for (const y of [300, 160]) domeLines.push(path(`M-400 ${y + 120}Q900 ${y - 160} ${W + 400} ${y + 120}`, 'none', { stroke: '#a7f0d9', 'stroke-width': 6, opacity: 0.4 }));
  const far = [
    rect(-200, 0, W + 400, H, 'url(#gx-space)'),
    ell(500, 260, 520, 260, 'url(#gx-nebula)'),
    ell(1350, 180, 420, 200, 'url(#gx-nebula)', { opacity: 0.7 }),
    ...starfield(22, -200, W + 200, 0, 520, 220),
    g(null, circ(1180, 200, 70, '#ffcf8a'), ell(1180, 200, 130, 22, 'none', { stroke: '#ffe7c2', 'stroke-width': 8, opacity: 0.8, transform: 'rotate(-18 1180 200)' })),
  ];
  const back = [
    rect(-500, 0, W + 1000, 430, '#bfffe8', { opacity: 0.05 }),
    ...domeLines,
    rect(-500, 418, W + 1000, 26, '#9fd9c6'),
    rect(-500, 444, W + 1000, FLOOR - 444, 'url(#gx-wall2)'),
    path('M-100 470q120 60 260 10t260 20t300 -10', 'none', { stroke: '#3fae5a', 'stroke-width': 8, opacity: 0.8 }),
    rect(-500, FLOOR - 14, W + 1000, 14, '#0b2219', { opacity: 0.6 }),
    rect(-500, FLOOR, W + 1000, H - FLOOR, 'url(#gx-floor2)'),
    ...floorLines('#0d2a10'),
    path(`M700 ${H}Q860 ${FLOOR + 60} 980 ${FLOOR + 20}L1180 ${FLOOR + 20}Q1100 ${FLOOR + 80} 1080 ${H}Z`, '#b9a98a', { opacity: 0.55 }),
    // 물 펌프
    rect(990, 470, 90, 210, '#7f97b0', { rx: 22, stroke: '#4c5f78', 'stroke-width': 4 }),
    circ(1035, 540, 26, '#eef6ff', { stroke: '#4c5f78', 'stroke-width': 4 }),
    line(1035, 540, 1048, 526, '#e03c4b', 4),
    path('M1035 680V735H960', 'none', { stroke: '#4c5f78', 'stroke-width': 14 }),
    // 식물 조명 화면
    rect(1496, 372, 92, 100, 'url(#gx-screen)', { rx: 10, stroke: '#5ff0b0', 'stroke-width': 3 }),
    path('M1542 452v-34M1542 430q-16 -14 -22 -30q20 2 22 22M1542 424q14 -16 26 -22q-2 20 -26 30', 'none', { stroke: '#5ff0b0', 'stroke-width': 4 }),
    // 출구 문 (빅 버드 뒤)
    path(`M1580 760V560Q1580 490 1660 490Q1740 490 1740 560V760Z`, '#1d3d37', { stroke: '#9fd9c6', 'stroke-width': 8 }),
    letterSlots(1752, 470, st.letters || ['', '', '', ''], { vertical: true, size: 32 }),
    st.open ? path('M1592 760V566Q1592 504 1660 504Q1728 504 1728 566V760Z', '#fff7d6') : null,
  ];
  const mid = [
    // 모모의 화분 침대
    path('M40 790L200 790L184 890L56 890Z', 'url(#gx-pot)'),
    rect(30, 776, 180, 20, '#c96a38', { rx: 8 }),
    path('M52 780q40 -40 90 -18q30 -14 50 16z', '#ff9fc4'),
    ell(80, 770, 26, 14, '#ffffff'),
    text(120, 852, 'MOMO', { fill: '#fff0e0', 'font-size': 22 }),
    // 화분 탁자 + 공책
    rect(214, 650, 180, 18, 'url(#gx-wood)', { rx: 6 }),
    rect(228, 668, 14, 130, '#6b4a2f'),
    rect(366, 668, 14, 130, '#6b4a2f'),
    rect(246, 618, 84, 34, '#2f9e5a', { rx: 4, stroke: '#1d6b3a', 'stroke-width': 3 }),
    rect(256, 624, 30, 22, '#e8f5dc', { rx: 2 }),
    rect(342, 626, 28, 26, '#ffd84a', { rx: 3 }),
    path('M300 618q-14 -40 10 -60', 'none', { stroke: '#7d89a6', 'stroke-width': 4 }),
    fruitTree(),
    // 분수 (물고기는 확대 화면에서만 셀 수 있다)
    ell(850, 790, 132, 46, '#9aa3b3', { stroke: '#6b7385', 'stroke-width': 5 }),
    ell(850, 782, 110, 32, 'url(#gx-water)'),
    rect(840, 640, 20, 140, '#9aa3b3'),
    path('M850 640q-60 20 -80 120M850 640q60 20 80 120', 'none', { stroke: '#9cf3ff', 'stroke-width': 6, opacity: 0.8, class: 'gm-twinkle' }),
    [0, 1, 2, 3, 4].map((i) => circ(790 + i * 30, 780 + (i % 2) * 8, 5, '#d9fbff', { class: 'gm-twinkle', opacity: 0.8 })),
    // 벤치 + 악보
    rect(1090, 742, 176, 18, 'url(#gx-wood)', { rx: 6 }),
    rect(1104, 760, 12, 70, '#6b4a2f'),
    rect(1240, 760, 12, 70, '#6b4a2f'),
    rect(1140, 706, 70, 44, 'url(#gx-paper)', { rx: 3, transform: 'rotate(-6 1175 728)' }),
    [0, 1, 2].map((i) => line(1146, 716 + i * 10, 1204, 712 + i * 10, '#c9b98f', 2, { transform: 'rotate(-6 1175 728)' })),
    // 종소리 꽃 다섯 송이
    FLOWERS.map((col, i) => bellFlower(1300 + i * 46, 840, 190 + (i % 2) * 40, col)),
    bigBud(solved.includes(3)),
    at(990, 300, 0.8, g({ class: 'gm-float' }, pip('happy'))),
  ];
  const front = [
    path('M-420 1000Q-300 820 -120 790Q-40 880 -10 1000Z', '#2c8a3c'),
    path('M-300 1000Q-200 880 -60 860Q-10 930 0 1000Z', '#3fae5a'),
    path(`M${W + 420} 1000Q${W + 300} 760 ${W + 90} 700Q${W - 10} 840 ${W - 60} 1000Z`, '#2c8a3c'),
    path('M260 0q20 120 -20 220', 'none', { stroke: '#3fae5a', 'stroke-width': 6 }),
    path('M1300 0q-30 90 10 170', 'none', { stroke: '#3fae5a', 'stroke-width': 6 }),
    ell(240, 220, 16, 9, '#4fbf5a'),
    ell(1310, 170, 16, 9, '#4fbf5a'),
  ];
  return {
    layers: { far, back, mid, front },
    hot: [
      { id: 'notebook', layer: 'mid', x: 206, y: 590, w: 196, h: 210 },
      { id: 'tree', layer: 'mid', x: 330, y: 130, w: 470, h: 670 },
      { id: 'fountain', layer: 'mid', x: 716, y: 630, w: 268, h: 210 },
      { id: 'pump', layer: 'back', x: 980, y: 460, w: 110, h: 230 },
      { id: 'sheet', layer: 'mid', x: 1086, y: 690, w: 184, h: 140 },
      { id: 'bells', layer: 'mid', x: 1262, y: 560, w: 236, h: 290 },
      { id: 'tablet', layer: 'back', x: 1488, y: 364, w: 108, h: 116 },
      { id: 'bud', layer: 'mid', x: 1520, y: 150, w: 260, h: 700 },
      { id: 'door', layer: 'back', x: 1744, y: 460, w: 56, h: 166 },
      { id: 'momobed', layer: 'mid', x: 26, y: 740, w: 190, h: 156 },
    ],
    crystals: [
      { id: 'c1', layer: 'mid', x: 160, y: 786 },
      { id: 'c2', layer: 'mid', x: 760, y: 250 },
      { id: 'c3', layer: 'back', x: 1460, y: 700 },
    ],
  };
}

/* ---------- 방 3: 로봇 작업실 ---------- */

function robotArm() {
  return g(
    null,
    rect(316, 756, 150, 44, '#2b2f3c', { rx: 10 }),
    rect(354, 728, 74, 34, '#ffb020', { rx: 8 }),
    path('M392 740L330 520', 'none', { stroke: '#ff9a1f', 'stroke-width': 34, 'stroke-linecap': 'round' }),
    path('M330 520L480 420', 'none', { stroke: '#ffb020', 'stroke-width': 28, 'stroke-linecap': 'round' }),
    circ(392, 740, 20, '#5b6276'),
    circ(330, 520, 18, '#5b6276'),
    circ(480, 420, 15, '#5b6276'),
    path('M480 420l30 -8l18 30M480 420l12 28l32 6', 'none', { stroke: '#8d99b8', 'stroke-width': 9, 'stroke-linecap': 'round' }),
    path('M330 520L480 420', 'none', { stroke: '#ffd27a', 'stroke-width': 6, opacity: 0.5, 'stroke-linecap': 'round' })
  );
}

function gearRack() {
  const gears = [
    [1222, 340, 30, 'red'],
    [1290, 340, 30, 'blue'],
    [1222, 430, 30, 'green'],
    [1290, 430, 18, 'red'],
    [1222, 510, 18, 'blue'],
    [1290, 510, 18, 'green'],
  ];
  return g(
    null,
    rect(1188, 290, 136, 270, 'url(#gx-peg)', { rx: 8, stroke: '#6d4c33', 'stroke-width': 4 }),
    gears.map(([x, y, r, col]) => g(null, path(gearPath(x, y, r, r > 20 ? 10 : 8), hex(col), { stroke: '#00000055', 'stroke-width': 2 }), circ(x, y, r * 0.3, '#2b2f3c'))),
    rect(1170, 560, 172, 18, '#5b4a3a', { rx: 4 })
  );
}

function workbench() {
  return g(
    null,
    rect(910, 600, 280, 24, '#8d99b8', { rx: 6 }),
    rect(926, 624, 20, 176, '#4b5674'),
    rect(1156, 624, 20, 176, '#4b5674'),
    rect(946, 700, 210, 14, '#4b5674'),
    // 토스터 (볼트가 고치던 것)
    rect(952, 540, 86, 62, '#d7deea', { rx: 14, stroke: '#8d99b8', 'stroke-width': 3 }),
    rect(966, 534, 24, 8, '#3a4260', { rx: 3 }),
    rect(1000, 534, 24, 8, '#3a4260', { rx: 3 }),
    text(1018, 528, '~', { fill: '#9fb0cc', 'font-size': 34 }),
    // 공구함
    rect(1068, 552, 100, 50, '#e03c4b', { rx: 6, stroke: '#8f1f2b', 'stroke-width': 3 }),
    rect(1100, 540, 36, 14, 'none', { stroke: '#8f1f2b', 'stroke-width': 5, rx: 4 }),
    // 볼트의 쪽지 (내용은 확대 화면에서)
    rect(1112, 612, 54, 48, '#ffe066', { rx: 2, transform: 'rotate(5 1139 636)' }),
    [0, 1, 2].map((i) => line(1120, 626 + i * 10, 1156, 628 + i * 10, '#c9a21b', 2, { transform: 'rotate(5 1139 636)' }))
  );
}

function elevator(working, open, letters) {
  return g(
    null,
    rect(1470, 168, 266, 594, '#3a2a22', { rx: 10 }),
    rect(1486, 230, 234, 530, open ? '#fff3cf' : 'url(#gx-metal)', { rx: 4, stroke: '#2b2f3c', 'stroke-width': 4 }),
    open ? null : line(1603, 236, 1603, 756, '#3a4260', 6),
    rect(1556, 182, 94, 36, '#071321', { rx: 8, stroke: working ? '#5dff9a' : '#ff4d6d', 'stroke-width': 3 }),
    text(1603, 210, working ? '▲' : '✕', { fill: working ? '#5dff9a' : '#ff4d6d', 'font-size': 24 }),
    rect(1744, 420, 46, 120, '#2b2f3c', { rx: 8 }),
    [0, 1, 2].map((i) => circ(1767, 446 + i * 34, 11, working ? '#5dff9a' : '#7d89a6', { stroke: '#1a1d26', 'stroke-width': 3 })),
    letterSlots(1530, 646, letters)
  );
}

export function room3(st) {
  const solved = st.solved || [];
  const far = [rect(-200, 0, W + 400, H, 'url(#gx-space)'), ...starfield(33, -200, W + 200, 0, H, 160), circ(900, 240, 26, '#ffcf8a')];
  const back = [
    ...shell({ wall: 'gx-wall3', floor: 'gx-floor3', holes: [[828, 166, 120, 120, 60]], seam: '#2a1a12', step: 200, lit: 1, ceilLights: [300, 1000, 1600] }),
    circ(888, 226, 60, 'none', { stroke: '#a7795a', 'stroke-width': 14 }),
    // 공구 판
    rect(70, 150, 500, 270, 'url(#gx-peg)', { rx: 10, stroke: '#6d4c33', 'stroke-width': 4 }),
    path('M120 200l60 60M112 210l16 -16M172 262l16 -16', 'none', { stroke: '#8d99b8', 'stroke-width': 12, 'stroke-linecap': 'round' }),
    rect(240, 190, 22, 110, '#e03c4b', { rx: 6 }),
    rect(232, 180, 38, 26, '#8d99b8', { rx: 4 }),
    path('M340 190v120', 'none', { stroke: '#ffb020', 'stroke-width': 14, 'stroke-linecap': 'round' }),
    path('M410 200a26 26 0 1 0 1 0', 'none', { stroke: '#8d99b8', 'stroke-width': 10 }),
    rect(470, 176, 80, 14, '#5b4a3a', { rx: 4 }),
    // 팔 프로그램 화면
    rect(90, 440, 160, 120, 'url(#gx-screen)', { rx: 10, stroke: '#3fd7ff', 'stroke-width': 3 }),
    [0, 1, 2, 3].map((i) => line(104, 466 + i * 22, 236, 466 + i * 22, '#1c4a66', 2)),
    [0, 1, 2, 3, 4].map((i) => line(118 + i * 26, 452, 118 + i * 26, 548, '#1c4a66', 2)),
    circ(170, 530, 8, '#ffd23f'),
    // 선반
    rect(250, 430, 320, 14, '#5b4a3a'),
    rect(250, 530, 320, 14, '#5b4a3a'),
    [0, 1, 2, 3].map((i) => rect(266 + i * 76, 470, 60, 60, ['#3b82f6', '#22c55e', '#ef4444', '#facc15'][i], { rx: 6, opacity: 0.85 })),
    // 설계도 (내용은 확대 화면에서)
    rect(598, 186, 172, 176, '#2a63b8', { rx: 4, stroke: '#cfe0ff', 'stroke-width': 3 }),
    path('M620 220h60v50h60M620 300h40v-30M700 330h50', 'none', { stroke: '#cfe0ff', 'stroke-width': 3, opacity: 0.8 }),
    circ(720, 240, 14, 'none', { stroke: '#cfe0ff', 'stroke-width': 3, opacity: 0.8 }),
    // 전원 상자
    rect(796, 356, 116, 186, 'url(#gx-metal)', { rx: 8, stroke: '#46506d', 'stroke-width': 3 }),
    rect(796, 356, 116, 24, 'url(#gx-hazard)', { rx: 4 }),
    path('M812 542q-6 80 -60 120M832 542q10 90 -20 140M892 542q20 60 70 80', 'none', { stroke: '#e03c4b', 'stroke-width': 7 }),
    path('M852 542q6 70 40 110', 'none', { stroke: '#3b82f6', 'stroke-width': 7 }),
    circ(854, 470, 26, solved.includes(1) ? 'url(#gx-glowG)' : '#2b3249', { stroke: '#46506d', 'stroke-width': 4 }),
    gearRack(),
    elevator(solved.includes(3), st.open, st.letters || ['', '', '', '']),
  ];
  const mid = [
    robotArm(),
    workbench(),
    ell(1396, 852, 84, 18, '#5b3a2a'),
    at(1400, 850, 0.9, sparky(true)),
    at(700, 640, 0.8, g({ class: 'gm-float' }, pip('happy'))),
  ];
  const front = [
    rect(-500, 912, W + 1000, 58, '#2b2f3c'),
    rect(-500, 906, W + 1000, 12, '#4b5674'),
    Array.from({ length: 20 }, (_, i) => circ(-460 + i * 150, 942, 18, '#5b6276', { stroke: '#1a1d26', 'stroke-width': 4 })),
    rect(140, 832, 110, 80, '#c98a4b', { rx: 4, stroke: '#7a4c24', 'stroke-width': 4 }),
    rect(1100, 846, 90, 66, '#c98a4b', { rx: 4, stroke: '#7a4c24', 'stroke-width': 4 }),
    path(`M${W - 260} 0V160`, 'none', { stroke: '#2b2f3c', 'stroke-width': 10 }),
    path(`M${W - 260} 160q-30 0 -30 30q0 26 26 26`, 'none', { stroke: '#5b6276', 'stroke-width': 10 }),
  ];
  return {
    layers: { far, back, mid, front },
    hot: [
      { id: 'armscreen', layer: 'back', x: 80, y: 430, w: 180, h: 140 },
      { id: 'arm', layer: 'mid', x: 300, y: 380, w: 240, h: 420 },
      { id: 'blueprint', layer: 'back', x: 588, y: 176, w: 192, h: 196 },
      { id: 'powerbox', layer: 'back', x: 786, y: 346, w: 136, h: 206 },
      { id: 'note', layer: 'mid', x: 900, y: 520, w: 290, h: 160 },
      { id: 'gears', layer: 'back', x: 1176, y: 280, w: 160, h: 290 },
      { id: 'sparky', layer: 'mid', x: 1290, y: 730, w: 190, h: 150 },
      { id: 'liftpanel', layer: 'back', x: 1738, y: 410, w: 58, h: 140 },
      { id: 'door', layer: 'back', x: 1470, y: 168, w: 266, h: 594 },
    ],
    crystals: [
      { id: 'c1', layer: 'mid', x: 1180, y: 520 },
      { id: 'c2', layer: 'back', x: 540, y: 150 },
      { id: 'c3', layer: 'mid', x: 1500, y: 870 },
    ],
  };
}

/* ---------- 방 4: 관제실 ---------- */

export function room4(st) {
  const solved = st.solved || [];
  const far = [
    rect(-200, 0, W + 400, H, 'url(#gx-space)'),
    ...starfield(44, -200, W + 200, 0, H, 240),
    circ(1350, 250, 420, 'url(#gx-sun)', { class: 'gm-pulse' }),
    path('M1060 160q140 -80 300 -20M1100 330q170 60 330 -40', 'none', { stroke: '#ffd59a', 'stroke-width': 10, opacity: 0.4, 'stroke-linecap': 'round', class: 'gm-pulse' }),
    earth(520, 560, 300),
  ];
  const panes = [270, 1420];
  const back = [
    ...shell({ wall: 'gx-wall4', floor: 'gx-floor4', holes: [[panes[0], 112, panes[1] - panes[0], 360, 30]], seam: '#0b1230', step: 225, lit: 1, ceilLights: [] }),
    path(roundRectPath(panes[0], 112, panes[1] - panes[0], 360, 30), 'none', { stroke: '#8d99b8', 'stroke-width': 18 }),
    rect(650, 112, 20, 360, '#8d99b8'),
    rect(1030, 112, 20, 360, '#8d99b8'),
    rect(panes[0] - 20, 472, panes[1] - panes[0] + 40, 22, '#5c6784', { rx: 8 }),
    // 지구 메시지 화면 · 전력 표 · 카메라 전력판
    rect(566, 520, 200, 140, 'url(#gx-screen)', { rx: 10, stroke: '#3fd7ff', 'stroke-width': 3 }),
    text(666, 556, 'EARTH', { fill: '#7df9ff', 'font-size': 22 }),
    [0, 1, 2].map((i) => rect(590, 576 + i * 22, 150 - i * 30, 8, '#1c4a66', { rx: 4 })),
    rect(894, 520, 130, 140, '#e9eef7', { rx: 8, stroke: '#7d89a6', 'stroke-width': 3 }),
    [0, 1, 2].map((i) => rect(916 + i * 34, 620 - (i + 1) * 22, 22, (i + 1) * 22, '#9aa6c0')),
    rect(1040, 520, 132, 186, '#2b3249', { rx: 8, stroke: '#7d89a6', 'stroke-width': 3 }),
    [0, 1, 2].map((i) => g(null, rect(1062 + i * 36, 540, 10, 140, '#11152a', { rx: 5 }), rect(1054 + i * 36, 600, 26, 16, solved.includes(2) ? '#5dff9a' : '#c8d0e0', { rx: 4 }))),
    // 코어 룸 금고 문
    rect(1446, 180, 290, 582, '#0f1733', { rx: 20 }),
    circ(1591, 440, 150, st.open ? '#fff7d6' : 'url(#gx-metal)', { stroke: '#3a4260', 'stroke-width': 10 }),
    st.open ? glow(1591, 440, 220, 'Y') : g(
      null,
      [0, 1, 2, 3, 4, 5].map((i) => line(1591, 440, 1591 + 120 * Math.cos((i * Math.PI) / 3), 440 + 120 * Math.sin((i * Math.PI) / 3), '#5c6784', 10)),
      circ(1591, 440, 46, '#2b3249', { stroke: '#46506d', 'stroke-width': 6 }),
      s('polygon', { points: '1591,410 1612,440 1591,470 1570,440', fill: '#7df9ff', class: 'gm-twinkle' })
    ),
    letterSlots(1513, 640, st.letters || ['', '', '', '']),
    rect(1740, 380, 52, 140, '#071321', { rx: 8, stroke: '#3fd7ff', 'stroke-width': 2 }),
    text(1766, 440, solved.includes(3) ? 'OK' : '--', { fill: '#7df9ff', 'font-size': 20 }),
    text(1766, 470, ':--', { fill: '#3fd7ff', 'font-size': 16 }),
  ];
  const mid = [
    // 별 지도 탁자
    path('M200 520L300 520L360 640L140 640Z', 'url(#gx-holo)'),
    circ(220, 470, 18, '#ff8a5b', { class: 'gm-twinkle' }),
    circ(280, 450, 12, '#7df9ff'),
    circ(250, 500, 9, '#ffd23f'),
    ell(250, 648, 120, 28, '#2b3249', { stroke: '#7df9ff', 'stroke-width': 4 }),
    rect(226, 672, 48, 120, '#2b3249'),
    ell(250, 800, 80, 16, '#1a1f33'),
    // 보안 스캐너
    path('M392 820L398 640L556 640L562 820Z', 'url(#gx-dark)', { stroke: '#11152a', 'stroke-width': 4 }),
    rect(410, 650, 134, 60, 'url(#gx-screen)', { rx: 6, stroke: solved.includes(0) ? '#5dff9a' : '#3fd7ff', 'stroke-width': 2 }),
    path('M478 640v-40', 'none', { stroke: '#8d99b8', 'stroke-width': 8 }),
    path('M440 600a44 24 0 0 1 76 0z', '#c8d0e0', { stroke: '#7d89a6', 'stroke-width': 3 }),
    // 지구 무전 마이크
    rect(780, 720, 120, 100, 'url(#gx-dark)', { rx: 8 }),
    path('M840 720V650', 'none', { stroke: '#8d99b8', 'stroke-width': 6 }),
    rect(824, 612, 32, 52, '#2b3249', { rx: 16, stroke: '#8d99b8', 'stroke-width': 4 }),
    circ(840, 760, 10, solved.includes(1) ? '#5dff9a' : '#ff4d6d', { class: 'gm-blink' }),
    // 선장 의자 + 영상 기록
    path('M1210 560Q1290 520 1370 560L1360 740L1220 740Z', '#2f5bea', { stroke: '#1d3a9a', 'stroke-width': 5 }),
    rect(1200, 720, 180, 46, '#2547b8', { rx: 14 }),
    rect(1280, 766, 20, 70, '#3a4260'),
    ell(1290, 842, 70, 14, '#1a1f33'),
    rect(1376, 668, 46, 60, 'url(#gx-screen)', { rx: 6, stroke: '#ffd23f', 'stroke-width': 3 }),
    circ(1390, 680, 4, '#ff4d6d', { class: 'gm-blink' }),
    at(980, 330, 0.75, g({ class: 'gm-float' }, pip('worried'))),
  ];
  const front = [
    path(`M-500 1000V930Q900 890 ${W + 500} 930V1000Z`, '#1a2244'),
    Array.from({ length: 16 }, (_, i) => rect(-400 + i * 170, 948, 40, 14, ['#ff4d6d', '#5dff9a', '#ffd23f', '#3fd7ff'][i % 4], { rx: 7, class: i % 3 ? null : 'gm-blink' })),
    path('M-400 0Q-160 220 80 40', 'none', { stroke: '#0a0f22', 'stroke-width': 20, 'stroke-linecap': 'round' }),
  ];
  return {
    layers: { far, back, mid, front },
    hot: [
      { id: 'starmap', layer: 'mid', x: 120, y: 420, w: 260, h: 390 },
      { id: 'scanner', layer: 'mid', x: 386, y: 580, w: 182, h: 246 },
      { id: 'comms', layer: 'back', x: 556, y: 510, w: 220, h: 160 },
      { id: 'mic', layer: 'mid', x: 772, y: 600, w: 136, h: 226 },
      { id: 'chart', layer: 'back', x: 884, y: 510, w: 150, h: 160 },
      { id: 'switchboard', layer: 'back', x: 1030, y: 510, w: 152, h: 206 },
      { id: 'captainlog', layer: 'mid', x: 1196, y: 520, w: 236, h: 330 },
      { id: 'doorclock', layer: 'back', x: 1736, y: 370, w: 60, h: 160 },
      { id: 'door', layer: 'back', x: 1440, y: 280, w: 300, h: 420 },
    ],
    crystals: [
      { id: 'c1', layer: 'mid', x: 160, y: 860 },
      { id: 'c2', layer: 'back', x: 1400, y: 500 },
      { id: 'c3', layer: 'mid', x: 1236, y: 700 },
    ],
  };
}

/* ---------- 마지막: 코어 룸 ---------- */

export const FINALE_POS = { bolt: [360, 840], mira: [660, 840], zeek: [1180, 560], momo: [1450, 840] };

export function finale(st) {
  const restored = st.restored;
  const mood = (id) => (st.moods?.[id] ?? 'calm');
  const far = [rect(-200, 0, W + 400, H, 'url(#gx-space)'), ...starfield(55, -200, W + 200, 0, H, 200)];
  const back = [
    path(`M-500 0H${W + 500}V${FLOOR}H-500Z${roundRectPath(700, -200, 400, 340, 170)}`, 'url(#gx-wall5)', { 'fill-rule': 'evenodd' }),
    path(roundRectPath(700, -200, 400, 340, 170), 'none', { stroke: '#9b7bff', 'stroke-width': 14 }),
    [260, 420, 580].map((r, i) => ell(900, 560, r * 1.6, r * 0.5, 'none', { stroke: '#7a5cff', 'stroke-width': 4, opacity: 0.35 - i * 0.08 })),
    rect(140, 160, 70, 600, '#22174a', { rx: 16 }),
    rect(1590, 160, 70, 600, '#22174a', { rx: 16 }),
    rect(-500, FLOOR, W + 1000, H - FLOOR, 'url(#gx-floor4)'),
    ...floorLines('#000'),
    ell(900, 860, 200, 40, '#1c1440', { stroke: '#9b7bff', 'stroke-width': 5 }),
    path('M830 860L850 700L950 700L970 860Z', '#2b2050', { stroke: '#7a5cff', 'stroke-width': 4 }),
    ell(900, 700, 70, 18, restored ? '#9ffcff' : '#3b2d70', { stroke: '#b9a3ff', 'stroke-width': 4 }),
    restored
      ? g(
          null,
          glow(900, 610, 260, 'C', { class: 'gm-pulse' }),
          s('polygon', { points: '900,520 950,610 900,690 850,610', fill: 'url(#gx-core)', stroke: '#ffffff', 'stroke-width': 4 }),
          s('polygon', { points: '900,520 950,610 900,600', fill: '#ffffff', opacity: 0.55 })
        )
      : g(null, glow(900, 690, 90, 'P', { opacity: 0.5 }), text(900, 650, '?', { fill: '#b9a3ff', 'font-size': 70, class: 'gm-twinkle' })),
  ];
  const mid = [
    at(...FINALE_POS.bolt, 0.92, bolt(mood('bolt'))),
    at(...FINALE_POS.mira, 0.88, mira(mood('mira'))),
    at(FINALE_POS.zeek[0], FINALE_POS.zeek[1], 1.15, g({ class: 'gm-float' }, zeek(mood('zeek')))),
    rect(1394, 840, 112, 46, '#c98a4b', { rx: 6, stroke: '#7a4c24', 'stroke-width': 4 }),
    at(1450, 842, 1.1, momo(mood('momo'))),
    at(900, 380, 0.8, g({ class: 'gm-float' }, pip(restored ? 'happy' : 'worried'))),
  ];
  const front = [path(`M-500 1000V950Q900 900 ${W + 500} 950V1000Z`, '#120c26')];
  const label = (id, x, y) => g(null, rect(x - 70, y, 140, 34, '#0b0820', { rx: 17, opacity: 0.75 }), text(x, y + 24, id, { fill: '#ffffff', 'font-size': 22 }));
  mid.push(label('Bolt', 360, 870), label('Dr. Mira', 660, 870), label('Zeek', 1180, 680), label('Momo', 1450, 900));
  return {
    layers: { far, back, mid, front },
    hot: [
      { id: 'bolt', layer: 'mid', x: 240, y: 520, w: 240, h: 390 },
      { id: 'mira', layer: 'mid', x: 560, y: 520, w: 200, h: 390 },
      { id: 'zeek', layer: 'mid', x: 1060, y: 440, w: 240, h: 280 },
      { id: 'momo', layer: 'mid', x: 1350, y: 700, w: 200, h: 240 },
      { id: 'pedestal', layer: 'back', x: 800, y: 560, w: 200, h: 320 },
    ],
    crystals: [],
  };
}

export const ROOM_ART = [room1, room2, room3, room4];

/* ---------- 확대 화면 그림 (단서 내용) ---------- */

const SHAPE_PTS = {
  triangle: [
    [150, 40],
    [62, 182],
    [238, 182],
  ],
  square: [
    [84, 48],
    [216, 48],
    [216, 180],
    [84, 180],
  ],
  circle: Array.from({ length: 10 }, (_, i) => [150 + 72 * Math.cos((i / 10) * Math.PI * 2), 114 + 72 * Math.sin((i / 10) * Math.PI * 2)]),
  heart: Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    return [150 + 5 * 16 * Math.sin(t) ** 3, 108 - 5 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  }),
};

const PICTURE = {
  sunshine: () => g(null, glow(0, 0, 60, 'Y'), circ(0, 0, 26, '#ffd23f'), [0, 1, 2, 3, 4, 5, 6, 7].map((i) => line(0, -36, 0, -50, '#ffd23f', 6, { transform: `rotate(${i * 45})` }))),
  sunflower: () => g(null, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ell(0, -26, 10, 20, '#ffd23f', { transform: `rotate(${i * 45})` })), circ(0, 0, 18, '#7a4a1a')),
  rainbow: () => g(null, ['#ef4444', '#fb923c', '#facc15', '#22c55e', '#3b82f6', '#a855f7'].map((c, i) => path(`M${-50 + i * 7} 20a${50 - i * 7} ${50 - i * 7} 0 0 1 ${100 - i * 14} 0`, 'none', { stroke: c, 'stroke-width': 7 }))),
  moonlight: () => g(null, glow(0, 0, 60, 'W'), path('M10 -34a34 34 0 1 0 22 58a28 28 0 1 1 -22 -58z', '#fff3c4')),
  stardust: () => g(null, s('polygon', { points: starPoints(-12, -6, 26, 11), fill: '#ffd23f' }), s('polygon', { points: starPoints(26, 18, 13, 5), fill: '#fff6b0' }), circ(-30, 28, 3, '#fff'), circ(32, -26, 3, '#fff'), circ(4, 34, 2, '#fff')),
  rocket: () => g(null, path('M0 -46q26 24 18 64h-36q-8 -40 18 -64z', '#e9eef7', { stroke: '#7d89a6', 'stroke-width': 3 }), circ(0, -8, 9, '#3fd7ff'), path('M-18 10l-14 22h14zM18 10l14 22h-14z', '#e03c4b'), path('M-10 18q10 30 20 0', '#ff9a2e')),
  planet: () => g(null, circ(0, 0, 28, '#ffb46b'), ell(0, 0, 50, 10, 'none', { stroke: '#ffe2b0', 'stroke-width': 5, transform: 'rotate(-16)' })),
  comet: () => g(null, path('M20 -14L-46 30L-40 20L-50 12L14 -22z', '#bfe8ff', { opacity: 0.7 }), circ(22, -18, 13, '#ffffff')),
  orbit: () => g(null, ell(0, 0, 46, 20, 'none', { stroke: '#7df9ff', 'stroke-width': 4 }), circ(0, 0, 16, '#3b82f6'), circ(40, 10, 7, '#ffd23f')),
  meteor: () => g(null, path('M-6 -6L-50 -40', 'none', { stroke: '#ff9a2e', 'stroke-width': 12, 'stroke-linecap': 'round', opacity: 0.7 }), circ(4, 4, 18, '#8a6a5a', { stroke: '#5a4234', 'stroke-width': 3 })),
  galaxy: () => g(null, glow(0, 0, 50, 'P'), path('M0 0q20 -24 34 0q-4 30 -34 34q-36 -6 -38 -40q8 -38 46 -38', 'none', { stroke: '#d9c2ff', 'stroke-width': 5 }), circ(0, 0, 6, '#ffffff')),
};

export function fruitIcon(kind, size = 64) {
  return svg('-40 -40 80 80', { width: size, height: size, class: 'gm-ico' }, FRUIT_DRAW[kind](0, 0, kind === 'watermelon' ? 1.1 : 1.3));
}

const PLANET_DRAW = {
  earth: () => g(null, earth(0, 0, 30)),
  mars: () => g(null, circ(0, 0, 26, '#e0603a'), circ(-8, -6, 6, '#b84a2a'), circ(9, 8, 4, '#b84a2a')),
  jupiter: () => g(null, circ(0, 0, 34, '#e7c49a'), [-18, -6, 8, 20].map((y, i) => rect(-34, y, 68, 6, i % 2 ? '#c9935f' : '#d9a777', { opacity: 0.9 })), ell(12, 10, 8, 5, '#c0503a')),
  saturn: () => g(null, circ(0, 0, 24, '#f2d38f'), ell(0, 0, 44, 10, 'none', { stroke: '#e9c77a', 'stroke-width': 6, transform: 'rotate(-14)' })),
};
export function planetIcon(kind, size = 64) {
  return svg('-48 -48 96 96', { width: size, height: size, class: 'gm-ico' }, PLANET_DRAW[kind]());
}

export function shapeIcon(kind, size = 56, color = '#7df9ff') {
  const o = { fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linejoin': 'round' };
  const shapes = {
    circle: circ(0, 0, 26, 'none', o),
    triangle: s('polygon', { points: '0,-28 28,22 -28,22', ...o }),
    square: rect(-24, -24, 48, 48, 'none', o),
    heart: path('M0 26C-36 4 -30 -26 -10 -26C-2 -26 0 -18 0 -14C0 -18 2 -26 10 -26C30 -26 36 4 0 26Z', 'none', o),
    star: s('polygon', { points: starPoints(0, 0, 30, 13), ...o }),
  };
  return svg('-40 -40 80 80', { width: size, height: size, class: 'gm-ico' }, shapes[kind]);
}

/** id: 'big-red' 같은 형식. gray: 색을 숨긴다 */
export function gearIcon(id, { size = 72, gray = false } = {}) {
  const [sz, col] = id.split('-');
  const r = sz === 'big' ? 34 : 21;
  return svg('-40 -40 80 80', { width: size, height: size, class: 'gm-ico' }, path(gearPath(0, 0, r, sz === 'big' ? 12 : 9), gray ? '#8a8f9c' : hex(col), { stroke: '#00000066', 'stroke-width': 2.5 }), circ(0, 0, r * 0.32, '#1f2433'));
}

export function flowerIcon(color, size = 56) {
  const c = hex(color);
  return svg('-30 -34 60 64', { width: size, height: size, class: 'gm-ico' }, path('M-24 4Q-24 -30 0 -32Q24 -30 24 4Q12 -4 0 8Q-12 -4 -24 4Z', c, { stroke: '#00000033', 'stroke-width': 3 }), circ(0, 6, 6, '#fff6b0'), path('M0 12v18', 'none', { stroke: '#3c9a48', 'stroke-width': 5 }));
}

function fishShape(x, y, f, k = 1) {
  const c = hex(f.color);
  const flip = f.dir === 'left' ? -1 : 1;
  return g(
    { transform: `translate(${x} ${y}) scale(${flip * k} ${k})` },
    s('polygon', { points: '-22,0 -38,-14 -38,14', fill: c, opacity: 0.9 }),
    ell(0, 0, 26, 15, c, { stroke: '#ffffff55', 'stroke-width': 2 }),
    f.striped ? g(null, line(-6, -13, -6, 13, '#1d2433', 4, { opacity: 0.75 }), line(5, -14, 5, 14, '#1d2433', 4, { opacity: 0.75 })) : null,
    circ(13, -3, 4, '#ffffff'),
    circ(14, -3, 2, '#111')
  );
}

/** 확대 화면의 그림. 없으면 null (글만 보여 준다) */
export function closeup(art) {
  if (!art) return null;
  switch (art.type) {
    case 'dots':
      return svg('0 0 300 110', { class: 'gm-closeup' }, art.colors.map((c, i) => g(null, circ(55 + i * 95, 52, 38, hex(c), { stroke: '#ffffff', 'stroke-width': 5 }), text(55 + i * 95, 104, i + 1, { fill: '#9fb0cc', 'font-size': 16 }))));
    case 'radio':
      return svg(
        '0 0 300 140',
        { class: 'gm-closeup gm-radio' },
        rect(40, 18, 220, 110, 'url(#gx-metal)', { rx: 18, stroke: '#46506d', 'stroke-width': 4 }),
        circ(98, 73, 36, 'url(#gx-grille)', { stroke: '#2b3249', 'stroke-width': 4 }),
        rect(150, 40, 90, 46, '#062018', { rx: 6 }),
        s('polyline', { class: 'gm-wave', points: '156,63 166,50 176,76 186,46 196,74 206,56 216,70 226,60 234,63', fill: 'none', stroke: '#5dff9a', 'stroke-width': 3 }),
        line(240, 18, 262, 0, '#9aa6c0', 4)
      );
    case 'crates': {
      const items = [];
      const smalls = [...(art.small || [])];
      art.big.forEach((d, i) => {
        items.push({ d, big: true });
        if (i < art.big.length - 1 && smalls.length) items.push({ d: smalls.shift(), big: false });
      });
      let x = 10;
      const nodes = items.map((it) => {
        const sz = it.big ? 84 : 52;
        const y = 150 - sz;
        const node = g(null, rect(x, y, sz, sz, 'url(#gx-crate)', { rx: 6, stroke: '#6b4220', 'stroke-width': 4 }), text(x + sz / 2, y + sz * 0.7, it.d, { fill: '#3b2410', 'font-size': sz * 0.56 }));
        x += sz + 10;
        return node;
      });
      return svg(`0 0 ${x} 160`, { class: 'gm-closeup' }, nodes, line(0, 152, x, 152, '#5c6784', 4));
    }
    case 'stars': {
      const r = rngFor(art.shape.length * 7 + (art.lines ? 1 : 0), 'cl-stars');
      const dim = Array.from({ length: 46 }, () => circ((r() * 280 + 10).toFixed(0), (r() * 210 + 10).toFixed(0), 1.4 + r() * 1.4, '#cfe0ff', { opacity: (0.3 + r() * 0.4).toFixed(2) }));
      const pts = SHAPE_PTS[art.shape];
      return svg(
        '0 0 300 230',
        { class: 'gm-closeup' },
        rect(0, 0, 300, 230, 'url(#gx-space)', { rx: 26 }),
        dim,
        art.lines ? s('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#7df9ff', 'stroke-width': 3, opacity: 0.8 }) : null,
        pts.map(([x, y]) => g(null, glow(x, y, 16, 'W'), s('polygon', { points: starPoints(x, y, 8, 3.4), fill: '#fff7d6' }))),
        path(roundRectPath(4, 4, 292, 222, 24), 'none', { stroke: '#8d99b8', 'stroke-width': 8 })
      );
    }
    case 'switches':
      return svg(
        '0 0 330 170',
        { class: 'gm-closeup' },
        [0, 1, 2, 3].map((i) => {
          const x = 22 + i * 78;
          const st = art.pattern?.[i];
          return g(
            null,
            rect(x, 26, 64, 110, '#c8d0e0', { rx: 10, stroke: '#7d89a6', 'stroke-width': 3 }),
            rect(x + 20, 46, 24, 70, '#8a95ad', { rx: 8 }),
            st ? rect(x + 16, st === 'up' ? 44 : 84, 32, 32, '#ffffff', { rx: 8, stroke: '#46506d', 'stroke-width': 3 }) : null,
            art.arrows && st ? text(x + 32, st === 'up' ? 20 : 162, st === 'up' ? '▲' : '▼', { fill: st === 'up' ? '#5dff9a' : '#ffb020', 'font-size': 22 }) : null,
            text(x + 32, art.arrows ? 152 : 160, i + 1, { fill: '#9fb0cc', 'font-size': art.arrows ? 0 : 18 })
          );
        })
      );
    case 'fruit':
      return fruitIcon(art.fruit, 150);
    case 'fish': {
      const r = rngFor(art.fish.length * 31 + (art.statue ? 3 : 0), 'cl-fish');
      const slots = [];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) slots.push([62 + col * 80 + (row % 2) * 24, 88 + row * 50]);
      const used = slots.sort(() => r() - 0.5);
      return svg(
        '0 0 380 260',
        { class: 'gm-closeup' },
        ell(190, 150, 184, 106, '#9aa3b3', { stroke: '#6b7385', 'stroke-width': 6 }),
        ell(190, 146, 166, 92, 'url(#gx-water)'),
        art.statue ? g(null, rect(170, 160, 40, 60, '#7a808e', { rx: 6 }), fishShape(190, 150, { color: '#9aa0ad', dir: 'right' }, 1.1)) : null,
        art.fish.map((f, i) => fishShape(...(art.statue && Math.abs(used[i][0] - 190) < 50 && Math.abs(used[i][1] - 150) < 40 ? used[(i + 7) % used.length] : used[i]), f, 0.85))
      );
    }
    case 'notes':
      return svg(
        '0 0 330 120',
        { class: 'gm-closeup' },
        [0, 1, 2, 3, 4].map((i) => line(10, 24 + i * 18, 320, 24 + i * 18, '#c9b98f', 2)),
        (art.melody || [0, 1, 2, 3]).map((c, i) =>
          art.melody
            ? g({ transform: `translate(${60 + i * 72} 60)` }, path('M-26 6Q-26 -30 0 -32Q26 -30 26 6Q13 -2 0 10Q-13 -2 -26 6Z', hex(c), { stroke: '#00000044', 'stroke-width': 3 }), text(0, 50, i + 1, { fill: '#7a6a4a', 'font-size': 14 }))
            : g(null, ell(60 + i * 72, 78 - (i % 3) * 18, 16, 12, '#3b3020', { transform: `rotate(-20 ${60 + i * 72} ${78 - (i % 3) * 18})` }), line(74 + i * 72, 74 - (i % 3) * 18, 74 + i * 72, 18 - (i % 3) * 18, '#3b3020', 4))
        )
      );
    case 'word': {
      const letters = [...art.word];
      const tw = letters.length * 48;
      const pic = art.picture && PICTURE[art.picture];
      const h = pic ? 210 : 90;
      return svg(
        `0 0 ${Math.max(tw + 20, 200)} ${h}`,
        { class: 'gm-closeup' },
        pic ? g({ transform: `translate(${Math.max(tw + 20, 200) / 2} 62)` }, pic()) : null,
        letters.map((ch, i) =>
          g(
            null,
            rect(10 + i * 48 + (Math.max(tw + 20, 200) - tw - 20) / 2, h - 76, 42, 58, ch === '_' ? '#0b1a28' : '#fff7d6', { rx: 8, stroke: ch === '_' ? '#3fd7ff' : '#c9b98f', 'stroke-width': 3, 'stroke-dasharray': ch === '_' ? '6 5' : null }),
            text(31 + i * 48 + (Math.max(tw + 20, 200) - tw - 20) / 2, h - 32, ch === '_' ? '' : ch, { fill: '#2b2f3c', 'font-size': 36 })
          )
        )
      );
    }
    case 'arrows':
      return svg(
        '0 0 330 96',
        { class: 'gm-closeup' },
        art.moves.map((m, i) => g({ transform: `translate(${44 + i * 80} 48)` }, circ(0, 0, 34, '#0f2d44', { stroke: '#3fd7ff', 'stroke-width': 3 }), path('M0 -20L18 4H7V20H-7V4H-18Z', '#7df9ff', { transform: `rotate(${{ up: 0, right: 90, down: 180, left: 270 }[m]})` })))
      );
    case 'wiring': {
      const ys = [50, 110, 170];
      const cols = ['red', 'blue', 'yellow'];
      return svg(
        '0 0 320 220',
        { class: 'gm-closeup' },
        rect(0, 0, 320, 220, '#2a63b8', { rx: 14 }),
        cols.map((c, i) => g(null, rect(26, ys[i] - 16, 44, 32, hex(c), { rx: 8, stroke: '#ffffff', 'stroke-width': 3 }))),
        [1, 2, 3].map((n, i) => g(null, circ(276, ys[i], 22, '#e8f0ff', { stroke: '#ffffff', 'stroke-width': 3 }), text(276, ys[i] + 9, n, { fill: '#2a63b8', 'font-size': 24 }))),
        art.map ? cols.map((c, i) => path(`M70 ${ys[i]}C160 ${ys[i]} 160 ${ys[art.map[c] - 1]} 254 ${ys[art.map[c] - 1]}`, 'none', { stroke: hex(c), 'stroke-width': 8, 'stroke-linecap': 'round' })) : null
      );
    }
    case 'gear':
      return gearIcon(`${art.size}-${art.color}`, { size: 150 });
    case 'sparky':
      return svg('-150 -150 300 170', { class: 'gm-closeup gm-sparky' }, sparky(true));
    case 'planet':
      return planetIcon(art.planet, 150);
    case 'planets':
      return svg(
        '0 0 380 130',
        { class: 'gm-closeup' },
        ['earth', 'mars', 'jupiter', 'saturn'].map((p, i) => g({ transform: `translate(${50 + i * 94} 52)` }, PLANET_DRAW[p](), text(0, 66, p[0].toUpperCase() + p.slice(1), { fill: '#cfe0ff', 'font-size': 16 })))
      );
    case 'order':
      return svg(
        '0 0 400 130',
        { class: 'gm-closeup' },
        circ(-10, 60, 50, 'url(#gx-sun)'),
        PLANET_ORDER.map((p, i) =>
          g(null, circ(56 + i * 46, 56, [7, 10, 11, 9, 18, 15, 12, 12][i], ['#b9aa99', '#f2c98a', '#3f8fe0', '#e0603a', '#e7c49a', '#f2d38f', '#9fe8f0', '#4a6be0'][i]), text(56 + i * 46, 96, i + 1, { fill: '#ffd23f', 'font-size': 14 }), text(56 + i * 46, 116, p, { fill: '#cfe0ff', 'font-size': 10 }))
        )
      );
    case 'bars':
      return svg(
        '0 0 300 200',
        { class: 'gm-closeup' },
        rect(0, 0, 300, 200, '#e9eef7', { rx: 14 }),
        [1, 2, 3, 4, 5].map((v) => line(40, 170 - v * 28, 280, 170 - v * 28, '#c9d2e2', 2)),
        art.levels.map((v, i) => g(null, rect(64 + i * 78, 170 - v * 28, 48, v * 28, ['#3b82f6', '#22c55e', '#a855f7'][i], { rx: 6 }), art.numbers ? text(88 + i * 78, 160 - v * 28, v, { fill: '#2b2f3c', 'font-size': 24 }) : null, text(88 + i * 78, 192, `CAM ${i + 1}`, { fill: '#5d6475', 'font-size': 14 })))
      );
    case 'clock': {
      const ha = ((art.h % 12) + art.m / 60) * 30;
      const ma = art.m * 6;
      return svg(
        '0 0 320 170',
        { class: 'gm-closeup' },
        circ(84, 85, 72, '#fff7e6', { stroke: '#46506d', 'stroke-width': 7 }),
        Array.from({ length: 12 }, (_, i) => line(84, 22, 84, i % 3 ? 30 : 36, '#46506d', i % 3 ? 3 : 5, { transform: `rotate(${i * 30} 84 85)` })),
        line(84, 85, 84, 46, '#2b2f3c', 8, { transform: `rotate(${ha} 84 85)` }),
        line(84, 85, 84, 30, '#e03c4b', 5, { transform: `rotate(${ma} 84 85)` }),
        circ(84, 85, 6, '#2b2f3c'),
        rect(178, 52, 128, 66, '#071321', { rx: 12, stroke: '#3fd7ff', 'stroke-width': 3 }),
        text(242, 100, `${art.h}:${String(art.m).padStart(2, '0')}`, { fill: '#7df9ff', 'font-size': 38 })
      );
    }
    case 'captain':
      return svg('0 0 260 170', { class: 'gm-closeup' }, rect(0, 0, 260, 170, '#0f2d44', { rx: 14, stroke: '#ffd23f', 'stroke-width': 4 }), at(130, 96, 1, luna()), circ(26, 24, 7, '#ff4d6d', { class: 'gm-blink' }), text(58, 30, 'REC', { fill: '#ff9aa8', 'font-size': 16 }));
    default:
      return null;
  }
}

/** 이야기 창의 얼굴 */
export function portrait(who, mood) {
  const k = { pip: 0.62, bolt: 0.27, zeek: 0.62, mira: 0.25, momo: 0.6, luna: 0.62, nova: 0.6 }[who] ?? 0.6;
  const y = { pip: 50, bolt: 98, zeek: 50, mira: 100, momo: 84, luna: 50, nova: 50 }[who] ?? 50;
  let face;
  if (who === 'pip') face = pip(mood || 'talk');
  else if (who === 'luna') face = luna();
  else if (SUSPECT_ART[who]) face = SUSPECT_ART[who](mood);
  else if (who === 'narrator')
    face = g(
      null,
      circ(0, 0, 44, '#1b1448', { stroke: '#7a5cff', 'stroke-width': 4 }),
      s('polygon', { points: starPoints(0, -2, 26, 11), fill: '#ffd23f' }),
      circ(-24, 22, 3, '#ffffff'),
      circ(26, -24, 2.5, '#ffffff')
    );
  else
    face = g(
      null,
      rect(-46, -40, 92, 80, '#0b1a28', { rx: 14, stroke: '#3fd7ff', 'stroke-width': 4 }),
      text(0, 12, 'NOVA', { fill: '#7df9ff', 'font-size': 26 }),
      circ(0, -22, 6, '#ff4d6d', { class: 'gm-blink' })
    );
  return svg('0 0 100 100', { class: 'gm-face', 'aria-hidden': 'true' }, at(50, y, k, face));
}

/** 처음 화면 그림: 정거장과 핍 */
export function heroArt() {
  return svg(
    '0 0 600 300',
    { class: 'gm-hero-art', 'aria-hidden': 'true' },
    rect(0, 0, 600, 300, 'url(#gx-space)', { rx: 22 }),
    starfield(5, 0, 600, 0, 300, 90),
    earth(470, 330, 170),
    g(
      { transform: 'translate(250 130) rotate(-8)' },
      rect(-150, -10, 300, 20, '#9aa6c0', { rx: 10 }),
      rect(-190, -46, 60, 92, '#2f5bea', { rx: 6, stroke: '#9aa6c0', 'stroke-width': 4 }),
      rect(130, -46, 60, 92, '#2f5bea', { rx: 6, stroke: '#9aa6c0', 'stroke-width': 4 }),
      circ(0, 0, 54, 'url(#gx-steel)', { stroke: '#7d89a6', 'stroke-width': 5 }),
      circ(0, 0, 22, 'url(#gx-core)', { class: 'gm-pulse' }),
      rect(-14, -82, 28, 40, '#c8d0e0', { rx: 6 })
    ),
    at(470, 120, 0.9, g({ class: 'gm-float' }, pip('happy')))
  );
}

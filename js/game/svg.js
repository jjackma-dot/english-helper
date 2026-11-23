// SVG 요소 만들기 (게임 그림용). ui.js의 h()와 같은 모양: s('rect', {x, y, fill}, ...자식)
// 글자는 textContent로만 넣는다 (외부 데이터를 마크업으로 해석하지 않게).

const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, String(v));
    }
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.append(document.createTextNode(String(c)));
    else el.append(c);
  }
}

export const g = (attrs, ...kids) => s('g', attrs, ...kids);

/** 바깥 <svg> */
export function svg(viewBox, attrs = {}, ...kids) {
  return s('svg', { viewBox, xmlns: NS, preserveAspectRatio: 'xMidYMid meet', ...attrs }, ...kids);
}

/** 둥근 사각형 경로 (구멍 뚫기용: evenodd로 벽에서 창문을 뺀다) */
export function roundRectPath(x, y, w, h, r = 0) {
  const q = Math.min(r, w / 2, h / 2);
  return (
    `M${x + q} ${y}H${x + w - q}A${q} ${q} 0 0 1 ${x + w} ${y + q}V${y + h - q}A${q} ${q} 0 0 1 ${x + w - q} ${y + h}` +
    `H${x + q}A${q} ${q} 0 0 1 ${x} ${y + h - q}V${y + q}A${q} ${q} 0 0 1 ${x + q} ${y}Z`
  );
}

/** 별 모양 꼭짓점 (뾰족한 수 n) */
export function starPoints(cx, cy, r1, r2, n = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 톱니바퀴 경로 */
export function gearPath(cx, cy, r, teeth = 10, depth = 0.22) {
  const ro = r;
  const ri = r * (1 - depth);
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    const pts = [
      [ri, a0],
      [ro, a0 + step * 0.15],
      [ro, a0 + step * 0.45],
      [ri, a0 + step * 0.6],
    ];
    for (const [rr, a] of pts) {
      const x = (cx + rr * Math.cos(a)).toFixed(1);
      const y = (cy + rr * Math.sin(a)).toFixed(1);
      d += `${d ? 'L' : 'M'}${x} ${y}`;
    }
  }
  return `${d}Z`;
}

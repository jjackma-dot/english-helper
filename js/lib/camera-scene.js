// 카메라 실시간 번역의 장면 판단 (순수 함수, 단위 테스트 대상): 카메라 화면을 작은 흑백 그림으로 자주 재서,
// 휴대폰이 멈춰 있고(흔들리지 않음) 글자처럼 무늬가 있는 곳을 비추며, 마지막으로 보낸 장면과 달라졌을 때만 보낸다.
// 같은 글을 계속 비추거나 흔드는 동안·벽이나 바닥을 비출 때는 보내지 않아 무료 한도와 데이터를 아낀다.

export const SAMPLE_W = 64; // 장면을 잴 작은 그림 크기
export const SAMPLE_H = 48;
export const SAMPLE_MS = 200; // 이 간격으로 잰다
// 장면이 얼마나 다른지는 줄마다·칸마다의 평균 밝기를 뺀 뒤(글줄 간격이 같은 다른 글도 구별되게) 서로 얼마나
// 닮았는지(상관)로 잰다 (align). 크롬 카메라 화면(손떨림 ±5px·천천히 밀림·어두운 곳을 흉내 낸 메뉴판 영상)으로 잰 값:
// 같은 글 0.46 아래, 같은 메뉴판의 다른 곳 0.68 넘음, 빈 벽과 글 0.9 넘음.
// 움직임은 앞 그림과 가장 잘 맞는 자리가 얼마나 밀렸는지로 본다 (손떨림은 1칸 안, 휴대폰을 옮기면 2칸 넘음)
export const MOVE_RANGE = 3; // 앞 그림과 견줄 때 밀어 볼 칸 수
export const STILL_SHIFT = 1; // 이만큼까지 밀린 것은 손떨림 (작은 그림 1칸 = 실제 화면의 약 1.6%)
export const STILL_DIFF = 0.6; // 가장 잘 맞는 자리에서도 이보다 다르면 흔들려 번졌거나 다른 곳으로 옮겼다
export const STEADY_MS = 600; // 이만큼 멈춰 있어야 보낸다 (흔들려 번진 그림을 보내지 않게)
export const CHANGE_DIFF = 0.57; // 마지막으로 보낸 장면과 이보다 더 달라야 새 장면이다
export const CHANGE_SHIFT = 3; // 같은 글에서 조금 밀린 것(작은 그림 3칸 = 실제 화면의 약 5%)은 같은 장면으로 본다
export const MIN_DETAIL = 0.01; // 또렷한 경계가 이 비율보다 적으면 글자가 없는 곳(벽·바닥·어두운 곳)으로 본다
export const EDGE_STEP = 12; // 이웃 화소와 이만큼 넘게 밝기가 다르면 경계
export const MIN_GAP_MS = 4000; // 보내는 간격의 최소 (무료 등급 분당 요청 한도 안에서)

/** RGBA 화소 → 밝기(0~255) */
export function toGray(rgba) {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return out;
}

/** 흑백 그림(w×h)을 가로·세로 반으로 줄인다 (2×2 화소의 평균: 카메라 잡음과 손떨림으로 생기는 깜박임을 줄인다) */
export function halve(gray, w, h) {
  const ow = Math.floor(w / 2);
  const oh = Math.floor(h / 2);
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * ow + x] = (gray[i] + gray[i + 1] + gray[i + w] + gray[i + w + 1] + 2) >> 2;
    }
  }
  return out;
}

/**
 * 줄마다·칸마다의 평균 밝기를 뺀다. 글줄의 가로 줄무늬(줄 간격이 같은 다른 글도 비슷하다)와 그림자·밝기 차이는 지우고
 * 낱말이 놓인 자리만 남겨 견준다 (상관은 진하기와 상관없다)
 */
function centered(g, w, h) {
  const row = new Float32Array(h);
  const col = new Float32Array(w);
  let all = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x];
      row[y] += v;
      col[x] += v;
      all += v;
    }
  }
  for (let y = 0; y < h; y++) row[y] /= w;
  for (let x = 0; x < w; x++) col[x] /= h;
  all /= w * h;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g[y * w + x] - row[y] - col[x] + all;
  return out;
}

/**
 * 두 흑백 그림(w×h)을 가로·세로 shift칸까지 밀어 가며 가장 잘 맞는 자리를 찾는다.
 * 그림마다 밝기·진하기를 맞춘 뒤 서로 얼마나 닮았는지(상관)로 견주므로, 카메라가 밝기를 저절로 맞추거나 어두운 곳에서
 * 흐릿해진 것은 차이로 보지 않고, 종이 위에 드문드문 있는 글자도 자리가 다르면 다르다고 본다.
 * diff: 1 − 그 자리의 상관 (같은 무늬 0, 서로 상관없는 무늬 1 안팎, 한 가지 색이면 1). dx·dy: a의 (x, y)가 b에서는 (x+dx, y+dy)에 있다
 * @returns {{diff: number, dx: number, dy: number}}
 */
export function align(a, b, { w = SAMPLE_W, h = SAMPLE_H, shift = 0 } = {}) {
  if (!a || !b || a.length !== b.length || a.length < w * h || w <= 2 * shift || h <= 2 * shift)
    return { diff: Infinity, dx: 0, dy: 0 };
  const za = centered(a, w, h);
  const zb = centered(b, w, h);
  let aa = 0; // a의 가운데(견주는 곳)는 어느 자리에서나 같다
  for (let y = shift; y < h - shift; y++) for (let x = shift; x < w - shift; x++) aa += za[y * w + x] ** 2;
  let best = { r: -Infinity, dx: 0, dy: 0 };
  for (let dy = -shift; dy <= shift; dy++) {
    for (let dx = -shift; dx <= shift; dx++) {
      let ab = 0;
      let bb = 0;
      for (let y = shift; y < h - shift; y++) {
        const ra = y * w;
        const rb = (y + dy) * w + dx;
        for (let x = shift; x < w - shift; x++) {
          const v = zb[rb + x];
          ab += za[ra + x] * v;
          bb += v * v;
        }
      }
      const r = ab / Math.sqrt(Math.max(aa * bb, 1e-9));
      // 같으면 덜 밀린 자리 (흔들림 없는 그림을 움직였다고 보지 않게)
      if (r > best.r || (r === best.r && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy)))
        best = { r, dx, dy };
    }
  }
  return { diff: 1 - best.r, dx: best.dx, dy: best.dy };
}

/** 두 그림이 얼마나 다른지 (align의 diff): shift칸까지 밀린 같은 글은 같다고 본다 */
export function frameDiff(a, b, o) {
  return align(a, b, o).diff;
}

/** 또렷한 경계(글자 획 등)가 있는 화소의 비율 (0~1). 가로·세로 이웃과 견준다 */
export function detail(gray, w = SAMPLE_W, h = SAMPLE_H) {
  if (!gray || gray.length < w * h || w < 2 || h < 2) return 0;
  let edges = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(gray[i] - gray[i + 1]) > EDGE_STEP || Math.abs(gray[i] - gray[i + w]) > EDGE_STEP) edges++;
    }
  }
  return edges / ((w - 1) * (h - 1));
}

/**
 * 장면 지켜보기. 잴 때마다 push로 그림을 넣으면 지금 보낼지 알려 준다.
 * @returns {{push: (gray: Uint8Array, now: number) => 'moving'|'blank'|'same'|'wait'|'ready',
 *   sent: (gray: Uint8Array, now: number) => void, done: () => void, forget: () => void, readonly busy: boolean}}
 *   push: moving 흔들리는 중 / blank 글자가 없어 보임 / same 보낸 장면 그대로 / wait 보내는 중이거나 너무 이름 / ready 보낼 때,
 *   sent: 이 그림을 보냈다 (답이 올 때까지 busy), done: 답이 왔다 (실패도),
 *   forget: 보낸 장면을 잊는다 (지금 비추는 것을 다시 보낼 수 있게: 다시 시도·카메라를 다시 켬)
 */
export function createSceneWatch({
  stillDiff = STILL_DIFF,
  stillShift = STILL_SHIFT,
  moveRange = MOVE_RANGE,
  steadyMs = STEADY_MS,
  changeDiff = CHANGE_DIFF,
  changeShift = CHANGE_SHIFT,
  minDetail = MIN_DETAIL,
  minGapMs = MIN_GAP_MS,
  w = SAMPLE_W,
  h = SAMPLE_H,
} = {}) {
  let prev = null;
  let stillSince = 0;
  let last = null; // 마지막으로 보낸 장면
  let lastAt = -Infinity;
  let busy = false;

  return {
    get busy() {
      return busy;
    },
    push(gray, now) {
      const m = prev ? align(prev, gray, { w, h, shift: moveRange }) : null;
      if (!m || m.diff > stillDiff || Math.max(Math.abs(m.dx), Math.abs(m.dy)) > stillShift) stillSince = now;
      prev = gray;
      // 글자가 없으면 움직임도 잴 수 없다 (잡음뿐인 그림은 서로 닮지 않는다)
      if (detail(gray, w, h) < minDetail) return 'blank';
      if (now - stillSince < steadyMs) return 'moving';
      if (last && frameDiff(gray, last, { w, h, shift: changeShift }) < changeDiff) return 'same';
      if (busy || now - lastAt < minGapMs) return 'wait';
      return 'ready';
    },
    sent(gray, now) {
      last = gray;
      lastAt = now;
      busy = true;
    },
    done() {
      busy = false;
    },
    forget() {
      last = null;
    },
  };
}

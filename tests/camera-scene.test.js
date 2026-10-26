// js/lib/camera-scene.js: 카메라 실시간 번역에서 언제 장면을 보낼지 (멈춤·글자 있음·새 장면·간격)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_DIFF,
  MIN_GAP_MS,
  SAMPLE_H,
  SAMPLE_MS,
  SAMPLE_W,
  STEADY_MS,
  STILL_DIFF,
  align,
  createSceneWatch,
  detail,
  frameDiff,
  halve,
  toGray,
} from '../js/lib/camera-scene.js';

const W = SAMPLE_W;
const H = SAMPLE_H;

/** 같은 seed면 같은 수열 */
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * 종이 위 글줄 (seed마다 낱말 길이·자리가 다른 메뉴판), 크게 그려 둔 뒤 (ox, oy)만큼 밀어 W×H로 잘라 낸다.
 * contrast·bright: 어두운 곳에서 흐릿하게
 */
function page(seed, { ox = 0, oy = 0, contrast = 1, bright = 0 } = {}) {
  const PW = W + 16;
  const PH = H + 16;
  const big = new Float32Array(PW * PH).fill(225);
  const r = rand(seed);
  for (let y = 2; y < PH - 3; y += 5) {
    let x = 1 + Math.floor(r() * 4);
    while (x < PW - 2) {
      const len = 2 + Math.floor(r() * 9);
      for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < Math.min(PW, x + len); xx++) big[yy * PW + xx] = 45;
      x += len + 2 + Math.floor(r() * 3);
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = big[(y + 8 + oy) * PW + (x + 8 + ox)];
      out[y * W + x] = Math.max(0, Math.min(255, Math.round((v - 128) * contrast + 128 + bright)));
    }
  }
  return out;
}
const flat = (v = 128) => new Uint8Array(W * H).fill(v);
/** 카메라 잡음 (호출마다 다르게) */
let noiseSeed = 1;
const noisy = (g, amp = 3) => {
  const r = rand(++noiseSeed);
  return g.map((v) => Math.max(0, Math.min(255, Math.round(v + (r() * 2 - 1) * amp))));
};

test('toGray: RGBA를 밝기로 (흰색 255·검정 0·초록이 가장 밝다), halve: 2×2 평균으로 반씩 줄인다', () => {
  const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  assert.deepEqual([...g], [255, 0, 149, 28]);
  assert.deepEqual([...halve(Uint8Array.from([0, 4, 8, 8, 2, 6, 8, 8]), 4, 2)], [3, 8]);
});

test('frameDiff: 같은 글은 0에 가깝고, 어둡고 흐릿해져도 같은 글이며, 다른 글·빈 벽은 크다', () => {
  const a = page(1);
  assert.ok(frameDiff(a, a) < 1e-9);
  assert.ok(frameDiff(a, noisy(a)) < 0.05, '카메라 잡음');
  assert.ok(frameDiff(a, page(1, { contrast: 0.3, bright: -60 }), { shift: 3 }) < 0.1, '어두운 곳의 같은 글');
  assert.ok(frameDiff(a, page(2), { shift: 3 }) > CHANGE_DIFF, '다른 글');
  assert.ok(frameDiff(a, noisy(flat(190)), { shift: 3 }) > CHANGE_DIFF, '빈 벽');
  assert.equal(frameDiff(a, new Uint8Array(3)), Infinity, '크기가 다르면 견줄 수 없다');
});

test('align: 조금 밀린 같은 글은 그만큼 밀린 자리에서 맞고, 밀어 볼 칸보다 더 밀리면 다르다', () => {
  const a = page(3);
  const r = align(a, page(3, { ox: 2, oy: -1 }), { shift: 3 }); // b(x, y) = a(x + 2, y − 1)
  assert.deepEqual({ dx: r.dx, dy: r.dy }, { dx: -2, dy: 1 });
  assert.ok(r.diff < 0.15);
  assert.deepEqual(
    { dx: align(a, noisy(a), { shift: 3 }).dx, dy: align(a, noisy(a), { shift: 3 }).dy },
    { dx: 0, dy: 0 },
    '그대로면 밀리지 않았다'
  );
  const far = align(a, page(3, { oy: 7 }), { shift: 3 });
  assert.ok(far.diff > STILL_DIFF || Math.abs(far.dy) === 3, '더 밀리면 맞는 자리를 못 찾는다 (끝 칸이거나 다르다)');
});

test('detail: 글줄은 경계가 많고, 벽·어두운 곳은 거의 없다', () => {
  assert.ok(detail(page(1)) > 0.1);
  assert.equal(detail(flat()), 0);
  assert.ok(detail(noisy(flat(30))) < 0.01);
});

/** 장면을 ms 동안 SAMPLE_MS마다 넣고 마지막 판단을 돌려준다 (make: 잴 때마다 그림, 손떨림을 넣을 수 있다) */
function hold(watch, make, ms, clock) {
  let s;
  let i = 0;
  for (let t = 0; t <= ms; t += SAMPLE_MS) s = watch.push(noisy(make(i++)), (clock.now += SAMPLE_MS));
  return s;
}
/** 손에 들고 멈춤: 1칸 안에서 떨린다 */
const shaky =
  (seed, more = {}) =>
  (i) =>
    page(seed, { ox: i % 2, oy: (i >> 1) % 2, ...more });

test('손에 들고 멈춰서 글자를 비추면 STEADY_MS 뒤에 보내고, 같은 글은 다시 보내지 않는다', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  assert.equal(w.push(page(1), clock.now), 'moving', '처음 그림');
  assert.equal(hold(w, shaky(1), STEADY_MS - 2 * SAMPLE_MS, clock), 'moving', '아직 덜 멈췄다');
  assert.equal(hold(w, shaky(1), 2 * SAMPLE_MS, clock), 'ready');
  w.sent(page(1), clock.now);
  assert.equal(w.busy, true);
  assert.equal(hold(w, shaky(1), 1000, clock), 'same', '보내는 중에도 같은 장면');
  w.done();
  assert.equal(hold(w, shaky(1), MIN_GAP_MS * 3, clock), 'same', '같은 글을 오래 비춰도 다시 보내지 않는다');
  assert.equal(
    hold(w, (i) => page(1, { ox: 3, oy: 2, contrast: 0.5 }), STEADY_MS, clock),
    'same',
    '조금 밀리고 그늘져도 같은 글'
  );
});

test('휴대폰을 옮기는 동안(한 번에 2칸 넘게 밀림)은 보내지 않는다', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  const pan = (i) => page(4, { oy: -6 + ((i * 3) % 13) });
  for (let i = 0; i < 4; i++) assert.equal(hold(w, pan, STEADY_MS * 2, clock), 'moving');
  for (let i = 0; i < 10; i++)
    assert.equal(w.push(page(10 + i), (clock.now += SAMPLE_MS)), 'moving', '다른 곳으로 휙휙');
});

test('새 글에 멈추면 간격(MIN_GAP_MS)을 지킨 뒤 보낸다', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  hold(w, shaky(1), STEADY_MS, clock);
  w.sent(page(1), clock.now);
  w.done();
  const sentAt = clock.now;
  const s = hold(w, shaky(30), STEADY_MS, clock);
  assert.ok(clock.now - sentAt < MIN_GAP_MS);
  assert.equal(s, 'wait', '앞 장면을 보낸 지 얼마 안 됐다');
  assert.equal(hold(w, shaky(30), MIN_GAP_MS, clock), 'ready');
});

test('답을 기다리는 동안은 새 장면이라도 보내지 않는다 (wait), 답이 오면 보낸다', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  hold(w, shaky(1), STEADY_MS, clock);
  w.sent(page(1), clock.now);
  assert.equal(hold(w, shaky(5), MIN_GAP_MS + STEADY_MS, clock), 'wait');
  w.done();
  assert.equal(w.push(noisy(page(5)), (clock.now += SAMPLE_MS)), 'ready');
});

test('글자가 없는 곳(벽·바닥·어두운 곳)은 보내지 않는다', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  assert.equal(
    hold(w, () => flat(200), STEADY_MS * 3, clock),
    'blank'
  );
  assert.equal(
    hold(w, () => flat(5), STEADY_MS * 3, clock),
    'blank'
  );
});

test('forget: 보낸 장면을 잊으면 같은 장면도 다시 보낸다 (다시 시도)', () => {
  const w = createSceneWatch();
  const clock = { now: 0 };
  hold(w, shaky(1), STEADY_MS, clock);
  w.sent(page(1), clock.now);
  w.done();
  assert.equal(hold(w, shaky(1), MIN_GAP_MS, clock), 'same');
  w.forget();
  assert.equal(w.push(noisy(page(1)), (clock.now += SAMPLE_MS)), 'ready');
});

// 번역 탭 "카메라" 흐름을 가짜 카메라·캔버스·Gemini로 시험한다: 켜기 → 멈춰서 글자를 비추면 보내기 → 받는 대로 그리기,
// 같은 장면·흔들림·빈 곳은 보내지 않기, 결과를 읽는 동안 멈춤, 실패·다시 시도, 손전등, 앱을 벗어나면 끄고 돌아오면 다시 켜기,
// 다른 방식으로 가면 끄기, 자세히(사진 번역으로), 많이 보내면 멈춤, 오래 쓰지 않으면 끄기, 권한 거부·카메라 끊김, 키가 없을 때
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installEnv, mount, button, segment, descendants, text, tick, until } from './platform-env.js';

/* ---------- 가짜 카메라 ---------- */

// 지금 카메라가 비추는 것: 'textN'(글자, N마다 다른 글), 'blank'(빈 벽), 'shake'(흔드는 중: 잴 때마다 다름)
const cam = { scene: 'text1', calls: [], tracks: [], fail: null, torch: true, torchCalls: [] };
let shakes = 0;

class VideoTrack extends EventTarget {
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
  getCapabilities() {
    return cam.torch ? { torch: true } : {};
  }
  async applyConstraints(c) {
    cam.torchCalls.push(c);
  }
}
const liveTracks = () => cam.tracks.filter((t) => t.readyState === 'live').length;

const env = installEnv({
  userAgent: 'Mozilla/5.0 (Linux; Android 16)',
  microphone: false,
  settings: { geminiKey: 'k' },
  navigator: {
    mediaDevices: {
      getUserMedia: async (c) => {
        cam.calls.push(c);
        await tick();
        if (cam.fail) throw cam.fail;
        const t = new VideoTrack();
        cam.tracks.push(t);
        return { getVideoTracks: () => [t], getTracks: () => [t] };
      },
    },
  },
});

// <video>: 카메라 스트림을 받으면 1920×1080 그림이 나온다
Object.defineProperties(FakeElement.prototype, {
  videoWidth: { get: () => 0, configurable: true },
});
Object.defineProperty(FakeElement.prototype, 'videoWidth', {
  get() {
    return this.srcObject ? 1920 : 0;
  },
});
Object.defineProperty(FakeElement.prototype, 'videoHeight', {
  get() {
    return this.srcObject ? 1080 : 0;
  },
});
FakeElement.prototype.play = function () {
  this.playing = true;
  return Promise.resolve();
};
FakeElement.prototype.pause = function () {
  this.playing = false;
};

/** 같은 seed면 같은 수열 */
function rand(seed) {
  let x = seed >>> 0 || 1;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** 장면의 작은 그림 (RGBA): 글자는 종이 위 글줄(번호마다 낱말 자리가 다르다), 빈 벽은 한 가지 색, 흔들면 잴 때마다 다른 글 */
function pixels(scene, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const ink = new Uint8Array(w * h);
  if (scene !== 'blank') {
    const r = rand(scene === 'shake' ? 7000 + ++shakes : Number(scene.replace(/\D/g, '')) + 1);
    const row = Math.max(4, Math.round(h / 10));
    for (let y = 2; y < h - row / 2; y += row) {
      let x = 1 + Math.floor(r() * 4);
      while (x < w - 2) {
        const len = 3 + Math.floor(r() * (w / 6));
        for (let yy = y; yy < y + row / 2; yy++) for (let xx = x; xx < Math.min(w, x + len); xx++) ink[yy * w + xx] = 1;
        x += len + 3 + Math.floor(r() * 4);
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = scene === 'blank' ? 190 : ink[i] ? 45 : 225;
    out.set([v, v, v, 255], i * 4);
  }
  return out;
}

const encodes = [];
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      drawImage: () => {},
      fillRect: () => {},
      getImageData: (_x, _y, w, h) => ({ data: pixels(cam.scene, w, h) }),
    };
  }
  async convertToBlob(opts) {
    encodes.push(opts);
    return new Blob([`JPEG${this.width}x${this.height}:${cam.scene}`], { type: opts.type });
  }
};
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = `data:${blob.type};base64,${Buffer.from(ab).toString('base64')}`;
      this.onload();
    });
  }
};
// "자세히"로 사진 번역에 넘긴 장면을 여는 데 쓴다
globalThis.createImageBitmap = async (_f, o) => ({
  width: o?.resizeWidth ?? 1280,
  height: o?.resizeHeight ?? 720,
  close() {},
});
const urlBlobs = new Map();
URL.createObjectURL = (b) => {
  const u = `blob:${urlBlobs.size}`;
  urlBlobs.set(u, b);
  return u;
};
URL.revokeObjectURL = (u) => urlBlobs.delete(u);
globalThis.Image = class {
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_u) {
    setTimeout(() => {
      [this.naturalWidth, this.naturalHeight] = [1280, 720];
      this.onload?.();
    }, 0);
  }
};

/* ---------- 가짜 Gemini: 받은 장면 이름으로 답한다 ('text9'는 글자 없음) ---------- */

const enc = new TextEncoder();
const sse = (obj) =>
  new Response(
    new ReadableStream({
      start(c) {
        const s = JSON.stringify(obj);
        const cut = Math.floor(s.length / 2);
        for (const [t, fin] of [
          [s.slice(0, cut), undefined],
          [s.slice(cut), 'STOP'],
        ]) {
          c.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: fin }] })}\n\n`
            )
          );
        }
        c.close();
      },
    })
  );
const requests = []; // {scene, size, schema}
let fail = null;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const img = body.contents[0].parts.find((p) => p.inlineData);
  const [, size, scene] =
    Buffer.from(img.inlineData.data, 'base64')
      .toString()
      .match(/^JPEG(\d+x\d+)(?::(\w+))?/) ?? [];
  const schema = Object.keys(body.generationConfig.responseSchema.properties);
  requests.push({ scene, size, schema });
  if (fail) return fail();
  if (schema.includes('noteKo'))
    return sse({
      noteKo: '메뉴판',
      blocks: [{ lang: 'en', text: `Menu ${scene}`, translation: `메뉴 ${scene}` }],
      phrases: [],
      sourceLang: 'en',
    });
  if (scene === 'text9') return sse({ blocks: [] });
  return sse({ blocks: [{ lang: 'en', text: `Menu ${scene}`, translation: `메뉴 ${scene}` }] });
};

/* ---------- 시계: 장면 재기(setInterval)와 Date만 가짜로 (나머지 기다림은 진짜) ---------- */

mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
const SAMPLE = 200;
async function advance(ms) {
  for (let t = 0; t < ms; t += SAMPLE) {
    mock.timers.tick(SAMPLE);
    await tick();
  }
}

/* ---------- 화면 ---------- */

const translate = await import('../js/views/translate.js');
const { updateSettings } = await import('../js/store.js');
const view = mount(translate, env.body);
translate.show(new URLSearchParams());

const els = () => descendants(view);
const byClass = (c) => els().filter((e) => e.classList.contains(c));
const visible = (el) => {
  for (let n = el; n; n = n.parentNode) if (n.hidden) return false;
  return Boolean(el);
};
const video = () => byClass('camera-video')[0];
const status = () => byClass('camera-status')[0].textContent;
const results = () => byClass('camera-out')[0];
const resultText = () => text(results());
const startBtn = () => button(view, '카메라 켜기');

async function turnOn() {
  startBtn().click();
  await until(() => video().srcObject, '카메라가 켜진다');
}
/** 지금 장면을 멈춰서 비추고 보낼 때까지 기다린다 */
async function aim(scene, ms = 1000) {
  cam.scene = scene;
  await advance(ms);
}
async function answered(n) {
  await until(() => requests.length === n, `요청 ${n}번`);
  for (let i = 0; i < 50 && status() === '글자를 읽는 중…'; i++) await advance(SAMPLE); // 다음에 잴 때 바뀐다
  assert.notEqual(status(), '글자를 읽는 중…', '답을 받았다');
}

test('번역 방식은 카메라 > 사진 > 텍스트 > 실시간 통역 > 녹음 순이고, 처음에는 카메라를 고른 채 켜기 버튼만 보인다', () => {
  assert.deepEqual(
    els()
      .filter((e) => e.tagName === 'BUTTON' && e.dataset.value)
      .map((e) => e.textContent),
    ['카메라', '사진', '텍스트', '실시간 통역', '녹음']
  );
  assert.equal(segment(view, '카메라').getAttribute('aria-pressed'), 'true');
  assert.ok(visible(startBtn()));
  assert.equal(visible(byClass('camera-card')[0]), false);
  assert.equal(cam.calls.length, 0, '누르기 전에는 카메라를 열지 않는다');
});

test('켜면 뒤 카메라를 소리 없이 열고, 멈춰서 글자를 비추면 그 장면을 줄여 보내 받는 대로 보여 준다', async () => {
  await turnOn();
  assert.deepEqual(cam.calls[0], {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  assert.ok(visible(byClass('camera-card')[0]));
  assert.equal(visible(startBtn()), false);
  assert.equal(video().getAttribute('playsinline'), '', '아이폰에서 전체 화면으로 열리지 않게');
  assert.equal(video().muted, true);

  await aim('text1');
  await answered(1);
  assert.deepEqual(
    requests[0],
    { scene: 'text1', size: '1280x720', schema: ['blocks'] },
    '긴 변 1280px, 블록만 받는다'
  );
  assert.deepEqual(encodes.at(-1), { type: 'image/jpeg', quality: 0.8 });
  assert.match(resultText(), /Menu text1.*메뉴 text1/);
  assert.ok(button(view, '이 장면 자세히 보기'));
});

test('같은 글을 계속 비추면 다시 보내지 않고, 흔드는 동안·빈 곳도 보내지 않는다', async () => {
  await aim('text1', 10000);
  assert.equal(requests.length, 1);
  assert.equal(status(), '다른 글을 비추면 이어서 번역해요');
  await aim('shake', 3000);
  assert.equal(status(), '휴대폰을 잠깐 멈춰 주세요');
  await aim('blank', 3000);
  assert.equal(status(), '글자를 비춰 주세요');
  assert.equal(requests.length, 1);
});

test('새 글에 멈추면 보내고 결과를 바꾸며, 글자를 못 찾은 장면은 앞 번역을 흐리게 남긴다', async () => {
  await aim('text2');
  await answered(2);
  assert.match(resultText(), /메뉴 text2/);
  assert.doesNotMatch(resultText(), /text1/);

  await aim('text9', 5000);
  await answered(3);
  assert.match(resultText(), /이번 장면에서는 글자를 찾지 못했어요/);
  assert.match(resultText(), /메뉴 text2/);
  assert.ok(byClass('live-list')[0].classList.contains('stale'));
});

test('결과를 누르면(읽는 중) 멈춰서 보내지 않고, 화면을 누르면 이어 간다', async () => {
  results().dispatchEvent(new Event('pointerdown'));
  assert.equal(status(), '번역을 멈췄어요 · 화면을 누르면 이어 가요');
  assert.equal(video().playing, false, '화면을 그 장면에 세운다');
  assert.ok(button(view, '계속'));
  await aim('text3', 6000);
  assert.equal(requests.length, 3);

  byClass('camera-frame')[0].click();
  assert.equal(video().playing, true);
  await advance(1000);
  await answered(4);
  assert.match(resultText(), /메뉴 text3/);
});

test('화면을 누르면 같은 장면도 기다리지 않고 바로 다시 읽는다', async () => {
  byClass('camera-frame')[0].click();
  await answered(5);
  assert.equal(requests.at(-1).scene, 'text3');
});

test('카메라 칸에 꽉 채워 보이는 부분(가운데)만 보낸다', async () => {
  const box = byClass('camera-frame')[0];
  Object.assign(box, { clientWidth: 360, clientHeight: 360 });
  box.click();
  await answered(6);
  assert.equal(requests.at(-1).size, '1080x1080', '1920×1080의 가운데 1080×1080 (긴 변이 1280px보다 짧아 그대로)');
  Object.assign(box, { clientWidth: 0, clientHeight: 0 });
});

test('실패하면 멈추고 알리며, 다시 시도하면 같은 장면을 다시 보낸다', async () => {
  fail = () => new Response(JSON.stringify({ error: { code: 403, message: 'denied' } }), { status: 403 });
  await aim('text4', 5000);
  await until(() => button(view, '다시 시도'), '실패 안내');
  assert.equal(status(), '번역을 멈췄어요 · 화면을 누르면 이어 가요');
  const n = requests.length;
  await advance(5000);
  assert.equal(requests.length, n, '멈춘 동안은 보내지 않는다');

  fail = null;
  button(view, '다시 시도').click();
  await advance(1000);
  await until(() => resultText().includes('메뉴 text4'), '같은 장면을 다시 보낸다');
  assert.equal(requests.at(-1).scene, 'text4');
  assert.equal(button(view, '다시 시도'), undefined);
});

test('손전등: 켤 수 있는 카메라면 버튼이 있고, 누르면 켜고 다시 누르면 끈다', async () => {
  const torch = button(view, '손전등');
  assert.ok(visible(torch));
  torch.click();
  await until(() => torch.classList.contains('on'), '켜짐');
  assert.deepEqual(cam.torchCalls.at(-1), { advanced: [{ torch: true }] });
  torch.click();
  await until(() => !torch.classList.contains('on'), '꺼짐');
  assert.deepEqual(cam.torchCalls.at(-1), { advanced: [{ torch: false }] });
});

test('앱을 벗어나면 카메라를 끄고, 돌아오면 다시 켜서 지금 비추는 글을 다시 읽는다', async () => {
  const n = requests.length;
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(liveTracks(), 0);
  assert.equal(video().srcObject, null);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => liveTracks() === 1, '다시 켠다');
  await aim('text4', 1000);
  await answered(n + 1);
  assert.equal(requests.at(-1).scene, 'text4');
});

test('다른 번역 방식으로 가면 카메라를 끄고, 돌아와도 누르기 전에는 켜지 않는다', async () => {
  segment(view, '텍스트').click();
  assert.equal(liveTracks(), 0);
  segment(view, '카메라').click();
  await tick();
  assert.equal(liveTracks(), 0);
  assert.ok(visible(startBtn()));
  await turnOn();
  assert.equal(liveTracks(), 1);
  translate.hide(); // 다른 탭
  assert.equal(liveTracks(), 0);
  translate.show(new URLSearchParams());
  await tick();
  assert.equal(liveTracks(), 0);
});

test('켜는 중(권한 묻기)에 다른 방식으로 가면 늦게 열린 카메라를 바로 닫는다', async () => {
  startBtn().click();
  segment(view, '텍스트').click();
  await until(
    () => cam.tracks.at(-1)?.readyState === 'ended' && cam.calls.length === cam.tracks.length,
    '늦게 열린 카메라'
  );
  assert.equal(liveTracks(), 0);
  segment(view, '카메라').click();
});

test('이 장면 자세히 보기: 카메라를 끄고 번역이 나온 장면을 사진 번역으로 보낸다', async () => {
  await turnOn();
  await aim('text5');
  await until(() => resultText().includes('메뉴 text5'), '카메라 번역');
  button(view, '이 장면 자세히 보기').click();
  assert.equal(liveTracks(), 0);
  assert.equal(segment(view, '사진').getAttribute('aria-pressed'), 'true');
  await until(() => requests.at(-1).schema.includes('noteKo'), '사진 번역으로 보낸다');
  assert.equal(requests.at(-1).scene, 'text5');
  await until(() => text(view).includes('메뉴판'), '사진 번역 결과');
  segment(view, '카메라').click();
});

test('한 번 켜서 많이 보내면(60번) 멈추고, 계속을 누르면 이어 간다', async () => {
  await turnOn();
  const start = requests.length;
  for (let i = 0; requests.length - start < 60; i++) {
    const before = requests.length;
    await aim(`text${100 + i}`, 4400);
    await until(() => requests.length > before || button(view, '계속 번역'), '보냈다');
    await until(() => status() !== '글자를 읽는 중…', '답');
  }
  await until(() => button(view, '계속 번역'), '많이 보내서 멈춤');
  assert.match(text(view), /무료 한도를 아끼려고/);
  await aim('text501', 6000);
  assert.equal(requests.length - start, 60);
  button(view, '계속 번역').click();
  await advance(1000);
  await until(() => requests.length - start === 61, '이어 간다');
});

test('한동안(2분) 새로 보낸 장면도 누른 것도 없으면 카메라를 끄고 알린다', async () => {
  await until(() => status() !== '글자를 읽는 중…', '답');
  await aim('text501', 121000); // 마지막으로 보낸 장면 그대로
  assert.equal(liveTracks(), 0);
  assert.match(text(view), /한동안 새로 읽을 글이 없어 카메라를 껐어요/);
  assert.ok(visible(startBtn()));
});

test('카메라가 끊기면(다른 앱·권한 회수) 끄고 알린다', async () => {
  await turnOn();
  cam.tracks.at(-1).dispatchEvent(new Event('ended'));
  assert.equal(video().srcObject, null);
  assert.match(text(view), /카메라가 끊겼어요/);
  assert.ok(visible(startBtn()));
});

test('카메라 권한을 거부하면 이유를 알리고 켜기 버튼을 다시 보여 준다', async () => {
  cam.fail = new DOMException('denied', 'NotAllowedError');
  startBtn().click();
  await until(() => text(view).includes('카메라 권한이 거부되었습니다'), '권한 안내');
  assert.ok(visible(startBtn()));
  assert.equal(visible(byClass('camera-card')[0]), false);
  cam.fail = null;
});

test('Gemini 키가 없으면 키 안내와 휴대폰 기능 안내를 보여 주고 켜기 버튼은 없다 (켜 둔 카메라는 끈다)', async () => {
  await turnOn();
  updateSettings({ geminiKey: '' });
  assert.equal(liveTracks(), 0);
  const box = byClass('callout').find((e) => e.textContent.includes('카메라 번역은 Gemini API 키가'));
  assert.ok(visible(box));
  assert.match(box.textContent, /갤럭시 카메라/);
  assert.equal(visible(startBtn()), false);
  assert.equal(visible(byClass('camera-card')[0]), false);
  updateSettings({ geminiKey: 'k' });
  assert.ok(visible(startBtn()));
});

test.after(() => mock.timers.reset());

// 번역 탭 화면을 가짜 DOM·카메라·사진 디코더·fetch로 시험한다: 번역 방식(텍스트 > 스캔 > 실시간 통역 > 녹음, 방향 고르기 없음),
// 스캔 — 누르면 바로 카메라, "카메라"로 지금 장면을 찍어 번역, "사진"으로 고른 사진 번역(돌려 세우기·줄이기·긴 캡처 조각),
// "멈춤", 결과 순서(전체 번역본 → 전체 원문 → 사진)와 맨 아래 질문 칸, 다시 시도·다른 탭·새 사진·공유받은 사진·다른 언어·저작권,
// 앱을 벗어났다 돌아오기·오래 쓰지 않으면 끄기·권한 거부·카메라 끊김·손전등·키가 없을 때
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- 아주 작은 가짜 DOM (ui.js의 h()가 쓰는 만큼만) ---------- */

class FakeNode extends EventTarget {
  parentNode = null;
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
}
class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  childNodes = [];
  attributes = {};
  style = {};
  dataset = {};
  hidden = false;
  disabled = false;
  value = '';
  #cls = new Set();
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    const cls = this.#cls;
    this.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c), on),
      contains: (c) => cls.has(c),
    };
  }
  get className() {
    return [...this.#cls].join(' ');
  }
  set className(v) {
    this.#cls.clear();
    for (const c of String(v).split(/\s+/)) if (c) this.#cls.add(c);
  }
  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = n instanceof FakeNode ? n : new FakeText(n);
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    while (this.firstChild) this.firstChild.remove();
    this.append(...nodes);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    this.replaceChildren(String(v));
  }
  matches(sel) {
    return sel.split(',').some((s) => matchSimple(this, s.trim()));
  }
  querySelector(sel) {
    return (
      descendants(this)
        .slice(1)
        .find((e) => e.matches(sel)) ?? null
    );
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event('click'));
  }
  focus() {
    document.activeElement = this;
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null;
  }
  scrollIntoView() {}
  // <video>: 카메라 스트림을 받으면 1920×1080 그림이 나온다
  get videoWidth() {
    return this.srcObject ? 1920 : 0;
  }
  get videoHeight() {
    return this.srcObject ? 1080 : 0;
  }
  play() {
    this.playing = true;
    return Promise.resolve();
  }
  pause() {
    this.playing = false;
  }
}

/** 'span', '.btn.primary', 'button.w' 같은 간단한 선택자만 */
function matchSimple(e, sel) {
  const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
  if (!m) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  return m[2]
    .split('.')
    .filter(Boolean)
    .every((c) => e.classList.contains(c));
}

function descendants(rootEl) {
  const out = [];
  const walk = (n) => {
    if (!(n instanceof FakeElement)) return;
    out.push(n);
    n.childNodes.forEach(walk);
  };
  walk(rootEl);
  return out;
}

const body = new FakeElement('body');
globalThis.Node = FakeNode;
globalThis.document = Object.assign(new EventTarget(), {
  hidden: false,
  visibilityState: 'visible',
  body,
  activeElement: null,
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (t) => new FakeText(t),
  getElementById: (id) => descendants(body).find((e) => e.attributes.id === id) ?? null,
  querySelector: () => null,
});
const winEvents = new EventTarget();
globalThis.window = globalThis;
globalThis.addEventListener = winEvents.addEventListener.bind(winEvents);
globalThis.removeEventListener = winEvents.removeEventListener.bind(winEvents);
globalThis.dispatchEvent = winEvents.dispatchEvent.bind(winEvents);
globalThis.scrollTo = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
/* ---------- 가짜 카메라 ---------- */

const cam = { calls: [], tracks: [], fail: null, torch: true, torchCalls: [], wait: null };
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
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla/5.0 (Linux; Android 16)',
    mediaDevices: {
      getUserMedia: async (c) => {
        cam.calls.push(c);
        await (cam.wait ?? Promise.resolve());
        if (cam.fail) throw cam.fail;
        const t = new VideoTrack();
        cam.tracks.push(t);
        return { getVideoTracks: () => [t], getTracks: () => [t] };
      },
    },
  },
});

const storage = (init = []) => {
  const mem = new Map(init);
  return {
    mem,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
};
globalThis.localStorage = storage([['eh.settings.v1', JSON.stringify({ geminiKey: 'k' })]]);
globalThis.sessionStorage = storage();
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = `data:${blob.type};base64,${Buffer.from(ab).toString('base64')}`;
      this.onload();
    });
  }
};

/* ---------- 가짜 사진 디코더·캔버스 (크롬처럼 HEIF는 열지 못한다) ---------- */

// 파일마다 사진 크기(돌려 세운 가로·세로)와 디코더 흉내. 적지 않은 파일은 4000×3000 사진
const fakePhotos = new WeakMap(); // 파일 → {size: [가로, 세로], swap?: 줄인 뒤 돌려 가로·세로가 바뀌어 나옴, noBitmap?: 못 엶}
const photoFile = (name, size, more = {}) => {
  const f = new File([new Uint8Array(5000)], name, { type: 'image/jpeg' });
  fakePhotos.set(f, { size, ...more });
  return f;
};
const cantOpen = (f) => /heic|heif/.test(f.type) || f.type === 'text/plain';

const decoded = []; // createImageBitmap에 들어온 파일
const drawn = []; // drawImage 크기
const drawnFrom = []; // drawImage에 그린 그림
const cameraDraws = []; // 카메라 화면(<video>)을 그린 자리
const encodes = []; // convertToBlob 옵션
globalThis.createImageBitmap = async (file, opts) => {
  decoded.push({ file, opts });
  const info = fakePhotos.get(file) ?? { size: [4000, 3000] };
  if (cantOpen(file) || info.noBitmap) throw new DOMException('decode', 'InvalidStateError');
  const size = opts?.resizeWidth ? [opts.resizeWidth, opts.resizeHeight] : info.size;
  if (info.swap) size.reverse();
  return { width: size[0], height: size[1], close() {} };
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.size = [w, h];
  }
  getContext() {
    return {
      fillRect() {},
      drawImage: (src, ...xywh) => {
        if (src?.tagName === 'VIDEO') cameraDraws.push(xywh);
        drawn.push(xywh);
        drawnFrom.push(src);
        this.from = xywh.length > 4 ? `@${xywh[1]}` : ''; // 조각이면 어디서부터 잘랐는지
      },
    };
  }
  async convertToBlob(opts) {
    encodes.push(opts);
    return new Blob([`JPEG${this.size.join('x')}${this.from}`], { type: opts.type });
  }
};

// 미리 보기 주소: 만들고 지운 것을 센다
const liveUrls = new Set();
const urlBlobs = new Map();
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = (b) => {
  const u = realCreate(b);
  liveUrls.add(u);
  urlBlobs.set(u, b);
  return u;
};
URL.revokeObjectURL = (u) => {
  liveUrls.delete(u);
  urlBlobs.delete(u);
  realRevoke(u);
};

// 크기만 읽는 <img> (크롬처럼 돌려 세운 크기를 알려 주고, HEIF는 열지 못한다)
const imgLoads = [];
globalThis.Image = class {
  naturalWidth = 0;
  naturalHeight = 0;
  set src(u) {
    const f = urlBlobs.get(u);
    imgLoads.push(f);
    setTimeout(() => {
      if (!f || cantOpen(f)) return this.onerror?.();
      [this.naturalWidth, this.naturalHeight] = (fakePhotos.get(f) ?? { size: [4000, 3000] }).size;
      this.onload?.();
    }, 0);
  }
};

/* ---------- 가짜 주소·공유 보관함 ---------- */

const BASE = 'https://example.github.io/english-helper/';
globalThis.location = { pathname: '/english-helper/', href: `${BASE}#/translate?photo=shared`, search: '' };
const replaced = [];
globalThis.history = { replaceState: (_s, _t, url) => replaced.push(url) };
const inbox = new Map();
globalThis.caches = {
  open: async () => ({
    match: async (k) => inbox.get(String(k)),
    delete: async (k) => inbox.delete(String(k)),
  }),
  delete: async () => inbox.clear(),
};

/* ---------- 가짜 Gemini: 스캔은 원문·번역을 통째로, 질문은 글로 답한다 ---------- */

const enc = new TextEncoder();
const sse = (text) =>
  new Response(
    new ReadableStream({
      start(c) {
        // 두 조각으로 나눠 보내 받는 대로 그리는지 본다
        const cut = Math.floor(text.length / 2);
        for (const [t, fin] of [
          [text.slice(0, cut), undefined],
          [text.slice(cut), 'STOP'],
        ]) {
          const chunk = { candidates: [{ content: { parts: [{ text: t }] }, finishReason: fin }] };
          c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        c.close();
      },
    })
  );
const answer = (tag = '') =>
  JSON.stringify({
    sourceLang: 'en',
    original: 'Closed on Mondays\nPlease knock',
    translation: `월요일 휴무\n노크해 주세요${tag}`,
  });
const fetchCalls = [];
let respond = () => sse(answer());
let reply = (body) => sse(`답: ${body.contents.at(-1).parts[0].text}`); // 질문에 답하기
const isQuestion = (body) => body.contents.some((c) => c.role === 'model');
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  fetchCalls.push(body);
  return isQuestion(body) ? reply(body, init) : respond(init);
};
const scans = () => fetchCalls.filter((b) => !isQuestion(b));
let hangAborts = 0;
/** 취소될 때까지 답하지 않는 서버 */
const hang = (init) =>
  new Promise((_, reject) =>
    init.signal.addEventListener('abort', () => {
      hangAborts++;
      reject(new DOMException('Aborted', 'AbortError'));
    })
  );

/* ---------- 시계: 카메라를 오래 쓰지 않았는지 재는 setInterval과 Date만 가짜로 ---------- */

mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });

/* ---------- 화면 ---------- */

const { init, show, hide } = await import('../js/views/translate.js');
const { updateSettings, listWords, getTranslateHistory } = await import('../js/store.js');
const view = new FakeElement('section');
body.append(view);
init(view);
show(new URLSearchParams());

const els = () => descendants(view);
const button = (label) => els().find((e) => e.tagName === 'BUTTON' && e.textContent.includes(label));
const segment = (label) => els().find((e) => e.tagName === 'BUTTON' && e.dataset.value && e.textContent === label);
const byClass = (c) => els().filter((e) => e.classList.contains(c));
const visible = (el) => {
  if (!el) return false;
  for (let n = el; n; n = n.parentNode) if (n.hidden) return false;
  return true;
};
const panelText = () => view.textContent; // 지금 고른 번역 방식의 칸만 화면에 붙어 있다
const visibleText = (el = view) =>
  el.hidden ? '' : el.childNodes.map((n) => (n instanceof FakeElement ? visibleText(n) : n.textContent)).join('');
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check, what) {
  for (let i = 0; i < 300 && !check(); i++) await tick();
  assert.ok(check(), what);
}
const jpegFile = (name = 'IMG_1.jpg') => new File([new Uint8Array(5000)], name, { type: 'image/jpeg' });
const pickInput = () => els().find((e) => e.tagName === 'INPUT' && e.attributes.type === 'file');
function pick(file) {
  const input = pickInput();
  input.files = [file];
  input.value = 'C:\\fakepath\\photo.jpg';
  input.dispatchEvent(new Event('change'));
}
const sentImage = (call = scans().at(-1)) => call.contents[0].parts[0].inlineData;
/** 보낸 사진(요청 조각 또는 inlineData)의 내용 */
const sentText = (p) => Buffer.from((p.inlineData ?? p).data, 'base64').toString();
const video = () => byClass('camera-video')[0];
const frameBox = () => byClass('camera-frame')[0];
const shot = () => byClass('photo-thumb')[0];
const cards = () => byClass('scan-card');
const qaBox = () => byClass('scan-qa')[0];
const qInput = () => els().find((e) => e.tagName === 'INPUT' && e.attributes['aria-label'] === '질문');
const keyBox = () => els().find((e) => e.classList.contains('callout') && e.textContent.includes('설정에서 키 넣기'));
const done = () => visible(qaBox()); // 번역을 다 받으면 질문 칸이 나온다
async function scanMode() {
  segment('스캔').click();
  await until(() => video().srcObject, '카메라가 켜진다');
}
async function snap() {
  button('카메라').click();
  await until(() => scans().length && done(), '찍은 장면을 번역한다');
}
async function ask(q) {
  qInput().value = q;
  byClass('scan-ask')[0].dispatchEvent(new Event('submit', { cancelable: true }));
}
/** 원문 언어 등을 바꾼 스캔 답 */
const scanAnswer = (o) => () => sse(JSON.stringify(o));
const recitation = () =>
  new Response(
    new ReadableStream({
      start(c) {
        const chunk = { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'RECITATION' }] };
        c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        c.close();
      },
    })
  );
const denied = () => new Response(JSON.stringify({ error: { code: 403, message: 'denied' } }), { status: 403 });

test('번역 방식은 텍스트 > 스캔 > 실시간 통역 > 녹음 순이고, 방향 고르기 없이 텍스트가 먼저 골라져 있다', () => {
  assert.deepEqual(
    els()
      .filter((e) => e.tagName === 'BUTTON' && e.dataset.value)
      .map((e) => e.textContent),
    ['텍스트', '스캔', '실시간 통역', '녹음']
  );
  assert.equal(segment('텍스트').getAttribute('aria-pressed'), 'true');
  assert.equal(button('번역 방향'), undefined, '한국어 ↔ English 바꾸기 버튼이 없다');
  assert.equal(byClass('dir-bar').length, 0);
  const ta = els().find((e) => e.tagName === 'TEXTAREA');
  assert.equal(ta.placeholder, '번역할 글을 입력하세요 (한국어 → English, English → 한국어)');
  assert.equal(cam.calls.length, 0, '스캔을 누르기 전에는 카메라를 열지 않는다');
});

test('스캔을 누르면 바로 뒤 카메라가 켜지고, 아래에 사진·카메라·멈춤 버튼만 있다 (위 설명 없음)', async () => {
  await scanMode();
  assert.deepEqual(cam.calls[0], {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  assert.equal(video().attributes.playsinline, '', '아이폰에서 전체 화면으로 열리지 않게');
  assert.equal(video().muted, true);
  assert.deepEqual(
    byClass('scan-controls')[0].childNodes.map((b) => b.textContent),
    ['사진', '카메라', '멈춤']
  );
  assert.ok(visible(frameBox()));
  assert.equal(visible(byClass('scan-result')[0]), false);
  assert.equal(visible(qaBox()), false);
  assert.doesNotMatch(visibleText(), /메뉴판·안내문|사진을 찍지 않고|Google Gemini로 보내/, '위 설명이 없다');
  assert.match(visibleText(), /글자를 화면에 맞추고 "카메라"를 누르세요/);
});

test('카메라를 누르면 지금 장면을 멈추고(카메라를 끄고) 바로 번역해, 번역본 → 원문 → 찍은 사진 순으로 한 번에 보여 준다', async () => {
  await snap();
  assert.equal(liveTracks(), 0, '찍으면 카메라를 끈다');
  assert.deepEqual(cameraDraws.at(-1), [0, 0, 1920, 1080, 0, 0, 1920, 1080], '보이는 부분 전체를 그대로');
  assert.equal(sentText(sentImage()), 'JPEG1920x1080@0');
  assert.deepEqual(encodes.at(-1), { type: 'image/jpeg', quality: 0.85 });
  assert.equal(scans().at(-1).contents[0].parts.length, 2, '사진 한 장과 요청문');

  assert.equal(visible(frameBox()), false, '결과를 볼 때는 카메라 화면을 숨긴다');
  const [tr, orig, photo] = cards();
  assert.match(tr.textContent, /^전체 번역본영어 → 한국어/);
  assert.match(tr.textContent, /월요일 휴무\n노크해 주세요/, '문장을 나누지 않고 줄바꿈 그대로 한 덩어리');
  assert.match(orig.textContent, /^전체 원문/);
  assert.deepEqual(
    descendants(orig)
      .filter((e) => e.classList.contains('w'))
      .map((e) => e.textContent),
    ['Closed', 'on', 'Mondays', 'Please', 'knock'],
    '영어 원문은 단어를 누르면 뜻이 나온다'
  );
  assert.match(photo.textContent, /^찍은 사진/);
  assert.ok(urlBlobs.has(shot().getAttribute('src')));
  assert.equal(byClass('photo-block').length, 0, '블록마다 나누지 않는다');

  // 화면 순서: 결과(맨 위) → 버튼 → 질문 칸(맨 아래)
  const shownTop = view.childNodes.at(-1).childNodes[0].childNodes.filter((n) => !n.hidden);
  assert.deepEqual(
    shownTop.map((n) => n.className),
    ['stack scan-result', 'scan-controls', 'card scan-qa']
  );

  const [h0] = getTranslateHistory();
  assert.deepEqual([h0.photo, h0.source, h0.from, h0.to], [true, 'Closed on Mondays\nPlease knock', 'en', 'ko']);
});

test('질문 칸: 원문을 바탕으로 Gemini에게 묻고, 받는 대로 보여 주며 앞 질문·답을 이어서 보낸다', async () => {
  await ask('가게가 언제 쉬어요?');
  await until(() => panelText().includes('답: 가게가 언제 쉬어요?'), '답');
  const first = fetchCalls.at(-1);
  assert.match(first.contents[0].parts[0].text, /Scanned text \(original\):\n"""\nClosed on Mondays\nPlease knock/);
  assert.match(first.systemInstruction.parts[0].text, /Base your answers on the scanned text/);
  assert.equal(qInput().value, '', '보내면 칸을 비운다');

  await ask('노크는 몇 번?');
  await until(() => panelText().includes('답: 노크는 몇 번?'), '두 번째 답');
  assert.deepEqual(
    fetchCalls
      .at(-1)
      .contents.slice(2)
      .map((c) => [c.role, c.parts[0].text]),
    [
      ['user', '가게가 언제 쉬어요?'],
      ['model', '답: 가게가 언제 쉬어요?'],
      ['user', '노크는 몇 번?'],
    ]
  );
  const n = fetchCalls.length;
  await ask('   ');
  await tick();
  assert.equal(fetchCalls.length, n, '빈 질문은 보내지 않는다');
});

test('고쳐서 번역: 텍스트 칸에 원문을 넣고 바로 번역하지는 않으며, 스캔 기록이 텍스트 칸 기록에 보인다', async () => {
  const sent = fetchCalls.length;
  button('고쳐서 번역').click();
  assert.equal(segment('텍스트').getAttribute('aria-pressed'), 'true');
  const ta = els().find((e) => e.tagName === 'TEXTAREA');
  assert.equal(ta.value, 'Closed on Mondays\nPlease knock');
  assert.equal(document.activeElement, ta);
  assert.match(panelText(), /잘못 읽은 글자를 고친 뒤/);
  assert.match(panelText(), /최근 번역 1개[\s\S]*스캔/);
  await tick();
  assert.equal(fetchCalls.length, sent);
});

test('결과를 보다 다시 스캔을 누르면 바로 카메라가 켜지고, 결과에서 카메라를 눌러도 카메라로 돌아간다', async () => {
  await scanMode();
  assert.ok(visible(frameBox()));
  assert.equal(visible(byClass('scan-result')[0]), false);
  await snap();
  button('카메라').click();
  await until(() => liveTracks() === 1 && visible(frameBox()), '카메라로 돌아간다');
  // 카메라 화면을 눌러도 찍는다
  const n = scans().length;
  frameBox().click();
  await until(() => scans().length === n + 1 && done(), '화면을 눌러 찍는다');
});

test('사진: 고른 사진을 돌려 세우고 줄여 JPEG로 보내고, 고른 사진으로 보여 준다', async () => {
  let opened = false;
  pickInput().addEventListener('click', () => (opened = true), { once: true });
  button('사진').click();
  assert.ok(opened, '갤러리·파일 고르기가 열린다');
  assert.equal(pickInput().attributes.accept, 'image/*');
  assert.equal('capture' in pickInput().attributes, false, '사진은 갤러리에서 (카메라는 "카메라" 버튼)');

  pick(jpegFile());
  assert.equal(pickInput().value, '', '같은 사진을 다시 골라도 알 수 있게 비운다');
  await until(() => done(), '번역');
  assert.deepEqual(decoded.at(-1).opts, {
    imageOrientation: 'from-image',
    resizeWidth: 2048,
    resizeHeight: 1536,
    resizeQuality: 'high',
  });
  assert.equal(sentText(sentImage()), 'JPEG2048x1536');
  assert.match(cards()[2].textContent, /^고른 사진/);
});

test('실패하면 다시 시도로 같은 사진을 다시 보낸다 (다시 줄이지 않는다)', async () => {
  respond = denied;
  const before = decoded.length;
  pick(jpegFile('menu.jpg'));
  await until(() => button('다시 시도'), '오류와 다시 시도');
  assert.match(panelText(), /권한이 없습니다/);
  const first = scans().at(-1);

  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => done(), '다시 받는다');
  assert.deepEqual(scans().at(-1).contents, first.contents, '같은 사진·같은 요청문');
  assert.equal(decoded.length, before + 1, '사진은 한 번만 연다');
});

test('번역 중에 다른 탭으로 가면 멈추고, 돌아와 다시 시도하면 같은 사진으로 이어 간다', async () => {
  respond = hang;
  pick(jpegFile());
  await until(() => panelText().includes('글자를 읽고 번역하는 중'), '기다리는 중');
  const first = scans().at(-1);
  const aborts = hangAborts;
  hide();
  await until(() => panelText().includes('다른 화면으로 가서 멈췄어요'), '멈췄다고 알린다');
  assert.equal(hangAborts, aborts + 1, '요청을 취소한다');

  show(new URLSearchParams());
  assert.equal(liveTracks(), 0, '결과를 보던 중이면 카메라를 켜지 않는다');
  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => done(), '다시 받는다');
  assert.deepEqual(scans().at(-1).contents, first.contents);
});

test('사진을 준비하는 사이 다른 탭으로 가면 보내지 않고 기다린다', async () => {
  const sent = scans().length;
  pick(jpegFile());
  hide();
  await until(() => panelText().includes('다른 화면으로 가서 멈췄어요'), '보내지 않고 멈춘다');
  assert.equal(scans().length, sent);
  show(new URLSearchParams());
  button('다시 시도').click();
  await until(() => done(), '돌아와서 보낸다');
  assert.equal(scans().length, sent + 1);
});

test('새 사진을 고르면 앞 요청을 멈추고, 늦게 온 앞 사진의 답은 그리지 않으며, 앞 미리 보기 주소를 지운다', async () => {
  let release;
  let lateServed = false;
  const gate = new Promise((r) => (release = r));
  // 취소를 모르는 느린 서버: 앞 사진의 답이 새 사진의 답보다 늦게 온다
  respond = async () => {
    await gate;
    lateServed = true;
    return sse(answer(' (앞 사진)'));
  };
  const sent = scans().length;
  pick(jpegFile('first.jpg'));
  await until(() => scans().length === sent + 1, '앞 사진을 보냈다');
  const firstUrl = shot().getAttribute('src');

  respond = () => sse(answer(' (새 사진)'));
  pick(jpegFile('second.jpg'));
  await until(() => panelText().includes('(새 사진)') && done(), '새 사진의 답');
  assert.ok(!liveUrls.has(firstUrl), '앞 미리 보기 주소를 지웠다');
  assert.equal(liveUrls.size, 1, '미리 보기 주소는 하나만 남는다');

  release();
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(lateServed);
  assert.ok(!panelText().includes('(앞 사진)'), '앞 사진의 답이 섞이지 않는다');
  assert.ok(!getTranslateHistory().some((x) => x.result.includes('(앞 사진)')), '기록에도 넣지 않는다');
});

test('공유받은 사진: 카메라를 켜지 않고 보관함에서 한 번만 꺼내 원본(HEIF)을 그대로 보내며, 주소에서 표시를 지운다', async () => {
  segment('텍스트').click();
  const heif = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const headers = { 'X-File-Name': encodeURIComponent('사진.HEIC') };
  inbox.set(`${BASE}shared-photo`, new Response(new Blob([heif], { type: 'image/heic' }), { headers }));
  const sent = scans().length;
  const calls = cam.calls.length;
  show(new URLSearchParams('photo=shared'));
  assert.equal(replaced.at(-1), '/english-helper/#/translate', '새로 고침해도 다시 꺼내지 않게');
  assert.equal(segment('스캔').getAttribute('aria-pressed'), 'true');
  await until(() => done(), '공유받은 사진을 번역한다');
  assert.equal(cam.calls.length, calls, '카메라는 켜지 않는다');
  assert.equal(inbox.size, 0, '꺼내면 지운다');
  assert.equal(scans().length, sent + 1);
  assert.equal(sentImage().mimeType, 'image/heic', '크롬이 못 여는 HEIF는 원본 그대로');
  assert.deepEqual([...Buffer.from(sentImage().data, 'base64')], [...heif]);

  show(new URLSearchParams('photo=shared'));
  await until(() => panelText().includes('공유받은 사진을 찾지 못했습니다'), '두 번 꺼내지 않는다');
  assert.equal(scans().length, sent + 1);
});

test('열 수 없는 파일은 보내지 않고 알린다', async () => {
  const sent = scans().length;
  pick(new File(['hello'], 'note.txt', { type: 'text/plain' }));
  await until(() => panelText().includes('이 사진은 열 수 없습니다'), '오류');
  assert.equal(scans().length, sent);
});

test('한국어 사진은 영어로: 번역본(영어)의 단어를 누를 수 있고, 기록은 한 → 영', async () => {
  respond = scanAnswer({ sourceLang: 'ko', original: '화장실은 2층', translation: 'Restroom on the 2nd floor' });
  pick(jpegFile('ko.jpg'));
  await until(() => done(), '결과');
  const [tr, orig] = cards();
  assert.match(tr.textContent, /한국어 → 영어/);
  assert.ok(descendants(tr).some((e) => e.classList.contains('w') && e.textContent === 'Restroom'));
  assert.equal(descendants(orig).filter((e) => e.classList.contains('w')).length, 0);
  assert.deepEqual([getTranslateHistory()[0].from, getTranslateHistory()[0].to], ['ko', 'en']);
});

test('일본어 사진: 영어로 다루지 않고(단어 누르기·영어 읽기 없음), 고쳐서 번역·기록 다시 번역은 한국어로', async () => {
  respond = scanAnswer({
    sourceLang: 'other',
    original: '営業時間 11時〜22時\n定休日 月曜日',
    translation: '영업시간 11시~22시\n정기 휴일 월요일',
  });
  pick(jpegFile('jp.jpg'));
  await until(() => done(), '결과');
  const [tr, orig] = cards();
  assert.match(tr.textContent, /외국어 → 한국어/);
  assert.equal(descendants(orig).filter((e) => e.classList.contains('w')).length, 0, '영어 단어 버튼이 없다');
  assert.equal(
    descendants(orig).some((e) => e.attributes['aria-label'] === '읽기'),
    false,
    '영어 목소리로 읽지 않는다'
  );
  assert.ok(
    descendants(tr).some((e) => e.attributes['aria-label'] === '읽기'),
    '한국어 번역은 읽는다'
  );
  const item = getTranslateHistory()[0];
  assert.deepEqual([item.from, item.to, item.photo], ['other', 'ko', true], '영어(en)로 적지 않는다');

  button('고쳐서 번역').click();
  assert.equal(els().find((e) => e.tagName === 'TEXTAREA').value, '営業時間 11時〜22時\n定休日 月曜日');
  // 기록을 누르면 한국어로 다시 번역한다
  respond = () => sse('영업시간 11시~22시\n정기 휴일 월요일');
  byClass('history-item')
    .find((e) => e.textContent.includes('営業時間'))
    .click();
  await until(() => panelText().includes('English → 한국어'), '영 → 한으로 번역');
  assert.match(fetchCalls.at(-1).systemInstruction.parts[0].text, /into natural, everyday Korean/);
});

test('저작권으로 요약만 받으면 알리고, 이름표는 누를 수 없으며, 기록에 넣지 않고, 질문할 때는 사진을 보낸다', async () => {
  let n = 0;
  respond = () =>
    n++ === 0
      ? recitation()
      : sse(
          JSON.stringify({ sourceLang: 'en', original: 'Chapter 1', translation: '주인공이 집을 떠나는 장면의 요약' })
        );
  const history = getTranslateHistory().length;
  segment('스캔').click();
  pick(jpegFile('book.jpg'));
  await until(() => done(), '요약을 받는다');
  assert.equal(n, 2);
  assert.match(panelText(), /저작권 보호 때문에 원문을 그대로 옮기지 않고 요약해서 보여 드려요/);
  const orig = cards()[1];
  assert.equal(
    descendants(orig).filter((e) => e.classList.contains('w')).length,
    0,
    '이름표(Chapter 1)는 누를 수 없다'
  );
  assert.equal(button('고쳐서 번역'), undefined, '고칠 원문이 없다');
  assert.equal(getTranslateHistory().length, history, '기록에 넣지 않는다');

  await ask('누가 나와요?');
  await until(() => panelText().includes('답: 누가 나와요?'), '답');
  const first = fetchCalls.at(-1).contents[0].parts;
  assert.equal(first[0].inlineData.mimeType, 'image/jpeg', '원문 대신 사진을 보낸다');
});

test('아주 긴 스크롤 캡처: 너비를 지키며 6조각으로 나눠 차례로 보내고, 줄였다고 알리며, 다시 시도는 같은 조각을 보낸다', async () => {
  respond = denied;
  const before = decoded.length;
  pick(photoFile('scroll.png', [1080, 20000]));
  await until(() => button('다시 시도'), '오류와 다시 시도');
  assert.equal(decoded.length, before + 1);
  assert.deepEqual(decoded.at(-1).opts, {
    imageOrientation: 'from-image',
    resizeWidth: 950,
    resizeHeight: 17600,
    resizeQuality: 'high',
  });
  assert.deepEqual(drawn.at(-1), [0, 14600, 950, 3000, 0, 0, 950, 3000], '마지막 조각');
  const first = scans().at(-1);
  const parts = first.contents[0].parts;
  assert.equal(parts.length, 7, '조각 6개 + 요청문');
  assert.deepEqual(
    parts.slice(0, 6).map(sentText),
    [0, 2920, 5840, 8760, 11680, 14600].map((y) => `JPEG950x3000@${y}`),
    '위에서부터 차례로'
  );
  assert.match(parts[6].text, /^These 6 images are consecutive parts of ONE long screenshot/);
  const note = els().find((e) => e.tagName === 'P' && e.textContent.includes('아주 긴 캡처라'));
  assert.ok(visible(note), '글자가 작을 수 있다고 알린다');
  assert.equal(urlBlobs.get(shot().getAttribute('src')).size, 'JPEG950x3000@0'.length, '미리 보기는 첫 조각');

  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => done(), '다시 받는다');
  assert.deepEqual(scans().at(-1).contents, first.contents, '같은 조각·같은 요청문');
  assert.equal(decoded.length, before + 1, '다시 열거나 자르지 않는다');

  pick(jpegFile('small.jpg'));
  await until(() => done() && note.hidden, '보통 사진이면 안내를 숨긴다');
  assert.equal(scans().at(-1).contents[0].parts.length, 2);
});

test('큰 사진(2억 화소)도 원본 크기로 풀지 않고 처음부터 줄여서 연다', async () => {
  pick(photoFile('200mp.jpg', [16320, 12240]));
  await until(() => done() && sentText(sentImage()) === 'JPEG2048x1536', '결과');
  assert.deepEqual(decoded.at(-1).opts, {
    imageOrientation: 'from-image',
    resizeWidth: 2048,
    resizeHeight: 1536,
    resizeQuality: 'high',
  });
  assert.ok(
    decoded.every((d) => d.opts?.resizeWidth > 0),
    '어떤 사진도 원본 크기로 열지 않는다'
  );
});

test('돌려 찍은 사진: 줄인 뒤 돌리는 크롬이면(가로·세로가 바뀌어 나옴) 반대로 다시 열어 찌그러지지 않게 한다', async () => {
  const before = decoded.length;
  pick(photoFile('portrait.jpg', [3000, 4000], { swap: true }));
  await until(() => done() && sentText(sentImage()) === 'JPEG1536x2048', '세로 사진 그대로');
  assert.deepEqual(
    decoded.slice(before).map((d) => [d.opts.resizeWidth, d.opts.resizeHeight]),
    [
      [1536, 2048],
      [2048, 1536],
    ]
  );
  assert.deepEqual(drawn.at(-1), [0, 0, 1536, 2048]);
});

test('createImageBitmap으로 못 열면 <img>를 줄여 그린다 (긴 캡처는 원본 크기 기준으로 잘라 그린다)', async () => {
  pick(photoFile('odd.jpg', [4000, 3000], { noBitmap: true }));
  await until(() => done() && drawnFrom.at(-1) instanceof Image, '결과');
  assert.deepEqual(drawn.at(-1), [0, 0, 2048, 1536]);
  assert.equal(sentText(sentImage()), 'JPEG2048x1536');

  pick(photoFile('odd-scroll.jpg', [2160, 16000], { noBitmap: true }));
  await until(() => scans().at(-1).contents[0].parts.length === 4 && done(), '3조각');
  assert.deepEqual(drawn.at(-1), [0, 10560, 2160, 5440, 0, 0, 1080, 2720], '원본 크기로 잘라 1080px 너비로 그린다');
  assert.equal(liveUrls.size, 1, '크기를 읽느라 만든 주소는 지운다 (미리 보기 하나만)');
});

test('멈춤: 카메라를 끄고 다시 켜는 법을 알리며, 번역 중이면 번역을 멈춘다', async () => {
  await scanMode();
  button('멈춤').click();
  assert.equal(liveTracks(), 0);
  assert.match(visibleText(), /카메라를 껐어요\. "카메라"를 누르면 다시 켜져요/);
  assert.equal(button('멈춤').disabled, true, '멈출 것이 없으면 누를 수 없다');
  button('카메라').click();
  await until(() => liveTracks() === 1, '다시 켠다');

  respond = hang;
  button('카메라').click();
  await until(() => panelText().includes('글자를 읽고 번역하는 중'), '번역 중');
  const aborts = hangAborts;
  button('멈춤').click();
  await until(() => panelText().includes('번역을 멈췄어요'), '번역을 멈췄다');
  assert.equal(hangAborts, aborts + 1);
  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => done(), '다시 시도하면 같은 장면을 보낸다');
});

test('앱을 벗어나면 카메라를 끄고, 돌아오면 다시 켠다', async () => {
  await scanMode();
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(liveTracks(), 0);
  assert.equal(video().srcObject, null);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => liveTracks() === 1, '다시 켠다');
});

test('다른 번역 방식으로 가면 끄고, 다른 탭에 갔다 오면 켜 두었던 카메라를 다시 켠다', async () => {
  segment('텍스트').click();
  assert.equal(liveTracks(), 0);
  await scanMode();
  hide();
  assert.equal(liveTracks(), 0);
  show(new URLSearchParams());
  await until(() => liveTracks() === 1, '다시 켠다');
});

test('켜는 중(권한 묻기)에 다른 방식으로 가면 늦게 열린 카메라를 바로 닫는다', async () => {
  let release;
  cam.wait = new Promise((r) => (release = r));
  segment('텍스트').click();
  segment('스캔').click();
  segment('텍스트').click();
  release();
  cam.wait = null;
  await until(
    () => cam.tracks.at(-1)?.readyState === 'ended' && cam.tracks.length === cam.calls.length,
    '늦게 열린 카메라'
  );
  assert.equal(liveTracks(), 0);
});

test('손전등: 켤 수 있는 카메라면 카메라 화면 위에 있고, 눌러도 찍지 않는다', async () => {
  await scanMode();
  const torch = els().find((e) => e.attributes['aria-label'] === '손전등');
  assert.ok(visible(torch));
  const n = scans().length;
  torch.click();
  await until(() => torch.classList.contains('on'), '켜짐');
  assert.deepEqual(cam.torchCalls.at(-1), { advanced: [{ torch: true }] });
  torch.click();
  await until(() => !torch.classList.contains('on'), '꺼짐');
  assert.equal(scans().length, n);
});

test('카메라를 켜 두고 오래(3분) 찍지 않으면 끄고 알린다', async () => {
  mock.timers.tick(185000);
  assert.equal(liveTracks(), 0);
  assert.match(visibleText(), /한동안 쓰지 않아 카메라를 껐어요/);
});

test('카메라가 끊기면(다른 앱·권한 회수) 끄고 알린다', async () => {
  await scanMode();
  cam.tracks.at(-1).dispatchEvent(new Event('ended'));
  assert.equal(video().srcObject, null);
  assert.match(visibleText(), /카메라가 끊겼어요/);
});

test('카메라 권한을 거부하면 이유를 알리고, 사진으로는 번역할 수 있다', async () => {
  cam.fail = new DOMException('denied', 'NotAllowedError');
  segment('스캔').click();
  await until(() => visibleText().includes('카메라 권한이 거부되었습니다'), '권한 안내');
  assert.match(visibleText(), /"사진"으로 사진을 골라도 됩니다/);
  cam.fail = null;
  pick(jpegFile());
  await until(() => done(), '사진은 된다');
});

test('Gemini 키가 없으면 키 안내와 휴대폰 기능 안내만 보이고, 켜 둔 카메라는 끈다', async () => {
  await scanMode();
  updateSettings({ geminiKey: '' });
  assert.equal(liveTracks(), 0);
  assert.ok(visible(keyBox()));
  assert.match(keyBox().textContent, /스캔 번역은 Gemini API 키가 있어야 합니다\. 설정에서 키 넣기/);
  assert.match(keyBox().textContent, /갤럭시 카메라[\s\S]*서클 투 서치/);
  assert.equal(visible(byClass('scan-controls')[0]), false);
  assert.equal(visible(frameBox()), false);
  segment('텍스트').click();
  segment('스캔').click();
  await tick();
  assert.equal(liveTracks(), 0, '키가 없으면 카메라를 켜지 않는다');
  updateSettings({ geminiKey: 'k' });
  assert.equal(visible(keyBox()), false);
  hide();
});

test.after(() => mock.timers.reset());

// 번역 탭 "사진" 화면 흐름을 가짜 DOM·사진 디코더·fetch로 시험한다:
// 찍기·고르기 → 줄여서 보내기 → 받는 대로 그리기, 다시 시도(같은 사진), 다른 탭으로 가기, 새 사진으로 바꾸기,
// 공유받은 사진 꺼내기, 글자 고쳐서 다시 번역, 키가 없을 때
import test from 'node:test';
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
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 16)' },
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

/* ---------- 가짜 Gemini ---------- */

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
    noteKo: `가게 앞 안내문이에요${tag}`,
    blocks: [
      { lang: 'en', text: 'Closed on Mondays\nPlease knock', translation: `월요일 휴무\n노크해 주세요${tag}` },
      { lang: 'ko', text: '화장실은 2층', translation: 'Restroom on the 2nd floor' },
    ],
    phrases: [{ phrase: 'Closed on Mondays', meaningKo: '월요일 휴무', noteKo: '가게 안내에 자주 나와요' }],
    sourceLang: 'en',
  });
const fetchCalls = [];
let respond = () => sse(answer());
globalThis.fetch = async (url, init) => {
  fetchCalls.push(JSON.parse(init.body));
  return respond(init);
};
let hangAborts = 0;
/** 취소될 때까지 답하지 않는 서버 */
const hang = (init) =>
  new Promise((_, reject) =>
    init.signal.addEventListener('abort', () => {
      hangAborts++;
      reject(new DOMException('Aborted', 'AbortError'));
    })
  );

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
const inputs = () => els().filter((e) => e.tagName === 'INPUT' && e.attributes.type === 'file');
const camInput = () => inputs().find((e) => e.attributes.capture === 'environment');
const galleryInput = () => inputs().find((e) => !('capture' in e.attributes));
const byClass = (c) => els().filter((e) => e.classList.contains(c));
const thumb = () => byClass('photo-thumb')[0];
const visible = (el) => {
  for (let n = el; n; n = n.parentNode) if (n.hidden) return false;
  return true;
};
const panelText = () => view.textContent; // 지금 고른 번역 방식의 칸만 화면에 붙어 있다
const keyBox = () => els().find((e) => e.classList.contains('callout') && e.textContent.includes('설정에서 키 넣기'));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check, what) {
  for (let i = 0; i < 300 && !check(); i++) await tick();
  assert.ok(check(), what);
}
const jpegFile = (name = 'IMG_1.jpg') => new File([new Uint8Array(5000)], name, { type: 'image/jpeg' });
function pick(input, file) {
  input.files = [file];
  input.value = 'C:\\fakepath\\photo.jpg';
  input.dispatchEvent(new Event('change'));
}
const sentImage = (call = fetchCalls.at(-1)) => call.contents[0].parts[0].inlineData;
/** 보낸 사진(요청 조각 또는 inlineData)의 내용 */
const sentText = (p) => Buffer.from((p.inlineData ?? p).data, 'base64').toString();
const dirText = () => byClass('dir-label')[0].textContent;
const blockEls = () => byClass('photo-block');
const wordsIn = (el) => descendants(el).filter((e) => e.classList.contains('w'));
/** 블록의 버튼 이름 (영어 단어 버튼은 빼고) */
const actionsIn = (el) =>
  descendants(el)
    .filter((e) => e.tagName === 'BUTTON' && !e.classList.contains('w'))
    .map((e) => e.textContent);
/** 원문을 옮기지 못하게 막힌 답 (저작권) */
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

test('사진 칸: 카메라로 찍기(휴대폰 카메라 앱)와 사진 고르기(갤러리)가 있다', () => {
  assert.deepEqual(
    els()
      .filter((e) => e.tagName === 'BUTTON' && e.dataset.value)
      .map((e) => e.textContent),
    ['텍스트', '실시간 통역', '녹음', '사진']
  );
  segment('사진').click();
  assert.equal(segment('사진').getAttribute('aria-pressed'), 'true');
  assert.equal(inputs().length, 2);
  assert.equal(camInput().attributes.accept, 'image/*');
  assert.equal(galleryInput().attributes.accept, 'image/*');
  assert.ok(button('카메라로 찍기') && button('사진 고르기'));

  let opened = '';
  camInput().addEventListener('click', () => (opened = 'camera'), { once: true });
  button('카메라로 찍기').click();
  assert.equal(opened, 'camera');
  galleryInput().addEventListener('click', () => (opened = 'gallery'), { once: true });
  button('사진 고르기').click();
  assert.equal(opened, 'gallery');
  assert.ok(visible(byClass('photo-card')[0]) === false, '사진을 고르기 전에는 사진 칸이 없다');
  assert.equal(keyBox().hidden, true, '키가 있으면 키 안내를 숨긴다');
});

test('찍은 사진을 돌려 세우고 줄여 JPEG로 보내고, 받는 대로 블록을 그린 뒤 기록에 남긴다', async () => {
  const sent = fetchCalls.length;
  pick(camInput(), jpegFile());
  assert.equal(camInput().value, '', '같은 사진을 다시 골라도 알 수 있게 비운다');
  await until(() => panelText().includes('Restroom on the 2nd floor') && button('전체 복사'), '결과가 다 나온다');

  assert.deepEqual(
    decoded.at(-1).opts,
    { imageOrientation: 'from-image', resizeWidth: 2048, resizeHeight: 1536, resizeQuality: 'high' },
    '크기를 먼저 읽고 처음부터 줄여서 연다'
  );
  assert.deepEqual(drawn.at(-1), [0, 0, 2048, 1536], '긴 변 2048px로 줄인다');
  assert.deepEqual(encodes.at(-1), { type: 'image/jpeg', quality: 0.85 });
  assert.equal(fetchCalls.length, sent + 1);
  assert.equal(sentImage().mimeType, 'image/jpeg');
  assert.equal(Buffer.from(sentImage().data, 'base64').toString(), 'JPEG2048x1536');

  const src = thumb().getAttribute('src');
  assert.ok(liveUrls.has(src), '줄인 사진으로 미리 보기');
  assert.ok(visible(thumb()));
  assert.equal(visible(button('카메라로 찍기')), false, '사진이 있으면 큰 버튼 대신 다시 찍기·다른 사진');
  assert.ok(button('다시 찍기') && button('다른 사진'));

  const text = panelText();
  assert.match(text, /가게 앞 안내문이에요/);
  assert.match(text, /Closed on Mondays[\s\S]*월요일 휴무[\s\S]*화장실은 2층[\s\S]*Restroom on the 2nd floor/);
  assert.match(text, /알아 두면 좋은 표현/);
  // 영어는 단어마다 누를 수 있다 (원문이 영어면 원문, 한국어면 번역)
  const words = byClass('w').map((w) => w.textContent);
  assert.ok(words.includes('Mondays') && words.includes('Restroom'));

  button('단어장 저장').click();
  const { text: saved, meaning, type, source } = listWords()[0];
  assert.deepEqual(
    { saved, meaning, type, source },
    { saved: 'Closed on Mondays\nPlease knock', meaning: '월요일 휴무\n노크해 주세요', type: 'sentence', source: '사진 번역' }
  );

  const [h0] = getTranslateHistory();
  assert.equal(h0.photo, true);
  assert.equal(h0.source, 'Closed on Mondays\nPlease knock\n\n화장실은 2층');
  assert.deepEqual([h0.from, h0.to], ['en', 'ko']);
});

test('글자 고쳐서 다시 번역: 텍스트 칸에 읽은 글을 모두 넣고 바로 번역하지는 않는다', async () => {
  const sent = fetchCalls.length;
  button('글자 고쳐서 다시 번역').click();
  assert.equal(segment('텍스트').getAttribute('aria-pressed'), 'true');
  assert.equal(dirText(), 'English한국어', '영어 사진이면 영 → 한');
  const ta = els().find((e) => e.tagName === 'TEXTAREA');
  assert.equal(ta.value, 'Closed on Mondays\nPlease knock\n\n화장실은 2층');
  assert.equal(document.activeElement, ta);
  assert.match(panelText(), /잘못 읽은 글자를 고친 뒤/);
  assert.match(panelText(), /최근 번역 1개[\s\S]*사진/, '사진 번역 기록이 텍스트 칸 기록에 보인다');
  await tick();
  assert.equal(fetchCalls.length, sent);
  segment('사진').click();
  assert.ok(button('전체 복사'), '사진 칸 결과는 그대로 남아 있다');
});

test('실패하면 다시 시도로 같은 사진을 다시 보낸다 (다시 줄이지 않는다)', async () => {
  respond = () => new Response(JSON.stringify({ error: { code: 403, message: 'denied' } }), { status: 403 });
  const before = decoded.length;
  pick(galleryInput(), jpegFile('menu.jpg'));
  assert.equal(galleryInput().value, '');
  await until(() => button('다시 시도'), '오류와 다시 시도');
  assert.match(panelText(), /권한이 없습니다/);
  const first = fetchCalls.at(-1);

  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => button('전체 복사'), '다시 받는다');
  assert.deepEqual(fetchCalls.at(-1).contents, first.contents, '같은 사진·같은 요청문');
  assert.equal(decoded.length, before + 1, '사진은 한 번만 연다');
});

test('번역 중에 다른 탭으로 가면 멈추고, 돌아와 다시 시도하면 같은 사진으로 이어 간다', async () => {
  respond = hang;
  pick(camInput(), jpegFile());
  await until(() => panelText().includes('사진 속 글자를 읽고 번역하는 중'), '기다리는 중');
  const first = fetchCalls.at(-1);
  const aborts = hangAborts;
  hide();
  await until(() => panelText().includes('다른 화면으로 가서 멈췄어요'), '멈췄다고 알린다');
  assert.equal(hangAborts, aborts + 1, '요청을 취소한다');

  show(new URLSearchParams());
  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => button('전체 복사'), '다시 받는다');
  assert.deepEqual(fetchCalls.at(-1).contents, first.contents);
});

test('사진을 준비하는 사이 다른 탭으로 가면 보내지 않고 기다린다', async () => {
  const sent = fetchCalls.length;
  pick(camInput(), jpegFile());
  hide();
  await until(() => panelText().includes('다른 화면으로 가서 멈췄어요'), '보내지 않고 멈춘다');
  assert.equal(fetchCalls.length, sent);
  show(new URLSearchParams());
  button('다시 시도').click();
  await until(() => button('전체 복사'), '돌아와서 보낸다');
  assert.equal(fetchCalls.length, sent + 1);
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
  pick(camInput(), jpegFile('first.jpg'));
  await until(() => fetchCalls.length && panelText().includes('읽고 번역하는 중'), '앞 사진을 보냈다');
  const firstUrl = thumb().getAttribute('src');

  respond = () => sse(answer(' (새 사진)'));
  pick(galleryInput(), jpegFile('second.jpg'));
  await until(() => panelText().includes('(새 사진)') && button('전체 복사'), '새 사진의 답');
  assert.ok(!liveUrls.has(firstUrl), '앞 미리 보기 주소를 지웠다');
  assert.equal(liveUrls.size, 1, '미리 보기 주소는 하나만 남는다');

  release();
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(lateServed);
  assert.ok(!panelText().includes('(앞 사진)'), '앞 사진의 답이 새 칸에 섞이지 않는다');
  assert.ok(!getTranslateHistory().some((x) => x.result.includes('(앞 사진)')), '기록에도 넣지 않는다');

  // 닫기: 요청·미리 보기를 지우고 큰 버튼으로 돌아간다
  els()
    .find((e) => e.attributes['aria-label'] === '사진 닫기')
    .click();
  assert.equal(liveUrls.size, 0);
  assert.equal(thumb().getAttribute('src'), null);
  assert.ok(visible(button('카메라로 찍기')));
  assert.equal(button('전체 복사'), undefined);
});

test('공유받은 사진: 보관함에서 한 번만 꺼내 원본(HEIF)을 그대로 보내고, 주소에서 표시를 지운다', async () => {
  segment('텍스트').click();
  const heif = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const headers = { 'X-File-Name': encodeURIComponent('사진.HEIC') };
  inbox.set(`${BASE}shared-photo`, new Response(new Blob([heif], { type: 'image/heic' }), { headers }));
  const sent = fetchCalls.length;
  show(new URLSearchParams('photo=shared'));
  assert.equal(replaced.at(-1), '/english-helper/#/translate', '새로 고침해도 다시 꺼내지 않게');
  assert.equal(segment('사진').getAttribute('aria-pressed'), 'true');
  await until(() => button('전체 복사'), '공유받은 사진을 번역한다');
  assert.equal(inbox.size, 0, '꺼내면 지운다');
  assert.equal(fetchCalls.length, sent + 1);
  assert.equal(sentImage().mimeType, 'image/heic', '크롬이 못 여는 HEIF는 원본 그대로');
  assert.deepEqual([...Buffer.from(sentImage().data, 'base64')], [...heif]);

  show(new URLSearchParams('photo=shared'));
  await until(() => panelText().includes('공유받은 사진을 찾지 못했습니다'), '두 번 꺼내지 않는다');
  assert.equal(fetchCalls.length, sent + 1);
});

test('열 수 없는 파일은 보내지 않고 알린다', async () => {
  const sent = fetchCalls.length;
  pick(galleryInput(), new File(['hello'], 'note.txt', { type: 'text/plain' }));
  await until(() => panelText().includes('이 사진은 열 수 없습니다'), '오류');
  assert.equal(fetchCalls.length, sent);
  assert.equal(visible(byClass('photo-card')[0]), false);
});

test('일본어·베트남어 블록은 영어로 다루지 않는다: 단어 누르기·읽기·단어장 저장 없이 한국어 번역과 복사만', async () => {
  respond = () =>
    sse(
      JSON.stringify({
        noteKo: '라멘 가게 메뉴판이에요',
        blocks: [
          { lang: 'other', text: 'ラーメン Ramen ¥800', translation: '라멘 800엔' },
          { lang: 'other', text: '営業中 OPEN', translation: '영업 중' },
          { lang: 'other', text: 'Phở bò tái 65.000đ', translation: '소고기 쌀국수 65,000동' },
          { lang: 'en', text: 'Exit', translation: '출구' },
          { lang: 'ko', text: '출구', translation: 'Exit' },
        ],
        phrases: [],
        sourceLang: 'mixed',
      })
    );
  segment('사진').click();
  pick(galleryInput(), jpegFile('menu-jp.jpg'));
  await until(() => button('전체 복사'), '결과');
  const blocks = blockEls();
  assert.equal(blocks.length, 5);
  for (const b of blocks.slice(0, 3)) {
    assert.equal(wordsIn(b).length, 0, `${b.textContent}: 영어 단어 버튼이 없다`);
    assert.deepEqual(actionsIn(b), ['복사'], '읽기(영어 목소리)·단어장 저장이 없다');
    assert.equal(b.querySelector('.photo-src').getAttribute('lang'), null, 'lang="other" 같은 틀린 표시를 달지 않는다');
    assert.equal(b.querySelector('.photo-tr').getAttribute('lang'), 'ko');
  }
  // 두 언어로 쓴 안내판(출구 Exit)은 언어마다 따로 받아 각각 영어 쪽으로 읽고 저장한다
  const [exitEn, exitKo] = blocks.slice(3);
  assert.deepEqual(
    wordsIn(exitEn).map((w) => w.textContent),
    ['Exit']
  );
  assert.deepEqual(actionsIn(exitEn), ['읽기', '복사', '단어장 저장']);
  assert.deepEqual(actionsIn(exitKo), ['읽기', '복사', '단어장 저장']);
  descendants(exitKo)
    .find((e) => e.textContent === '단어장 저장')
    .click();
  const { text, meaning } = listWords()[0];
  assert.deepEqual([text, meaning], ['Exit', '출구']);
  assert.equal(getTranslateHistory()[0].from, 'ko', '한국어 블록이 있으면 텍스트 번역처럼 한국어로 본다');
});

test('일본어 사진: 글자 고쳐서 다시 번역·기록 다시 번역은 한국어로 (한 → 영 방향에 남지 않는다)', async () => {
  const jp = {
    noteKo: '가게 문 앞 안내예요',
    blocks: [
      { lang: 'other', text: '営業時間 11時〜22時', translation: '영업시간 11시~22시' },
      { lang: 'other', text: '定休日 月曜日', translation: '정기 휴일 월요일' },
    ],
    phrases: [],
    sourceLang: 'other',
  };
  respond = () => sse(JSON.stringify(jp));
  const swap = () => els().find((e) => e.attributes['aria-label'] === '번역 방향 바꾸기');
  if (dirText() !== '한국어English') swap().click();
  assert.equal(dirText(), '한국어English', '지금은 한 → 영');

  segment('사진').click();
  pick(camInput(), jpegFile('jp.jpg'));
  await until(() => button('글자 고쳐서 다시 번역'), '결과');
  const item = getTranslateHistory()[0];
  assert.deepEqual([item.from, item.to, item.photo], ['other', 'ko', true], '영어(en)로 적지 않는다');

  button('글자 고쳐서 다시 번역').click();
  assert.equal(els().find((e) => e.tagName === 'TEXTAREA').value, '営業時間 11時〜22時\n\n定休日 月曜日');
  assert.equal(dirText(), 'English한국어', '일본어는 한국어로 번역하도록 영 → 한');

  // 기록을 누르면: 방향을 한 → 영으로 바꿔 둬도 한국어로 다시 번역한다
  swap().click();
  assert.equal(dirText(), '한국어English');
  respond = () => sse('영업시간 11시~22시\n\n정기 휴일 월요일');
  byClass('history-item')
    .find((e) => e.textContent.includes('営業時間'))
    .click();
  await until(() => panelText().includes('English → 한국어'), '영 → 한으로 번역');
  assert.equal(dirText(), 'English한국어');
  assert.match(fetchCalls.at(-1).systemInstruction.parts[0].text, /into natural, everyday Korean/);
  assert.match(panelText(), /정기 휴일 월요일/);
});

test('저작권으로 요약만 받으면 블록마다 복사만 두고, 짧은 이름표는 그냥 글자로 보여 준다', async () => {
  const gist = {
    noteKo: '소설책 한 쪽이에요',
    blocks: [
      { lang: 'en', text: 'Chapter 1', translation: '주인공이 집을 떠나는 장면' },
      { lang: 'ko', text: '1장 첫 문단', translation: 'The hero leaves home' },
    ],
    phrases: [],
    sourceLang: 'en',
  };
  let n = 0;
  respond = () => (n++ === 0 ? recitation() : sse(JSON.stringify(gist)));
  const words = listWords().length;
  const history = getTranslateHistory().length;
  segment('사진').click();
  pick(camInput(), jpegFile('book.jpg'));
  await until(() => button('전체 복사'), '요약을 받는다');
  assert.equal(n, 2);
  assert.match(panelText(), /저작권 보호 때문에 원문을 그대로 옮기지 않고 줄여서 보여 드려요/);
  const [label, korean] = blockEls();
  assert.equal(wordsIn(label).length, 0, '이름표(Chapter 1)는 누를 수 없다');
  assert.equal(label.querySelector('.photo-src').textContent, 'Chapter 1');
  assert.deepEqual(actionsIn(label), ['복사'], '읽기·단어장 저장이 없다');
  assert.deepEqual(actionsIn(korean), ['복사']);
  assert.equal(button('글자 고쳐서 다시 번역'), undefined, '고칠 원문이 없다');
  assert.equal(listWords().length, words);
  assert.equal(getTranslateHistory().length, history, '기록에 넣지 않는다');
});

test('아주 긴 스크롤 캡처: 너비를 지키며 6조각으로 나눠 차례로 보내고, 줄였다고 알리며, 다시 시도는 같은 조각을 보낸다', async () => {
  respond = denied;
  segment('사진').click();
  const before = decoded.length;
  pick(galleryInput(), photoFile('scroll.png', [1080, 20000]));
  await until(() => button('다시 시도'), '오류와 다시 시도');
  assert.equal(decoded.length, before + 1);
  assert.deepEqual(decoded.at(-1).opts, {
    imageOrientation: 'from-image',
    resizeWidth: 950,
    resizeHeight: 17600,
    resizeQuality: 'high',
  });
  assert.deepEqual(drawn.at(-1), [0, 14600, 950, 3000, 0, 0, 950, 3000], '마지막 조각');
  const first = fetchCalls.at(-1);
  const parts = first.contents[0].parts;
  assert.equal(parts.length, 7, '조각 6개 + 요청문');
  assert.deepEqual(
    parts.slice(0, 6).map(sentText),
    [0, 2920, 5840, 8760, 11680, 14600].map((y) => `JPEG950x3000@${y}`),
    '위에서부터 차례로'
  );
  assert.match(parts[6].text, /^These 6 images are consecutive parts of ONE long screenshot/);
  const note = els().find((e) => e.tagName === 'P' && e.textContent.includes('아주 긴 캡처라'));
  assert.ok(note && visible(note), '글자가 작을 수 있다고 알린다');
  assert.equal(urlBlobs.get(thumb().getAttribute('src')).size, 'JPEG950x3000@0'.length, '미리 보기는 첫 조각');

  respond = () => sse(answer());
  button('다시 시도').click();
  await until(() => button('전체 복사'), '다시 받는다');
  assert.deepEqual(fetchCalls.at(-1).contents, first.contents, '같은 조각·같은 요청문');
  assert.equal(decoded.length, before + 1, '다시 열거나 자르지 않는다');

  // 보통 사진으로 바꾸면 안내를 숨긴다
  pick(galleryInput(), jpegFile('small.jpg'));
  await until(() => button('전체 복사') && note.hidden, '안내를 숨긴다');
  assert.equal(fetchCalls.at(-1).contents[0].parts.length, 2);
});

test('큰 사진(2억 화소)도 원본 크기로 풀지 않고 처음부터 줄여서 연다', async () => {
  respond = () => sse(answer());
  segment('사진').click();
  pick(camInput(), photoFile('200mp.jpg', [16320, 12240]));
  await until(() => button('전체 복사'), '결과');
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
  assert.equal(sentText(sentImage()), 'JPEG2048x1536');
});

test('돌려 찍은 사진: 줄인 뒤 돌리는 크롬이면(가로·세로가 바뀌어 나옴) 반대로 다시 열어 찌그러지지 않게 한다', async () => {
  respond = () => sse(answer());
  segment('사진').click();
  const before = decoded.length;
  pick(camInput(), photoFile('portrait.jpg', [3000, 4000], { swap: true }));
  await until(() => button('전체 복사'), '결과');
  assert.deepEqual(
    decoded.slice(before).map((d) => [d.opts.resizeWidth, d.opts.resizeHeight]),
    [
      [1536, 2048],
      [2048, 1536],
    ]
  );
  assert.deepEqual(drawn.at(-1), [0, 0, 1536, 2048]);
  assert.equal(sentText(sentImage()), 'JPEG1536x2048', '세로 사진 그대로');
});

test('createImageBitmap으로 못 열면 <img>를 줄여 그린다 (긴 캡처는 원본 크기 기준으로 잘라 그린다)', async () => {
  respond = () => sse(answer());
  segment('사진').click();
  pick(galleryInput(), photoFile('odd.jpg', [4000, 3000], { noBitmap: true }));
  await until(() => button('전체 복사'), '결과');
  assert.ok(drawnFrom.at(-1) instanceof Image);
  assert.deepEqual(drawn.at(-1), [0, 0, 2048, 1536]);
  assert.equal(sentText(sentImage()), 'JPEG2048x1536');

  pick(galleryInput(), photoFile('odd-scroll.jpg', [2160, 16000], { noBitmap: true }));
  await until(() => fetchCalls.at(-1).contents[0].parts.length === 4 && button('전체 복사'), '3조각');
  assert.deepEqual(drawn.at(-1), [0, 10560, 2160, 5440, 0, 0, 1080, 2720], '원본 크기로 잘라 1080px 너비로 그린다');
  assert.equal(liveUrls.size, 1, '크기를 읽느라 만든 주소는 지운다 (미리 보기 하나만)');
});

test('Gemini 키가 없으면 키 안내와 휴대폰 기능 안내를 보여 주고 보내지 않는다', async () => {
  updateSettings({ geminiKey: '' });
  assert.equal(keyBox().hidden, false);
  assert.match(keyBox().textContent, /사진 번역은 Gemini API 키가 있어야 합니다\. 설정에서 키 넣기/);
  assert.match(keyBox().textContent, /갤럭시 카메라[\s\S]*서클 투 서치[\s\S]*휴대폰·버전에 따라 이름이 다를 수 있어요/);
  const sent = fetchCalls.length;
  pick(camInput(), jpegFile());
  await until(() => button('번역하기'), '키를 넣은 뒤 누를 버튼');
  assert.equal(fetchCalls.length, sent);

  updateSettings({ geminiKey: 'k' });
  assert.equal(keyBox().hidden, true, '키를 넣으면 안내를 숨긴다');
  button('번역하기').click();
  await until(() => button('전체 복사'), '키를 넣고 누르면 보낸다');
  assert.equal(fetchCalls.length, sent + 1);
  hide();
});

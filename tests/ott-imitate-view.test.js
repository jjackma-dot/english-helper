// OTT "들린 대로 말하기·적어서 묻기" 화면 흐름을 가짜 DOM·마이크·fetch로 시험한다:
// 마이크를 언제 열고 닫는지(두 번 누르기, 다른 탭·다른 앱으로 가기, 15초 자동 끝, 닫기), 요청 멈춤과 다시 시도
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
    return sel.split(',').some((s) => s.trim() === this.tagName.toLowerCase());
  }
  /** 진짜 브라우저처럼 막힌 버튼은 눌리지 않는다 */
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

function descendants(root) {
  const out = [];
  const walk = (n) => {
    if (!(n instanceof FakeElement)) return;
    out.push(n);
    n.childNodes.forEach(walk);
  };
  walk(root);
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
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (t) => clearTimeout(t);

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

/* ---------- 가짜 마이크·오디오 ---------- */

const tracks = [];
const gumCalls = []; // {audio, liveBefore: 그때 켜져 있던 마이크 수}
let gumGate = null; // 정해 두면 권한 창처럼 마이크 열기를 그때까지 미룬다
let lastNode = null;

class FakeTrack extends EventTarget {
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}
globalThis.AudioContext = class {
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource = () => ({ connect: (n) => n, disconnect() {} });
  createGain = () => ({ gain: { value: 1 }, connect: (n) => n });
  close = async () => {};
};
globalThis.AudioWorkletNode = class {
  constructor() {
    this.port = { onmessage: null };
    lastNode = this;
  }
  connect(n) {
    return n;
  }
  disconnect() {}
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    mediaDevices: {
      getUserMedia: async ({ audio }) => {
        gumCalls.push({ audio, liveBefore: tracks.filter((t) => t.readyState === 'live').length });
        if (gumGate) await gumGate;
        const t = new FakeTrack();
        tracks.push(t);
        return { getAudioTracks: () => [t], getTracks: () => [t] };
      },
    },
  },
});

/* ---------- 가짜 Gemini ---------- */

const enc = new TextEncoder();
const sse = (text) =>
  new Response(
    new ReadableStream({
      start(c) {
        const chunk = { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
        c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        c.close();
      },
    })
  );
const ANSWER = JSON.stringify({
  heard: '아이 고나 웨이릿',
  lines: [
    { en: "I'm gonna wait it out.", ko: '끝날 때까지 기다릴래.' },
    { en: "I'm gonna weigh it out.", ko: '따져 볼게.' },
  ],
  phrases: [],
  explanationKo: 't가 모음 사이에서 ㄹ처럼 들려요.',
  confidence: 'medium',
});
const fetchCalls = [];
let respond = () => sse(ANSWER);
globalThis.fetch = async (url, init) => {
  fetchCalls.push(JSON.parse(init.body));
  return respond(init);
};
let hangAborts = 0; // hang 요청이 취소된 횟수
/** 취소될 때까지 답하지 않는 서버 */
const hang = (init) =>
  new Promise((_, reject) =>
    init.signal.addEventListener('abort', () => {
      hangAborts++;
      reject(new DOMException('Aborted', 'AbortError'));
    })
  );

/* ---------- 화면 ---------- */

const { buildListenCard, stopListening } = await import('../js/views/ott-listen.js');
const { updateSettings } = await import('../js/store.js');
const card = buildListenCard();
body.append(card);

const els = () => descendants(card);
const button = (label) => els().find((e) => e.tagName === 'BUTTON' && e.textContent.includes(label));
const byClass = (c) => els().find((e) => e.classList.contains(c));
const main = () => byClass('listen-btn');
const result = () => byClass('listen-result').textContent;
const closeBtn = () => els().find((e) => e.attributes['aria-label'] === '닫기');
const toastText = () => document.getElementById('toast')?.textContent ?? '';
const live = () => tracks.filter((t) => t.readyState === 'live').length;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check, what) {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  assert.ok(check(), what);
}
/** 48kHz 마이크 조각 (워클릿이 보내는 것처럼) */
const chunk = (n, v) => lastNode.port.onmessage({ data: new Float32Array(n).fill(v) });

// 녹음을 끝내자마자 다시 눌린 손가락은 무시하므로(두 번 누름 막기), 새로 누를 때는 시계를 1초 넘긴다
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
function pressRecord() {
  skew += 1000;
  button('누르고 말하기').click();
}

async function startMimic() {
  pressRecord();
  await until(() => button('다 말했으면 누르기'), '녹음이 시작된다');
}

test('들린 대로 말하기: 내 목소리용 마이크로 녹음하고, 다시 누르면 마이크를 끄고 보내서 후보를 보여 준다', async () => {
  button('들린 대로 말하기').click();
  assert.ok(byClass('guess-card'), '결과 칸에 녹음기가 열린다');
  assert.ok(button('들린 대로 말하기').classList.contains('on'));
  assert.ok(card.classList.contains('guessing'));
  const scene = els().find((e) => e.tagName === 'INPUT');
  scene.value = '프렌즈 시즌1';
  scene.dispatchEvent(new Event('input'));
  assert.equal(sessionStorage.mem.get('eh.ottScene'), '프렌즈 시즌1', '장면 메모는 sessionStorage에');

  await startMimic();
  // 안드로이드: 통화 모드(볼륨 버튼 = 통화 음량)가 되지 않게 에코 제거만 끈다
  assert.deepEqual(gumCalls.at(-1).audio, {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  });
  assert.equal(main().disabled, true, '따라 말하는 동안에는 듣기를 시작하지 않는다');
  chunk(48000, 0.3); // 1초
  button('다 말했으면 누르기').click();
  assert.equal(live(), 0, '누르자마자 마이크를 끈다');
  assert.equal(main().disabled, false);
  assert.ok(button('누르고 말하기'));

  await until(() => result().includes('따져 볼게'), '후보가 다 나온다');
  const [audio, prompt] = fetchCalls.at(-1).contents[0].parts;
  assert.equal(audio.inlineData.mimeType, 'audio/wav');
  assert.equal(Buffer.from(audio.inlineData.data, 'base64').length, 44 + 16000 * 2, '16kHz로 1초');
  assert.match(prompt.text, /IMITATING[\s\S]*"프렌즈 시즌1"/);
  assert.match(result(), /Gemini가 들은 내 소리: 아이 고나 웨이릿/);
  assert.match(result(), /가장 그럴듯한 대사I'm gonna wait it out\.[\s\S]*다른 후보I'm gonna weigh it out\./);
  assert.match(result(), /짐작이에요/);

  closeBtn().click();
  assert.equal(byClass('guess-card'), undefined);
  assert.ok(!button('들린 대로 말하기').classList.contains('on'));
  assert.ok(!card.classList.contains('guessing'));
});

test('마이크 여는 중(권한 창)에 다시 누르면 그만두고, 늦게 열린 마이크도 바로 닫는다', async () => {
  const sent = fetchCalls.length;
  let open;
  gumGate = new Promise((r) => (open = r));
  button('들린 대로 말하기').click();
  pressRecord();
  assert.ok(button('마이크 여는 중'));
  assert.equal(main().disabled, true);
  button('마이크 여는 중').click();
  assert.ok(button('누르고 말하기'));
  assert.equal(main().disabled, false);
  const made = tracks.length;
  gumGate = null;
  open();
  await until(() => tracks.length > made && tracks.at(-1).readyState === 'ended', '늦게 열린 마이크를 닫는다');
  await tick();
  assert.equal(live(), 0);
  assert.ok(button('누르고 말하기'), '녹음 중으로 바뀌지 않는다');
  assert.equal(fetchCalls.length, sent);
  closeBtn().click();
});

test('녹음 중에 다른 탭으로 가거나 앱이 화면에서 사라지면 녹음을 버리고 마이크를 끈다', async () => {
  const sent = fetchCalls.length;
  button('들린 대로 말하기').click();
  await startMimic();
  chunk(48000, 0.3);
  stopListening(); // OTT 탭을 떠날 때 ott.js가 부른다
  assert.equal(live(), 0);
  assert.match(result(), /다른 화면으로 가서 녹음을 멈췄어요/);
  assert.ok(button('누르고 말하기'));

  await startMimic();
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  document.visibilityState = 'visible';
  assert.equal(live(), 0);

  // 마이크가 열리는 사이에 다른 앱으로 갔다
  let open;
  gumGate = new Promise((r) => (open = r));
  pressRecord();
  document.visibilityState = 'hidden';
  const made = tracks.length;
  gumGate = null;
  open();
  await until(() => tracks.length > made && tracks.at(-1).readyState === 'ended', '열리자마자 닫는다');
  await tick();
  document.visibilityState = 'visible';
  assert.ok(button('누르고 말하기'));
  assert.equal(main().disabled, false);

  assert.equal(fetchCalls.length, sent, '아무것도 보내지 않는다');
  closeBtn().click();
});

test('15초가 되면 저절로 끝내고 보내며, 너무 짧거나 조용한 녹음은 보내지 않는다', async () => {
  button('들린 대로 말하기').click();
  let sent = fetchCalls.length;
  await startMimic();
  chunk(48000 * 15, 0.3);
  assert.equal(live(), 0, '15초에서 마이크를 끈다');
  await until(() => fetchCalls.length === sent + 1, '바로 보낸다');
  await until(() => result().includes('따져 볼게'), '결과를 보여 준다');

  sent = fetchCalls.length;
  await startMimic();
  button('다 말했으면 누르기').click();
  await tick();
  assert.match(result(), /너무 짧아요/);

  await startMimic();
  chunk(48000, 0.001);
  button('다 말했으면 누르기').click();
  await tick();
  assert.match(result(), /목소리가 들리지 않았어요/);
  assert.equal(fetchCalls.length, sent);
  closeBtn().click();
});

test('듣는 중이면 듣기를 먼저 끄고 녹음한다 (두 마이크를 함께 열지 않는다)', async () => {
  main().click();
  await until(() => main().textContent.includes('방금 뭐라고?'), '듣기가 시작된다');
  assert.equal(gumCalls.at(-1).audio.echoCancellation, false);
  assert.equal(live(), 1);

  button('들린 대로 말하기').click();
  await startMimic();
  assert.equal(gumCalls.at(-1).audio.noiseSuppression, true, '내 목소리용 마이크 (듣기는 소리 처리를 모두 끈다)');
  assert.equal(gumCalls.at(-1).liveBefore, 0, '듣던 마이크를 먼저 닫았다');
  assert.match(toastText(), /듣기를 끄고/);
  assert.ok(main().textContent.includes('듣기 시작'));
  closeBtn().click();
  assert.equal(live(), 0, '닫기도 녹음 중인 마이크를 끈다');
});

test('짐작하는 중에 다른 탭으로 가면 멈추고, 다시 시도하면 같은 녹음을 다시 보낸다', async () => {
  respond = hang;
  button('들린 대로 말하기').click();
  await startMimic();
  chunk(48000, 0.3);
  button('다 말했으면 누르기').click();
  await until(() => result().includes('짐작하는 중'), '기다리는 중');
  const first = fetchCalls.at(-1);
  stopListening();
  await until(() => result().includes('다른 화면으로 가서 멈췄어요'), '멈췄다고 알린다');

  respond = () => sse(ANSWER);
  button('다시 시도').click();
  await until(() => result().includes('따져 볼게'), '다시 받는다');
  assert.deepEqual(fetchCalls.at(-1).contents, first.contents, '같은 녹음·같은 요청문');

  // 결과 칸을 닫으면 진행 중인 요청도 멈춘다 (닫은 칸에 늦게 그리지 않는다)
  respond = hang;
  await startMimic();
  chunk(48000, 0.3);
  button('다 말했으면 누르기').click();
  await until(() => result().includes('짐작하는 중'), '기다리는 중');
  const aborts = hangAborts;
  closeBtn().click();
  await tick();
  assert.equal(result(), '');
  assert.equal(hangAborts, aborts + 1, '닫으면 요청을 취소한다');
  respond = () => sse(ANSWER);
});

test('녹음을 끝내자마자 다시 눌린 손가락(두 번 누름)으로는 새 녹음을 시작하지 않는다', async () => {
  button('들린 대로 말하기').click();
  await startMimic();
  chunk(48000, 0.3);
  const sent = fetchCalls.length;
  const opened = gumCalls.length;
  button('다 말했으면 누르기').click();
  button('누르고 말하기').click(); // 같은 자리를 곧바로 한 번 더
  await until(() => result().includes('따져 볼게'), '보낸 녹음의 결과가 그대로 나온다');
  assert.equal(gumCalls.length, opened, '마이크를 다시 열지 않는다');
  assert.equal(live(), 0);
  assert.equal(fetchCalls.length, sent + 1);
  closeBtn().click();
});

test('적어서 묻기: 빈칸이면 묻지 않고, 적은 소리와 장면을 보내며, 두 번 눌러도 한 번만 묻는다', async () => {
  button('적어서 묻기').click();
  assert.ok(button('적어서 묻기').classList.contains('on'));
  const box = els().find((e) => e.tagName === 'TEXTAREA');
  assert.equal(document.activeElement, box, '바로 적을 수 있게');
  const sent = fetchCalls.length;
  button('물어보기').click();
  assert.match(toastText(), /먼저 적어/);
  assert.equal(fetchCalls.length, sent);

  box.value = '  아이 고나 웨더 잇 ';
  button('물어보기').click();
  button('물어보기').click();
  await until(() => result().includes('따져 볼게'), '결과를 보여 준다');
  assert.equal(fetchCalls.length, sent + 1);
  const { parts } = fetchCalls.at(-1).contents[0];
  assert.equal(parts.length, 1, '소리 없이 글만');
  assert.match(parts[0].text, /"프렌즈 시즌1"[\s\S]*"""\n아이 고나 웨더 잇\n"""$/);
  assert.equal(button('물어보기').disabled, false);

  // 다른 칩을 누르면 바뀌고, 다시 열면 적은 글이 남아 있다
  button('들린 대로 말하기').click();
  assert.ok(button('누르고 말하기'));
  assert.equal(els().find((e) => e.tagName === 'TEXTAREA'), undefined);
  button('적어서 묻기').click();
  assert.equal(els().find((e) => e.tagName === 'TEXTAREA').value, '  아이 고나 웨더 잇 ');
  button('적어서 묻기').click();
  assert.equal(byClass('guess-card'), undefined, '같은 칩을 다시 누르면 닫는다');
});

test('Gemini 키가 없으면 마이크를 열지 않고 키 안내를 보여 준다', async () => {
  updateSettings({ geminiKey: '' });
  const opened = gumCalls.length;
  const sent = fetchCalls.length;
  button('들린 대로 말하기').click();
  pressRecord();
  await tick();
  assert.equal(gumCalls.length, opened);
  assert.match(result(), /대사 짐작은 무료 Gemini 키가 있어야 합니다\. 설정에서 키 넣기/);

  button('적어서 묻기').click();
  button('물어보기').click();
  await tick();
  assert.match(result(), /설정에서 키 넣기/);
  assert.equal(fetchCalls.length, sent);
  closeBtn().click();
  updateSettings({ geminiKey: 'k' });
  stopListening();
  assert.equal(live(), 0);
});

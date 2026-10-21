// 기기별(안드로이드·아이폰) 번역·OTT·AI 회화 화면 테스트용 가짜 브라우저:
// 화면(DOM), 음성 인식·음성 합성, 마이크, 공유·클립보드·새 창, 무료 번역(fetch).
// ui.js는 불러올 때 userAgent로 기기를 정하므로 앱 모듈을 import하기 전에 installEnv()를 부른다.
// (테스트 파일마다 따로 실행되므로 기기마다 파일을 나눈다)

/** 지금 사용자가 누르는 중인지 (click() 처리 안). 아이폰은 이때만 읽기·새 창이 허락된다 */
export const gesture = { active: false };

export class FakeNode extends EventTarget {
  parentNode = null;
  get parentElement() {
    return this.parentNode;
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  get nextSibling() {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  before(...nodes) {
    this.parentNode?.insertNodes(this, nodes);
  }
  after(...nodes) {
    this.parentNode?.insertNodes(this.nextSibling, nodes);
  }
  replaceWith(...nodes) {
    const p = this.parentNode;
    if (!p) return;
    const next = this.nextSibling;
    this.remove();
    p.insertNodes(next, nodes);
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

export class FakeElement extends FakeNode {
  childNodes = [];
  attributes = {};
  style = {};
  dataset = {};
  hidden = false;
  disabled = false;
  checked = false;
  readOnly = false;
  value = '';
  open = false;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
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
  hasAttribute(k) {
    return k in this.attributes;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  /** ref 앞에 넣는다 (ref가 없으면 맨 뒤) */
  insertNodes(ref, nodes) {
    const list = nodes.map((n) => (n instanceof FakeNode ? n : new FakeText(n)));
    for (const n of list) n.remove();
    let i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) i = this.childNodes.length;
    for (const n of list) {
      n.parentNode = this;
      this.childNodes.splice(i++, 0, n);
    }
  }
  append(...nodes) {
    this.insertNodes(null, nodes);
  }
  prepend(...nodes) {
    this.insertNodes(this.firstChild, nodes);
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
  get children() {
    return this.childNodes.filter((n) => n instanceof FakeElement);
  }
  get childElementCount() {
    return this.children.length;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    this.replaceChildren(String(v));
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  matches(sel) {
    return sel.split(',').some((s) => matchSimple(this, s.trim()));
  }
  closest(sel) {
    for (let x = this; x; x = x.parentNode) if (x instanceof FakeElement && x.matches(sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    return descendants(this)
      .slice(1)
      .filter((e) => e.matches(sel));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  click() {
    if (this.disabled) return;
    const was = gesture.active;
    gesture.active = true;
    try {
      this.dispatchEvent(new Event('click'));
    } finally {
      gesture.active = was;
    }
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
  focus() {
    document.activeElement = this;
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null;
  }
  select() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

/** 'span', '.btn.primary', 'button.w', 'input' 같은 간단한 선택자만 */
function matchSimple(e, sel) {
  const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
  if (!m) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  return m[2]
    .split('.')
    .filter(Boolean)
    .every((c) => e.classList.contains(c));
}

export function descendants(rootEl) {
  const out = [];
  const walk = (n) => {
    if (!(n instanceof FakeElement)) return;
    out.push(n);
    n.childNodes.forEach(walk);
  };
  walk(rootEl);
  return out;
}

/** 글자만 (줄바꿈·여러 칸 공백은 한 칸으로) */
export const text = (el) => el.textContent.replace(/\s+/g, ' ');
export const tick = () => new Promise((r) => setTimeout(r, 0));
export async function until(check, what) {
  for (let i = 0; i < 300 && !check(); i++) await tick();
  if (!check()) throw new Error(`기다렸지만 되지 않음: ${what}`);
}

const storage = (init = []) => {
  const mem = new Map(init);
  return {
    mem,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
};

/* ---------- 음성 인식 ---------- */

/** 만든 인식기 (새로 시작할 때마다 하나씩). calls: 'start'·'stop'·'abort' 순서 */
export const recognizers = [];

class FakeRecognition {
  calls = [];
  constructor() {
    recognizers.push(this);
  }
  start() {
    this.calls.push('start');
  }
  stop() {
    this.calls.push('stop');
    setTimeout(() => this.onend?.(), 0);
  }
  abort() {
    this.calls.push('abort');
    setTimeout(() => {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }, 0);
  }
  /** 한 문장을 다 말한 것처럼 최종 결과를 보낸다 */
  say(transcript) {
    const res = Object.assign([{ transcript }], { isFinal: true });
    this.onresult?.({ resultIndex: 0, results: [res] });
  }
}

/* ---------- 음성 합성 ---------- */

/** 읽기 요청: {text, volume, lang, gesture: 누르는 중에 불렸는지} */
export const spoken = [];

class FakeUtterance {
  volume = 1;
  constructor(t) {
    this.text = t;
  }
}

function fakeSynth() {
  const synth = Object.assign(new EventTarget(), {
    speaking: false,
    pending: false,
    getVoices: () => [],
    cancel() {
      synth.speaking = false;
    },
    speak(u) {
      spoken.push({ text: u.text, volume: u.volume, lang: u.lang, gesture: gesture.active });
      if (!u.text.trim()) return; // 깨우기용 빈 읽기: 소리도 알림도 없다
      synth.speaking = true;
      setTimeout(() => {
        u.onstart?.();
        setTimeout(() => {
          synth.speaking = false;
          u.onend?.();
        }, 0);
      }, 0);
    },
  });
  return synth;
}

/* ---------- 마이크 ---------- */

export const mic = { tracks: [], node: null, audio: [] }; // audio: getUserMedia에 준 오디오 조건 (부른 차례대로)

class FakeTrack extends EventTarget {
  readyState = 'live';
  muted = false;
  stop() {
    this.readyState = 'ended';
  }
}

/** 워클릿이 보내는 것처럼 48kHz 마이크 조각을 보낸다 */
export function micChunk(n = 48000, v = 0.3) {
  mic.node.port.onmessage?.({ data: new Float32Array(n).fill(v) });
}

/**
 * 전역(window·document·navigator…)을 가짜로 채운다.
 * @param {{userAgent: string, standalone?: boolean, speechRecognition?: boolean, microphone?: boolean,
 *          settings?: object, navigator?: object}} o
 */
export function installEnv({
  userAgent,
  standalone = false,
  speechRecognition = true,
  microphone = true,
  settings = {},
  navigator: navExtra = {},
}) {
  const body = new FakeElement('body');
  globalThis.Node = FakeNode;
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: 'visible',
    title: '',
    body,
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
    getElementById: (id) => descendants(body).find((e) => e.attributes.id === id) ?? null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  });
  const winEvents = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = winEvents.addEventListener.bind(winEvents);
  globalThis.removeEventListener = winEvents.removeEventListener.bind(winEvents);
  globalThis.dispatchEvent = winEvents.dispatchEvent.bind(winEvents);
  globalThis.scrollTo = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  globalThis.confirm = () => false;
  globalThis.matchMedia = (q) => ({
    matches: /display-mode:\s*standalone/.test(q) ? standalone : false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.localStorage = storage([['eh.settings.v1', JSON.stringify(settings)]]);
  globalThis.sessionStorage = storage();
  globalThis.location = { hash: '', search: '', pathname: '/english-helper/', hostname: 'example.github.io', href: '' };
  globalThis.history = { replaceState() {} };

  // 새 창: {url, gesture: 누르는 중에 열었는지}
  const opened = [];
  globalThis.open = (url) => {
    opened.push({ url, gesture: gesture.active });
    return null;
  };

  // 클립보드: 복사는 한 박자 뒤에 끝난다 (그사이 새 창을 여는지 본다)
  const copied = [];
  const clipboard = {
    writeText: (t) => {
      const entry = { text: t, gesture: gesture.active, done: false };
      copied.push(entry);
      return new Promise((r) => setTimeout(() => r((entry.done = true)), 0));
    },
  };

  if (speechRecognition) globalThis.webkitSpeechRecognition = FakeRecognition;
  globalThis.speechSynthesis = fakeSynth();
  globalThis.SpeechSynthesisUtterance = FakeUtterance;

  const nav = { userAgent, maxTouchPoints: 0, language: 'ko-KR', clipboard, ...navExtra };
  if (standalone && /iPhone/.test(userAgent)) nav.standalone = true;
  if (microphone) {
    nav.mediaDevices = {
      getUserMedia: async ({ audio } = {}) => {
        mic.audio.push(audio);
        const t = new FakeTrack();
        mic.tracks.push(t);
        return { getAudioTracks: () => [t], getTracks: () => [t] };
      },
    };
    globalThis.AudioContext = class {
      sampleRate = 48000;
      state = 'running';
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource = () => ({ connect: (n) => n, disconnect() {} });
      createGain = () => ({ gain: { value: 1 }, connect: (n) => n, disconnect() {} });
      resume = async () => {};
      close = async () => {};
    };
    globalThis.AudioWorkletNode = class {
      constructor() {
        this.port = { onmessage: null };
        mic.node = this;
      }
      connect(n) {
        return n;
      }
      disconnect() {}
    };
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });

  // 무료 번역(MyMemory)
  const fetched = [];
  const translation = { text: '번역된 문장' };
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: translation.text } }));
  };

  return { body, nav, opened, copied, fetched, translation };
}

/** 화면 하나를 만들어 init()한다 */
export function mount(mod, body) {
  const view = new FakeElement('section');
  body.append(view);
  mod.init(view);
  return view;
}

/** root 안에서 글자를 포함하는 버튼 */
export const button = (root, label) =>
  descendants(root).find((e) => e.tagName === 'BUTTON' && e.textContent.includes(label));

/** 번역 방식 같은 세그먼트 버튼 (글자가 꼭 같은 것) */
export const segment = (root, label) =>
  descendants(root).find((e) => e.tagName === 'BUTTON' && e.dataset.value && e.textContent === label);

export const toastText = () => document.getElementById('toast')?.textContent ?? '';

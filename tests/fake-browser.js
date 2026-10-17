// 기기별 화면 테스트용 아주 작은 가짜 브라우저 (ui.js의 h()·openSheet·icon과 app.js 머리글이 쓰는 만큼만).
// ui.js는 불러올 때 userAgent로 기기(안드로이드·아이폰·앱 안 브라우저)를 정하므로,
// 앱 모듈을 import하기 전에 installFakeBrowser()를 부른다. (테스트 파일마다 따로 실행되므로 기기마다 파일을 나눈다)

export class FakeNode extends EventTarget {
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

export class FakeElement extends FakeNode {
  childNodes = [];
  attributes = {};
  style = {};
  dataset = {};
  hidden = false;
  disabled = false;
  checked = false;
  value = '';
  open = false;
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
  prepend(...nodes) {
    const rest = this.childNodes.splice(0);
    for (const n of rest) n.parentNode = null;
    this.append(...nodes, ...rest);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get children() {
    return this.childNodes.filter((n) => n instanceof FakeElement);
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    while (this.firstChild) this.firstChild.remove();
    this.append(String(v));
  }
  matches(sel) {
    return sel.split(',').some((s) => matchSelector(this, s.trim()));
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
    if (this.tagName === 'A') clickedLinks.push(this);
    this.dispatchEvent(new Event('click'));
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
  focus() {}
}

/** 'span', '.btn.primary', 'a[data-icon]', '.tabbar a' 같은 간단한 선택자만 */
function matchSelector(e, sel) {
  const parts = sel.split(/\s+/);
  if (!matchCompound(e, parts.pop())) return false;
  let node = e.parentNode;
  while (parts.length && node) {
    if (matchCompound(node, parts.at(-1))) parts.pop();
    node = node.parentNode;
  }
  return parts.length === 0;
}

function matchCompound(e, sel) {
  const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/i);
  if (!m || !(e instanceof FakeElement)) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  if (m[3]) {
    const key = m[3].replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (!(m[3] in e.attributes) && !(m[3].startsWith('data-') && key in e.dataset)) return false;
  }
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

/** <a download>.click()으로 내려받으려 한 링크들 */
export const clickedLinks = [];

const storage = () => {
  const mem = new Map();
  return {
    mem,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    get length() {
      return mem.size;
    },
    key: (i) => [...mem.keys()][i] ?? null,
  };
};

/**
 * 전역(window·document·navigator…)을 가짜로 채운다.
 * @param {{userAgent: string, standalone?: boolean, maxTouchPoints?: number, navigator?: object, hash?: string}} opts
 */
export function installFakeBrowser({ userAgent, standalone = false, maxTouchPoints = 0, navigator = {}, hash = '' }) {
  const body = new FakeElement('body');
  const doc = Object.assign(new EventTarget(), {
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
  globalThis.Node = FakeNode;
  globalThis.document = doc;
  const winEvents = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = winEvents.addEventListener.bind(winEvents);
  globalThis.removeEventListener = winEvents.removeEventListener.bind(winEvents);
  globalThis.dispatchEvent = winEvents.dispatchEvent.bind(winEvents);
  globalThis.scrollTo = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  globalThis.confirm = () => false;
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  const display = { standalone };
  globalThis.matchMedia = (q) => ({
    matches: /display-mode:\s*standalone/.test(q) ? display.standalone : false,
    addEventListener() {},
    removeEventListener() {},
  });
  const nav = { userAgent, maxTouchPoints, language: 'ko-KR', ...navigator };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  const loc = { hash, search: '', pathname: '/english-helper/', hostname: 'example.github.io' };
  loc.href = `https://${loc.hostname}${loc.pathname}${hash}`;
  globalThis.location = loc;
  globalThis.history = {
    replaceState: (_s, _t, url) => {
      loc.hash = String(url).replace(/^[^#]*/, '');
    },
  };
  return {
    body,
    nav,
    display,
    /** 화면을 다시 보거나 숨긴 것처럼 visibilitychange를 보낸다 */
    setVisible(visible) {
      doc.hidden = !visible;
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

/** index.html의 머리글·화면 칸 (app.js가 찾는 것만) */
export function buildShell(body) {
  const el = (tag, attrs = {}, ...kids) => {
    const e = new FakeElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'hidden') e.hidden = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  const installBtn = el('button', { id: 'install-btn', class: 'btn small primary', hidden: true }, '앱 설치');
  body.append(
    el('header', { class: 'app-header' }, el('h1', { id: 'view-title' }, 'English Helper'), installBtn),
    el(
      'main',
      { id: 'views' },
      ...['tutor', 'dict', 'translate', 'ott', 'words', 'settings'].map((v) =>
        el('section', { id: `view-${v}`, class: 'view', hidden: true })
      )
    )
  );
  return { installBtn };
}

export const text = (el) => el.textContent.replace(/\s+/g, ' ');
export const flush = () => new Promise((r) => setTimeout(r, 0));

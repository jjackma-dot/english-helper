// 화면 구성 공통 헬퍼: 요소 생성, 토스트, 바텀시트, 복사, 공유
// 외부 데이터는 항상 textContent로 넣어 XSS를 막는다 (innerHTML 사용 금지).

import { icon } from './icons.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'multiple', 'readOnly', 'open']);

/**
 * h('button', { class: 'btn', onclick: fn }, '텍스트', childEl)
 * children: 문자열·숫자(텍스트 노드), Node, 배열, null/false(무시)
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** 아이콘 + 글자 버튼 */
export function btn(label, onclick, { cls = 'btn', ico, title, type = 'button', disabled } = {}) {
  return h(
    'button',
    { class: cls, type, onclick, title, 'aria-label': label ? undefined : title, disabled },
    ico ? icon(ico) : null,
    label ? h('span', null, label) : null
  );
}

/** 아이콘만 있는 버튼 (title이 접근성 이름) */
export function iconBtn(ico, title, onclick, cls = 'icon-btn') {
  return h('button', { class: cls, type: 'button', title, 'aria-label': title, onclick }, icon(ico));
}

let toastTimer;
export function toast(message, { ms = 2600, kind = '' } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), ms);
}

/**
 * 화면 아래에서 올라오는 시트. 닫기 함수를 돌려준다.
 * @param {{title?: string, content: Node, onClose?: () => void}} opts
 */
export function openSheet({ title, content, onClose }) {
  const dialog = h(
    'dialog',
    { class: 'sheet' },
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'sheet-title' }, title || ''),
      iconBtn('x', '닫기', () => close())
    ),
    h('div', { class: 'sheet-body' }, content)
  );
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose?.();
  }
  dialog.addEventListener('close', close);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // 배경 클릭
  });
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { class: 'visually-hidden', readOnly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export async function copyWithToast(text, msg = '복사했습니다') {
  const ok = await copyText(text);
  toast(ok ? msg : '복사하지 못했습니다. 길게 눌러 직접 복사하세요.');
  return ok;
}

/** 안드로이드 공유 시트로 텍스트 보내기. 공유를 지원하지 않으면 false */
export async function shareText(text, title) {
  if (!navigator.share) return false;
  try {
    await navigator.share(title ? { title, text } : { text });
    return true;
  } catch (e) {
    if (e && e.name === 'AbortError') return true; // 사용자가 취소
    return false;
  }
}

export const isAndroid = /Android/i.test(navigator.userAgent);

export function externalLink(label, href, ico = 'external') {
  return h('a', { class: 'chip link', href, target: '_blank', rel: 'noopener noreferrer' }, label, icon(ico));
}

/** 로딩/오류 상태를 보여주는 섹션 상자 */
export function section(title, { ico, cls = '' } = {}) {
  const body = h('div', { class: 'section-body' });
  const el = h(
    'section',
    { class: `card ${cls}` },
    h('h3', { class: 'card-title' }, ico ? icon(ico) : null, title),
    body
  );
  return {
    el,
    body,
    loading(msg = '불러오는 중…') {
      clear(body).append(h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), msg));
    },
    error(msg) {
      clear(body).append(h('p', { class: 'error-text' }, msg));
    },
    set(...nodes) {
      clear(body);
      append(body, nodes);
    },
    hide() {
      el.hidden = true;
    },
  };
}

/**
 * 세그먼트(여러 버튼 중 하나 선택) 컨트롤
 * @param {{value: string, label: string}[]} options
 */
export function segmented(options, value, onChange, { label } = {}) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(o.value === value),
        onclick: () => {
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === btnEl(o.value)));
          onChange(o.value);
        },
        dataset: { value: o.value },
      },
      o.label
    )
  );
  const btnEl = (v) => buttons.find((b) => b.dataset.value === v);
  wrap.append(...buttons);
  wrap.setValue = (v) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  };
  return wrap;
}

/** 이름표 + 입력 요소 묶음 */
export function field(label, control, hint) {
  // 버튼 묶음을 <label>로 감싸면 빈 곳을 눌러도 첫 버튼이 눌리므로 div를 쓴다
  const tag = control.matches?.('input, select, textarea') ? 'label' : 'div';
  return h(
    tag,
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'hint' }, hint) : null
  );
}

/** 켜고 끄는 스위치 */
export function toggle(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: () => onChange(input.checked) });
  return h(
    'label',
    { class: 'toggle' },
    input,
    h('span', { class: 'toggle-text' }, label, hint ? h('span', { class: 'hint' }, hint) : null)
  );
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 오류 객체 → 사용자에게 보여줄 문장 */
export function errorMessage(e) {
  if (!e) return '알 수 없는 오류가 발생했습니다.';
  if (e.name === 'AbortError') return '취소되었습니다.';
  if (e instanceof TypeError && /fetch|network|Load failed/i.test(e.message)) {
    return '인터넷에 연결할 수 없습니다. 연결 상태를 확인하세요.';
  }
  return e.message || String(e);
}

// 앱 시작: 화면 전환(해시 라우터), 공유받은 글 처리, 서비스 워커 등록

import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { canInstall, promptInstall } from './install.js';
import { isLookupTerm, normalizeTerm } from './lib/lang.js';
import * as tutor from './views/tutor.js';
import * as dictionary from './views/dictionary.js';
import * as translate from './views/translate.js';
import * as ott from './views/ott.js';
import * as wordbook from './views/wordbook.js';
import * as settings from './views/settings.js';

const VIEWS = {
  tutor: { title: 'AI 영어회화', mod: tutor },
  dict: { title: '사전', mod: dictionary },
  translate: { title: '번역', mod: translate },
  ott: { title: 'OTT 자막 학습', mod: ott },
  words: { title: '단어장', mod: wordbook },
  settings: { title: '설정', mod: settings },
};
const LAST_TAB_KEY = 'eh.lastTab';

const mounted = new Set();
let currentName = null;

function sectionFor(name) {
  return document.getElementById(`view-${name}`);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, qs] = raw.split('?');
  return { name: VIEWS[name] ? name : null, params: new URLSearchParams(qs || '') };
}

function route() {
  let { name, params } = parseHash();
  if (!name) {
    let last = null;
    try {
      last = localStorage.getItem(LAST_TAB_KEY);
    } catch {
      /* 무시 */
    }
    history.replaceState(null, '', `#/${VIEWS[last] && last !== 'settings' ? last : 'tutor'}`);
    ({ name, params } = parseHash());
  }
  const changed = currentName !== name;
  if (currentName && changed) {
    VIEWS[currentName].mod.hide?.();
    sectionFor(currentName).hidden = true;
  }
  const sec = sectionFor(name);
  if (!mounted.has(name)) {
    mounted.add(name);
    try {
      VIEWS[name].mod.init(sec);
    } catch (e) {
      console.error(e);
      sec.append(h('p', { class: 'error-text' }, `화면을 여는 중 오류가 발생했습니다: ${e.message}`));
    }
  }
  sec.hidden = false;
  currentName = name;
  document.body.dataset.view = name; // 화면별 CSS (예: OTT 분할 화면용 간단 배치)
  document.getElementById('view-title').textContent = VIEWS[name].title;
  document.title = `${VIEWS[name].title} · English Helper`;
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    if (name !== 'settings') localStorage.setItem(LAST_TAB_KEY, name);
  } catch {
    /* 무시 */
  }
  try {
    VIEWS[name].mod.show?.(params);
  } catch (e) {
    console.error(e);
  }
  if (changed) window.scrollTo(0, 0);
}

/** 다른 앱에서 "공유 → English Helper"로 보낸 글: 짧으면 사전, 길면 번역 */
function handleShareTarget() {
  const sp = new URLSearchParams(location.search);
  if (!sp.has('text') && !sp.has('title')) return;
  let text = (sp.get('text') || sp.get('title') || '').trim();
  text = text.replace(/https?:\/\/\S+/g, '').trim(); // 함께 붙어 오는 링크 제거
  const target = !text
    ? '#/dict'
    : isLookupTerm(text)
      ? `#/dict?q=${encodeURIComponent(normalizeTerm(text))}`
      : `#/translate?text=${encodeURIComponent(text)}`;
  history.replaceState(null, '', location.pathname + target);
}

function setupHeader() {
  const installBtn = document.getElementById('install-btn');
  const sync = () => (installBtn.hidden = !canInstall());
  installBtn.addEventListener('click', promptInstall);
  window.addEventListener('install-state', sync);
  sync();
  for (const a of document.querySelectorAll('[data-icon]')) a.prepend(icon(a.dataset.icon, { size: 22 }));
}

let userAskedUpdate = false;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && !new URLSearchParams(location.search).has('sw')) return; // 개발 중에는 캐시 없이
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const offer = (worker) => {
        const bar = h(
          'div',
          { class: 'update-bar', role: 'status' },
          h('span', null, '새 버전이 있습니다.'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small primary',
              onclick: () => {
                userAskedUpdate = true;
                worker.postMessage({ type: 'SKIP_WAITING' });
              },
            },
            '업데이트'
          )
        );
        document.body.append(bar);
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
        });
      });
    })
    .catch((e) => console.warn('서비스 워커 등록 실패', e));
  // 처음 설치될 때(clients.claim)도 controllerchange가 오므로, 사용자가 "업데이트"를 눌렀을 때만 새로고침한다
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAskedUpdate || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

window.addEventListener('offline', () =>
  toast('오프라인입니다. 사전·번역·이미지는 인터넷이 필요합니다.', { ms: 4000 })
);
window.addEventListener('hashchange', route);

handleShareTarget();
setupHeader();
route();
registerServiceWorker();

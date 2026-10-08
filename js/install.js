// 홈 화면 설치(PWA) 안내: 크롬의 beforeinstallprompt 이벤트를 잡아 두었다가 버튼으로 띄운다

let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  window.dispatchEvent(new Event('install-state'));
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  window.dispatchEvent(new Event('install-state'));
});

export function canInstall() {
  return Boolean(deferred);
}

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  window.dispatchEvent(new Event('install-state'));
  return outcome === 'accepted';
}

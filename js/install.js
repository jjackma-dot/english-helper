// 홈 화면 설치(PWA) 안내: 크롬의 beforeinstallprompt 이벤트를 잡아 두었다가 버튼으로 띄운다
// 아이폰(Safari)에는 이 이벤트가 없어서 홈 화면에 추가하는 순서를 글로 안내한다

import { h, openSheet } from './ui.js';

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

/** 설정 화면에 쓰는 짧은 아이폰 설치 안내 */
export const IOS_INSTALL_SHORT =
  '아이폰: Safari ⋯ → 공유(또는 공유 버튼) → 목록을 아래로 내려 "홈 화면에 추가" → "웹 앱으로 열기"가 켜져 있는지 확인 → 추가. 설치한 앱에서 Gemini 키를 다시 넣으세요(Safari와 저장 공간이 따로예요).';

/** 아이폰: 홈 화면에 추가하는 방법을 시트로 보여 준다 */
export function showIosInstallGuide() {
  openSheet({
    title: '아이폰에 앱 설치',
    content: h(
      'div',
      { class: 'stack' },
      h(
        'ol',
        { class: 'steps' },
        h(
          'li',
          null,
          'Safari 주소창 옆(또는 아래쪽)의 ⋯ 버튼을 누르고 "공유"를 누르세요. 공유 버튼(네모에 위쪽 화살표)이 바로 보이면 그 버튼을 눌러도 돼요.'
        ),
        h('li', null, '나온 목록을 아래로 내려 "홈 화면에 추가"를 누르세요.'),
        h('li', null, '"웹 앱으로 열기"가 켜져 있는지 확인하고 "추가"를 누르세요.')
      ),
      h(
        'p',
        { class: 'callout' },
        '설치한 앱(홈 화면 아이콘)으로 열어 Gemini 키를 다시 넣으세요. Safari와 홈 화면 앱은 저장 공간이 따로라 Safari에서 넣은 키·단어장은 옮겨지지 않아요.'
      ),
      h('p', { class: 'hint' }, '단어장은 Safari에서 내보내기 → 설치한 앱의 단어장 탭에서 가져오기로 옮길 수 있어요.')
    ),
  });
}

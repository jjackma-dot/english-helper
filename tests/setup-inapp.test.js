// 카카오톡 안의 브라우저(아이폰)로 열었을 때: 설치할 수 없으니 설치 버튼·Safari 탭 경고 대신 "다른 브라우저로 열기" 안내
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, buildShell, text, FakeElement } from './fake-browser.js';

const KAKAO_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0';

const env = installFakeBrowser({ userAgent: KAKAO_IPHONE, hash: '#/words' });
const { installBtn } = buildShell(env.body);
await import('../js/app.js');
const settings = await import('../js/views/settings.js');

test('설치 버튼을 보이지 않는다', () => {
  assert.equal(installBtn.hidden, true);
});

test('설정: 다른 브라우저로 열라는 안내만 나온다', () => {
  const sec = new FakeElement('section');
  settings.init(sec);
  const t = text(sec);
  assert.match(t, /앱 안의 브라우저에서는 설치할 수 없어요/);
  assert.match(t, /다른 브라우저로 열기"\(아이폰은 Safari, 안드로이드는 크롬\)/);
  assert.doesNotMatch(t, /크롬 메뉴|홈 화면에 추가/);
  assert.equal(sec.querySelector('.callout.warn'), null);
});

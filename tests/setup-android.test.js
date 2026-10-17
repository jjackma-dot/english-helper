// 안드로이드 크롬에서 예전 동작이 그대로인지: 설치 버튼(크롬 설치 창), 크롬 설치 안내, 단어장 내려받기.
// 함께 서비스 워커 업데이트 확인(화면에 돌아올 때 한 시간에 한 번)과 저장소 계속 보관 요청을 본다
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, buildShell, descendants, clickedLinks, text, flush, FakeElement } from './fake-browser.js';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 16; SM-A175F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// 가짜 서비스 워커 등록
const reg = Object.assign(new EventTarget(), {
  waiting: null,
  installing: null,
  updates: 0,
  update() {
    this.updates++;
    return Promise.resolve();
  },
});
const serviceWorker = Object.assign(new EventTarget(), { controller: {}, register: async () => reg });
const newWorker = () => {
  const worker = Object.assign(new EventTarget(), { state: 'installing', posted: [] });
  worker.postMessage = (m) => worker.posted.push(m);
  return worker;
};

let persistCalls = 0;
const shared = [];
const env = installFakeBrowser({
  userAgent: ANDROID_CHROME,
  hash: '#/words',
  navigator: {
    // 크롬도 공유는 있지만, 안드로이드에서는 예전처럼 내려받아야 한다
    canShare: () => true,
    share: async (d) => shared.push(d),
    storage: {
      persisted: async () => false,
      persist: async () => {
        persistCalls++;
        return true;
      },
    },
    serviceWorker,
  },
});
const { installBtn } = buildShell(env.body);

let now = Date.now();
const realNow = Date.now;
Date.now = () => now;

await import('../js/app.js');
await flush(); // register() → then
const settings = await import('../js/views/settings.js');
const { addWord } = await import('../js/store.js');

const wordsView = document.getElementById('view-words');
const button = (root, label) =>
  descendants(root).find((e) => e.tagName === 'BUTTON' && e.textContent.includes(label));
const dialogs = () => descendants(env.body).filter((e) => e.tagName === 'DIALOG');

test.after(() => {
  Date.now = realNow;
});

test('설치 버튼: 크롬이 설치 창을 줄 때만 보이고, 누르면 크롬 설치 창을 띄운다', async () => {
  assert.equal(installBtn.hidden, true);
  let prompted = 0;
  const ev = new Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = () => prompted++;
  ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(installBtn.hidden, false);
  installBtn.click();
  assert.equal(prompted, 1);
  await flush();
  assert.equal(installBtn.hidden, true);
  assert.equal(dialogs().length, 0, '아이폰 안내 시트는 열리지 않는다');
});

test('설정: 크롬 설치 안내·안드로이드 음성 안내는 그대로, 아이폰 안내는 없다', () => {
  const sec = new FakeElement('section');
  settings.init(sec);
  const t = text(sec);
  assert.match(t, /크롬 메뉴\(⋮\) → "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 쓸 수 있습니다\./);
  assert.match(t, /휴대폰에 설치된 음성 엔진 목록입니다 \(안드로이드: 설정 → 텍스트 음성 변환\)\./);
  assert.doesNotMatch(t, /Safari|아이폰/);
  assert.equal(sec.querySelector('.callout.warn'), null);
  assert.match(t, /만 18세 이상/);
  assert.match(t, /하루 무료 한도를 함께/);
  assert.match(t, /가족 휴대폰/);
});

test('단어장 내보내기: 공유가 있어도 누르는 즉시 JSON 파일을 내려받는다', () => {
  addWord({ text: 'serendipity', meaning: '뜻밖의 행운' });
  const t = text(wordsView);
  assert.doesNotMatch(t, /Safari|에어드롭/);
  assert.match(t, /다운로드 폴더/);
  button(wordsView, '내보내기').click();
  // 기다리지 않고 바로 (누른 순간 안에서) 내려받기 링크를 누른다
  assert.equal(clickedLinks.length, 1);
  assert.match(clickedLinks[0].attributes.download, /^english-helper-words-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(shared.length, 0);
});

test('저장소 계속 보관을 한 번 요청한다', () => {
  assert.equal(persistCalls, 1);
});

test('화면에 돌아오면 한 시간에 한 번만 업데이트를 확인한다', () => {
  env.setVisible(false);
  env.setVisible(true);
  assert.equal(reg.updates, 0, '방금 열었으면 확인하지 않는다');
  now += 61 * 60 * 1000;
  env.setVisible(false);
  assert.equal(reg.updates, 0, '숨길 때는 확인하지 않는다');
  env.setVisible(true);
  assert.equal(reg.updates, 1);
  env.setVisible(false);
  env.setVisible(true);
  assert.equal(reg.updates, 1, '한 시간 안에는 다시 확인하지 않는다');
});

const installWorker = () => {
  const worker = newWorker();
  reg.installing = worker;
  reg.dispatchEvent(new Event('updatefound'));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  return worker;
};
const updateBars = () => descendants(env.body).filter((e) => e.classList.contains('update-bar'));

test('새 버전 안내는 음성 대화·듣기·자막 따라가기 중에는 띄우지 않고, 끝나면 띄운다', async () => {
  const { keepAwake } = await import('../js/services/wake-lock.js');
  keepAwake('tutor', true);
  keepAwake('listen', true);
  installWorker();
  assert.equal(updateBars().length, 0, '대화 중에는 가리지 않는다');
  keepAwake('tutor', false);
  assert.equal(updateBars().length, 0, '아직 듣는 중');
  keepAwake('listen', false);
  assert.equal(updateBars().length, 1);
  updateBars()[0].remove();
});

test('새 버전 안내는 하나만: 더 새 버전이 오면 그 버전으로 바꿔 단다', () => {
  const install = installWorker;
  const first = install();
  const second = install();
  const bars = descendants(env.body).filter((e) => e.classList.contains('update-bar'));
  assert.equal(bars.length, 1);
  button(bars[0], '업데이트').click();
  assert.deepEqual(second.posted, [{ type: 'SKIP_WAITING' }]);
  assert.deepEqual(first.posted, []);
});

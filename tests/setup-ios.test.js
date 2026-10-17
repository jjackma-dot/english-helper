// 아이폰(Safari 탭)에서: 머리글 "앱 설치"가 홈 화면에 추가하는 방법을 시트로 보여 주고,
// 설정·단어장 안내가 아이폰에 맞게 나오며, 단어장 내보내기는 공유 시트(파일)로 보낸다
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, buildShell, descendants, clickedLinks, text, flush, FakeElement } from './fake-browser.js';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const shared = [];
let shareResult = () => Promise.resolve();
const env = installFakeBrowser({
  userAgent: IPHONE_SAFARI,
  hash: '#/words',
  navigator: {
    canShare: (d) => Boolean(d?.files?.length && d.files.every((f) => f instanceof File)),
    share: (d) => {
      shared.push(d);
      return shareResult(d);
    },
  },
});
const { installBtn } = buildShell(env.body);

await import('../js/app.js');
const settings = await import('../js/views/settings.js');
const { addWord } = await import('../js/store.js');

const wordsView = document.getElementById('view-words');
const button = (root, label) =>
  descendants(root).find((e) => e.tagName === 'BUTTON' && e.textContent.includes(label));
const dialogs = () => descendants(env.body).filter((e) => e.tagName === 'DIALOG');
const openSettings = () => {
  const sec = new FakeElement('section');
  settings.init(sec);
  return sec;
};

test('머리글 "앱 설치" 버튼이 보이고, 누르면 홈 화면에 추가하는 방법 시트가 열린다', () => {
  assert.equal(installBtn.hidden, false);
  installBtn.click();
  const [sheet] = dialogs();
  assert.ok(sheet?.open, '시트가 열려야 한다');
  const t = text(sheet);
  assert.match(t, /⋯ 버튼을 누르고 "공유"를 누르세요/);
  assert.match(t, /목록을 아래로 내려 "홈 화면에 추가"/);
  assert.doesNotMatch(t, /공유 버튼을 누르세요[^]*공유 →/, '공유 버튼 다음에 또 "공유"를 누르라고 하지 않는다');
  assert.match(t, /웹 앱으로 열기/);
  assert.match(t, /Gemini 키를 다시 넣으세요/);
  assert.match(t, /저장 공간이 따로/);
  descendants(sheet).find((e) => e.attributes['aria-label'] === '닫기').click();
  assert.equal(dialogs().length, 0);
});

test('설정: 아이폰 설치 안내·Safari 탭 경고·아이폰 음성 안내, 약관·한도·기기별 저장 안내', () => {
  const t = text(openSettings());
  assert.match(t, /아이폰: Safari ⋯ → 공유\(또는 공유 버튼\) → 목록을 아래로 내려 "홈 화면에 추가"/);
  assert.doesNotMatch(t, /크롬 메뉴/);
  assert.match(t, /손쉬운 사용 → 읽기 및 말하기 → 음성/);
  assert.doesNotMatch(t, /텍스트 음성 변환/);
  assert.match(t, /만 18세 이상/);
  assert.match(t, /검토자/);
  assert.match(t, /하루 무료 한도를 함께/);
  assert.match(t, /이 기기\(브라우저\)에만 저장돼요/);
  const warn = openSettings().querySelector('.callout.warn');
  assert.ok(warn, 'Safari 탭 경고가 보여야 한다');
  assert.match(text(warn), /7일/);
});

test('설정: 홈 화면 앱으로 열면 "설치되어 실행 중" 안내만 나오고 Safari 탭 경고는 없다', () => {
  env.nav.standalone = true;
  try {
    const sec = openSettings();
    assert.match(text(sec), /앱으로 설치되어 실행 중입니다/);
    assert.equal(sec.querySelector('.callout.warn'), null);
  } finally {
    env.nav.standalone = false;
  }
});

test('단어장 안내: Safari와 홈 화면 앱은 따로, 다른 휴대폰으로 옮기는 방법', () => {
  const t = text(wordsView);
  assert.match(t, /Safari와 홈 화면 앱의 단어장은 서로 따로예요/);
  assert.match(t, /카톡·에어드롭/);
  assert.match(t, /이미 있는 단어는 건너뜀/);
  assert.match(t, /내보내 두세요/); // 원래 경고는 그대로
});

test('단어장 내보내기: 공유 시트로 JSON 파일을 보낸다 (내려받기 링크 없음)', async () => {
  addWord({ text: 'serendipity', meaning: '뜻밖의 행운' });
  button(wordsView, '내보내기').click();
  await flush();
  assert.equal(shared.length, 1);
  const { files, title } = shared[0];
  assert.equal(title, 'English Helper 단어장');
  assert.equal(files.length, 1);
  assert.match(files[0].name, /^english-helper-words-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(files[0].type, 'application/json');
  const data = JSON.parse(await files[0].text());
  assert.equal(data.app, 'english-helper');
  assert.deepEqual(data.words.map((w) => w.text), ['serendipity']);
  assert.equal(document.getElementById('toast'), null);
  assert.equal(clickedLinks.length, 0);
});

test('단어장 내보내기: 공유를 취소하면 아무것도 하지 않고, 공유가 막히면 내려받기로', async () => {
  shareResult = () => Promise.reject(new DOMException('cancel', 'AbortError'));
  button(wordsView, '내보내기').click();
  await flush();
  assert.equal(clickedLinks.length, 0);
  assert.equal(document.getElementById('toast'), null);

  shareResult = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
  button(wordsView, '내보내기').click();
  await flush();
  assert.equal(clickedLinks.length, 1);
  assert.match(clickedLinks[0].attributes.download, /\.json$/);
  assert.match(clickedLinks[0].attributes.href, /^blob:/);
  shareResult = () => Promise.resolve();
});

test('단어장 내보내기: 파일 공유를 못 하는 브라우저는 예전처럼 내려받는다', async () => {
  const canShare = env.nav.canShare;
  env.nav.canShare = () => false;
  try {
    const before = shared.length;
    button(wordsView, '내보내기').click();
    await flush();
    assert.equal(shared.length, before);
    assert.equal(clickedLinks.length, 2);
  } finally {
    env.nav.canShare = canShare;
  }
});

// 아이폰(Safari 탭)에서 번역·OTT·AI 회화 화면: 아이폰에 맞는 안내, 누른 순간 읽기 깨우기,
// 읽기 전 듣기는 abort(), 녹음 파일은 공유 시트로, 복사하고 열기는 기다리지 않고 바로 새 창
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installEnv,
  mount,
  button,
  segment,
  descendants,
  text,
  tick,
  until,
  toastText,
  recognizers,
  spoken,
  mic,
  micChunk,
} from './platform-env.js';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const shared = [];
let shareResult = () => Promise.resolve();
const env = installEnv({
  userAgent: IPHONE_SAFARI,
  settings: { autoSpeakTranslation: true },
  navigator: {
    canShare: (d) => Boolean(d?.files?.length && d.files.every((f) => f instanceof File)),
    share: (d) => {
      shared.push(d);
      return shareResult(d);
    },
  },
});

const translate = await import('../js/views/translate.js');
const ott = await import('../js/views/ott.js');
const tutor = await import('../js/views/tutor.js');
const { updateSettings } = await import('../js/store.js');

const tv = mount(translate, env.body);
translate.show(new URLSearchParams());

test('사진 번역: 공유받기 안내는 없고, 키 없이 쓰는 방법은 아이폰 기능으로 안내한다', () => {
  segment(tv, '사진').click();
  const t = text(tv);
  assert.doesNotMatch(t, /갤러리에서 공유/);
  assert.match(t, /아이폰 카메라: 글자를 비추면 나오는 텍스트 인식 버튼 → 번역/);
  assert.match(t, /사진 앱: 사진을 열고 텍스트 인식 버튼 → 글자를 길게 눌러 번역/);
  assert.match(t, /카메라 컨트롤을 길게 눌러 시각 지능 → 번역/);
  assert.match(t, /번역 앱 → 카메라/);
  assert.match(t, /기종·버전에 따라 이름이 다를 수 있어요/);
  assert.doesNotMatch(t, /갤럭시|서클 투 서치|안드로이드/);
});

test('실시간 통역: 누른 순간 소리 없이 한 번 읽어 깨우고, 번역을 읽기 전에는 듣기를 abort()로 끊었다가 다시 듣는다', async () => {
  segment(tv, '실시간 통역').click();
  assert.doesNotMatch(text(tv), /음성 인식을 지원하지/);
  button(tv, '한국어로 말하기').click();
  assert.deepEqual(
    spoken.map(({ text: t, volume, gesture }) => ({ t, volume, gesture })),
    [{ t: ' ', volume: 0, gesture: true }],
    '누르는 처리 안에서 소리 없는 읽기 한 번'
  );
  assert.equal(recognizers.length, 1);
  assert.deepEqual(recognizers[0].calls, ['start']);

  recognizers[0].say('안녕하세요');
  assert.deepEqual(recognizers[0].calls, ['start', 'abort'], '받은 문장을 번역해 읽기 전에 abort()');
  await until(() => recognizers.length === 2, '읽기가 끝나면 새 인식기로 다시 듣는다');
  assert.deepEqual(recognizers[1].calls, ['start']);
  assert.equal(spoken.at(-1).text, '번역된 문장');
  assert.equal(spoken.at(-1).gesture, false);
  assert.match(text(tv), /듣는 중… \(누르면 멈춤\)/);

  button(tv, '듣는 중').click();
  assert.deepEqual(recognizers[1].calls, ['start', 'stop'], '직접 멈출 때는 stop()');
  await tick();
});

test('텍스트 번역: 번역하기를 누르면 결과를 읽는다 (깨우기는 한 번만)', async () => {
  segment(tv, '텍스트').click();
  const before = spoken.length;
  tv.querySelector('textarea').value = '안녕';
  button(tv, '번역하기').click();
  await until(() => spoken.length > before, '번역 결과를 읽는다');
  assert.deepEqual(
    spoken.slice(before).map((s) => s.text),
    ['번역된 문장'],
    '이미 깨웠으면 다시 깨우지 않는다'
  );
});

test('녹음: 파일 저장은 공유 시트로 WAV 파일을 보내고, 취소는 조용히 넘어간다', async () => {
  segment(tv, '녹음').click();
  button(tv, '녹음 시작').click();
  await until(() => mic.node, '마이크가 열린다');
  assert.equal(mic.audio.at(-1).echoCancellation, true, '아이폰은 예전처럼 에코 제거를 켠다');
  micChunk();
  button(tv, '누르면 정지').click();
  await until(() => button(tv, '파일 저장'), '저장 버튼이 나온다');
  const save = button(tv, '파일 저장');
  assert.equal(save.tagName, 'BUTTON', '아이폰은 내려받기 링크 대신 공유 버튼');
  assert.equal(
    descendants(tv).some((e) => e.tagName === 'A' && 'download' in e.attributes),
    false
  );

  shareResult = () => Promise.reject(new DOMException('취소', 'AbortError'));
  save.click();
  const [file] = shared.at(-1).files;
  assert.ok(file instanceof File);
  assert.match(file.name, /^recording-\d+\.wav$/);
  assert.equal(file.type, 'audio/wav');
  assert.ok(file.size > 44, 'WAV 머리말 + 소리');
  await tick();
  assert.doesNotMatch(toastText(), /저장하지 못했습니다/, '사용자가 취소하면 알리지 않는다');

  shareResult = () => Promise.reject(new DOMException('막힘', 'NotAllowedError'));
  save.click();
  await tick();
  assert.match(toastText(), /파일을 저장하지 못했습니다/);
  assert.equal(shared.length, 2);
});

test('OTT: 실시간 자막·화면 배치 안내가 아이폰 기준이고, 시간 입력은 일반 자판(: 입력 가능)', () => {
  const ov = mount(ott, env.body);
  ott.show();
  const t = text(ov);
  assert.match(t, /아이폰 실시간 자막: 설정 → 손쉬운 사용 → 실시간 자막을 켜고 언어를 English로 고르세요/);
  assert.match(t, /아이폰 실시간 자막을 켜세요: 설정 → 손쉬운 사용 → 실시간 자막\./);
  assert.match(t, /같은 휴대폰에서 넷플릭스를 틀고 듣기를 켜면 넷플릭스 소리가 멈출 수 있어요/);
  assert.match(t, /넷플릭스 작은 창\(PIP\)으로 함께 띄웁니다\(광고형 요금제는 PIP 불가\)/);
  assert.doesNotMatch(t, /분할 화면|안드로이드|갤럭시|볼륨 버튼/);
  assert.doesNotMatch(t, /마이크 듣기를 지원하지/);

  descendants(ov)
    .find((e) => e.classList.contains('clock'))
    .click();
  const input = descendants(env.body).find((e) => e.tagName === 'INPUT' && e.attributes['aria-label'] === '재생 시간');
  assert.ok(input, '시간 입력 시트');
  assert.equal(input.getAttribute('inputmode'), null, '숫자 자판(: 없음)을 쓰지 않는다');
  descendants(env.body)
    .find((e) => e.tagName === 'DIALOG')
    .close();
});

test('AI 회화: 키가 없으면 "다른 앱으로 연습"을 펼쳐 두고, 키를 넣거나 지울 때만 다시 맞춘다', () => {
  const view = mount(tutor, env.body);
  const t = text(view);
  assert.match(t, /설정 → 동작 버튼에서 단축어\(또는 제어\)를 고른 뒤 ChatGPT의 음성 대화 기능을 고르면/);
  assert.doesNotMatch(t, /전원\(측면\) 버튼|기본 디지털 어시스턴트/);

  const apps = descendants(view).find((e) => e.tagName === 'DETAILS' && e.textContent.includes('다른 앱으로 연습'));
  assert.equal(apps.open, true, '키가 없으면 펼쳐 둔다');
  apps.open = false; // 사용자가 접음
  updateSettings({ ttsRate: 0.9 });
  assert.equal(apps.open, false, '키와 상관없는 설정이 바뀌면 그대로 둔다');
  updateSettings({ geminiKey: 'k' });
  assert.equal(apps.open, false, '키를 넣으면 접는다');
  assert.ok(text(view).includes('말로 끊기'));
  assert.doesNotMatch(text(view), /미디어 음량으로 듣기/, '아이폰에는 없는 설정 (통화 모드 문제가 없다)');
  apps.open = true; // 사용자가 펼침
  updateSettings({ ttsRate: 1 });
  assert.equal(apps.open, true);
  updateSettings({ geminiKey: '' });
  assert.equal(apps.open, true, '키를 지우면 펼친다');
});

test('복사하고 열기: 복사를 기다리지 않고 누른 처리 안에서 바로 새 창을 연 뒤, 복사가 끝나면 알린다', async () => {
  const view = descendants(env.body).find((e) => e.textContent.includes('다른 앱으로 연습') && e.tagName === 'DETAILS');
  button(view, '복사하고').click();
  assert.equal(env.opened.length, 1);
  assert.equal(env.opened[0].gesture, true, '누른 처리 안에서 연다');
  assert.equal(env.copied.at(-1).gesture, true);
  assert.equal(env.copied.at(-1).done, false, '복사가 끝나기 전에 연다');
  assert.match(env.opened[0].url, /^https:/);
  await until(() => /요청문을 복사했습니다/.test(toastText()), '복사가 끝나면 알린다');
});

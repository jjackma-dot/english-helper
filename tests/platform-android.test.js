// 안드로이드(크롬)에서 번역·OTT·AI 회화 화면이 예전 그대로인지: 갤럭시 안내·공유받기 안내,
// 깨우기 읽기 없음, 읽기 전 듣기는 stop(), 녹음 파일은 내려받기 링크, 복사가 끝난 뒤 앱 주소로 이동
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

const GALAXY_CHROME =
  'Mozilla/5.0 (Linux; Android 16; SM-S948N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const env = installEnv({
  userAgent: GALAXY_CHROME,
  settings: { autoSpeakTranslation: true, geminiKey: 'k', useGemini: false },
  navigator: { share: async () => {}, canShare: () => true },
});

const translate = await import('../js/views/translate.js');
const ott = await import('../js/views/ott.js');
const tutor = await import('../js/views/tutor.js');

const tv = mount(translate, env.body);
translate.show(new URLSearchParams());

test('스캔 번역: 갤러리에서 공유받기 안내와 갤럭시 기능 안내 (키가 없으면 카메라를 켜지 않는다)', () => {
  segment(tv, '스캔').click();
  const t = text(tv);
  assert.match(t, /갤러리에서 공유 → English Helper로 보내도 됩니다\./);
  assert.match(t, /갤럭시 카메라: 글자를 비추면 나오는 T\(텍스트\) 버튼 → 번역/);
  assert.match(t, /서클 투 서치: 홈 버튼이나 화면 아래 막대를 길게 누르기 → 번역/);
  assert.doesNotMatch(t, /아이폰/);
});

test('실시간 통역: 깨우기 읽기 없이 듣고, 번역을 읽기 전에는 stop()으로 멈췄다가 다시 듣는다', async () => {
  segment(tv, '실시간 통역').click();
  button(tv, '한국어로 말하기').click();
  assert.equal(spoken.length, 0, '안드로이드는 미리 깨우지 않는다');
  recognizers[0].say('안녕하세요');
  assert.deepEqual(recognizers[0].calls, ['start', 'stop']);
  await until(() => recognizers.length === 2, '읽기가 끝나면 다시 듣는다');
  assert.deepEqual(
    spoken.map((s) => s.text),
    ['번역된 문장']
  );
  button(tv, '듣는 중').click();
  await tick();
});

test('녹음: 파일 저장은 WAV 내려받기 링크', async () => {
  segment(tv, '녹음').click();
  button(tv, '녹음 시작').click();
  await until(() => mic.node, '마이크가 열린다');
  // 통화 모드(볼륨 버튼 = 통화 음량)가 되지 않게 에코 제거만 끈다
  assert.deepEqual(mic.audio.at(-1), {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  });
  micChunk();
  button(tv, '누르면 정지').click();
  await until(() => descendants(tv).find((e) => e.tagName === 'A' && 'download' in e.attributes), '저장 링크가 나온다');
  const link = descendants(tv).find((e) => e.tagName === 'A' && 'download' in e.attributes);
  assert.equal(link.textContent, '파일 저장');
  assert.match(link.attributes.download, /^recording-\d+\.wav$/);
  assert.match(link.attributes.href, /^blob:/);
});

test('OTT: 안드로이드 실시간 자막·분할 화면 안내, 시간 입력은 숫자 자판', () => {
  const ov = mount(ott, env.body);
  ott.show();
  const t = text(ov);
  assert.match(t, /안드로이드 실시간 자막도 좋아요/);
  assert.match(t, /안드로이드 실시간 자막\(Live Caption\)을 켜세요/);
  assert.match(t, /휴대폰으로 볼 때는 분할 화면이나 넷플릭스 작은 창\(PIP\)으로 함께 띄우세요\./);
  assert.match(t, /안드로이드 분할 화면\(최근 앱 → 앱 아이콘 → 분할 화면으로 열기\)/);
  assert.doesNotMatch(t, /아이폰/);

  descendants(ov)
    .find((e) => e.classList.contains('clock'))
    .click();
  const input = descendants(env.body).find((e) => e.tagName === 'INPUT' && e.attributes['aria-label'] === '재생 시간');
  assert.equal(input.getAttribute('inputmode'), 'decimal');
  descendants(env.body)
    .find((e) => e.tagName === 'DIALOG')
    .close();
});

test('AI 회화: 키가 있으면 "다른 앱으로 연습"은 접혀 있고, 복사가 끝난 뒤 앱 주소로 이동한다', async () => {
  const view = mount(tutor, env.body);
  const t = text(view);
  assert.match(t, /기본 디지털 어시스턴트 앱을 ChatGPT로 바꿔 두면\(한 번만\), 전원\(측면\) 버튼을 길게 눌러/);
  assert.doesNotMatch(t, /동작 버튼/);
  const apps = descendants(view).find((e) => e.tagName === 'DETAILS' && e.textContent.includes('다른 앱으로 연습'));
  assert.equal(apps.open, false);
  // 키를 지우면 펼치고(키 없는 기기는 다른 앱으로 연습), 다시 넣으면 접는다. 다른 설정을 바꿀 때는 사용자가 둔 대로
  const { updateSettings } = await import('../js/store.js');
  updateSettings({ geminiKey: '' });
  assert.equal(apps.open, true, '키를 지우면 펼친다');
  apps.open = false;
  updateSettings({ ttsRate: 1 });
  assert.equal(apps.open, false, '키와 상관없는 설정은 그대로 둔다');
  updateSettings({ geminiKey: 'k' });
  assert.equal(apps.open, false, '키를 넣으면 접는다');
  // 안드로이드: "말로 끊기" 옆에 "미디어 음량으로 듣기" (기본 켬, 바꾸면 저장)
  const media = descendants(view).find((e) => e.tagName === 'LABEL' && e.textContent.includes('미디어 음량으로 듣기'));
  assert.ok(media, '미디어 음량으로 듣기 스위치');
  assert.ok(text(view).includes('말로 끊기'));
  const box = descendants(media).find((e) => e.tagName === 'INPUT');
  assert.equal(box.checked, true, '기본은 켬');
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  const { getSettings } = await import('../js/store.js');
  assert.equal(getSettings().voiceMediaVolume, false);
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  assert.equal(getSettings().voiceMediaVolume, true);

  location.href = '';
  button(view, '복사하고').click();
  assert.equal(location.href, '', '복사가 끝나기 전에는 이동하지 않는다');
  await until(() => location.href, '앱 주소로 이동한다');
  assert.equal(env.copied.at(-1).done, true);
  assert.match(toastText(), /요청문을 복사했습니다/);
  assert.equal(env.opened.length, 0, '새 창은 열지 않는다');
});

// 아이폰 홈 화면 앱에서 음성 인식·마이크를 쓸 수 없을 때: 안드로이드 크롬이 아니라 Safari로 안내한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, mount, segment, text, descendants, spoken, gesture } from './platform-env.js';

const env = installEnv({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  standalone: true,
  speechRecognition: false,
  microphone: false,
});

const translate = await import('../js/views/translate.js');
const ott = await import('../js/views/ott.js');

test('실시간 통역: 홈 화면 앱에서는 Safari로 열라고 안내한다 (녹음 모드는 키가 있을 때만)', () => {
  const tv = mount(translate, env.body);
  segment(tv, '실시간 통역').click();
  const t = text(tv);
  assert.match(
    t,
    /이 브라우저는 음성 인식을 지원하지 않습니다\. 아이폰 홈 화면 앱에서는 음성 인식이 막혀 있을 수 있어요\. Safari에서 같은 주소를 여세요\(Gemini 키가 있으면 녹음 모드도 쓸 수 있어요\)\./
  );
  assert.doesNotMatch(t, /안드로이드|크롬/);
});

test('번역 결과를 소리로 읽기: 켜는 순간(누른 처리 안) 기기 음성을 깨운다 (통역 중에 켜도 다음 번역부터 들리게)', () => {
  const tv = mount(translate, env.body);
  segment(tv, '실시간 통역').click();
  const label = descendants(tv).find((e) => e.tagName === 'LABEL' && e.textContent.includes('번역 결과를 소리로 읽기'));
  const input = descendants(label).find((e) => e.tagName === 'INPUT');
  const before = spoken.length;
  const flip = (on) => {
    input.checked = on;
    gesture.active = true;
    try {
      input.dispatchEvent(new Event('change'));
    } finally {
      gesture.active = false;
    }
  };
  flip(false);
  assert.equal(spoken.length, before, '끌 때는 깨우지 않는다');
  flip(true);
  assert.deepEqual(
    spoken.slice(before).map(({ text: t, volume, gesture: g }) => ({ t, volume, g })),
    [{ t: ' ', volume: 0, g: true }]
  );
});

test('OTT 듣기: 마이크를 쓸 수 없으면 아이폰은 Safari로 열라고 안내한다', () => {
  const t = text(mount(ott, env.body));
  assert.match(t, /이 브라우저는 마이크 듣기를 지원하지 않습니다\. 아이폰은 Safari로 여세요\./);
  assert.doesNotMatch(t, /안드로이드|크롬/);
});

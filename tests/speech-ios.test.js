// 아이폰(Safari·WebKit)에서 음성 읽기·음성 인식·오디오 세션:
// 누르지 않은 읽기가 아무 알림 없이 버려져도 멈추지 않고, 'aborted'를 말소리 없는 차례로 세며, 아무 알림 없이 멈춘 인식기를
// 새로 바꾸고, 마이크·재생 동안 오디오 세션을 바꾼다. 장난감 목소리는 고르지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  contexts,
  fakeAudioSession,
  flush,
  installSpeechFakes,
  mic,
  recognitions,
  watch,
} from './speech-fakes.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const session = fakeAudioSession();
const { synth } = installSpeechFakes({ userAgent: IPHONE, navigator: { audioSession: session } });
const { speak, primeSpeech, createListener } = await import('../js/speech.js');
const { updateSettings } = await import('../js/store.js');
const { getMic, openMic, playbackSession, releaseMic } = await import('../js/services/recorder.js');
const { playClip } = await import('../js/services/listen-buffer.js');

/** 음성 인식기를 만들고 알림을 log에 모은다 */
function listener(extra = {}) {
  recognitions.length = 0;
  const log = [];
  const l = createListener({
    lang: 'en-US',
    onFinal: (x) => log.push(`final:${x}`),
    onState: (on) => log.push(`state:${on}`),
    onError: (msg, code) => log.push(`error:${code}:${msg}`),
    ...extra,
  });
  return { l, log };
}

/* ---------- 음성 읽기 ---------- */

test('primeSpeech: 아이폰에서는 한 페이지에 한 번만 소리 없이 읽어 두고 바로 지운다 (누른 처리 안에서 불러 제한을 푼다)', () => {
  primeSpeech();
  primeSpeech();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].volume, 0);
  assert.equal(synth.speaking, false, '읽는 중으로 남지 않는다 (OTT 듣기·음성 인식을 막지 않게)');
});

test('speak: 누르지 않은 읽기가 아무 알림 없이 버려져도 2초 뒤에 끝난다 (기본 음성 모드·통역이 멈추지 않게)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  synth.drop = true;
  const w = watch(speak('Hello there.'));
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(w.done, false);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(w.done, true);
  synth.drop = false;
});

test('speak: 읽기가 대기열에 있는 동안(엔진이 늦게 켜짐)과 읽는 동안은 끝날 때까지 기다린다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = watch(speak('This is a long answer.'));
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(w.done, false, '시작 알림이 늦어도 끊지 않는다');
  synth.start();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(w.done, false);
  synth.finish();
  await flush();
  assert.equal(w.done, true);
});

test('읽기 목소리(아이폰): 고르지 않았으면 목소리를 정하지 않고 언어만 넘겨 기기 기본 목소리로 읽고, 직접 고른 목소리는 그대로 쓴다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const v = (name, lang, isDefault = false) => ({
    name,
    lang,
    voiceURI: `apple.${name}`,
    localService: true,
    default: isDefault,
  });
  const spokenWith = (lang) => {
    speak('Hi', { lang });
    const u = synth.spoken.at(-1);
    synth.cancel();
    return u;
  };
  const voiceFor = (lang) => spokenWith(lang).voice?.name;
  const setVoices = (list) => {
    synth.voices = list;
    synth.dispatchEvent(new Event('voiceschanged'));
  };

  // 아이폰(WebKit)은 모든 목소리의 default가 true라 목록으로는 기기 기본 목소리를 알 수 없다
  setVoices([
    v('Albert', 'en-US', true),
    v('Fred', 'en-US', true),
    v('Samantha', 'en-US', true),
    v('Daniel', 'en-GB', true),
    v('Yuna', 'ko-KR', true),
  ]);
  for (const lang of ['en-US', 'en-GB', 'ko-KR']) {
    const u = spokenWith(lang);
    assert.equal(u.voice, null, `${lang}: 목소리를 정하지 않는다`);
    assert.equal(u.lang, lang, '언어만 넘긴다 (WebKit이 그 언어의 기기 기본 목소리로 읽음)');
  }

  setVoices([v('Albert', 'en-US', true), v('Samantha', 'en-US', true)]);
  updateSettings({ voiceURI: 'apple.Albert' });
  assert.equal(voiceFor('en-US'), 'Albert', '설정에서 고른 목소리');
  updateSettings({ voiceURI: '' });
});

/* ---------- 음성 인식 ---------- */

test('음성 인식(아이폰): aborted(말소리 없음·실패)는 말소리 없는 차례로 세고 1초 쉬었다 다시 듣는다. 네 번이면 멈춘다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  for (let i = 0; i < 3; i++) {
    const r = recognitions.at(-1);
    r.error('aborted');
    r.end();
    t.mock.timers.tick(999);
    assert.equal(recognitions.length, i + 1, '1초 동안은 다시 켜지 않는다');
    t.mock.timers.tick(1);
    assert.equal(recognitions.length, i + 2);
    assert.ok(recognitions.at(-1).started);
  }
  const r = recognitions.at(-1);
  r.error('aborted');
  assert.deepEqual(log, ['state:true', 'error:no-speech:한동안 말소리가 없어 듣기를 멈췄습니다.']);
  r.end();
  assert.deepEqual(log.slice(2), ['state:false']);
  t.mock.timers.tick(20000);
  assert.equal(recognitions.length, 4, '다시 듣지 않는다');
  assert.equal(l.active, false);
});

test('음성 인식(아이폰): 말을 알아들으면 조용한 차례 수를 지우고, 알아들은 뒤의 aborted는 쉬지 않고 바로 다시 듣는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  const quiet = () => {
    const r = recognitions.at(-1);
    r.error('aborted');
    r.end();
    t.mock.timers.tick(1000);
  };
  quiet();
  quiet();
  quiet();
  const r = recognitions.at(-1);
  r.result('Hello.');
  r.error('aborted');
  r.end();
  const n = recognitions.length;
  t.mock.timers.tick(120);
  assert.equal(recognitions.length, n + 1);
  quiet();
  quiet();
  quiet();
  assert.equal(l.active, true, '알아들은 뒤로 세 번뿐');
  assert.deepEqual(log, ['state:true', 'final:Hello.']);
  l.stop();
});

test('음성 인식(아이폰): 시작한 인식기가 10초 동안 아무 알림이 없으면 버리고 새 인식기로 다시 듣는다 (말소리 없는 차례로 셈)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  const r0 = recognitions[0];
  t.mock.timers.tick(9999);
  assert.equal(r0.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(r0.aborted, true, '멈춘 인식기는 abort()로 버린다');
  assert.equal(r0.onend, null, '버린 인식기의 늦은 알림은 받지 않는다');
  t.mock.timers.tick(120);
  assert.equal(recognitions.length, 2);
  assert.ok(recognitions[1].started);

  // 새 인식기가 말소리를 들으면 10초가 지나도 버리지 않는다
  const r1 = recognitions[1];
  r1.speechStart();
  t.mock.timers.tick(20000);
  assert.equal(r1.aborted, false);
  r1.result('I am here.');
  r1.end();
  t.mock.timers.tick(120);
  assert.equal(recognitions.length, 3);
  assert.deepEqual(log, ['state:true', 'final:I am here.']);

  // 계속 멈추면 네 번째에 '한동안 말소리가 없어' 멈춘다 (기본 음성 모드는 잠시 멈춤으로 바꾼다)
  advance(t, 3 * (10000 + 120));
  assert.equal(recognitions.length, 6);
  assert.deepEqual(log.slice(2), []);
  advance(t, 10000);
  assert.deepEqual(log.slice(2), ['error:no-speech:한동안 말소리가 없어 듣기를 멈췄습니다.', 'state:false']);
  assert.equal(recognitions.at(-1).aborted, true);
  assert.equal(l.active, false);
  advance(t, 60000);
  assert.equal(recognitions.length, 6);
});

test('abort(): 인식기를 abort()로 끊고 남은 결과는 버린다. stop()은 stop()으로 끊고 마지막 결과는 받는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  const r0 = recognitions[0];
  l.abort();
  assert.equal(r0.aborted, true);
  assert.equal(r0.stopped, false);
  r0.result('late words');
  r0.error('aborted');
  r0.end();
  t.mock.timers.tick(60000);
  assert.deepEqual(log, ['state:true', 'state:false']);
  assert.equal(recognitions.length, 1, '다시 듣지 않고, 멈춘 인식기 확인(10초)도 하지 않는다');

  l.start();
  const r1 = recognitions[1];
  l.stop();
  assert.equal(r1.stopped, true);
  assert.equal(r1.aborted, false);
  r1.result('last words');
  r1.end();
  t.mock.timers.tick(60000);
  assert.deepEqual(log.slice(2), ['state:true', 'state:false', 'final:last words']);
  assert.equal(recognitions.length, 2);
});

test('음성 인식 오류 안내(아이폰): 권한은 Safari·음성 인식 설정을, 쓸 수 없을 때는 Siri·받아쓰기와 홈 화면 앱을 알려 준다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const message = (code) => {
    let msg = '';
    const l = createListener({ lang: 'en-US', onFinal() {}, onError: (m) => (msg = m) });
    l.start();
    recognitions.at(-1).error(code);
    return msg;
  };
  const denied = message('not-allowed');
  assert.match(denied, /Safari/);
  assert.match(denied, /웹 사이트 설정/);
  assert.match(denied, /개인정보 보호 및 보안 → 음성 인식/);
  assert.doesNotMatch(denied, /자물쇠/, '안드로이드 크롬 안내가 아니다');
  const blocked = message('service-not-allowed');
  assert.match(blocked, /Safari에서 같은 주소를 여세요/);
  assert.match(blocked, /Siri\(설정 → Siri\) 또는 받아쓰기\(설정 → 일반 → 키보드\)/);
  assert.match(blocked, /스크린 타임/);
  assert.match(blocked, /홈 화면 앱/);
  assert.doesNotMatch(blocked, /녹음/, '키가 있어야 하는 기능으로 보내지 않는다');
});

/* ---------- 오디오 세션 ---------- */

test('오디오 세션(아이폰): 마이크를 열기 전에 녹음·재생으로 바꾸고, 마지막 마이크를 닫으면 기본으로 돌린다', async () => {
  session.types.length = 0;
  const a = await getMic();
  assert.equal(mic.calls.at(-1).session, 'play-and-record', 'getUserMedia 전에 바꾼다 (튜터 목소리가 작아지지 않게)');
  const b = await getMic();
  releaseMic(a);
  assert.equal(session.type, 'play-and-record', '아직 열린 마이크가 있다');
  releaseMic(a);
  assert.equal(session.type, 'play-and-record', '두 번 닫아도 한 번만 센다');
  releaseMic(b);
  assert.equal(session.type, 'auto');
  assert.equal(mic.tracks.at(-1).readyState, 'ended');
  assert.deepEqual(session.types, ['play-and-record', 'auto']);
});

test('오디오 세션(아이폰): 마이크 권한이 거부되면 기본으로 돌린다', async () => {
  mic.deny = 'NotAllowedError';
  await assert.rejects(getMic(), /마이크 권한이 거부되었습니다\. Safari의 ⋯\(또는 aA\) 메뉴 → 웹 사이트 설정 → 마이크/);
  mic.deny = null;
  assert.equal(session.type, 'auto');
});

test('오디오 세션(아이폰): openMic으로 연 마이크(녹음·듣기)도 release하면 돌린다', async () => {
  const m = await openMic({ echoCancellation: false }, () => {});
  assert.equal(session.type, 'play-and-record');
  m.release();
  m.release();
  assert.equal(session.type, 'auto');
});

test('느리게 다시 듣기(아이폰): 마이크가 꺼져 있으면 재생 동안 재생 세션(무음 스위치에도 들림), 끝나면 기본으로', async () => {
  const clip = () => new Blob([new Uint8Array(16)], { type: 'audio/wav' });
  const p = await playClip(clip(), { rate: 0.75 });
  assert.equal(session.type, 'playback');
  assert.ok(contexts.at(-1).source.started);
  p.stop();
  await p.ended;
  assert.equal(session.type, 'auto');

  // 듣는 중(마이크 열림)에는 녹음·재생 세션 그대로
  const m = await getMic();
  const q = await playClip(clip());
  assert.equal(session.type, 'play-and-record');
  q.stop();
  await q.ended;
  assert.equal(session.type, 'play-and-record');
  releaseMic(m);
  assert.equal(session.type, 'auto');
});

test('느리게 다시 듣기(아이폰): 소리 처리가 멈춰 끝 알림이 오지 않아도, 멈추기를 누르면 기본 세션으로 돌린다', async () => {
  const p = await playClip(new Blob([new Uint8Array(16)], { type: 'audio/wav' }));
  assert.equal(session.type, 'playback');
  contexts.at(-1).source.stop = () => {}; // 전화 등으로 멈춘 AudioContext: onended가 오지 않는다
  p.stop();
  assert.equal(session.type, 'auto');
  p.stop();
  const m = await getMic();
  releaseMic(m);
  assert.equal(session.type, 'auto', '다시 재생 세션으로 돌아가지 않는다 (한 번만 센다)');
});

test('오디오 세션을 바꾸다 오류가 나도 마이크·재생은 그대로 되고, 끝내기를 두 번 불러도 셈이 틀리지 않는다', async () => {
  session.failNext = true;
  const m = await getMic();
  assert.equal(m.getTracks()[0].readyState, 'live');
  releaseMic(m);
  assert.equal(session.type, 'auto');
  const end = playbackSession();
  assert.equal(session.type, 'playback');
  end();
  end();
  assert.equal(session.type, 'auto');
});

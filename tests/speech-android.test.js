// 안드로이드 크롬에서 음성 읽기·음성 인식·오디오 세션은 예전 그대로인지 (아이폰용으로 고친 부분이 끼어들지 않는지) 본다:
// 읽기를 미리 깨우지 않고, 읽는 중에는 끊지 않으며, 'aborted'는 세지 않고 0.12초 뒤 다시 듣고, 멈춘 인식기 확인(10초)이 없고,
// 오류 안내·목소리 고르기도 그대로이며, 오디오 세션은 건드리지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, fakeAudioSession, flush, installSpeechFakes, recognitions, watch } from './speech-fakes.js';

const GALAXY =
  'Mozilla/5.0 (Linux; Android 16; SM-A175F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// 크롬이 언젠가 navigator.audioSession을 내놓아도 안드로이드에서는 건드리지 않는다
const session = fakeAudioSession();
const { synth } = installSpeechFakes({ userAgent: GALAXY, navigator: { audioSession: session } });
const { speak, primeSpeech, createListener } = await import('../js/speech.js');
const { getMic, releaseMic } = await import('../js/services/recorder.js');
const { playClip } = await import('../js/services/listen-buffer.js');

function listener() {
  recognitions.length = 0;
  const log = [];
  const l = createListener({
    lang: 'en-US',
    onFinal: (x) => log.push(`final:${x}`),
    onState: (on) => log.push(`state:${on}`),
    onError: (msg, code) => log.push(`error:${code}`),
  });
  return { l, log };
}

test('primeSpeech: 안드로이드에서는 아무것도 읽지 않는다', () => {
  primeSpeech();
  assert.equal(synth.spoken.length, 0);
});

test('speak: 엔진이 늦게 켜져도(시작 알림 없이 대기열에 있음) 끝날 때까지 기다리고, 긴 읽기도 끊지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = watch(speak('Good morning.'));
  advance(t, 30000);
  await flush();
  assert.equal(w.done, false, '시작 알림이 없어도 읽기가 대기열에 있으면 기다린다');
  synth.start();
  advance(t, 60000);
  await flush();
  assert.equal(w.done, false);
  synth.finish();
  await flush();
  assert.equal(w.done, true);
});

test('speak: 안드로이드에는 버려진 읽기 확인(아이폰용)이 없다 — 끝 알림이 올 때까지 예전처럼 기다린다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  synth.drop = true;
  const w = watch(speak('Hello.'));
  advance(t, 10000);
  await flush();
  assert.equal(w.done, false);
  synth.drop = false;
  synth.cancel?.();
});

test('읽기 목소리(안드로이드): 예전처럼 같은 언어의 기기 안 목소리를 먼저 고른다 (기본 표시는 보지 않는다)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  synth.voices = [
    { name: 'Korean South Korea', lang: 'ko-KR', localService: true, default: true, voiceURI: 'ko' },
    { name: 'Google US English', lang: 'en-US', localService: false, default: true, voiceURI: 'g-us' },
    { name: 'English United States', lang: 'en_US', localService: true, default: false, voiceURI: 'en-us' },
    { name: 'English United Kingdom', lang: 'en-GB', localService: true, default: false, voiceURI: 'en-gb' },
  ];
  synth.dispatchEvent(new Event('voiceschanged'));
  const voiceFor = (lang) => {
    speak('Hi', { lang });
    const u = synth.spoken.at(-1);
    synth.cancel();
    return u.voice?.name;
  };
  assert.equal(voiceFor('en-US'), 'English United States');
  assert.equal(voiceFor('en-GB'), 'English United Kingdom');
  assert.equal(voiceFor('en-AU'), 'Google US English', '같은 언어가 없으면 목록의 첫 영어 목소리');
  assert.equal(voiceFor('ko-KR'), 'Korean South Korea');
});

test('음성 인식(안드로이드): aborted는 세지 않고 0.12초 뒤 다시 들으며, 오래 알림이 없어도 인식기를 바꾸지 않는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  for (let i = 0; i < 10; i++) {
    const r = recognitions.at(-1);
    r.error('aborted');
    r.end();
    t.mock.timers.tick(119);
    assert.equal(recognitions.length, i + 1);
    t.mock.timers.tick(1);
    assert.equal(recognitions.length, i + 2);
  }
  assert.equal(l.active, true);
  assert.deepEqual(log, ['state:true']);

  const r = recognitions.at(-1);
  advance(t, 60000);
  assert.equal(r.aborted, false, '멈춘 인식기 확인(아이폰용)은 하지 않는다');
  assert.equal(recognitions.length, 11);
  l.stop();
  assert.equal(r.stopped, true);
});

test('음성 인식(안드로이드): no-speech 네 번이면 예전처럼 멈추고 알린다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, log } = listener();
  l.start();
  for (let i = 0; i < 4; i++) {
    const r = recognitions.at(-1);
    r.error('no-speech');
    r.end();
    t.mock.timers.tick(120);
  }
  assert.deepEqual(log, ['state:true', 'error:no-speech', 'state:false']);
  assert.equal(recognitions.length, 4);
  assert.equal(l.active, false);
});

test('음성 인식 오류 안내(안드로이드): 예전 문구 그대로', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const message = (code) => {
    let msg = '';
    const l = createListener({ lang: 'en-US', onFinal() {}, onError: (m) => (msg = m) });
    l.start();
    recognitions.at(-1).error(code);
    return msg;
  };
  assert.equal(
    message('not-allowed'),
    '마이크 권한이 거부되었습니다. 주소창의 자물쇠(또는 앱 정보) → 권한에서 마이크를 허용하세요.'
  );
  assert.equal(message('service-not-allowed'), '이 기기에서 음성 인식을 사용할 수 없습니다.');
});

test('오디오 세션(안드로이드): 마이크·재생에서 건드리지 않는다', async () => {
  const m = await getMic();
  const p = await playClip(new Blob([new Uint8Array(16)], { type: 'audio/wav' }));
  p.stop();
  await p.ended;
  releaseMic(m);
  assert.deepEqual(session.types, []);
});

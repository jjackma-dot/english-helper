import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_STREAM_END,
  CHUNK_SAMPLES,
  LIVE_ENDPOINT,
  LIVE_MODELS,
  MAX_RECONNECTS,
  START_TEXT,
  audioMessage,
  base64FromInt16,
  buildSetup,
  classifyLiveClose,
  createDownsampler,
  decodeFrame,
  floatToInt16,
  int16FromBase64,
  int16ToFloat32,
  kickoffMessage,
  liveUrl,
  parseServerMessage,
  peakLevel,
  planAfterClose,
  rateFromMime,
  recentTurns,
  takeSentences,
  toolResponse,
} from '../js/lib/live-protocol.js';

test('연결 주소: 키를 주소에 넣는다', () => {
  assert.equal(liveUrl('a b&c'), `${LIVE_ENDPOINT}?key=a%20b%26c`);
  assert.ok(LIVE_ENDPOINT.startsWith('wss://generativelanguage.googleapis.com/ws/'));
  assert.equal(LIVE_MODELS[0], 'gemini-3.8-live');
});

test('설정 메시지: 음성 답·받아쓰기·말소리 감지·교정 도구, 거부되는 설정은 넣지 않음', () => {
  const { setup } = buildSetup({ model: 'gemini-3.8-live', system: 'Be my tutor.' });
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(setup.generationConfig, {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
  });
  assert.deepEqual(setup.systemInstruction, { parts: [{ text: 'Be my tutor.' }] });
  assert.deepEqual(setup.inputAudioTranscription, {});
  assert.deepEqual(setup.outputAudioTranscription, {});
  assert.deepEqual(setup.realtimeInputConfig, {
    automaticActivityDetection: {
      silenceDurationMs: 900,
      prefixPaddingMs: 200,
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
  });
  assert.deepEqual(setup.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(setup.sessionResumption, {});
  const fn = setup.tools[0].functionDeclarations[0];
  assert.equal(fn.name, 'show_correction');
  assert.equal(fn.behavior, undefined); // 3.8은 기본이 비동기, 예비 모델 3.1은 비동기를 지원하지 않는다
  assert.deepEqual(fn.parameters.required, ['original', 'corrected']);
  assert.ok(fn.parameters.properties.explanation_ko);
  const json = JSON.stringify(setup);
  for (const banned of ['thinkingConfig', 'enableAffectiveDialog', 'proactivity', 'temperature']) {
    assert.ok(!json.includes(banned), banned);
  }

  const resumed = buildSetup({ model: 'models/gemini-3.1-flash-live-preview', system: 's', handle: 'h1' }).setup;
  assert.equal(resumed.model, 'models/gemini-3.1-flash-live-preview');
  assert.deepEqual(resumed.sessionResumption, { handle: 'h1' });
});

test('보내는 메시지: 첫 요청·마이크 소리·소리 끝·도구 응답', () => {
  assert.deepEqual(kickoffMessage(), {
    clientContent: { turns: [{ role: 'user', parts: [{ text: START_TEXT }] }], turnComplete: true },
  });
  assert.deepEqual(audioMessage('AAA='), {
    realtimeInput: { audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=16000' } },
  });
  assert.equal(audioMessage('x', 8000).realtimeInput.audio.mimeType, 'audio/pcm;rate=8000');
  assert.deepEqual(AUDIO_STREAM_END, { realtimeInput: { audioStreamEnd: true } });
  assert.deepEqual(toolResponse([{ id: 'c1', name: 'show_correction', args: {} }]), {
    toolResponse: {
      functionResponses: [
        { id: 'c1', name: 'show_correction', response: { result: 'shown', scheduling: 'SILENT' }, scheduling: 'SILENT' },
      ],
    },
  });
});

test('서버 프레임 읽기: 글자·바이너리·깨진 프레임', () => {
  assert.deepEqual(decodeFrame('{"setupComplete":{}}'), { setupComplete: {} });
  const bytes = new TextEncoder().encode('{"serverContent":{"turnComplete":true}}');
  assert.deepEqual(decodeFrame(bytes.buffer), { serverContent: { turnComplete: true } });
  assert.equal(decodeFrame('{"broken'), null);
  assert.deepEqual(parseServerMessage(null), []);
});

test('서버 메시지 → 처리 순서대로 사건', () => {
  assert.deepEqual(parseServerMessage({ setupComplete: {} }), [{ type: 'setupComplete' }]);

  const events = parseServerMessage({
    serverContent: {
      interrupted: true,
      inputTranscription: { text: ' I go' },
      modelTurn: {
        parts: [
          { text: 'thinking…', thought: true },
          { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } },
          { inlineData: { mimeType: 'image/png', data: 'xx' } },
        ],
      },
      outputTranscription: { text: 'Hello' },
      turnComplete: true,
    },
  });
  assert.deepEqual(events, [
    { type: 'interrupted' },
    { type: 'userText', text: ' I go' },
    { type: 'audio', data: 'AAAA', rate: 24000 },
    { type: 'tutorText', text: 'Hello' },
    { type: 'turnComplete' },
  ]);

  assert.deepEqual(
    parseServerMessage({
      toolCall: { functionCalls: [{ id: 'f1', name: 'show_correction', args: { original: 'a', corrected: 'b' } }] },
    }),
    [{ type: 'toolCall', calls: [{ id: 'f1', name: 'show_correction', args: { original: 'a', corrected: 'b' } }] }]
  );
  assert.deepEqual(parseServerMessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'h2' } }), [
    { type: 'resumeHandle', handle: 'h2' },
  ]);
  // 지금은 이어 말하기를 할 수 없는 시점: 이전 handle을 그대로 쓴다
  assert.deepEqual(parseServerMessage({ sessionResumptionUpdate: { resumable: false } }), [{ type: 'notResumable' }]);
  assert.deepEqual(parseServerMessage({ goAway: { timeLeft: '9.5s' } }), [{ type: 'goAway', ms: 9500 }]);
  assert.deepEqual(parseServerMessage({ usageMetadata: { totalTokenCount: 5 } }), []);
});

test('rateFromMime', () => {
  assert.equal(rateFromMime('audio/pcm;rate=16000'), 16000);
  assert.equal(rateFromMime('audio/pcm'), 24000);
});

test('연결이 닫힌 이유 분류', () => {
  const key = classifyLiveClose(1008, 'API key not valid. Please pass a valid API key.');
  assert.equal(key.kind, 'key');
  assert.equal(key.remember, false); // 키를 고치면 바로 다시 쓸 수 있다
  // 분당 한도처럼 잠깐인 초과는 그날 기억하지 않고, 일일 한도만 기억한다
  const quota = classifyLiveClose(1011, 'RESOURCE_EXHAUSTED: You exceeded your current quota');
  assert.deepEqual([quota.kind, quota.remember], ['quota', false]);
  assert.match(quota.message, /잠시 많습니다/);
  assert.equal(classifyLiveClose(1011, 'Error 429 Too Many Requests').kind, 'quota');
  const daily = classifyLiveClose(1011, 'You exceeded your current quota. Quota exceeded for metric: x, limit: 0');
  assert.deepEqual([daily.kind, daily.remember], ['quota', true]);
  assert.match(daily.message, /오늘 Gemini Live 무료 사용 한도를 다 썼습니다/);
  assert.equal(classifyLiveClose(1011, 'quota exceeded: requests per day').remember, true);
  const model = classifyLiveClose(
    1008,
    'models/gemini-3.8-live is not found for API version v1beta, or is not supported'
  );
  assert.deepEqual([model.kind, model.remember], ['model', true]);
  assert.equal(classifyLiveClose(1008, 'Operation is not implemented, or supported, or enabled.').kind, 'model');
  const net = classifyLiveClose(1006, '');
  assert.deepEqual([net.kind, net.remember], ['network', false]);
  assert.match(net.message, /인터넷 연결을 확인하세요\. \(코드 1006\)$/);

  // 서버 내부 오류는 잠깐일 수 있다 / 설정 거부(1007·1008)는 다시 해도 같다
  const internal = classifyLiveClose(1011, 'Internal error encountered.');
  assert.deepEqual([internal.kind, internal.remember], ['other', false]);
  assert.match(internal.message, /코드 1011: Internal error encountered\./);
  const invalid = classifyLiveClose(1007, 'Request contains an invalid argument.');
  assert.deepEqual([invalid.kind, invalid.remember], ['other', true]);
  assert.match(classifyLiveClose(1007, '').message, /\(코드 1007\)/);
});

test('닫힌 뒤 할 일: 다음 모델·다시 연결·기본 음성 모드', () => {
  const c = (code, reason) => classifyLiveClose(code, reason);
  const first = { setupDone: false, everReady: false, modelIdx: 0, reconnects: 0 };
  // 시작할 때 모델이 없으면 예비 Live 모델로, 그것도 없으면 그날은 기본 음성 모드
  assert.deepEqual(planAfterClose(c(1008, 'model is not found'), first), { action: 'next-model' });
  assert.deepEqual(planAfterClose(c(1008, 'model is not found'), { ...first, modelIdx: LIVE_MODELS.length - 1 }), {
    action: 'fail',
    remember: true,
  });
  // 시작 전에 닫히면 Live를 그만둔다. 인터넷 문제·서버 오류는 그날 기억하지 않는다
  assert.deepEqual(planAfterClose(c(1011, 'RESOURCE_EXHAUSTED'), first), { action: 'fail', remember: false });
  assert.deepEqual(planAfterClose(c(1011, 'RESOURCE_EXHAUSTED limit: 0'), first), { action: 'fail', remember: true });
  assert.deepEqual(planAfterClose(c(1006, ''), first), { action: 'fail', remember: false });
  assert.deepEqual(planAfterClose(c(1011, 'Internal error'), first), { action: 'fail', remember: false });
  assert.deepEqual(planAfterClose(c(1007, 'invalid argument'), first), { action: 'fail', remember: true });
  // 키 문제는 언제든 바로 끝
  assert.deepEqual(planAfterClose(c(1008, 'API key not valid'), { ...first, everReady: true }), {
    action: 'fail',
    remember: false,
  });

  // 대화 중에 끊기면 이어 말하기 정보로 다시 연결 (점점 늦게, 최대 MAX_RECONNECTS번)
  const talking = { setupDone: true, everReady: true, modelIdx: 0, reconnects: 0 };
  assert.deepEqual(planAfterClose(c(1011, 'Internal error'), talking), {
    action: 'reconnect',
    keepHandle: true,
    delayMs: 1000,
  });
  // 다시 연결이 설정 전에 닫혔으면 handle을 버리고 새로 (인터넷 문제면 그대로 둔다)
  const retry = { ...talking, setupDone: false, reconnects: 1 };
  assert.deepEqual(planAfterClose(c(1007, 'Invalid resumption handle'), retry), {
    action: 'reconnect',
    keepHandle: false,
    delayMs: 2000,
  });
  assert.deepEqual(planAfterClose(c(1006, ''), retry), { action: 'reconnect', keepHandle: true, delayMs: 2000 });
  assert.deepEqual(planAfterClose(c(1006, ''), { ...retry, reconnects: MAX_RECONNECTS }), {
    action: 'fail',
    remember: false,
  });
  // 대화 중 한도 초과는 다시 연결해도 소용없다 (일일 한도일 때만 그날 기억)
  assert.deepEqual(planAfterClose(c(1011, 'quota exceeded'), talking), { action: 'fail', remember: false });
  assert.deepEqual(planAfterClose(c(1011, 'quota exceeded per day'), talking), { action: 'fail', remember: true });
});

test('PCM 변환: 실수↔16비트, 리틀 엔디언 base64 왕복', () => {
  assert.deepEqual(
    [...floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))],
    [0, 32767, -32768, 32767, -32768, 16383]
  );
  assert.deepEqual([...int16ToFloat32(Int16Array.from([-32768, 0, 16384]))], [-1, 0, 0.5]);

  // [1, -2] → 바이트 01 00 FE FF
  assert.equal(base64FromInt16(Int16Array.from([1, -2])), 'AQD+/w==');
  assert.deepEqual([...int16FromBase64('AQD+/w==')], [1, -2]);
  const samples = Int16Array.from({ length: CHUNK_SAMPLES }, (_, i) => Math.round(Math.sin(i / 7) * 30000));
  assert.deepEqual(int16FromBase64(base64FromInt16(samples)), samples);
  assert.equal(int16FromBase64('AQD+').length, 1); // 남는 바이트는 버린다
  assert.equal(peakLevel(Int16Array.from([0, 0, 0, 0, -16384, 0, 0, 0])), 0.5);
});

test('표본화율 낮추기: 정수 비율은 구간 평균, 44.1kHz는 블록을 넘어 이어서 계산', () => {
  const down = createDownsampler(48000, 16000);
  assert.deepEqual([...down(Float32Array.from([1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5]))], [1, 0, 0.5]);
  assert.deepEqual([...down(Float32Array.from([0.25, 0.25]))], []); // 구간이 덜 찼다
  assert.deepEqual([...down(Float32Array.from([0.25]))], [0.25]);

  const d44 = createDownsampler(44100, 16000);
  let total = 0;
  for (let i = 0; i < 44100 / 100; i++) total += d44(new Float32Array(100).fill(0.3)).length;
  assert.ok(Math.abs(total - 16000) <= 1, `${total}`);
  assert.ok(Math.abs(d44(new Float32Array(128).fill(0.3))[0] - 0.3) < 1e-6);

  const same = createDownsampler(16000, 16000);
  assert.deepEqual([...same(Float32Array.from([0.1, 0.2]))].map((v) => +v.toFixed(3)), [0.1, 0.2]);
});

test('takeSentences: 스트리밍 중에는 끝난 문장만, 마지막에는 나머지까지', () => {
  let r = takeSentences('Hello there! How are', 0);
  assert.deepEqual(r, { sentences: ['Hello there!'], end: 13 });
  r = takeSentences('Hello there! How are you? It costs 3.', r.end);
  assert.deepEqual(r.sentences, ['How are you?']);
  // "3." 뒤에 숫자가 더 올 수 있으므로 아직 끝난 문장으로 보지 않는다
  r = takeSentences('Hello there! How are you? It costs 3.5 dollars', r.end, true);
  assert.deepEqual(r.sentences, ['It costs 3.5 dollars']);
  // 문장 끝 기호 뒤의 닫는 따옴표는 그 문장에 붙인다
  assert.deepEqual(takeSentences('He said "Hi." Then he left. Ok', 0).sentences, ['He said "Hi."', 'Then he left.']);
  assert.deepEqual(takeSentences('', 0, true), { sentences: [], end: 0 });
});

test('recentTurns: 최근 대화만, 사용자 차례로 시작', () => {
  const turns = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', n: i }));
  const recent = recentTurns(turns, 8);
  assert.equal(recent[0].role, 'user');
  assert.deepEqual(
    recent.map((t) => t.n),
    [4, 5, 6, 7, 8, 9, 10]
  );
  assert.deepEqual(recentTurns([{ role: 'model' }]), []);
});

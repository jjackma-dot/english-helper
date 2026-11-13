// js/services/azure-speech.js (가짜 Speech SDK로 발음 평가 흐름·오류·취소)와 js/services/level-test.js (Gemini 채점·총평 요청)
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
const mem = new Map([['eh.settings.v1', JSON.stringify({ geminiKey: 'k' })]]);
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

/* ---------- 가짜 Speech SDK ---------- */

const azure = { recognizers: [], fail: null, answer: () => [] };
const SDK = {
  SpeechConfig: { fromSubscription: (key, region) => ({ key, region, speechRecognitionLanguage: '' }) },
  AudioConfig: { fromWavFileInput: (file) => ({ file }) },
  PronunciationAssessmentConfig: class {
    constructor(referenceText, gradingSystem, granularity, enableMiscue) {
      Object.assign(this, { referenceText, gradingSystem, granularity, enableMiscue, enableProsodyAssessment: false });
    }
    applyTo(rec) {
      rec.pa = this;
    }
  },
  PronunciationAssessmentGradingSystem: { HundredMark: 'HundredMark' },
  PronunciationAssessmentGranularity: { Word: 'Word' },
  SpeechRecognizer: class {
    constructor(speechConfig, audioConfig) {
      Object.assign(this, { speechConfig, audioConfig, pa: null, closed: false, stops: 0 });
      azure.recognizers.push(this);
    }
    startContinuousRecognitionAsync(ok) {
      ok?.();
      setTimeout(() => {
        if (azure.fail) {
          this.canceled?.(this, {
            reason: SDK.CancellationReason.Error,
            errorCode: azure.fail.code,
            errorDetails: azure.fail.details,
          });
          return;
        }
        for (const r of azure.answer(this)) {
          this.recognized?.(this, {
            result: {
              reason: r.noMatch ? SDK.ResultReason.NoMatch : SDK.ResultReason.RecognizedSpeech,
              text: r.text,
              properties: { getProperty: (id) => (id === 23 ? JSON.stringify(r.json) : '') },
            },
          });
        }
        this.canceled?.(this, { reason: SDK.CancellationReason.EndOfStream });
      }, 0);
    }
    stopContinuousRecognitionAsync(ok) {
      this.stops++;
      ok?.();
      setTimeout(() => this.sessionStopped?.(this, {}), 0);
    }
    close() {
      this.closed = true;
    }
  },
  ResultReason: { NoMatch: 0, RecognizedSpeech: 3 },
  CancellationReason: { Error: 0, EndOfStream: 1 },
  CancellationErrorCode: {
    NoError: 0,
    AuthenticationFailure: 1,
    TooManyRequests: 3,
    ConnectionFailure: 4,
    ServiceTimeout: 5,
    Forbidden: 8,
  },
  PropertyId: { SpeechServiceResponse_JsonResult: 23 },
};
globalThis.SpeechSDK = SDK;

const { assessSpeech, silentWav, testAzure, REGIONS } = await import('../js/services/azure-speech.js');
const { gradeAnswer, summarize } = await import('../js/services/level-test.js');
const { buildTest } = await import('../js/lib/level.js');

const json = (text, pa, words = []) => ({ NBest: [{ Display: text, PronunciationAssessment: pa, Words: words }] });
const wav = new Blob([new Uint8Array(100)], { type: 'audio/wav' });

test('assessSpeech: 키·지역·영어로 설정하고 WAV 파일을 주며, 억양 평가를 켜고, 자유 답변은 읽은 글 없이 보낸다', async () => {
  azure.answer = () => [
    {
      text: 'I like coffee.',
      json: json('I like coffee.', { AccuracyScore: 90, FluencyScore: 80, ProsodyScore: 70 }, [
        { Word: 'coffee', PronunciationAssessment: { AccuracyScore: 55, ErrorType: 'Mispronunciation' } },
      ]),
    },
    { noMatch: true, text: '', json: {} },
    { text: 'Yes.', json: json('Yes.', { AccuracyScore: 60, FluencyScore: 50, ProsodyScore: 40 }, [{ Word: 'Yes' }]) },
  ];
  const partials = [];
  const r = await assessSpeech({
    key: 'K',
    region: 'koreacentral',
    audio: wav,
    onPartial: (p) => partials.push(p.transcript),
  });
  const rec = azure.recognizers.at(-1);
  assert.deepEqual(
    [rec.speechConfig.key, rec.speechConfig.region, rec.speechConfig.speechRecognitionLanguage],
    ['K', 'koreacentral', 'en-US']
  );
  assert.ok(rec.audioConfig.file instanceof File);
  assert.equal(rec.audioConfig.file.type, 'audio/wav');
  assert.deepEqual(
    [
      rec.pa.referenceText,
      rec.pa.gradingSystem,
      rec.pa.granularity,
      rec.pa.enableMiscue,
      rec.pa.enableProsodyAssessment,
    ],
    ['', 'HundredMark', 'Word', false, true]
  );
  assert.equal(r.transcript, 'I like coffee. Yes.');
  assert.equal(r.scores.pronunciation, 75, '단어 수로 가중 (1:1)');
  assert.equal(r.scores.completeness, null);
  assert.equal(r.utterances, 2, 'NoMatch 토막은 세지 않는다');
  assert.deepEqual(partials, ['I like coffee.', 'I like coffee. Yes.']);
  assert.ok(rec.closed && rec.stops >= 1, '끝나면 닫는다');
});

test('assessSpeech: 읽은 글(referenceText)이 있으면 빠뜨린 단어도 보고(miscue), 말소리가 없으면 점수 0', async () => {
  azure.answer = () => [];
  const r = await assessSpeech({ key: 'K', region: 'eastus', audio: wav, referenceText: 'Hello there.' });
  const rec = azure.recognizers.at(-1);
  assert.deepEqual([rec.pa.referenceText, rec.pa.enableMiscue], ['Hello there.', true]);
  assert.deepEqual(r, {
    transcript: '',
    scores: { pronunciation: 0, fluency: 0, prosody: 0, completeness: null },
    words: [],
    utterances: 0,
  });
});

test('assessSpeech: 키가 없으면 보내지 않고, Azure 오류는 알기 쉬운 말로, 취소하면 AbortError', async () => {
  const n = azure.recognizers.length;
  await assert.rejects(assessSpeech({ key: '', region: 'eastus', audio: wav }), /Azure 음성 키와 지역을 설정에서/);
  assert.equal(azure.recognizers.length, n);

  azure.fail = { code: 1, details: 'WebSocket upgrade failed: Unauthorized (401)' };
  await assert.rejects(assessSpeech({ key: 'bad', region: 'eastus', audio: wav }), /키나 지역이 맞지 않아요/);
  azure.fail = { code: 8, details: 'Quota exceeded for this month' };
  await assert.rejects(assessSpeech({ key: 'K', region: 'eastus', audio: wav }), /무료 사용량\(5시간\)을 다 썼어요/);
  azure.fail = null;
  assert.ok(azure.recognizers.at(-1).closed, '오류가 나도 닫는다');

  const ctl = new AbortController();
  azure.answer = () => [];
  const p = assessSpeech({ key: 'K', region: 'eastus', audio: wav, signal: ctl.signal });
  ctl.abort();
  await assert.rejects(p, { name: 'AbortError' });
  ctl.abort();
  await assert.rejects(assessSpeech({ key: 'K', region: 'eastus', audio: wav, signal: ctl.signal }), {
    name: 'AbortError',
  });
});

test('silentWav·testAzure: 1초 무음 16kHz WAV로 연결만 확인한다', async () => {
  const b = silentWav(1);
  assert.equal(b.size, 44 + 16000 * 2);
  const head = Buffer.from(await b.slice(0, 44).arrayBuffer());
  assert.equal(head.toString('ascii', 0, 4), 'RIFF');
  assert.equal(head.toString('ascii', 8, 12), 'WAVE');
  assert.equal(head.readUInt32LE(24), 16000, '샘플 속도');
  assert.equal(head.readUInt16LE(22), 1, '모노');
  azure.answer = () => [];
  await testAzure({ key: 'K', region: 'koreacentral' });
  assert.equal(azure.recognizers.at(-1).audioConfig.file.size, b.size);
  assert.ok(REGIONS.some(([id]) => id === 'koreacentral'));
});

/* ---------- Gemini (가짜 fetch) ---------- */

const enc = new TextEncoder();
const sse = (text) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })}\n\n`
          )
        );
        c.close();
      },
    })
  );
const calls = [];
let reply = () => sse('{}');
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) });
  return reply(calls.at(-1).body);
};

test('gradeAnswer: 유형·지시문·받아쓰기·시간을 주고 문법·어휘·과제 수행(0~100)과 피드백을 받는다', async () => {
  const task = buildTest('normal', new Set(), () => 0.2).tasks[6]; // 의견 말하기
  reply = () =>
    sse(
      JSON.stringify({
        grammar: 61.6,
        vocabulary: 140,
        relevance: 70,
        feedbackKo: '이유를 잘 들었어요. 시제를 조심하세요.',
        corrections: [
          { original: 'I go there yesterday', corrected: 'I went there yesterday', noteKo: '과거형' },
          { original: '', corrected: 'x' },
        ],
        better: 'In my opinion, homework is useful because it helps students review.',
      })
    );
  const g = await gradeAnswer({
    task,
    level: 'normal',
    transcript: 'i think homework is good because i go there yesterday',
    seconds: 41,
  });
  assert.deepEqual([g.grammar, g.vocabulary, g.relevance], [62, 100, 70], '반올림하고 0~100으로 자른다');
  assert.equal(g.corrections.length, 1, '빈 고침은 뺀다');
  assert.match(g.better, /^In my opinion/);
  const { systemInstruction, contents, generationConfig } = calls.at(-1).body;
  assert.match(systemInstruction.parts[0].text, /TOEIC Speaking and OPIc/);
  assert.match(systemInstruction.parts[0].text, /never penalize punctuation/);
  const prompt = contents[0].parts[0].text;
  assert.match(
    prompt,
    /Test part: 의견 말하기 \(opinion\)\. Difficulty: 일반\. Time allowed: 60 seconds; the learner spoke for about 41 seconds/
  );
  assert.match(
    prompt,
    new RegExp(`Task given to the learner: ${task.question.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  );
  assert.match(prompt, /Transcript of the answer:\n"""\ni think homework is good/);
  assert.match(prompt, /Score each criterion from 0 to 100/);
  assert.deepEqual(generationConfig.responseSchema.propertyOrdering, [
    'grammar',
    'vocabulary',
    'relevance',
    'feedbackKo',
    'corrections',
    'better',
  ]);
  assert.equal(generationConfig.responseSchema.properties.grammar.type, 'NUMBER');

  reply = () => sse(JSON.stringify({ grammar: 'n/a' }));
  await assert.rejects(gradeAnswer({ task, level: 'easy', transcript: '', seconds: 0 }), /채점 결과를 읽지 못했습니다/);
  assert.match(calls.at(-1).body.contents[0].parts[0].text, /\(nothing was recognized\)/);
});

test('summarize: 항목 점수와 과제별 답·피드백을 모아 한국어 총평을 글로 받는다', async () => {
  reply = () => sse('- 지금은 중급 초반이에요.\n- 잘한 점: ...');
  const text = await summarize({
    total: 61.5,
    scores: { pronunciation: 80, fluency: 70, prosody: 60, grammar: 55, vocabulary: 50, relevance: 60 },
    items: [
      {
        part: 'read',
        prompt: 'Read the text aloud: "Hi."',
        transcript: 'hi',
        scores: { pronunciation: 80 },
        feedbackKo: '',
      },
      {
        part: 'opinion',
        prompt: 'Do you like homework?',
        transcript: '',
        scores: { grammar: 0 },
        feedbackKo: '답이 없었어요.',
      },
    ],
  });
  assert.match(text, /^- 지금은 중급 초반이에요\./);
  const body = calls.at(-1).body;
  assert.equal(body.generationConfig.responseMimeType, undefined, '글로 받는다');
  assert.equal(body.generationConfig.maxOutputTokens, 900);
  assert.match(body.contents[0].parts[0].text, /Overall 61\.5\/100/);
  assert.match(
    body.contents[0].parts[0].text,
    /Task 2 \(opinion\): Do you like homework\?\nAnswer: \(no answer\)[\s\S]*Feedback: 답이 없었어요\./
  );
  assert.match(body.systemInstruction.parts[0].text, /plain text without\s+markdown/);
});

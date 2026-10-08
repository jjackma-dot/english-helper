import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFreeDictionary,
  parseMyMemory,
  parseMyMemoryMatches,
  QuotaError,
  extractGeminiText,
  geminiErrorMessage,
  parseJsonLoose,
  normalizeOpenverse,
  normalizeWiktionary,
} from '../js/lib/api-parse.js';

test('Free Dictionary 응답 정리: 품사별 병합, 음성 US 우선, 빈 audio 제외', () => {
  const json = [
    {
      word: 'run',
      phonetic: '/ɹʌn/',
      phonetics: [
        { text: '/ɹʌn/', audio: '' },
        { text: '/ɹʌn/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-uk.mp3' },
        { text: '/ɹʌn/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' },
      ],
      meanings: [
        {
          partOfSpeech: 'verb',
          definitions: [{ definition: 'To move quickly.', example: 'I run every day.', synonyms: ['sprint'] }],
          synonyms: ['jog'],
        },
        { partOfSpeech: 'noun', definitions: [{ definition: 'An act of running.' }] },
      ],
    },
    {
      word: 'run',
      phonetics: [{ audio: '//ssl.gstatic.com/run.mp3' }],
      meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To operate.', synonyms: ['sprint'] }] }],
    },
  ];
  const d = normalizeFreeDictionary(json);
  assert.equal(d.word, 'run');
  assert.equal(d.phonetic, '/ɹʌn/');
  assert.deepEqual(
    d.audios.map((a) => a.accent),
    ['US', 'UK', '']
  );
  assert.equal(d.audios[2].url, 'https://ssl.gstatic.com/run.mp3');
  assert.deepEqual(
    d.meanings.map((m) => m.pos),
    ['verb', 'noun']
  );
  assert.equal(d.meanings[0].defs.length, 2);
  assert.deepEqual(d.meanings[0].synonyms, ['sprint', 'jog']);
  assert.equal(normalizeFreeDictionary({ title: 'No Definitions Found' }), null);
});

test('MyMemory: 정상 응답, 엔티티 해제, 한도 초과·오류', () => {
  assert.equal(parseMyMemory({ responseStatus: 200, responseData: { translatedText: 'It&#39;s fine' } }), "It's fine");
  assert.throws(
    () =>
      parseMyMemory({
        responseStatus: 200,
        responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' },
      }),
    QuotaError
  );
  assert.throws(() => parseMyMemory({ responseStatus: 429, responseData: {} }), QuotaError);
  assert.throws(
    () => parseMyMemory({ responseStatus: 403, responseDetails: 'INVALID LANGUAGE PAIR' }),
    /INVALID LANGUAGE PAIR/
  );
});

test('MyMemory 단어 뜻 후보: 일치도순, 중복·원문·낮은 일치 제외', () => {
  const json = {
    responseStatus: 200,
    responseData: { translatedText: '사과' },
    matches: [
      { translation: '사과.', match: 1, quality: 74 },
      { translation: '애플', match: 0.99, quality: 70 },
      { translation: 'apple', match: 0.98 },
      { translation: '엉뚱한 문장', match: 0.3 },
      { translation: '사과나무', match: 0.85 },
    ],
  };
  assert.deepEqual(parseMyMemoryMatches(json, 'Apple'), ['사과', '애플', '사과나무']);
  assert.throws(
    () =>
      parseMyMemoryMatches({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: quota' } }, 'x'),
    QuotaError
  );
});

test('Gemini 응답 텍스트 추출: thought 부분 제외, 차단·빈 응답 오류', () => {
  const json = {
    candidates: [
      {
        content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Hello' }, { text: ' world' }] },
        finishReason: 'STOP',
      },
    ],
  };
  assert.equal(extractGeminiText(json), 'Hello world');
  assert.throws(() => extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
  assert.throws(
    () => extractGeminiText({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
    /MAX_TOKENS/
  );
});

test('Gemini 오류 메시지 (키 오류·모델 없음·한도)', () => {
  assert.match(
    geminiErrorMessage(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
    /키가 올바르지/
  );
  assert.match(geminiErrorMessage(404, { error: { message: 'models/x is not found' } }), /모델을 찾을 수 없/);
  assert.match(geminiErrorMessage(429, {}), /한도/);
  assert.match(geminiErrorMessage(503, {}), /일시적/);
  assert.match(geminiErrorMessage(400, { error: { message: 'Bad schema' } }), /Bad schema/);
});

test('parseJsonLoose: 순수 JSON, 코드 블록, 앞뒤 잡문', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Here you go: {"a":3} thanks'), { a: 3 });
  assert.throws(() => parseJsonLoose('no json'), /해석하지 못했습니다/);
});

test('Openverse·Wiktionary 정리', () => {
  const imgs = normalizeOpenverse({
    results: [
      {
        title: 'Apple',
        url: 'https://x/a.jpg',
        thumbnail: 'https://api.openverse.org/v1/images/1/thumb/',
        foreign_landing_url: 'https://flickr/1',
        creator: 'kim',
        license: 'by',
      },
      { title: 'no image' },
    ],
  });
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].thumb, 'https://api.openverse.org/v1/images/1/thumb/');
  assert.equal(imgs[0].credit, 'kim · CC BY');
  assert.deepEqual(normalizeOpenverse(null), []);

  const wiki = normalizeWiktionary(
    {
      ko: [
        {
          partOfSpeech: 'Noun',
          definitions: [{ definition: '<a href="/wiki/apple">apple</a> (fruit)' }, { definition: '' }],
        },
      ],
      en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'x' }] }],
    },
    'ko'
  );
  assert.deepEqual(wiki, [{ pos: 'Noun', defs: ['apple (fruit)'] }]);
  assert.deepEqual(normalizeWiktionary({}, 'ko'), []);
});

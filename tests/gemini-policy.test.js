import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAST_MODEL,
  modelChain,
  thinkingFor,
  parseDuration,
  retryDelayMs,
  isDailyQuota,
  nextPacificMidnight,
  classifyGeminiError,
  splitSse,
  chunkText,
} from '../js/lib/gemini-policy.js';
import { closePartialJson, parsePartialJson } from '../js/lib/partial-json.js';

test('모델 순서: 설정 모델 → 예비 모델, 중복·쉬는 모델 제외', () => {
  assert.deepEqual(modelChain('models/gemini-3.8-flash'), ['gemini-3.8-flash', FAST_MODEL, 'gemini-3.1-flash-lite']);
  assert.deepEqual(modelChain(FAST_MODEL), [FAST_MODEL, 'gemini-3.1-flash-lite']);
  assert.deepEqual(modelChain(FAST_MODEL, { cooled: (m) => m === FAST_MODEL }), ['gemini-3.1-flash-lite']);
  assert.deepEqual(modelChain('', { cooled: () => true }), []);
});

test('생각 설정: 2.5는 budget, 3.x Flash-Lite·3.5 Flash는 minimal, 3.8 Flash·별칭은 low', () => {
  assert.deepEqual(thinkingFor('gemini-2.5-flash'), { thinkingBudget: 0 });
  assert.equal(thinkingFor('gemini-2.5-flash-lite'), undefined);
  assert.deepEqual(thinkingFor('gemini-3.5-flash-lite'), { thinkingLevel: 'minimal' });
  assert.deepEqual(thinkingFor('models/gemini-3.1-flash-lite'), { thinkingLevel: 'minimal' });
  assert.deepEqual(thinkingFor('gemini-3.5-flash'), { thinkingLevel: 'minimal' });
  assert.deepEqual(thinkingFor('gemini-3-flash-preview'), { thinkingLevel: 'minimal' });
  assert.deepEqual(thinkingFor('gemini-3.8-flash'), { thinkingLevel: 'low' });
  assert.deepEqual(thinkingFor('gemini-flash-latest'), { thinkingLevel: 'low' });
  assert.deepEqual(thinkingFor('gemma-4-26b-a4b-it'), { thinkingLevel: 'minimal' });
  assert.equal(thinkingFor('gemini-3.8-live'), undefined);
});

test('재시도 대기 시간 읽기: RetryInfo, 메시지', () => {
  assert.equal(parseDuration('44s'), 44000);
  assert.equal(parseDuration('1.5s'), 1500);
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('x'), null);
  const withInfo = {
    error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }] },
  };
  assert.equal(retryDelayMs(withInfo), 2000);
  assert.equal(retryDelayMs({ error: { message: 'Quota exceeded. Please retry in 56.18s.' } }), 56180);
  assert.equal(retryDelayMs({ error: { message: 'nope' } }), null);
});

test('일일 한도 판별', () => {
  const perDay = {
    error: {
      message: 'You exceeded your current quota',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      ],
    },
  };
  assert.ok(isDailyQuota(perDay));
  assert.ok(isDailyQuota({ error: { message: 'Quota exceeded for metric: x, limit: 0' } }));
  const perMinute = {
    error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] },
  };
  assert.ok(!isDailyQuota(perMinute));
});

test('태평양 시간 자정 계산 (서머타임 포함)', () => {
  // 2026-10-12 09:00 KST = 2026-10-11 17:00 PDT → 다음 자정 2026-10-12 00:00 PDT = 07:00Z
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-10-12T00:00:00Z'))).toISOString(), '2026-10-12T07:00:00.000Z');
  // 겨울(PST): 2026-12-01 12:00Z → 2026-12-02 00:00 PST = 08:00Z
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-12-01T12:00:00Z'))).toISOString(), '2026-12-02T08:00:00.000Z');
  // 서머타임 끝나는 날(2026-11-01) 오전 → 다음 자정은 PST 기준
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-11-01T15:00:00Z'))).toISOString(), '2026-11-02T08:00:00.000Z');
});

test('오류 분류: 일일 한도 → 쉬기, 짧은 대기 → 재시도, 503 → 재시도, 키 오류 → 중단', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  const daily = classifyGeminiError(429, { error: { message: 'limit: 0' } }, { now });
  assert.equal(daily.action, 'cooldown');
  assert.equal(daily.until, Date.parse('2026-10-12T07:00:00Z'));
  const short = classifyGeminiError(
    429,
    { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } },
    { now }
  );
  assert.equal(short.action, 'retry');
  const long = classifyGeminiError(429, { error: { message: 'Please retry in 40s.' } }, { now });
  assert.equal(long.action, 'cooldown');
  assert.equal(long.until, now + 40000);
  assert.equal(classifyGeminiError(503, {}).action, 'retry');
  assert.equal(classifyGeminiError(404, {}).action, 'next');
  assert.equal(classifyGeminiError(400, { error: { message: 'thinking_level is not supported' } }).action, 'no-thinking');
  assert.equal(classifyGeminiError(400, { error: { message: 'API key not valid' } }).action, 'fatal');
  assert.equal(classifyGeminiError(403, {}).action, 'fatal');
});

test('SSE 나누기: 여러 줄 바꿈 형식, 남은 조각 보존', () => {
  const { events, rest } = splitSse('data: {"a":1}\r\n\r\ndata: {"b":2}\n\ndata: {"c"');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, 'data: {"c"');
  assert.deepEqual(splitSse(': comment\n\n').events, []);
});

test('스트림 조각에서 생각 부분을 빼고 본문만 꺼낸다', () => {
  const c = chunkText({
    candidates: [
      { content: { parts: [{ text: 'hmm', thought: true }, { text: 'Hello' }, { text: ' world' }] }, finishReason: 'STOP' },
    ],
  });
  assert.equal(c.text, 'Hello world');
  assert.equal(c.finishReason, 'STOP');
  assert.equal(chunkText({ promptFeedback: { blockReason: 'SAFETY' } }).blockReason, 'SAFETY');
});

test('덜 끝난 JSON 닫기', () => {
  assert.deepEqual(parsePartialJson('{"pronunciation":"/ræn/","entries":[{"english":"run","korean":"달리'), {
    pronunciation: '/ræn/',
    entries: [{ english: 'run', korean: '달리' }],
  });
  assert.deepEqual(parsePartialJson('{"a":1,"b'), { a: 1 });
  assert.deepEqual(parsePartialJson('{"a":1,"b":'), { a: 1, b: null });
  assert.deepEqual(parsePartialJson('{"a":[1,2,'), { a: [1, 2] });
  assert.deepEqual(parsePartialJson('{"a":"x\\'), { a: 'x' });
  assert.deepEqual(parsePartialJson('{"a":"\\u00'), { a: '' });
  assert.deepEqual(parsePartialJson('{"a":tr'), { a: null });
  assert.deepEqual(parsePartialJson('{"a":1.'), { a: 1 });
  assert.deepEqual(parsePartialJson('```json\n{"a":{"b":["c"'), { a: { b: ['c'] } });
  assert.deepEqual(parsePartialJson('{"a":1} trailing'), { a: 1 });
  assert.equal(parsePartialJson(''), undefined);
  assert.equal(parsePartialJson('no json'), undefined);
  assert.equal(closePartialJson('{"a":"b}'), '{"a":"b}"}');
});

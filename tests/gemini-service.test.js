// js/services/gemini.js를 가짜 fetch로 시험한다: 스트리밍, 재시도, 모델 바꾸기, 시간 제한
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window ??= globalThis;
globalThis.window.dispatchEvent ??= () => true;

const { generate } = await import('../js/services/gemini.js');

const enc = new TextEncoder();
function sse(chunks, { delayMs = 0 } = {}) {
  return new Response(
    new ReadableStream({
      async start(c) {
        for (const ch of chunks) {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\r\n\r\n`));
        }
        c.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}
const part = (text, finishReason) => ({
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
  modelVersion: 'gemini-3.5-flash-lite-001',
});
const errorRes = (status, error) => new Response(JSON.stringify({ error }), { status });

function mockFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const h = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    return h(String(url), body, init);
  };
  return calls;
}

test.beforeEach(() => mem.clear());

test('스트리밍 JSON: 조각마다 덜 끝난 결과를 알리고 최종 객체를 돌려준다', async () => {
  const calls = mockFetch([() => sse([part('{"entries":[{"korean":"달'), part('리다"}]}', 'STOP')])]);
  const partials = [];
  let meta;
  const r = await generate({
    prompt: 'run',
    schema: { type: 'OBJECT' },
    key: 'k',
    onPartial: (p) => partials.push(p),
    onMeta: (m) => (meta = m),
  });
  assert.deepEqual(r, { entries: [{ korean: '달리다' }] });
  assert.deepEqual(partials[0], { entries: [{ korean: '달' }] });
  assert.equal(meta.modelVersion, 'gemini-3.5-flash-lite-001');
  assert.match(calls[0].url, /models\/gemini-3\.5-flash-lite:streamGenerateContent\?alt=sse$/);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(calls[0].body.generationConfig.temperature, undefined);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
});

test('503이면 같은 모델로 한 번 더 시도한다', async () => {
  const calls = mockFetch([
    () => errorRes(503, { code: 503, message: 'The model is overloaded.' }),
    () => sse([part('OK', 'STOP')]),
  ]);
  assert.equal(await generate({ prompt: 'x', key: 'k' }), 'OK');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
});

test('일일 한도면 그 모델을 쉬게 하고 다음 모델로 넘어가며, 다음 요청에서도 건너뛴다', async () => {
  const calls = mockFetch([
    () => errorRes(429, { code: 429, message: 'Quota exceeded for metric: x, limit: 0' }),
    () => sse([part('OK', 'STOP')]),
    () => sse([part('OK2', 'STOP')]),
  ]);
  assert.equal(await generate({ prompt: 'x', key: 'k' }), 'OK');
  assert.match(calls[1].url, /gemini-3\.1-flash-lite/);
  assert.equal(await generate({ prompt: 'y', key: 'k' }), 'OK2');
  assert.match(calls[2].url, /gemini-3\.1-flash-lite/);
});

test('모든 모델이 일일 한도면 (자정 직전이라도) 일일 한도라고 알려 준다', async () => {
  mockFetch([() => errorRes(429, { code: 429, message: 'limit: 0' })]);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), /한도를 다 썼습니다/);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), /한도를 다 썼습니다/);
});

test('분당 한도로 모든 모델이 쉬면 잠시 뒤 다시 하라고 알려 준다', async () => {
  mockFetch([() => errorRes(429, { code: 429, message: 'Please retry in 40s.' })]);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), /잠시 많습니다/);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), /잠시 많습니다/);
});

test('생각 설정을 거부하면 빼고 다시 보낸다', async () => {
  const calls = mockFetch([
    () => errorRes(400, { code: 400, message: 'thinking_level MINIMAL is not supported for this model' }),
    () => sse([part('OK', 'STOP')]),
  ]);
  assert.equal(await generate({ prompt: 'x', key: 'k', model: 'gemini-3.5-flash' }), 'OK');
  assert.ok(calls[0].body.generationConfig.thinkingConfig);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
});

test('첫 응답이 늦으면 시간 제한으로 끊고 다시 시도한다', async () => {
  const calls = mockFetch([
    (url, body, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
    () => sse([part('OK', 'STOP')]),
  ]);
  assert.equal(await generate({ prompt: 'x', key: 'k', firstChunkMs: 50 }), 'OK');
  assert.equal(calls.length, 2);
});

test('사용자가 취소하면 다시 시도하지 않고 AbortError', async () => {
  const ctl = new AbortController();
  const calls = mockFetch([
    (url, body, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
  ]);
  const p = generate({ prompt: 'x', key: 'k', signal: ctl.signal });
  setTimeout(() => ctl.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(calls.length, 1);
});

test('키 오류는 다시 시도하지 않는다', async () => {
  const calls = mockFetch([() => errorRes(400, { code: 400, message: 'API key not valid. Please pass a valid API key.' })]);
  await assert.rejects(generate({ prompt: 'x', key: 'bad' }), /키가 올바르지 않습니다/);
  assert.equal(calls.length, 1);
});

test('fallback:false면 지정 모델만 쓴다 (연결 테스트)', async () => {
  const calls = mockFetch([() => errorRes(404, { code: 404, message: 'not found' })]);
  await assert.rejects(generate({ prompt: 'x', key: 'k', model: 'gemini-x', fallback: false }));
  assert.equal(calls.length, 1);
});

test('저작권(RECITATION)·안전 필터로 막히면 다시 시도하지 않고 이유를 알린다', async () => {
  const calls = mockFetch([() => sse([part('', 'RECITATION')])]);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), (e) => e.reason === 'RECITATION' && /저작권/.test(e.message));
  assert.equal(calls.length, 1);
  const calls2 = mockFetch([() => sse([{ promptFeedback: { blockReason: 'SAFETY' } }])]);
  await assert.rejects(generate({ prompt: 'x', key: 'k' }), (e) => e.reason === 'SAFETY');
  assert.equal(calls2.length, 1);
});

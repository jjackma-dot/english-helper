// js/services/dictionary.js의 AI 사전을 가짜 fetch로 시험한다: 짧은 스키마, 스트리밍, 보관함
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map([['eh.settings.v1', JSON.stringify({ geminiKey: 'k' })]]);
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window ??= globalThis;

const { aiEntry, aiWordInContext, aiExplainLine } = await import('../js/services/dictionary.js');
const { cached } = await import('../js/services/ai-cache.js');

const enc = new TextEncoder();
const sse = (texts) =>
  new Response(
    new ReadableStream({
      start(c) {
        texts.forEach((text, i) => {
          const done = i === texts.length - 1 ? { finishReason: 'STOP' } : {};
          c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...done }] })}\n\n`));
        });
        c.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

function mockFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return handlers[Math.min(calls.length - 1, handlers.length - 1)]();
  };
  return calls;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('aiEntry: 짧은 스키마로 스트리밍하고, 같은 검색어는 보관함에서 바로 꺼낸다', async () => {
  const calls = mockFetch([
    () => sse(['{"pronunciation":"/rʌn/","entries":[{"english":"run","korean":"달', '리다"}]}']),
  ]);
  const partials = [];
  const first = await aiEntry('run', 'en', { onPartial: (p) => partials.push(p) });
  assert.equal(first.cached, false);
  assert.deepEqual(first.entry.entries, [{ english: 'run', korean: '달리다' }]);
  assert.equal(partials[0].entries[0].korean, '달');

  const { generationConfig } = calls[0].body;
  assert.equal(generationConfig.maxOutputTokens, 2048);
  const schema = generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ['pronunciation', 'entries', 'synonyms', 'tip']);
  assert.deepEqual(schema.properties.entries.items.propertyOrdering, [
    'english',
    'partOfSpeech',
    'korean',
    'nuance',
    'examples',
  ]);
  assert.match(calls[0].body.contents[0].parts[0].text, /up to 3/);

  const again = await aiEntry(' run ', 'en');
  assert.deepEqual(again, { entry: first.entry, cached: true });
  assert.equal(calls.length, 1);

  const fresh = await aiEntry('run', 'en', { fresh: true });
  assert.equal(fresh.cached, false);
  assert.equal(calls.length, 2);

  // 대소문자가 다르면 뜻이 다를 수 있으므로(US/us) 따로 찾는다
  assert.equal((await aiEntry('Run', 'en')).cached, false);
  assert.equal(calls.length, 3);
});

test('aiWordInContext·aiExplainLine: 결과를 그대로 돌려주고 같은 요청은 다시 보내지 않는다', async () => {
  const calls = mockFetch([
    () => sse(['{"word":"run","meaning":"달리다"}']),
    () => sse(['{"translation":"가자","expressions":[]}']),
  ]);
  assert.deepEqual(await aiWordInContext('ran', 'I ran.'), { word: 'run', meaning: '달리다' });
  assert.deepEqual(await aiWordInContext('ran', 'I ran.'), { word: 'run', meaning: '달리다' });
  assert.deepEqual(await aiExplainLine("Let's go.", { context: 'Hi.' }), { translation: '가자', expressions: [] });
  assert.deepEqual(await aiExplainLine("Let's go."), { translation: '가자', expressions: [] });
  assert.equal(calls.length, 2);
});

test('보관함: 먼저 시작한 같은 요청이 취소되면 기다리던 쪽이 직접 만든다 (멈추지 않음)', async () => {
  let rejectFirst;
  const first = cached('test:abort', () => new Promise((_, reject) => (rejectFirst = reject)));
  await tick();
  const second = cached('test:abort', async () => 'new');
  await tick();
  rejectFirst(new DOMException('Aborted', 'AbortError'));
  await assert.rejects(first, { name: 'AbortError' });
  assert.deepEqual(await second, { value: 'new', cached: false });

  // 취소가 아닌 오류는 기다리던 쪽도 함께 받는다
  let rejectA;
  const a = cached('test:error', () => new Promise((_, reject) => (rejectA = reject)));
  await tick();
  const b = cached('test:error', async () => 'unused');
  await tick();
  rejectA(new Error('boom'));
  await assert.rejects(a, /boom/);
  await assert.rejects(b, /boom/);
});

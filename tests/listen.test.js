// OTT "방금 뭐라고?": 최근 소리 보관(링 버퍼)·음량 맞추기와, 소리 조각 해석 요청(가짜 fetch)을 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { SampleRing, rms, normalizePeak } from '../js/lib/ring.js';
import { encodeWav } from '../js/lib/wav.js';

const mem = new Map([['eh.settings.v1', JSON.stringify({ geminiKey: 'k' })]]);
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window ??= globalThis;
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = `data:${blob.type};base64,${Buffer.from(ab).toString('base64')}`;
      this.onload();
    });
  }
};

const { explainClip } = await import('../js/services/translate.js');

const f32 = (...xs) => new Float32Array(xs);

test('SampleRing: 덜 찼을 때는 넣은 만큼, 순서대로', () => {
  const r = new SampleRing(5);
  assert.deepEqual([...r.last(3)], []);
  r.push(f32(1, 2));
  assert.deepEqual([...r.last(10)], [1, 2]);
  assert.deepEqual([...r.last(1)], [2]);
  assert.deepEqual([...r.last(1.9)], [2], '소수는 내림');
});

test('SampleRing: 넘치면 오래된 것부터 덮어쓰고 last()는 오래된 → 최근 순서', () => {
  const r = new SampleRing(5);
  r.push(f32(1, 2, 3));
  r.push(f32(4, 5, 6, 7)); // 끝을 넘어 앞으로 이어 쓴다
  assert.deepEqual([...r.last(5)], [3, 4, 5, 6, 7]);
  assert.deepEqual([...r.last(2)], [6, 7]);
  r.push(f32(8));
  assert.deepEqual([...r.last(99)], [4, 5, 6, 7, 8]);
});

test('SampleRing: 버퍼보다 긴 조각은 끝부분만, clear()는 0으로 지운다', () => {
  const r = new SampleRing(3);
  r.push(f32(9));
  r.push(f32(1, 2, 3, 4, 5));
  assert.deepEqual([...r.last(3)], [3, 4, 5]);
  r.clear();
  assert.deepEqual([...r.last(3)], []);
  assert.ok(r.buf.every((x) => x === 0));
  r.push(f32(6));
  assert.deepEqual([...r.last(3)], [6]);
});

test('rms / normalizePeak', () => {
  assert.equal(rms(f32()), 0);
  assert.ok(Math.abs(rms(f32(0.5, -0.5, 0.5, -0.5)) - 0.5) < 1e-9);

  const loud = normalizePeak(f32(0.1, -0.3, 0.2));
  assert.ok(Math.abs(loud[1] + 0.9) < 1e-6, '가장 큰 소리가 0.9가 된다');
  assert.ok(Math.abs(loud[0] - 0.3) < 1e-6, '비율은 그대로');
  assert.ok(Math.abs(normalizePeak(f32(1.5))[0] - 0.9) < 1e-6, '너무 큰 소리는 줄인다');
  assert.ok(Math.abs(normalizePeak(f32(0.001))[0] - 0.03) < 1e-6, '아주 작은 소리는 30배까지만');
  assert.deepEqual([...normalizePeak(f32(0, 0))], [0, 0]);
});

/* ---------- explainClip (Gemini 스트리밍 흉내) ---------- */

const enc = new TextEncoder();
const sse = (...chunks) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.close();
      },
    })
  );
const part = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

function mockFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return handlers[Math.min(calls.length - 1, handlers.length - 1)]();
  };
  return calls;
}

const wav = new Blob([encodeWav(new Float32Array(16000), 16000)], { type: 'audio/wav' });
const answer = (en) =>
  JSON.stringify({ lines: [{ en, ko: '해석' }], phrases: [], explanationKo: '', confidence: 'high' });

test('explainClip: 소리를 inline WAV로 보내고, 대사부터 차례로 알린다', async () => {
  const full = answer('You gonna eat that?');
  const cut = full.indexOf(' eat');
  const calls = mockFetch([() => sse(part(full.slice(0, cut)), part(full.slice(cut), 'STOP'))]);
  const partials = [];
  const r = await explainClip(wav, { onPartial: (p) => partials.push(p) });
  assert.equal(r.lines[0].en, 'You gonna eat that?');
  assert.equal(r.paraphrased, false);
  assert.deepEqual(partials[0], { lines: [{ en: 'You gonna' }], paraphrased: false });
  const [audio, prompt] = calls[0].contents[0].parts;
  assert.equal(audio.inlineData.mimeType, 'audio/wav');
  assert.equal(Buffer.from(audio.inlineData.data, 'base64').length, 44 + 16000 * 2);
  assert.match(prompt.text, /LAST 1–3 utterances[\s\S]*\[inaudible\]/);
  const schema = calls[0].generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ['lines', 'phrases', 'explanationKo', 'confidence']);
  assert.deepEqual(schema.properties.confidence.enum, ['high', 'medium', 'low']);
});

test('explainClip: 저작권(RECITATION)으로 막히면 원문 조각을 지우고 요지로 한 번만 다시 묻는다', async () => {
  const calls = mockFetch([
    () => sse(part('{"lines":[{"en":"Exact quote'), part('', 'RECITATION')),
    () => sse(part(answer('He asks if she will eat it.'), 'STOP')),
  ]);
  const partials = [];
  const r = await explainClip(wav, { onPartial: (p) => partials.push(p) });
  assert.equal(calls.length, 2);
  assert.match(calls[1].contents[0].parts[1].text, /Do NOT quote the dialogue word for word/);
  assert.equal(r.paraphrased, true);
  assert.equal(r.lines[0].en, 'He asks if she will eat it.');
  assert.equal(partials[0].lines[0].en, 'Exact quote');
  assert.deepEqual(partials[1], { paraphrased: true }, '앞서 보여 준 원문을 지우라는 신호');
  assert.ok(partials.slice(1).every((p) => p.paraphrased));

  const again = mockFetch([() => sse(part('', 'RECITATION'))]);
  await assert.rejects(explainClip(wav), (e) => e.reason === 'RECITATION');
  assert.equal(again.length, 2, '요지 요청까지 막히면 그만둔다');
});

test('explainClip: 안전 필터 등 다른 오류는 다시 묻지 않는다', async () => {
  const calls = mockFetch([() => sse({ promptFeedback: { blockReason: 'SAFETY' } })]);
  await assert.rejects(explainClip(wav), (e) => e.reason === 'SAFETY');
  assert.equal(calls.length, 1);
});

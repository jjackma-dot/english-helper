// OTT 이어폰으로 볼 때: 따라 말한 녹음·적은 소리로 대사 짐작하기 — 요청문 만들기와 Gemini 요청(가짜 fetch)을 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
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

const { buildGuessPrompt, guessLine, GUESS_TEXT_MAX, SCENE_MAX } = await import('../js/services/translate.js');

/* ---------- 요청문 ---------- */

test('buildGuessPrompt: 따라 말한 녹음이면 흉내 낸 소리라는 것과 짐작하는 방법을 알린다', () => {
  const p = buildGuessPrompt();
  assert.match(p, /IMITATING from memory/);
  assert.match(p, /approximate/);
  assert.match(p, /gonna[\s\S]*flapping/, '연음·축약·플래핑을 따져 보게 한다');
  assert.match(p, /up to 3 genuinely different candidates, most likely first/);
  assert.match(p, /confidence/);
  assert.doesNotMatch(p, /Show or scene/, '작품·장면을 안 적었으면 넣지 않는다');
  assert.doesNotMatch(p, /"""/);
  assert.equal(buildGuessPrompt({ scene: '   ' }), p, '빈칸만 적은 장면도 넣지 않는다');
});

test('buildGuessPrompt: 적어서 묻기는 적은 소리를 따로 묶어 맨 끝에 넣고, 작품·장면은 한 줄로 넣는다', () => {
  const p = buildGuessPrompt({ text: '  아이 고나 웨더 잇 \n', scene: '  프렌즈\n  시즌1 ' });
  assert.match(p, /Korean Hangul spelling of the sounds/);
  assert.doesNotMatch(p, /IMITATING/);
  assert.match(p, /Show or scene, written by the learner[^\n]*: "프렌즈 시즌1"/);
  assert.ok(p.endsWith('"""\n아이 고나 웨더 잇\n"""'), p.slice(-40));

  const long = buildGuessPrompt({ text: 'a'.repeat(GUESS_TEXT_MAX + 50), scene: 'b'.repeat(SCENE_MAX + 50) });
  assert.ok(long.includes(`"""\n${'a'.repeat(GUESS_TEXT_MAX)}\n"""`));
  assert.ok(!long.includes('a'.repeat(GUESS_TEXT_MAX + 1)), '적은 소리는 최대 길이까지만');
  assert.ok(long.includes(`"${'b'.repeat(SCENE_MAX)}"`));
  assert.ok(!long.includes('b'.repeat(SCENE_MAX + 1)), '장면은 최대 길이까지만');
});

test('buildGuessPrompt: 요지(gist)로 다시 물을 때는 대본을 그대로 옮기지 말라고 한다', () => {
  assert.doesNotMatch(buildGuessPrompt(), /Do NOT quote/);
  const gist = buildGuessPrompt({ text: 'gonna', task: 'gist' });
  assert.match(gist, /Do NOT quote any script word for word/);
  assert.match(gist, /"""\ngonna\n"""$/);
});

/* ---------- guessLine (Gemini 스트리밍 흉내) ---------- */

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
    calls.push({ url: String(url), body: JSON.parse(init.body) }); // 취소된 요청도 센다 (다시 묻지 않는지 확인)
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return handlers[Math.min(calls.length - 1, handlers.length - 1)]();
  };
  return calls;
}

const wav = new Blob([encodeWav(new Float32Array(16000), 16000)], { type: 'audio/wav' });

const ANSWER = {
  heard: '아이 고나 웨이릿',
  lines: [
    { en: "I'm gonna wait it out.", ko: '끝날 때까지 기다릴래.' },
    { en: "I'm gonna weigh it out.", ko: '따져 볼게.' },
  ],
  phrases: [{ phrase: 'wait it out', meaningKo: '끝날 때까지 기다리다', noteKo: 'wait it이 이어져 웨이릿처럼 들려요' }],
  explanationKo: 't가 모음 사이에서 약해져 ㄹ처럼 들려요.',
  confidence: 'medium',
};

test('guessLine: 따라 말한 녹음을 inline WAV로 보내고, 작품·장면과 스키마를 함께 보낸다', async () => {
  const full = JSON.stringify(ANSWER);
  const cut = full.indexOf('"lines"');
  const calls = mockFetch([() => sse(part(full.slice(0, cut)), part(full.slice(cut), 'STOP'))]);
  const partials = [];
  const r = await guessLine({ audio: wav, scene: '프렌즈 시즌1' }, { onPartial: (p) => partials.push(p) });
  assert.deepEqual(r, { ...ANSWER, paraphrased: false });
  assert.deepEqual(partials[0], { heard: '아이 고나 웨이릿', paraphrased: false }, '내 소리부터 먼저 보여 준다');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /:streamGenerateContent\?alt=sse$/);
  const { contents, systemInstruction, generationConfig } = calls[0].body;
  assert.match(systemInstruction.parts[0].text, /Korean intermediate learner/);
  const [audio, prompt] = contents[0].parts;
  assert.equal(audio.inlineData.mimeType, 'audio/wav');
  assert.equal(Buffer.from(audio.inlineData.data, 'base64').length, 44 + 16000 * 2);
  assert.match(prompt.text, /IMITATING/);
  assert.match(prompt.text, /"프렌즈 시즌1"/);

  assert.equal(generationConfig.responseMimeType, 'application/json');
  const schema = generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ['heard', 'lines', 'phrases', 'explanationKo', 'confidence']);
  assert.deepEqual(schema.required, schema.propertyOrdering);
  assert.match(schema.properties.lines.description, /most likely first/);
  assert.deepEqual(schema.properties.lines.items.propertyOrdering, ['en', 'ko']);
  assert.deepEqual(schema.properties.confidence.enum, ['high', 'medium', 'low']);
});

test('guessLine: 적어서 묻기는 소리 없이 글만 보내고, 내 소리(heard) 칸은 없다', async () => {
  const answer = { ...ANSWER };
  delete answer.heard;
  const calls = mockFetch([() => sse(part(JSON.stringify(answer), 'STOP'))]);
  const r = await guessLine({ text: '아이 고나 웨더 잇', scene: '' });
  assert.deepEqual(r, { ...answer, paraphrased: false });

  const { parts } = calls[0].body.contents[0];
  assert.equal(parts.length, 1, '소리는 보내지 않는다');
  assert.equal(parts[0].inlineData, undefined);
  assert.match(parts[0].text, /"""\n아이 고나 웨더 잇\n"""$/);
  assert.doesNotMatch(parts[0].text, /Show or scene/);
  const schema = calls[0].body.generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ['lines', 'phrases', 'explanationKo', 'confidence']);

  // 글과 녹음을 함께 주면 적은 글로 묻는다
  const both = mockFetch([() => sse(part(JSON.stringify(answer), 'STOP'))]);
  await guessLine({ audio: wav, text: 'gonna' });
  assert.equal(both[0].body.contents[0].parts.length, 1);
});

test('guessLine: 저작권(RECITATION)으로 막히면 원문 조각을 지우고 요지로 한 번만 다시 묻는다', async () => {
  const gist = { ...ANSWER, lines: [{ en: 'He says he will wait until it ends.', ko: '끝날 때까지 기다리겠대.' }] };
  const calls = mockFetch([
    () => sse(part('{"heard":"아이 고나","lines":[{"en":"Exact quote'), part('', 'RECITATION')),
    () => sse(part(JSON.stringify(gist), 'STOP')),
  ]);
  const partials = [];
  const r = await guessLine({ audio: wav, scene: '프렌즈' }, { onPartial: (p) => partials.push(p) });
  assert.equal(calls.length, 2);
  const retry = calls[1].body.contents[0].parts;
  assert.equal(retry[0].inlineData.mimeType, 'audio/wav', '다시 물을 때도 녹음을 보낸다');
  assert.match(retry[1].text, /Do NOT quote any script word for word/);
  assert.match(retry[1].text, /"프렌즈"/);
  assert.equal(r.paraphrased, true);
  assert.equal(r.lines[0].en, 'He says he will wait until it ends.');
  assert.ok(partials.some((p) => p.lines?.[0]?.en === 'Exact quote'));
  const clearAt = partials.findIndex((p) => Object.keys(p).length === 1 && p.paraphrased === true);
  assert.ok(clearAt > 0, '앞서 보여 준 원문을 지우라는 신호');
  assert.ok(partials.slice(clearAt).every((p) => p.paraphrased));

  const again = mockFetch([() => sse(part('', 'RECITATION'))]);
  await assert.rejects(guessLine({ text: 'gonna' }), (e) => e.reason === 'RECITATION');
  assert.equal(again.length, 2, '요지 요청까지 막히면 그만둔다');
});

test('guessLine: 말하거나 적은 것이 없으면 묻지 않고, 취소하면 다시 묻지 않는다', async () => {
  const calls = mockFetch([() => sse(part(JSON.stringify(ANSWER), 'STOP'))]);
  await assert.rejects(guessLine({ text: '   ' }), /말하거나 적어/);
  await assert.rejects(guessLine(), /말하거나 적어/);
  assert.equal(calls.length, 0);

  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(guessLine({ text: 'gonna' }, { signal: ctl.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1, '취소되면 다른 모델·요지로 다시 묻지 않는다');
});

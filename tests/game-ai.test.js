// 게임 속 AI 대화(js/game/ai.js)를 가짜 Gemini로 시험한다: 핍·용의자 요청에 수준 안내·답 말하지 않기 규칙·
// 범인의 비밀(거짓말)이 들어가는지, 대화 기록이 user/model로 번갈아 가는지, 답(영어·한국어)을 읽는지
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map([['eh.settings.v1', JSON.stringify({ geminiKey: 'test-key' })]]);
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window ??= globalThis;
globalThis.window.dispatchEvent ??= () => true;

const { askPip, askSuspect } = await import('../js/game/ai.js');

const enc = new TextEncoder();
const sse = (obj) =>
  new Response(
    new ReadableStream({
      start(c) {
        const chunk = { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] };
        c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
        c.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

function mockFetch(reply) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return sse(reply);
  };
  return calls;
}

test('핍: 방 정보·수준 안내·답을 말하지 않는 규칙을 보내고, 대화 기록을 번갈아 붙인다', async () => {
  const calls = mockFetch({ reply: 'Beep-boop! The radio is next to the shuttle.', ko: '삐빅! 무전기는 셔틀 옆에 있어.' });
  const r = await askPip({
    room: 0,
    level: 'basic',
    question: 'Where is the radio?',
    history: [
      { from: 'me', text: 'Hi Pip' },
      { from: 'them', text: 'Hi! I am Pip.' },
    ],
  });
  assert.deepEqual(r, { reply: 'Beep-boop! The radio is next to the shuttle.', ko: '삐빅! 무전기는 셔틀 옆에 있어.' });
  const body = calls[0].body;
  const sys = body.systemInstruction.parts[0].text;
  assert.match(sys, /You are Pip/);
  assert.match(sys, /Docking Bay/);
  assert.match(sys, /grade 1-2/, 'Basic 수준 안내');
  assert.match(sys, /NEVER give codes, colors, numbers, passwords/);
  assert.match(sys, /never scary or violent/);
  assert.deepEqual(
    body.contents.map((c) => c.role),
    ['user', 'model', 'user']
  );
  assert.equal(body.contents.at(-1).parts[0].text, 'Where is the radio?');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('용의자: 범인에게만 비밀(거짓말)을 주고, 아닌 사람은 사실대로 말하게 한다', async () => {
  const calls = mockFetch({ reply: 'I stayed in the garden all night.', ko: '밤새 정원에 있었어.' });
  await askSuspect({ suspect: 'momo', culprit: 'momo', level: 'im3', question: 'Where were you at 9:10?' });
  await askSuspect({ suspect: 'bolt', culprit: 'momo', level: 'im1', question: 'Where were you?' });
  const guilty = calls[0].body.systemInstruction.parts[0].text;
  const innocent = calls[1].body.systemInstruction.parts[0].text;
  assert.match(guilty, /SECRET: You took the Star Core/);
  assert.match(guilty, /left the Space Garden at 9:05/);
  assert.match(guilty, /do not confess unless they officially accuse you/);
  assert.match(guilty, /B1-B2/, 'IM3 수준 안내');
  assert.match(innocent, /You did NOT take the Star Core/);
  assert.match(innocent, /Robot Workshop at 8:00 PM/);
  assert.doesNotMatch(innocent, /SECRET/);
  assert.match(innocent, /grade 3-4/, 'IM1 수준 안내');
  for (const c of calls) assert.match(c.body.systemInstruction.parts[0].text, /Never say who the culprit is/);
});

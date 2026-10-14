// 사진 번역: 보낼 크기·형식 정하기(순수 함수), Gemini 요청(가짜 fetch), 공유받기(manifest·서비스 워커)를 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

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

const photo = await import('../js/lib/photo.js');
const {
  fitSize,
  photoPlan,
  imageType,
  rawFallback,
  guessLang,
  blockLang,
  blockSides,
  photoBlocks,
  photoLang,
  textDirection,
  photoSourceText,
  photoCopyText,
  photoHistoryItem,
} = photo;
const { translateImage } = await import('../js/services/translate.js');
const { generate } = await import('../js/services/gemini.js');

/* ---------- 보낼 크기·형식 ---------- */

test('fitSize: 보통 사진은 긴 변 2048px로 줄이고, 작은 사진은 그대로 둔다', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 2048, height: 1536 }, '갤럭시 12MP 사진');
  assert.deepEqual(fitSize(3000, 4000), { width: 1536, height: 2048 }, '세로 사진');
  assert.deepEqual(fitSize(8160, 6120), { width: 2048, height: 1536 }, '50MP 사진');
  assert.deepEqual(fitSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(fitSize(2048, 2048), { width: 2048, height: 2048 });
  assert.deepEqual(fitSize(0, Number.NaN), { width: 1, height: 1 }, '이상한 값에도 0이 되지 않는다');
});

test('fitSize: 길쭉한 화면 캡처는 글자가 작아지지 않게 짧은 변을 1080px까지 남긴다 (긴 변은 4096px까지)', () => {
  assert.deepEqual(fitSize(1080, 2340), { width: 1080, height: 2340 }, 'FHD+ 화면 캡처는 그대로');
  assert.deepEqual(fitSize(1440, 3120), { width: 1080, height: 2340 }, 'QHD+ 화면 캡처');
  assert.deepEqual(fitSize(12000, 3000), { width: 4096, height: 1024 }, '파노라마');
});

const one = (width, height) => ({ width, height, slices: [{ y: 0, height }], small: false });

test('photoPlan: 보통 사진·화면 캡처·파노라마는 한 장으로 보낸다 (fitSize 크기)', () => {
  assert.deepEqual(photoPlan(4000, 3000), one(2048, 1536));
  assert.deepEqual(photoPlan(16320, 12240), one(2048, 1536), '2억 화소 사진');
  assert.deepEqual(photoPlan(1080, 2340), one(1080, 2340), 'FHD+ 화면 캡처');
  assert.deepEqual(photoPlan(1440, 3120), one(1080, 2340), 'QHD+ 화면 캡처');
  assert.deepEqual(photoPlan(1080, 3000), one(1080, 3000), '3000px까지는 한 장');
  assert.deepEqual(photoPlan(4000, 11000), one(1080, 2970), '너비를 1080px로 줄이면 3000px 안에 들어오는 사진');
  assert.deepEqual(photoPlan(12000, 3000), one(4096, 1024), '가로로 긴 파노라마는 나누지 않는다');
  assert.deepEqual(photoPlan(0, 0), one(1, 1));
});

test('photoPlan: 세로로 아주 긴 스크롤 캡처는 너비 1080px을 지키고 3000px 이하 조각으로 80px씩 겹쳐 나눈다', () => {
  assert.deepEqual(photoPlan(1080, 3001), {
    width: 1080,
    height: 3001,
    slices: [
      { y: 0, height: 1541 },
      { y: 1460, height: 1541 },
    ],
    small: false,
  });
  const p = photoPlan(1080, 8000);
  assert.deepEqual([p.width, p.height, p.small], [1080, 8000, false]);
  assert.deepEqual(p.slices, [
    { y: 0, height: 2720 },
    { y: 2640, height: 2720 },
    { y: 5280, height: 2720 },
  ]);
  const q = photoPlan(1440, 12000);
  assert.deepEqual([q.width, q.height, q.slices.length], [1080, 9000, 4], 'QHD+ 스크롤 캡처는 너비 1080px로');
  const narrow = photoPlan(500, 3500);
  assert.deepEqual([narrow.width, narrow.height, narrow.slices.length], [500, 3500, 2], '좁은 사진은 키우지 않는다');
});

test('photoPlan: 6조각보다 길면 6조각에 맞게 줄이고 small로 알린다 (1080×20000이 221px 너비가 되지 않게)', () => {
  const p = photoPlan(1080, 20000);
  assert.deepEqual([p.width, p.height, p.small], [950, 17600, true]);
  assert.deepEqual(
    p.slices.map((s) => s.y),
    [0, 2920, 5840, 8760, 11680, 14600]
  );
  assert.ok(p.slices.every((s) => s.height === 3000));
  assert.equal(photoPlan(1080, 17600).small, false, '딱 6조각이면 줄이지 않는다');
  assert.equal(photoPlan(1080, 17600).slices.length, 6);
});

test('photoPlan: 어떤 크기든 조각은 6개 이하, 3000px 이하, 서로 80px 이상 겹치며 사진 전체를 덮는다', () => {
  const sizes = [];
  for (const w of [200, 720, 1080, 1440, 2160]) for (let h = 2000; h <= 60000; h += 997) sizes.push([w, h]);
  for (const [w, h] of sizes) {
    const p = photoPlan(w, h);
    const what = `${w}×${h}`;
    assert.ok(p.slices.length >= 1 && p.slices.length <= photo.MAX_SLICES, what);
    assert.equal(p.slices[0].y, 0, what);
    const last = p.slices.at(-1);
    assert.equal(last.y + last.height, p.height, `${what}: 끝까지 덮는다`);
    if (p.slices.length === 1) continue;
    assert.ok(p.width <= photo.KEEP_SHORT, what);
    p.slices.forEach((s, i) => {
      assert.ok(s.height <= photo.SLICE_H, what);
      if (i) assert.ok(p.slices[i - 1].y + p.slices[i - 1].height - s.y >= photo.SLICE_OVERLAP, `${what}: 겹침`);
    });
    assert.equal(p.small, h * Math.min(1, photo.KEEP_SHORT / w) > 17600, what);
  }
});

test('imageType·rawFallback: 열지 못한 사진은 Gemini가 읽는 형식이고 크기가 맞을 때만 원본을 보낸다', () => {
  assert.equal(imageType({ type: 'image/JPG' }), 'image/jpeg');
  assert.equal(imageType({ type: 'image/png; foo=bar' }), 'image/png');
  assert.equal(imageType({ type: '', name: 'IMG_0001.HEIC' }), 'image/heic', '형식이 비어 오면 확장자로');
  assert.equal(imageType({ type: 'application/octet-stream', name: 'a.heif' }), 'image/heif');
  assert.equal(imageType({ type: '', name: 'doc.pdf' }), '');

  assert.deepEqual(rawFallback({ type: 'image/heic', size: 3e6 }), { ok: true, mimeType: 'image/heic' });
  assert.deepEqual(rawFallback({ type: '', name: 'x.webp', size: 10 }), { ok: true, mimeType: 'image/webp' });
  assert.deepEqual(rawFallback({ type: 'image/heif', size: photo.RAW_MAX_BYTES + 1 }), { ok: false, reason: 'size' });
  assert.deepEqual(rawFallback({ type: 'image/jpeg', size: 0 }), { ok: false, reason: 'size' });
  assert.deepEqual(rawFallback({ type: 'image/gif', size: 10 }), { ok: false, reason: 'type' });
  assert.deepEqual(rawFallback({ type: 'video/mp4', size: 10 }), { ok: false, reason: 'type' });
  // base64로 보내도 Gemini 한 번 요청(약 20MB)에 들어간다
  assert.ok((photo.RAW_MAX_BYTES * 4) / 3 < 19.5e6);
});

/* ---------- 결과 글 모으기 ---------- */

const RESULT = {
  noteKo: '가게 앞 안내문이에요.',
  blocks: [
    { text: 'OPEN 9AM–6PM\nClosed Mondays', translation: '영업 오전 9시~오후 6시\n월요일 휴무' },
    { text: '', translation: '' },
    { text: '화장실은 2층', translation: 'Restroom on the 2nd floor' },
    { text: 'ラーメン', translation: '라멘' },
  ],
  phrases: [],
  sourceLang: 'mixed',
};

test('블록: 빈 조각은 빼고, 영어 쪽(읽기·저장)은 원문이 한국어면 번역, 영어면 원문이다', () => {
  const blocks = photoBlocks(RESULT);
  assert.equal(blocks.length, 3);
  assert.deepEqual(photoBlocks({ blocks: 'x' }), []);
  assert.deepEqual(blockSides(blocks[0]), {
    from: 'en',
    en: 'OPEN 9AM–6PM\nClosed Mondays',
    ko: '영업 오전 9시~오후 6시\n월요일 휴무',
  });
  assert.deepEqual(blockSides(blocks[1]), { from: 'ko', en: 'Restroom on the 2nd floor', ko: '화장실은 2층' });
  assert.deepEqual(blockSides(blocks[2]), { from: 'other', en: '', ko: '라멘' }, '다른 언어는 영어 쪽이 없다');
});

test('블록 언어: Gemini가 준 lang을 따르고, 영어 글자가 섞인 일본어·베트남어 블록은 영어로 보지 않는다', () => {
  const side = (lang, text, translation = '번역') => blockSides({ lang, text, translation });
  assert.deepEqual(side('other', 'ラーメン Ramen ¥800', '라멘 800엔'), { from: 'other', en: '', ko: '라멘 800엔' });
  assert.deepEqual(side('other', '営業中 OPEN', '영업 중'), { from: 'other', en: '', ko: '영업 중' });
  assert.deepEqual(side('other', 'Phở bò tái 65.000đ', '소고기 쌀국수'), { from: 'other', en: '', ko: '소고기 쌀국수' });
  assert.deepEqual(side('en', 'Exit', '출구'), { from: 'en', en: 'Exit', ko: '출구' });
  assert.deepEqual(side('ko', '출구', 'Exit'), { from: 'ko', en: 'Exit', ko: '출구' });
  assert.equal(blockLang({ lang: 'ot', text: 'Hello' }), 'en', '스트리밍 중 덜 받은 lang은 쓰지 않고 글자로 짐작');
});

test('guessLang: lang이 없으면(예전 결과) 조심스럽게 짐작한다 — 다른 언어 글자가 하나라도 있으면 영어가 아니다', () => {
  assert.equal(guessLang('출구 Exit'), 'ko', '한글이 있으면 한국어');
  assert.equal(guessLang('OPEN 9AM–6PM\nClosed Mondays'), 'en');
  assert.equal(guessLang("Don't touch! (No. 3)"), 'en');
  assert.equal(guessLang('Phở bò tái 65.000đ'), 'other', '베트남어');
  assert.equal(guessLang('Crème brûlée'), 'other', '프랑스어');
  assert.equal(guessLang('Straße'), 'other', '독일어');
  assert.equal(guessLang('ラーメン Ramen ¥800'), 'other', '일본어 (영문자가 섞여도)');
  assert.equal(guessLang('営業中 OPEN'), 'other', '한자');
  assert.equal(guessLang('出口 Exit'), 'other', '중국어');
  assert.equal(guessLang('Выход'), 'other', '러시아어');
  assert.equal(guessLang('¥800 / 12:30'), 'other', '글자가 없으면 영어 쪽이 없다');
  assert.equal(guessLang(''), 'other');
  assert.equal(blockSides({ text: 'Phở bò tái', translation: '소고기 쌀국수' }).en, '');
});

test('photoLang·textDirection: 사진 글의 주 언어와, 텍스트 번역으로 넘길 때 방향', () => {
  assert.equal(photoLang({ sourceLang: 'other', blocks: [{ text: 'Hello' }] }), 'other', 'Gemini가 준 주 언어');
  assert.equal(photoLang(RESULT), 'ko', '섞여 있고 한국어 블록이 있으면 한국어');
  const jpMenu = {
    sourceLang: 'mixed',
    blocks: [
      { lang: 'other', text: 'ラーメン', translation: '라멘' },
      { lang: 'en', text: 'Ramen', translation: '라멘' },
    ],
  };
  assert.equal(photoLang(jpMenu), 'other', '섞여 있고 다른 언어 블록이 있으면 other');
  assert.equal(photoLang({ blocks: [{ text: 'Hello' }] }), 'en');
  assert.deepEqual(textDirection('ko'), { from: 'ko', to: 'en' });
  assert.deepEqual(textDirection('en'), { from: 'en', to: 'ko' });
  assert.deepEqual(textDirection('other'), { from: 'en', to: 'ko' }, '다른 언어도 한국어로 (Gemini가 옮긴다)');
});

test('원문 모으기·전체 복사·번역 기록 항목', () => {
  assert.equal(photoSourceText(RESULT), 'OPEN 9AM–6PM\nClosed Mondays\n\n화장실은 2층\n\nラーメン');
  assert.equal(
    photoCopyText(RESULT),
    'OPEN 9AM–6PM\nClosed Mondays\n→ 영업 오전 9시~오후 6시\n월요일 휴무\n\n화장실은 2층\n→ Restroom on the 2nd floor\n\nラーメン\n→ 라멘'
  );
  assert.deepEqual(photoHistoryItem({ ...RESULT, sourceLang: 'en' }), {
    source: photoSourceText(RESULT),
    result: '영업 오전 9시~오후 6시 월요일 휴무 / Restroom on the 2nd floor / 라멘',
    from: 'en',
    to: 'ko',
    photo: true,
  });
  assert.equal(photoHistoryItem(RESULT).from, 'ko', '섞여 있으면 텍스트 번역처럼 한글이 있으면 한국어로 본다');
  assert.equal(photoHistoryItem({ ...RESULT, paraphrased: true }), null, '요약만 받았으면 넣지 않는다');
  // 영어가 아닌 글은 영어(en)로 적지 않는다. 누르면 textDirection('other')대로 한국어로 다시 번역한다
  const jp = photoHistoryItem({
    sourceLang: 'other',
    blocks: [{ lang: 'other', text: 'ラーメン Ramen ¥800', translation: '라멘 800엔' }],
  });
  assert.deepEqual([jp.from, jp.to, jp.source], ['other', 'ko', 'ラーメン Ramen ¥800']);
  const vi = photoHistoryItem({ sourceLang: 'mixed', blocks: [{ text: 'Phở bò tái', translation: '소고기 쌀국수' }] });
  assert.deepEqual([vi.from, vi.to], ['other', 'ko'], 'lang이 없어도 베트남어를 영어로 적지 않는다');
  assert.equal(photoHistoryItem({ noteKo: '글자가 없어요', blocks: [] }), null);

  const long = photoHistoryItem({
    blocks: [{ text: 'a'.repeat(5000), translation: '가'.repeat(500) }],
    sourceLang: 'en',
  });
  assert.equal(long.source.length, 3000);
  assert.equal(long.result.length, 120, '번역은 짧은 미리 보기만');
  assert.ok(long.result.endsWith('…'));
});

/* ---------- translateImage (Gemini 스트리밍 흉내) ---------- */

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
    return handlers[Math.min(calls.length - 1, handlers.length - 1)](init);
  };
  return calls;
}

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });
const ANSWER = {
  noteKo: '가게 앞 안내문이에요.',
  blocks: [
    { lang: 'en', text: 'OPEN 9AM–6PM\nClosed Mondays', translation: '영업 오전 9시~오후 6시\n월요일 휴무' },
    { lang: 'en', text: 'Please knock', translation: '노크해 주세요' },
  ],
  phrases: [{ phrase: 'Closed Mondays', meaningKo: '월요일 휴무', noteKo: '가게 안내에 자주 나와요' }],
  sourceLang: 'en',
};

test('translateImage: 사진을 inline으로 보내고, 읽는 순서대로 스트리밍 스키마(propertyOrdering)로 받는다', async () => {
  const full = JSON.stringify(ANSWER);
  const cut = full.indexOf('"translation"');
  const calls = mockFetch([() => sse(part(full.slice(0, cut)), part(full.slice(cut), 'STOP'))]);
  const partials = [];
  const r = await translateImage({ blob: jpeg, mimeType: 'image/jpeg' }, { onPartial: (p) => partials.push(p) });
  assert.deepEqual(r, { ...ANSWER, paraphrased: false });
  assert.deepEqual(
    partials[0],
    {
      noteKo: '가게 앞 안내문이에요.',
      blocks: [{ lang: 'en', text: 'OPEN 9AM–6PM\nClosed Mondays' }],
      paraphrased: false,
    },
    '첫 블록의 언어와 원문부터 바로 보여 줄 수 있다'
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /:streamGenerateContent\?alt=sse$/);
  const { contents, systemInstruction, generationConfig } = calls[0].body;
  assert.match(systemInstruction.parts[0].text, /Korean adult learner/);
  assert.equal(contents[0].parts.length, 2, '사진 한 장과 요청문');
  const [image, prompt] = contents[0].parts;
  assert.equal(image.inlineData.mimeType, 'image/jpeg');
  assert.deepEqual([...Buffer.from(image.inlineData.data, 'base64')], [0xff, 0xd8, 0xff, 1, 2, 3]);
  assert.match(prompt.text, /^Read ALL legible text in this photo in natural reading order/);
  assert.match(prompt.text, /menu item, a sign or a label/);
  assert.match(prompt.text, /Never guess or invent text[^.]*: write \[\?\] for unclear parts/);
  assert.match(prompt.text, /Korean text into natural English, text in any other language \(mostly English\) into natural Korean/);
  assert.match(prompt.text, /first set lang[^.]*en for English, ko for Korean, other for\s+any other language/);
  assert.match(prompt.text, /Japanese, Chinese, Vietnamese or French\), even if[^.]*Latin letters or English words/);
  assert.match(prompt.text, /two languages side by side \(for example\s+출구 Exit\), make a separate block for each/);
  assert.match(prompt.text, /0–5 useful English expressions/);
  assert.match(prompt.text, /noteKo[^.]*what the\s+photo is/);
  assert.doesNotMatch(prompt.text, /consecutive parts/);

  assert.equal(generationConfig.responseMimeType, 'application/json');
  const schema = generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ['noteKo', 'blocks', 'phrases', 'sourceLang']);
  assert.deepEqual(schema.required, schema.propertyOrdering);
  const block = schema.properties.blocks.items;
  assert.deepEqual(block.propertyOrdering, ['lang', 'text', 'translation'], '블록 언어가 맨 먼저 온다');
  assert.deepEqual(block.required, block.propertyOrdering);
  assert.deepEqual(block.properties.lang.enum, ['en', 'ko', 'other']);
  assert.match(block.properties.lang.description, /other = any other language/);
  assert.match(block.properties.text.description, /exactly as written/);
  assert.deepEqual(schema.properties.phrases.items.propertyOrdering, ['phrase', 'meaningKo', 'noteKo']);
  assert.deepEqual(schema.properties.sourceLang.enum, ['en', 'ko', 'mixed', 'other', 'none']);
});

test('translateImage: 사진 Blob이나 이미 읽어 둔 base64(원본 HEIF 등)도 받는다', async () => {
  const calls = mockFetch([() => sse(part(JSON.stringify(ANSWER), 'STOP'))]);
  await translateImage(jpeg);
  assert.equal(calls[0].body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  await translateImage({ data: 'AAAA', mimeType: 'image/heic' });
  assert.deepEqual(calls[1].body.contents[0].parts[0].inlineData, { mimeType: 'image/heic', data: 'AAAA' });
  await translateImage({ blob: jpeg, pieces: [jpeg], mimeType: 'image/heic' });
  assert.equal(calls[2].body.contents[0].parts[0].inlineData.mimeType, 'image/heic', '원본 그대로 보내는 형식');
  await assert.rejects(translateImage({}), /번역할 사진이 없습니다/);
  assert.equal(calls.length, 3);
});

test('translateImage: 긴 캡처 조각(pieces)은 위에서부터 차례로 보내고 한 장의 캡처라고 알린다 (요약으로 다시 물을 때도)', async () => {
  const pieces = [1, 2, 3].map((n) => new Blob([new Uint8Array([0xff, 0xd8, n])], { type: 'image/jpeg' }));
  const calls = mockFetch([() => sse(part('', 'RECITATION')), () => sse(part(JSON.stringify(ANSWER), 'STOP'))]);
  const r = await translateImage({ blob: pieces[0], pieces, mimeType: 'image/jpeg', width: 950, height: 7000 });
  assert.equal(r.paraphrased, true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const parts = call.body.contents[0].parts;
    assert.equal(parts.length, 4, '조각 3개 + 요청문');
    assert.deepEqual(
      parts.slice(0, 3).map((p) => [p.inlineData.mimeType, Buffer.from(p.inlineData.data, 'base64')[2]]),
      [
        ['image/jpeg', 1],
        ['image/jpeg', 2],
        ['image/jpeg', 3],
      ],
      '순서대로'
    );
    assert.match(parts[3].text, /^These 3 images are consecutive parts of ONE long screenshot, in order from top to bottom/);
    assert.match(parts[3].text, /overlap by a few lines: read those duplicated lines only once/);
  }
});

test('translateImage: 저작권(RECITATION)으로 막히면 원문 조각을 지우고, 원문을 옮기지 않는 요약으로 한 번만 다시 묻는다', async () => {
  const short = { ...ANSWER, blocks: [{ text: 'Chapter 1', translation: '주인공이 집을 떠나는 장면의 요약' }] };
  const calls = mockFetch([
    () => sse(part('{"noteKo":"책 한 쪽","blocks":[{"text":"It was a bright cold'), part('', 'RECITATION')),
    () => sse(part(JSON.stringify(short), 'STOP')),
  ]);
  const partials = [];
  const r = await translateImage(jpeg, { onPartial: (p) => partials.push(p) });
  assert.equal(calls.length, 2);
  const [image, prompt] = calls[1].body.contents[0].parts;
  assert.equal(image.inlineData.mimeType, 'image/jpeg', '다시 물을 때도 사진을 보낸다');
  assert.match(prompt.text, /Do NOT copy the text word for word/);
  assert.match(prompt.text, /short label of a few words/);
  const retrySchema = calls[1].body.generationConfig.responseSchema;
  assert.match(retrySchema.properties.blocks.items.properties.text.description, /not the full text/);
  assert.equal(r.paraphrased, true);
  assert.equal(r.blocks[0].translation, '주인공이 집을 떠나는 장면의 요약');
  assert.ok(partials.some((p) => p.blocks?.[0]?.text === 'It was a bright cold'));
  const clearAt = partials.findIndex((p) => Object.keys(p).length === 1 && p.paraphrased === true);
  assert.ok(clearAt > 0, '앞서 보여 준 원문을 지우라는 신호');
  assert.ok(partials.slice(clearAt).every((p) => p.paraphrased));

  const again = mockFetch([() => sse(part('', 'RECITATION'))]);
  await assert.rejects(translateImage(jpeg), (e) => e.reason === 'RECITATION');
  assert.equal(again.length, 2, '요약 요청까지 막히면 그만둔다');
});

test('translateImage: 취소하면 다른 모델·요약으로 다시 묻지 않는다', async () => {
  const calls = mockFetch([() => sse(part(JSON.stringify(ANSWER), 'STOP'))]);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(translateImage(jpeg, { signal: ctl.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);

  // 답을 기다리는 중에 취소
  const hanging = mockFetch([
    (init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      ),
  ]);
  const ctl2 = new AbortController();
  const p = translateImage(jpeg, { signal: ctl2.signal });
  await new Promise((r) => setTimeout(r, 10));
  ctl2.abort();
  await assert.rejects(p, { name: 'AbortError' });
  assert.equal(hanging.length, 1);
});

test('큰 사진을 보내다 연결이 끊기면 다시 보내지 않고 알린다 (데이터 낭비 막기)', async () => {
  const calls = mockFetch([
    () => {
      throw new TypeError('Failed to fetch');
    },
  ]);
  await assert.rejects(
    translateImage({ data: 'A'.repeat(2.1e6), mimeType: 'image/jpeg' }),
    (e) => e.message === '사진을 보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 보세요.'
  );
  assert.equal(calls.length, 1);
});

test('큰 사진이 시간 안에 오지 않으면 사진이 크거나 연결이 느리다고 알린다 (Gemini가 느렸을 수도 있다)', async () => {
  const calls = mockFetch([
    (init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      ),
  ]);
  // 큰 요청은 보내는 시간 여유가 수십 초라, 이 시험에서만 기다리는 시간을 줄인다
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, Math.min(ms, 5), ...args);
  try {
    await assert.rejects(
      generate({ parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'A'.repeat(2.1e6) } }, { text: 'x' }], key: 'k' }),
      (e) => e.message === '사진이 크거나 연결이 느려 시간이 오래 걸렸어요. 다시 시도하거나 더 작은 사진으로 해 보세요.'
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(calls.length, 1, '다시 보내지 않는다');
});

/* ---------- 공유받기: manifest · 서비스 워커 ---------- */

test('manifest: 공유받기는 POST multipart로 글(title·text·url)과 사진(image)을 함께 받는다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(m.share_target, {
    action: './share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'image', accept: ['image/*'] }] },
  });
});

const SCOPE = 'https://example.github.io/english-helper/';

/**
 * sw.js를 가짜 서비스 워커 환경에서 실행한다
 * @param {{full?: boolean}} [o] full: 저장 공간이 모자라 cache.put이 실패한다
 */
function loadSw({ full = false } = {}) {
  const listeners = {};
  const stores = new Map();
  const cache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, res) => {
        if (full) throw new DOMException('quota', 'QuotaExceededError');
        m.set(String(req.url ?? req), res);
      },
      match: async (req) => m.get(String(req.url ?? req)),
      delete: async (req) => m.delete(String(req.url ?? req)),
      addAll: async () => {},
    };
  };
  const caches = {
    open: async (name) => cache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async () => undefined,
  };
  const self = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { scope: SCOPE },
    location: new URL(`${SCOPE}sw.js`),
    clients: { claim: async () => {} },
    skipWaiting() {},
  };
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  vm.runInNewContext(src, { self, caches, Response, Request, URL, URLSearchParams, fetch: globalThis.fetch, console });
  const fetchEvent = async (request) => {
    let responded = null;
    listeners.fetch({ request, respondWith: (p) => (responded = p) });
    return responded && (await responded);
  };
  return { listeners, stores, cache, fetchEvent };
}

const share = (form) => new Request(`${SCOPE}share-target`, { method: 'POST', body: form });

test('서비스 워커: 공유받은 사진은 share-inbox에 넣고 번역 화면으로 보낸다 (303)', async () => {
  const { stores, fetchEvent } = loadSw();
  const form = new FormData();
  form.append('title', '');
  form.append('text', '');
  form.append('image', new File([new Uint8Array([1, 2, 3])], '메뉴판.jpg', { type: 'image/jpeg' }));
  const res = await fetchEvent(share(form));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `${SCOPE}#/translate?photo=shared`);
  const saved = stores.get('share-inbox').get(`${SCOPE}shared-photo`);
  assert.equal(saved.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(decodeURIComponent(saved.headers.get('X-File-Name')), '메뉴판.jpg');
  assert.deepEqual([...new Uint8Array(await saved.arrayBuffer())], [1, 2, 3]);
});

test('서비스 워커: 사진을 넣을 공간이 모자라면 예전 사진을 지우고 사진 번역 화면으로 보내 "다시 공유해 주세요"를 띄운다', async () => {
  const { stores, cache, fetchEvent } = loadSw({ full: true });
  cache('share-inbox'); // 예전에 꺼내지 못하고 남은 사진
  stores.get('share-inbox').set(`${SCOPE}shared-photo`, new Response('old'));
  const form = new FormData();
  form.append('text', 'menu');
  form.append('image', new File([new Uint8Array([1, 2, 3])], 'big.jpg', { type: 'image/jpeg' }));
  const res = await fetchEvent(share(form));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `${SCOPE}#/translate?photo=shared`, '글 번역 화면으로 조용히 넘기지 않는다');
  assert.equal(stores.get('share-inbox').size, 0, '예전 사진이 대신 나오지 않는다');
});

test('서비스 워커: 글만 공유하면 예전처럼 ./?text=…로 보내 app.js가 사전·번역으로 나눈다', async () => {
  const { stores, fetchEvent } = loadSw();
  const form = new FormData();
  form.append('title', 'Article');
  form.append('text', 'serendipity');
  form.append('url', 'https://ex.com/a?b=1');
  form.append('image', new File([], '', { type: 'application/octet-stream' })); // 빈 파일 칸은 무시
  const res = await fetchEvent(share(form));
  assert.equal(res.status, 303);
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, SCOPE);
  assert.equal(loc.searchParams.get('title'), 'Article');
  assert.equal(loc.searchParams.get('text'), 'serendipity');
  assert.equal(loc.searchParams.get('url'), 'https://ex.com/a?b=1');
  assert.equal(stores.has('share-inbox'), false);

  const empty = await fetchEvent(share(new FormData()));
  assert.equal(empty.headers.get('Location'), SCOPE);
});

test('서비스 워커: 공유 요청을 읽지 못하면 번역 화면으로, 다른 POST(Gemini 등)는 건드리지 않는다', async () => {
  const { fetchEvent } = loadSw();
  const broken = new Request(`${SCOPE}share-target`, {
    method: 'POST',
    body: 'garbage',
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const res = await fetchEvent(broken);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `${SCOPE}#/translate`);

  const gemini = new Request('https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(await fetchEvent(gemini), null);
  assert.equal(await fetchEvent(new Request(`${SCOPE}share-target?x=1`, { method: 'PUT', body: 'x' })), null);
});

test('서비스 워커: 새 버전을 켤 때 예전 앱 파일(eh-*)만 지우고 공유받은 사진 칸은 남긴다', async () => {
  const { listeners, stores, cache } = loadSw();
  for (const name of ['eh-20260101-old', 'eh-__BUILD__', 'share-inbox']) cache(name);
  let pending;
  listeners.activate({ waitUntil: (p) => (pending = p) });
  await pending;
  assert.deepEqual([...stores.keys()].sort(), ['eh-__BUILD__', 'share-inbox']);
});

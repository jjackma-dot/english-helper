// 번역: Gemini 키가 있으면 Gemini, 없거나 실패하면 무료 MyMemory API

import { getSettings, geminiEnabled } from '../store.js';
import { splitForTranslation } from '../lib/lang.js';
import { parseMyMemory, parseMyMemoryMatches, QuotaError } from '../lib/api-parse.js';
import { generate, S } from './gemini.js';

const MYMEMORY = 'https://api.mymemory.translated.net/get';
const LANG_NAME = { ko: 'Korean', en: 'English' };

function myMemoryUrl(text, from, to) {
  const email = getSettings().myMemoryEmail.trim();
  return `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${from}|${to}`)}${
    email ? `&de=${encodeURIComponent(email)}` : ''
  }`;
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new QuotaError('무료 번역 요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  if (!res.ok) throw new Error(`번역 서버 오류 (${res.status})`);
  return res.json();
}

export async function myMemoryTranslate(text, from, to, { signal } = {}) {
  const chunks = splitForTranslation(text, 480); // MyMemory 요청 한도 500바이트
  const out = [];
  for (const c of chunks) {
    out.push(parseMyMemory(await fetchJson(myMemoryUrl(c, from, to), signal)));
  }
  return out.join(' ');
}

async function geminiTranslate(text, from, to, { signal } = {}) {
  return (
    await generate({
      system:
        `You are a professional ${LANG_NAME[from]}–${LANG_NAME[to]} translator. ` +
        `Translate the user's text from ${LANG_NAME[from]} into natural, everyday ${LANG_NAME[to]}. ` +
        'Keep the meaning, tone and line breaks. Output only the translation without quotes or explanations.',
      prompt: text,
      signal,
    })
  ).trim();
}

/**
 * @returns {Promise<{text: string, engine: 'gemini'|'mymemory', notice?: string}>}
 */
export async function translate(text, from, to, { signal } = {}) {
  const src = String(text || '').trim();
  if (!src) return { text: '', engine: 'mymemory' };
  if (geminiEnabled()) {
    try {
      return { text: await geminiTranslate(src, from, to, { signal }), engine: 'gemini' };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const fallback = await myMemoryTranslate(src, from, to, { signal });
      return { text: fallback, engine: 'mymemory', notice: `Gemini 대신 무료 번역을 사용했습니다 (${e.message})` };
    }
  }
  return { text: await myMemoryTranslate(src, from, to, { signal }), engine: 'mymemory' };
}

/** 단어의 후보 뜻 목록 (무료 번역 메모리) */
export async function wordMeanings(word, from, to, { signal } = {}) {
  return parseMyMemoryMatches(await fetchJson(myMemoryUrl(word, from, to), signal), word);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * 녹음 파일 받아쓰기 + 번역 (Gemini 필요)
 * @param {Blob} audio WAV
 * @param {'auto'|'ko'|'en'} sourceLang
 * @returns {Promise<{language: string, segments: {source: string, translation: string}[]}>}
 */
export async function transcribeAndTranslate(audio, sourceLang = 'auto', { signal } = {}) {
  const data = await blobToBase64(audio);
  const langRule =
    sourceLang === 'auto'
      ? 'The speech may be in Korean or English (or both). Translate Korean sentences into English and English sentences into Korean.'
      : `The speech is in ${LANG_NAME[sourceLang]}. Translate it into ${LANG_NAME[sourceLang === 'ko' ? 'en' : 'ko']}.`;
  const result = await generate({
    parts: [
      { inlineData: { mimeType: audio.type || 'audio/wav', data } },
      {
        text:
          'Transcribe this recording accurately, sentence by sentence, in the original language. ' +
          `${langRule} Use natural, everyday translations. ` +
          'If there is no speech, return an empty segments array.',
      },
    ],
    schema: S.obj({
      language: S.str('Main spoken language code: "ko" or "en"'),
      segments: S.arr(S.obj({ source: S.str('Original sentence'), translation: S.str('Translated sentence') })),
    }),
    signal,
    // 최대 5분 녹음: 듣고 받아쓰는 데 시간이 걸린다 (보내는 시간은 generate가 크기만큼 더 준다)
    firstChunkMs: 40000,
    timeoutMs: 120000,
  });
  return { language: result.language || '', segments: Array.isArray(result.segments) ? result.segments : [] };
}

/* ---------- OTT "방금 뭐라고?": 방금 들린 대사 받아쓰기·해석 ---------- */

const LINE = S.obj({ en: S.str('English line'), ko: S.str('Natural Korean translation') });
const PHRASES = S.arr(
  S.obj({
    phrase: S.str('English expression from the lines'),
    meaningKo: S.str('Korean meaning'),
    noteKo: S.str('Short Korean note (usage, slang, reduction or linking)'),
  }),
  '0–4 items'
);
const CONFIDENCE = { ...S.str('How sure you are about what was said'), enum: ['high', 'medium', 'low'] };

// S.obj는 키를 적은 순서대로 보내므로, 스트리밍 중에도 대사 → 표현 → 설명 순서로 온다
const CLIP_SCHEMA = S.obj({
  lines: S.arr(LINE, 'The last 1–3 utterances, oldest first'),
  phrases: PHRASES,
  explanationKo: S.str('Short Korean explanation of what is going on and anything a learner might miss'),
  confidence: CONFIDENCE,
});

const CLIP_SYSTEM =
  'You help a Korean intermediate learner of English who watches English-language TV shows and movies ' +
  'without subtitles. Write all explanations in natural, friendly Korean.';

const CLIP_SITUATION =
  'This audio was recorded by a phone microphone next to a TV or phone speaker playing a show or movie. ' +
  'The learner tapped a button right after the END of this clip because they missed the last line(s). ' +
  'Focus on the LAST 1–3 utterances, the ones closest to the end (an earlier line only if needed for context). ' +
  'Ignore music, sound effects and background noise. ';

const CLIP_TASK = {
  transcript:
    'Transcribe the English dialogue of those utterances exactly as spoken. If a word is unclear, write ' +
    '[inaudible] instead — never guess or invent words. Translate each line into natural Korean. In phrases, ' +
    'briefly explain in Korean any slang, idioms, phrasal verbs and reductions or linking ' +
    '(gonna, wanna, "did you" → "didja").',
  gist:
    'Do NOT quote the dialogue word for word. For each of those utterances, write its gist in simple English ' +
    'in your own words, with the Korean meaning. In phrases, list key expressions (a few words each) ' +
    'with Korean meanings and short notes.',
};

const CLIP_END = ' If there is no clear English speech, return an empty lines array and say so in explanationKo.';

/**
 * 방금 들린 대사 받아쓰기 + 해석 + 표현 설명 (Gemini 필요).
 * 저작권 보호(RECITATION)로 원문을 받지 못하면 한 번만, 원문 대신 쉬운 영어 요지를 다시 받는다 (paraphrased: true).
 * @param {Blob} audio 16kHz WAV
 * @param {{signal?: AbortSignal, onPartial?: (partial: object) => void}} [o] onPartial: 스트리밍 중 지금까지의 결과
 * @returns {Promise<{lines: {en: string, ko: string}[], phrases: {phrase: string, meaningKo: string, noteKo: string}[],
 *          explanationKo: string, confidence: 'high'|'medium'|'low', paraphrased: boolean}>}
 */
export async function explainClip(audio, { signal, onPartial } = {}) {
  const data = await blobToBase64(audio);
  return transcriptOrGist(
    (task) => ({
      system: CLIP_SYSTEM,
      parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: CLIP_SITUATION + CLIP_TASK[task] + CLIP_END }],
      schema: CLIP_SCHEMA,
      signal,
      firstChunkMs: 25000, // 소리를 듣고 답하므로 글보다 첫 글자가 늦다
      timeoutMs: 60000,
    }),
    onPartial
  );
}

/**
 * 원문 대사로 묻고, 저작권 보호(RECITATION)로 막히면 한 번만 쉬운 영어 요지로 다시 묻는다.
 * @param {(task: 'transcript'|'gist') => object} request task별 generate() 옵션
 */
async function transcriptOrGist(request, onPartial) {
  const ask = async (task) => ({
    ...(await generate({
      ...request(task),
      onPartial: onPartial && ((p) => onPartial({ ...p, paraphrased: task === 'gist' })),
    })),
    paraphrased: task === 'gist',
  });
  try {
    return await ask('transcript');
  } catch (e) {
    if (e.reason !== 'RECITATION') throw e;
    onPartial?.({ paraphrased: true }); // 막히기 전에 보여 준 원문 조각을 지운다
    return ask('gist');
  }
}

/* ---------- OTT 이어폰으로 볼 때: 따라 말한 소리·적은 소리로 대사 짐작하기 ---------- */

export const GUESS_TEXT_MAX = 300; // 적어서 묻기 최대 글자 수
export const SCENE_MAX = 60; // 작품·장면 메모 최대 글자 수

const GUESS_SITUATION = {
  voice:
    'The learner was watching an English-language show or movie (often with earphones) and did not catch a line. ' +
    'In this recording the learner is IMITATING from memory how that line sounded. It is not the original audio. ' +
    'The imitation is approximate: mumbled or broken sounds, partial words, Korean-like syllables and wrong vowels ' +
    'are all expected. If the learner also says something in Korean, use it only as a hint. ',
  text:
    'The learner was watching an English-language show or movie (often with earphones) and did not catch a line. ' +
    'Below is how the line sounded to them, written as best they could: English fragments, misspellings, ' +
    'or Korean Hangul spelling of the sounds (for example 워러 = "water", 고나 = "gonna"). ',
};

const GUESS_HOW =
  'Think about how fast spoken English sounds to Korean ears: linking between words, reductions ' +
  '(gonna, wanna, gotta, kinda, "did you" → "didja"), flapping (t/d between vowels sounds like a quick r: ' +
  'water → 워러), dropped sounds and weak vowels. ';

const GUESS_TASK = {
  transcript:
    'Reconstruct the most likely natural English line they heard. ' +
    GUESS_HOW +
    'In lines, give one candidate if one reading clearly fits, or up to 3 genuinely different candidates, ' +
    'most likely first, each with a natural Korean translation. In phrases, explain key expressions in Korean. ' +
    'In explanationKo, explain briefly in Korean why the line sounded that way (which sounds link, reduce or flap).',
  gist:
    'Work out the most likely line they heard. ' +
    GUESS_HOW +
    'Do NOT quote any script word for word: in lines, write the gist of 1–3 likely candidates in simple English ' +
    'in your own words, most likely first, with Korean meanings. In phrases, list key expressions (a few words each) ' +
    'with Korean meanings and short notes on how they sound. In explanationKo, explain briefly in Korean why it ' +
    'sounded that way.',
};

const GUESS_END =
  ' Set confidence to high only when one reading clearly fits, and low when you are mostly guessing. ' +
  'If you cannot tell what the line was, return an empty lines array and say so in explanationKo.';

/** 한 줄로 줄이고 앞뒤 공백을 지운 뒤 max 글자까지 */
function oneLine(s, max) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * "들린 대로 말하기·적어서 묻기" 요청문.
 * @param {{text?: string, scene?: string, task?: 'transcript'|'gist'}} o text가 있으면 적어서 묻기, 없으면 따라 말한 녹음
 *   scene: 학습자가 적은 작품·장면 (선택)
 */
export function buildGuessPrompt({ text = '', scene = '', task = 'transcript' } = {}) {
  const heard = String(text ?? '')
    .trim()
    .slice(0, GUESS_TEXT_MAX);
  const where = oneLine(scene, SCENE_MAX);
  return [
    GUESS_SITUATION[heard ? 'text' : 'voice'],
    where
      ? `Show or scene, written by the learner (may be partial or in Korean): "${where}". ` +
        "Prefer lines that fit this show's characters, setting and style. "
      : '',
    GUESS_TASK[task] || GUESS_TASK.transcript,
    GUESS_END,
    heard ? `\n\nHow it sounded to the learner:\n"""\n${heard}\n"""` : '',
  ].join('');
}

/** 따라 말한 녹음이면 학습자 목소리가 어떻게 들렸는지(heard)를 맨 먼저 받는다 (화면에 바로 보여 주고, 짐작에도 도움) */
function guessSchema(voice) {
  return S.obj({
    ...(voice
      ? { heard: S.str("How the learner's imitation sounds, written briefly in Hangul or English letters") }
      : {}),
    lines: S.arr(LINE, 'Candidate lines, most likely first (1–3; only one if you are sure)'),
    phrases: PHRASES,
    explanationKo: S.str('Short Korean note on why the line sounded that way (linking, reductions, flapping)'),
    confidence: CONFIDENCE,
  });
}

/**
 * 이어폰으로 보다가 놓친 대사 짐작하기 (Gemini 필요). 학습자가 따라 말한 녹음(audio)이나 적은 소리(text)로
 * 가장 그럴듯한 영어 대사 1~3개(가능성 높은 순)와 해석·표현·왜 그렇게 들렸는지를 받는다.
 * 돌려주는 모양은 explainClip과 같고, 따라 말한 녹음이면 heard(학습자 목소리가 들린 대로)가 더 있다.
 * @param {{audio?: Blob, text?: string, scene?: string}} input audio(16kHz WAV) 또는 text
 * @param {{signal?: AbortSignal, onPartial?: (partial: object) => void}} [o]
 */
export async function guessLine({ audio, text = '', scene = '' } = {}, { signal, onPartial } = {}) {
  const voice = !String(text ?? '').trim();
  if (voice && !audio) throw new Error('들린 소리를 말하거나 적어 주세요.');
  const data = voice ? await blobToBase64(audio) : '';
  return transcriptOrGist((task) => {
    const prompt = buildGuessPrompt({ text: voice ? '' : text, scene, task });
    return {
      system: CLIP_SYSTEM,
      parts: voice ? [{ inlineData: { mimeType: 'audio/wav', data } }, { text: prompt }] : [{ text: prompt }],
      schema: guessSchema(voice),
      signal,
      firstChunkMs: voice ? 25000 : 20000, // 소리를 듣거나 여러 후보를 따져 보느라 첫 글자가 늦다
      timeoutMs: voice ? 60000 : 45000,
    };
  }, onPartial);
}

/* ---------- 스캔 번역: 카메라로 찍거나 고른 사진의 글자를 모두 읽어 통째로 번역 + 그 글에 대해 묻기 ---------- */

const SCAN_SYSTEM =
  'You help a Korean adult learner of English read text in photos taken with a phone: signs, menus, labels, ' +
  'notices, documents, book pages and screenshots. Write all notes in natural, friendly Korean.';

const SCAN_TASK = {
  transcript:
    'Read ALL legible text in this photo in natural reading order. In original, copy it exactly as written, keeping ' +
    'meaningful line breaks (one line per menu item, sign or label, a blank line between separate parts). Never guess ' +
    'or invent text you cannot read: write [?] for unclear parts and skip text that is cut off at the edges or ' +
    'completely unreadable. In translation, translate the WHOLE text as one natural, easy-to-read text with the same ' +
    'line breaks: Korean text into natural English, text in any other language (mostly English) into natural Korean. ' +
    'Keep names, prices and numbers as they are. ',
  gist:
    'Do NOT copy the text word for word. In original, write only short labels of a few words for each part of the ' +
    'text in its original language (such as its heading or first words), one per line. In translation, write a ' +
    'natural translation or short summary of the whole text in your own words: Korean text into English, any other ' +
    'language into Korean. ',
};

/** 아주 긴 세로 캡처를 조각내 보낼 때 (조각 수) */
const SCAN_PARTS = (n) =>
  `These ${n} images are consecutive parts of ONE long screenshot, in order from top to bottom. ` +
  'Neighbouring parts overlap by a few lines: read those duplicated lines only once. ' +
  'Treat all parts together as one photo. ';

const SCAN_END =
  'Set sourceLang to the main language of the text: en for English, ko for Korean, mixed if Korean and another ' +
  'language are both substantial, other for any other language (for example Japanese, Chinese, Vietnamese or French), ' +
  'none if there is no readable text. If there is no readable text, leave original and translation empty.';

const SCAN_ORIGINAL = {
  transcript:
    'All legible text exactly as written, in reading order, keeping meaningful line breaks; [?] for unclear parts',
  gist: 'Short labels (a few words each) of the parts of the text in the original language, not the full text',
};

// 언어 → 원문 → 번역 순서로 받는다 (원문을 먼저 읽어야 번역이 정확하다). 화면에는 번역을 맨 위에 보여 준다
function scanSchema(task) {
  return S.obj({
    sourceLang: { ...S.str('Main language of the text in the photo'), enum: ['en', 'ko', 'mixed', 'other', 'none'] },
    original: S.str(SCAN_ORIGINAL[task]),
    translation: S.str(
      'Natural translation of the whole text with the same line breaks: Korean into English, any other language into Korean'
    ),
  });
}

/**
 * 사진(카메라로 찍은 장면·고른 사진·공유받은 사진) 속 글자를 모두 읽어 원문과 번역을 통째로 받는다 (Gemini 필요).
 * 한국어는 영어로, 다른 언어(주로 영어)는 한국어로. 아주 긴 세로 캡처를 조각낸 사진(pieces)은 위에서부터 차례로 함께
 * 보내고 한 장의 캡처라고 알린다. 저작권 보호(RECITATION)로 원문을 받지 못하면 한 번만, 원문 대신 짧은 이름표와
 * 번역·요약을 다시 받는다 (paraphrased: true).
 * @param {Blob|{blob?: Blob, pieces?: Blob[], data?: string, mimeType?: string}} image
 *   prepareImage() 결과(pieces가 있으면 그것을 보낸다), 사진 Blob, 또는 base64(data)
 * @param {{signal?: AbortSignal, onPartial?: (partial: object) => void}} [o] onPartial: 스트리밍 중 지금까지의 결과
 * @returns {Promise<{sourceLang: 'en'|'ko'|'mixed'|'other'|'none', original: string, translation: string,
 *          paraphrased: boolean}>}
 */
export async function scanImage(image, { signal, onPartial } = {}) {
  const images = await imageParts(image);
  if (!images.length || images.some((p) => !p.inlineData.data)) throw new Error('번역할 사진이 없습니다.');
  const intro = images.length > 1 ? SCAN_PARTS(images.length) : '';
  return transcriptOrGist(
    (task) => ({
      system: SCAN_SYSTEM,
      parts: [...images, { text: intro + SCAN_TASK[task] + SCAN_END }],
      schema: scanSchema(task),
      signal,
      // 사진을 보고 글자를 읽느라 글보다 첫 글자가 늦다 (보내는 시간은 generate가 크기만큼 더 준다).
      // 긴 캡처 조각이 많으면 읽을 글도 많으니 조각마다 시간을 더 준다
      firstChunkMs: 30000 + 5000 * (images.length - 1),
      timeoutMs: 90000 + 30000 * (images.length - 1),
    }),
    onPartial
  );
}

/** 보낼 사진 → Gemini inlineData 조각들 */
async function imageParts(image) {
  const img = image instanceof Blob ? { blob: image } : image || {};
  if (img.data) return [{ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data } }];
  const blobs = img.pieces?.length ? img.pieces : img.blob ? [img.blob] : [];
  return Promise.all(
    blobs.map(async (b) => ({
      inlineData: { mimeType: img.mimeType || b.type || 'image/jpeg', data: await blobToBase64(b) },
    }))
  );
}

export const QUESTION_MAX = 500; // 질문 최대 글자 수

const ASK_SYSTEM =
  'You help a Korean adult learner of English. They scanned some text with their phone (a menu, sign, notice, label, ' +
  'document, book page or screen) and now ask questions about it. Base your answers on the scanned text below. If the ' +
  'answer is not in the text, say so briefly, then help with general knowledge if it is useful. Answer in natural, ' +
  'friendly Korean unless the question is written in English (then answer in simple English). Keep answers short and ' +
  'practical, and quote the English words or sentences you talk about.';

/**
 * 스캔한 글에 대해 묻는다 (Gemini 필요). 앞서 묻고 받은 답(history)을 이어서 보낸다.
 * 저작권 때문에 원문 대신 요약만 받았으면(paraphrased) 원문 대신 사진(image)을 함께 보낸다.
 * @param {{original: string, translation: string, paraphrased?: boolean, image?: object}} scan scanImage 결과 + 사진
 * @param {{q: string, a: string}[]} history 앞서 한 질문과 답 (오래된 것부터)
 * @param {string} question
 * @param {{signal?: AbortSignal, onPartial?: (text: string) => void}} [o]
 * @returns {Promise<string>} 답
 */
export async function askAboutScan(scan, history, question, { signal, onPartial } = {}) {
  const q = String(question ?? '')
    .trim()
    .slice(0, QUESTION_MAX);
  if (!q) throw new Error('질문을 입력하세요.');
  const context =
    `Scanned text (original):\n"""\n${scan.paraphrased ? '(Not available because of copyright: see the photo.)' : scan.original}\n"""\n\n` +
    `Translation:\n"""\n${scan.translation}\n"""`;
  const first =
    scan.paraphrased && scan.image ? [...(await imageParts(scan.image)), { text: context }] : [{ text: context }];
  const contents = [
    { role: 'user', parts: first },
    { role: 'model', parts: [{ text: '네, 이 글에 대해 무엇이든 물어보세요.' }] },
    ...history.flatMap((t) => [
      { role: 'user', parts: [{ text: t.q }] },
      { role: 'model', parts: [{ text: t.a }] },
    ]),
    { role: 'user', parts: [{ text: q }] },
  ];
  const answer = await generate({ system: ASK_SYSTEM, contents, signal, onPartial, maxOutputTokens: 2048 });
  return String(answer).trim();
}

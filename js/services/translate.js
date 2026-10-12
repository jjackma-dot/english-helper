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
  });
  return { language: result.language || '', segments: Array.isArray(result.segments) ? result.segments : [] };
}

/* ---------- OTT "방금 뭐라고?": 방금 들린 대사 받아쓰기·해석 ---------- */

// 스트리밍 중에도 대사 → 표현 → 설명 순서로 오도록 키 순서를 정해 둔다
const ordered = (schema) => ({ ...schema, propertyOrdering: Object.keys(schema.properties) });

const CLIP_SCHEMA = ordered(
  S.obj({
    lines: S.arr(
      ordered(S.obj({ en: S.str('English line'), ko: S.str('Natural Korean translation') })),
      'The last 1–3 utterances, oldest first'
    ),
    phrases: S.arr(
      ordered(
        S.obj({
          phrase: S.str('English expression from the lines'),
          meaningKo: S.str('Korean meaning'),
          noteKo: S.str('Short Korean note (usage, slang, reduction or linking)'),
        })
      ),
      '0–4 items'
    ),
    explanationKo: S.str('Short Korean explanation of what is going on and anything a learner might miss'),
    confidence: { ...S.str('How sure you are about what was said'), enum: ['high', 'medium', 'low'] },
  })
);

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
  const ask = async (task) => ({
    ...(await generate({
      system: CLIP_SYSTEM,
      parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: CLIP_SITUATION + CLIP_TASK[task] + CLIP_END }],
      schema: CLIP_SCHEMA,
      signal,
      onPartial: onPartial && ((p) => onPartial({ ...p, paraphrased: task === 'gist' })),
      firstChunkMs: 25000, // 소리를 듣고 답하므로 글보다 첫 글자가 늦다
      timeoutMs: 60000,
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

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
      temperature: 0.2,
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
    temperature: 0.1,
    signal,
  });
  return { language: result.language || '', segments: Array.isArray(result.segments) ? result.segments : [] };
}

// 외부 API 응답을 앱에서 쓰는 형태로 바꾸는 순수 함수 (네트워크 없이 테스트 가능)

import { decodeEntities, stripHtml } from './lang.js';

/* ---------- Free Dictionary API (api.dictionaryapi.dev) ---------- */

/**
 * @returns {{word: string, phonetic: string, audios: {url: string, accent: string}[],
 *   meanings: {pos: string, defs: {def: string, example: string}[], synonyms: string[]}[]}|null}
 */
export function normalizeFreeDictionary(json) {
  if (!Array.isArray(json) || !json.length) return null;
  const word = json[0].word || '';
  let phonetic = '';
  const audios = [];
  const seenAudio = new Set();
  const byPos = new Map();
  for (const entry of json) {
    if (!phonetic) phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';
    for (const p of entry.phonetics || []) {
      if (!p.audio || seenAudio.has(p.audio)) continue;
      seenAudio.add(p.audio);
      const accent = /-us\.mp3$/i.test(p.audio)
        ? 'US'
        : /-uk\.mp3$/i.test(p.audio)
          ? 'UK'
          : /-au\.mp3$/i.test(p.audio)
            ? 'AU'
            : '';
      audios.push({ url: p.audio.startsWith('//') ? `https:${p.audio}` : p.audio, accent, text: p.text || '' });
    }
    for (const m of entry.meanings || []) {
      const pos = m.partOfSpeech || '';
      if (!byPos.has(pos)) byPos.set(pos, { pos, defs: [], synonyms: [] });
      const bucket = byPos.get(pos);
      for (const d of m.definitions || []) {
        if (d.definition) bucket.defs.push({ def: d.definition, example: d.example || '' });
        for (const s of d.synonyms || []) bucket.synonyms.push(s);
      }
      for (const s of m.synonyms || []) bucket.synonyms.push(s);
    }
  }
  const order = { US: 0, UK: 1, AU: 2, '': 3 };
  audios.sort((a, b) => order[a.accent] - order[b.accent]);
  const meanings = [...byPos.values()].map((m) => ({ ...m, synonyms: [...new Set(m.synonyms)].slice(0, 10) }));
  return { word, phonetic, audios, meanings };
}

/* ---------- MyMemory 번역 API ---------- */

export class QuotaError extends Error {}

/** /get 응답에서 번역문 꺼내기. 한도 초과·오류는 Error */
export function parseMyMemory(json) {
  const status = Number(json?.responseStatus);
  const text = json?.responseData?.translatedText;
  const details = String(json?.responseDetails || '');
  if (/MYMEMORY WARNING|USED ALL AVAILABLE FREE TRANSLATIONS/i.test(`${text} ${details}`) || status === 429) {
    throw new QuotaError(
      '무료 번역의 오늘 사용량을 모두 썼습니다. 설정에서 이메일을 등록하면 한도가 늘어나고, Gemini 키를 넣으면 제한 없이 쓸 수 있습니다.'
    );
  }
  if (status !== 200 || typeof text !== 'string') {
    throw new Error(`번역 서버 오류: ${details || status || '응답 없음'}`);
  }
  return decodeEntities(text).trim();
}

/** 단어 번역의 후보 뜻 목록 (일치도·품질 순, 중복 제거) */
export function parseMyMemoryMatches(json, query) {
  const main = (() => {
    try {
      return parseMyMemory(json);
    } catch (e) {
      if (e instanceof QuotaError) throw e;
      return '';
    }
  })();
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const list = [];
  const seen = new Set();
  const add = (t) => {
    const s = decodeEntities(String(t || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const key = s.toLowerCase().replace(/[.!?]$/, '');
    if (!s || s.length > 60 || key === q || seen.has(key)) return;
    seen.add(key);
    list.push(s.replace(/[.]$/, ''));
  };
  add(main);
  const matches = Array.isArray(json?.matches) ? [...json.matches] : [];
  matches.sort(
    (a, b) => (Number(b.match) || 0) - (Number(a.match) || 0) || (Number(b.quality) || 0) - (Number(a.quality) || 0)
  );
  for (const m of matches) {
    if ((Number(m.match) || 0) < 0.5) continue;
    add(m.translation);
  }
  return list.slice(0, 6);
}

/* ---------- Gemini API ---------- */

/** generateContent 응답에서 본문 텍스트(사고 과정 제외) */
export function extractGeminiText(json) {
  const cand = json?.candidates?.[0];
  if (!cand) {
    const reason = json?.promptFeedback?.blockReason;
    throw new Error(reason ? `Gemini가 요청을 거절했습니다 (${reason}).` : 'Gemini 응답이 비어 있습니다.');
  }
  const text = (cand.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text.trim()) {
    throw new Error(`Gemini 응답이 비어 있습니다 (${cand.finishReason || '이유 미상'}).`);
  }
  return text;
}

export function geminiErrorMessage(status, json) {
  const msg = json?.error?.message || '';
  const reason = JSON.stringify(json?.error?.details || '');
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason)) {
    return 'Gemini API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.';
  }
  if (status === 403) return 'Gemini API 사용 권한이 없습니다. 키가 제한되었거나 사용할 수 없는 프로젝트입니다.';
  if (status === 404)
    return '설정한 Gemini 모델을 찾을 수 없습니다. 설정에서 "모델 목록 확인"으로 다른 모델을 고르세요.';
  if (status === 429)
    return 'Gemini 사용 한도를 넘었습니다(무료 등급은 분당·일일 한도가 있음). 잠시 후 다시 시도하세요.';
  if (status >= 500) return 'Gemini 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.';
  return `Gemini 오류 (${status})${msg ? `: ${msg}` : ''}`;
}

/** 코드 블록(```json)으로 감싸여 와도 JSON으로 읽는다 */
export function parseJsonLoose(text) {
  const s = String(text || '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = s.search(/[[{]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
}

/* ---------- Openverse 이미지 ---------- */

export function normalizeOpenverse(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .filter((r) => r && (r.thumbnail || r.url))
    .map((r) => ({
      thumb: r.thumbnail || r.url,
      full: r.url || r.thumbnail,
      title: r.title || '',
      link: r.foreign_landing_url || r.url,
      credit: [r.creator, r.license ? `CC ${String(r.license).toUpperCase()}` : ''].filter(Boolean).join(' · '),
    }));
}

/* ---------- Wiktionary (en.wiktionary.org REST) ---------- */

/** 위키낱말사전 정의 응답에서 해당 언어 항목만: [{pos, defs: [string]}] */
export function normalizeWiktionary(json, lang) {
  const sections = json?.[lang];
  if (!Array.isArray(sections)) return [];
  return sections
    .map((s) => ({
      pos: s.partOfSpeech || '',
      defs: (s.definitions || [])
        .map((d) => stripHtml(d.definition))
        .filter((d) => d && d.length < 300)
        .slice(0, 5),
    }))
    .filter((s) => s.defs.length);
}

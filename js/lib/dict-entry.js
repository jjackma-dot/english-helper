// AI 사전 결과를 화면에 그릴 모양으로 정리하고 이미지 검색어를 고른다 (순수 함수, 단위 테스트 대상)

import { detectLang } from './lang.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * aiEntry 결과(스트리밍 중이면 덜 끝난 객체) → 화면용 모양.
 * JSON은 키 순서대로 도착하므로, 뒤에 다른 키가 나왔으면 앞 키의 값은 끝난 것이다.
 * @param {object} entry
 * @param {{done?: boolean}} [opts] done: 응답을 모두 받았는지
 * @returns {{pronunciation: string, synonyms: string[], tip: string,
 *            senses: {english: string, partOfSpeech: string, korean: string, nuance: string,
 *                     examples: {en: string, ko: string}[], complete: boolean}[]}}
 *   complete: 이 뜻을 다 받았는지 (false면 아직 자라는 중인 마지막 뜻)
 */
export function entryView(entry, { done = false } = {}) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const keys = Object.keys(e);
  const closed = (k) => done || (keys.includes(k) && keys.indexOf(k) < keys.length - 1);
  const list = Array.isArray(e.entries) ? e.entries : [];
  const senses = list
    .map((s, i) => ({
      english: str(s?.english),
      partOfSpeech: str(s?.partOfSpeech),
      korean: str(s?.korean),
      nuance: str(s?.nuance),
      examples: (Array.isArray(s?.examples) ? s.examples : [])
        .map((x) => ({ en: str(x?.en), ko: str(x?.ko) }))
        .filter((x) => x.en),
      complete: i < list.length - 1 || closed('entries'),
    }))
    .filter((s) => s.english || s.korean);
  const synonyms = (Array.isArray(e.synonyms) ? e.synonyms : []).map(str).filter(Boolean);
  return {
    pronunciation: closed('pronunciation') ? str(e.pronunciation) : '',
    senses,
    // 받는 중인 마지막 비슷한 말은 글자가 잘려 있을 수 있다
    synonyms: closed('synonyms') ? synonyms : synonyms.slice(0, -1),
    tip: str(e.tip),
  };
}

/**
 * 이미지 검색어: 영어 검색어는 그대로, 한국어 검색어는 AI 풀이의 첫 영어 단어 → 무료 번역 후보 → 한국어 그대로
 * @param {string} query
 * @param {'en'|'ko'} lang
 * @param {{aiWords?: string[], candidates?: string[]}} [found] 지금까지 나온 영어 단어들
 */
export function imageQuery(query, lang, { aiWords = [], candidates = [] } = {}) {
  if (lang !== 'ko') return query;
  return [...aiWords, ...candidates].map(str).find((w) => detectLang(w) === 'en') || query;
}

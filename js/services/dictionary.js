// 사전 데이터: Free Dictionary API(영영·발음), 위키낱말사전(한→영), Openverse(이미지), Gemini(AI 사전, 선택)
// AI 결과는 기기 안 보관함(ai-cache)에 두어 같은 단어·대사를 다시 찾으면 바로 보여 준다.

import { normalizeFreeDictionary, normalizeOpenverse, normalizeWiktionary } from '../lib/api-parse.js';
import { generate, S } from './gemini.js';
import { cached, cacheKey } from './ai-cache.js';

export async function freeDictionary(word, { signal } = {}) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`영영사전 서버 오류 (${res.status})`);
  return normalizeFreeDictionary(await res.json());
}

/** 위키낱말사전(영어판)에서 lang 언어 표제어의 영어 풀이. 실패하면 빈 배열 */
export async function wiktionary(word, lang, { signal } = {}) {
  try {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      signal,
    });
    if (!res.ok) return [];
    return normalizeWiktionary(await res.json(), lang);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return [];
  }
}

/** 자유 이용 이미지 검색 (Openverse) */
export async function searchImages(query, { signal } = {}) {
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=12`, {
    signal,
  });
  if (!res.ok) throw new Error(`이미지 검색 서버 오류 (${res.status})`);
  return normalizeOpenverse(await res.json());
}

// 키 순서대로 도착하므로 발음 → 첫 뜻(영어·품사·한국어 뜻·뉘앙스·예문) → 다음 뜻 순서로 화면에 나타난다
const ENTRY_SCHEMA = S.obj(
  {
    pronunciation: S.str('IPA of the English query, e.g. /ˈæp.əl/. Empty string if the query is Korean.'),
    entries: S.arr(
      S.obj({
        english: S.str('English word or phrase for this sense'),
        partOfSpeech: S.str('Part of speech in Korean, e.g. 명사, 동사, 형용사, 구동사'),
        korean: S.str('Korean meaning(s), short'),
        nuance: S.str('One short Korean sentence about usage or nuance'),
        examples: S.arr(
          S.obj({ en: S.str('Natural everyday English sentence'), ko: S.str('Korean translation') }),
          'One example (two only for the first entry)'
        ),
      }),
      'Up to 3 senses, most common first'
    ),
    synonyms: S.arr(S.str()),
    tip: S.str('One short Korean sentence for Korean learners (common mistake or collocation). Empty if none.'),
  },
  ['pronunciation', 'entries']
);

/**
 * Gemini 한영/영한 학습자 사전 항목. 같은 검색어는 보관함에서 바로 꺼낸다.
 * @param {{signal?: AbortSignal, onPartial?: (partial: object) => void, fresh?: boolean}} [opts]
 *   onPartial: 스트리밍 중 지금까지 받은 (덜 끝난) 항목 / fresh: 보관함을 건너뛰고 새로 만든다
 * @returns {Promise<{entry: object, cached: boolean}>}
 */
export async function aiEntry(query, lang, { signal, onPartial, fresh = false } = {}) {
  const task =
    lang === 'ko'
      ? `The query is Korean: "${query}". Give the most useful English equivalents (up to 3) as entries, ` +
        'most common first; use nuance to say in Korean how each one differs from the others.'
      : `The query is English: "${query}". Give its main senses (up to 3) as entries, most common first, ` +
        'with Korean meanings. If it is a phrase or idiom, explain it as one unit.';
  const r = await cached(
    cacheKey('dict:v2', lang, query),
    () =>
      generate({
        system:
          'You are a concise bilingual English–Korean learner’s dictionary for Korean speakers. Be accurate. ' +
          'Give ONE natural, everyday example sentence per entry (two only for the first entry). ' +
          'nuance is one short Korean sentence; tip is one Korean sentence or empty. Korean must be natural Korean.',
        prompt: task,
        schema: ENTRY_SCHEMA,
        maxOutputTokens: 2048, // 생각 토큰도 여기에 들어가므로 넉넉히 (잘린 풀이는 보관하지 않음)
        signal,
        onPartial,
      }),
    { fresh }
  );
  return { entry: r.value, cached: r.cached };
}

/** 자막·문장 속 단어 뜻 (문맥 반영). 같은 단어·문장은 보관함에서 꺼낸다 */
export async function aiWordInContext(word, sentence, { signal } = {}) {
  const r = await cached(cacheKey('ctx:v1', word, sentence), () =>
    generate({
      system: 'You explain English words to Korean learners. Answer in Korean except for English quotes and IPA.',
      prompt:
        `Word: "${word}"\nSentence: "${sentence}"\n` +
        'Explain the meaning of the word as used in this sentence, then translate the whole sentence into natural Korean.',
      schema: S.obj({
        word: S.str('Dictionary form of the word'),
        ipa: S.str('IPA pronunciation'),
        partOfSpeech: S.str('Part of speech in Korean'),
        meaning: S.str('General Korean meaning(s), short'),
        inContext: S.str('Korean explanation of the meaning in this sentence'),
        sentenceKo: S.str('Natural Korean translation of the sentence'),
      }),
      signal,
    })
  );
  return r.value;
}

/** 드라마·영화 대사 해설 (번역 + 핵심 표현). 같은 대사는 보관함에서 꺼낸다 */
export async function aiExplainLine(line, { signal, context = '' } = {}) {
  const r = await cached(cacheKey('line:v1', line), () =>
    generate({
      system:
        'You are an English tutor for Korean learners who study with TV shows and movies. ' +
        'Explain dialogue clearly in Korean. Include slang, idioms, phrasal verbs and grammar points that a learner might miss.',
      prompt: `${context ? `Previous lines for context:\n${context}\n\n` : ''}Line to explain:\n"${line}"`,
      schema: S.obj(
        {
          translation: S.str('Natural Korean translation of the line'),
          expressions: S.arr(
            S.obj({
              phrase: S.str('English expression from the line'),
              meaning: S.str('Korean meaning'),
              note: S.str('Short Korean usage note'),
            }),
            'Key expressions (0–4)'
          ),
          note: S.str('Short Korean note about tone, pronunciation (linking, reductions) or culture. Empty if none.'),
        },
        ['translation', 'expressions']
      ),
      signal,
    })
  );
  return r.value;
}

/** 외부 사전·검색 바로가기 */
export function externalLinks(query, lang) {
  const q = encodeURIComponent(query);
  const links = [
    { label: '네이버 사전', href: `https://en.dict.naver.com/#/search?query=${q}` },
    { label: '다음 사전', href: `https://dic.daum.net/search.do?q=${q}&dic=eng` },
  ];
  if (lang === 'en') {
    links.push(
      {
        label: 'Cambridge',
        href: `https://dictionary.cambridge.org/search/direct/?datasetsearch=english-korean&q=${q}`,
      },
      { label: 'YouGlish (실제 발음 영상)', href: `https://youglish.com/pronounce/${q}/english` }
    );
  }
  links.push({ label: '구글 이미지', href: `https://www.google.com/search?tbm=isch&q=${q}` });
  return links;
}

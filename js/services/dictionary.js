// 사전 데이터: Free Dictionary API(영영·발음), 위키낱말사전(한→영), Openverse(이미지), Gemini(AI 사전, 선택)

import { normalizeFreeDictionary, normalizeOpenverse, normalizeWiktionary } from '../lib/api-parse.js';
import { generate, S } from './gemini.js';

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

const ENTRY_SCHEMA = S.obj(
  {
    headword: S.str('The query word as given'),
    pronunciation: S.str('IPA of the English headword, e.g. /ˈæp.əl/. Empty string if the query is Korean.'),
    entries: S.arr(
      S.obj(
        {
          english: S.str('English word or phrase for this sense'),
          partOfSpeech: S.str('Part of speech in Korean, e.g. 명사, 동사, 형용사, 구동사'),
          korean: S.str('Korean meaning(s), short'),
          nuance: S.str('One short Korean sentence about usage or nuance'),
          examples: S.arr(S.obj({ en: S.str('Natural English example sentence'), ko: S.str('Korean translation') })),
        },
        ['english', 'partOfSpeech', 'korean', 'examples']
      )
    ),
    synonyms: S.arr(S.str()),
    tip: S.str('A short Korean tip for Korean learners (common mistakes, collocations). Empty if none.'),
  },
  ['headword', 'entries']
);

/** Gemini 한영/영한 학습자 사전 항목 */
export async function aiEntry(query, lang, { signal } = {}) {
  const task =
    lang === 'ko'
      ? `The query is Korean: "${query}". List the most useful English equivalents (up to 5) as entries, ` +
        'from most common to least, explaining the difference in nuance between them in Korean.'
      : `The query is English: "${query}". List its main senses (up to 5) as entries, from most common to least, ` +
        'with Korean meanings. If it is a phrase or idiom, explain it as one unit.';
  return generate({
    system:
      'You are a bilingual English–Korean learner’s dictionary for Korean speakers. ' +
      'Be accurate. Use everyday, natural example sentences (2 per entry). Korean must be natural Korean.',
    prompt: task,
    schema: ENTRY_SCHEMA,
    temperature: 0.2,
    signal,
  });
}

/** 자막·문장 속 단어 뜻 (문맥 반영) */
export async function aiWordInContext(word, sentence, { signal } = {}) {
  return generate({
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
    temperature: 0.2,
    signal,
  });
}

/** 드라마·영화 대사 해설 (번역 + 핵심 표현) */
export async function aiExplainLine(line, { signal, context = '' } = {}) {
  return generate({
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
    temperature: 0.2,
    signal,
  });
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

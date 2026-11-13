// 레벨테스트 규칙 (순수 함수, 단위 테스트 대상): 응시자·난이도, 토익스피킹식 문항 구성과 시간, 문제 은행에서 매번 다르게 고르기,
// Azure 발음 평가 결과 읽기·합치기, 항목 점수 모으기, 총점 → 토익스피킹 점수·등급 / OPIc 등급 예상, Azure 무료 사용량 계산

import { INFO, OPINIONS, PICTURES, QSETS, READ } from './level-bank.js';

/** 응시자 (가족) */
export const TAKERS = [
  { id: 'boar', name: '멧돼지', emoji: '🐗' },
  { id: 'monkey', name: '원숭이', emoji: '🐒' },
  { id: 'honey', name: '꿀돼지', emoji: '🐷' },
  { id: 'honey2', name: '꿀꿀돼지', emoji: '🐽' },
];
export const takerOf = (id) => TAKERS.find((t) => t.id === id) ?? { id, name: id || '?', emoji: '🙂' };

export const LEVELS = { normal: '일반', easy: '쉬움' };

/** 토익스피킹 다섯 유형 (축약: 유형마다 1문항, 질문에 답하기는 3문항) */
export const PARTS = [
  { part: 'read', label: '문장 읽기', dirKo: '화면의 글을 소리 내어 읽으세요. 준비 시간이 끝나면 녹음이 시작돼요.' },
  {
    part: 'picture',
    label: '사진 묘사',
    dirKo: '사진을 보고 되도록 자세히 설명하세요. 누가·무엇을·어디서·어떻게 보이는지 말해 보세요.',
  },
  {
    part: 'respond',
    label: '질문에 답하기',
    dirKo: '친구나 이웃이 묻는 질문 세 개에 바로 답하세요. 준비 시간은 3초예요.',
  },
  { part: 'info', label: '표 보고 답하기', dirKo: '표를 30초 동안 읽은 뒤, 표를 보며 질문에 답하세요.' },
  { part: 'opinion', label: '의견 말하기', dirKo: '질문에 대한 내 의견을 이유와 예를 들어 말하세요.' },
];
export const partOf = (part) => PARTS.find((p) => p.part === part);

/** 난이도별 시간(초): [준비, 답변]. 질문에 답하기는 질문마다, 표 보고 답하기는 [표 읽기, 준비, 답변] */
export const TIMING = {
  normal: { read: [20, 45], picture: [30, 45], respond: [3, [15, 15, 30]], info: [30, 3, 30], opinion: [30, 60] },
  easy: { read: [25, 30], picture: [30, 30], respond: [3, [15, 15, 30]], info: [30, 3, 30], opinion: [30, 45] },
};
export const MIN_SECONDS = 2; // 이보다 짧은 녹음은 답이 없는 것으로 본다 (Azure로 보내지 않는다)

/** 채점 항목 (성적표 순서). by: azure(음성 평가) | gemini(글 평가) */
export const DIMENSIONS = [
  { key: 'pronunciation', label: '발음', by: 'azure', hint: '단어의 소리를 얼마나 정확하게 내는지' },
  { key: 'fluency', label: '유창성', by: 'azure', hint: '막힘·머뭇거림 없이 자연스러운 속도로 이어 말하는지' },
  { key: 'prosody', label: '억양·강세', by: 'azure', hint: '강세와 억양이 자연스러운지' },
  { key: 'grammar', label: '문법', by: 'gemini', hint: '문장 구조와 시제·단수복수 등이 바른지' },
  { key: 'vocabulary', label: '어휘', by: 'gemini', hint: '상황에 맞는 다양한 단어와 표현을 쓰는지' },
  {
    key: 'relevance',
    label: '과제 수행',
    by: 'gemini',
    hint: '질문에 맞게 충분히, 짜임새 있게 답했는지 (문장 읽기는 빠짐없이 읽었는지)',
  },
];
const WEIGHTS = { pronunciation: 0.15, fluency: 0.15, prosody: 0.1, grammar: 0.2, vocabulary: 0.2, relevance: 0.2 };

/* ---------- 문제 고르기 ---------- */

/** 응시자가 최근 n번 시험에서 푼 문제 id (다시 내지 않게) */
export function recentBankIds(results, takerId, n = 3) {
  return new Set(
    results
      .filter((r) => r.taker === takerId)
      .slice(0, n)
      .flatMap((r) => r.bankIds || [])
  );
}

function pickOne(list, recent, rand) {
  const fresh = list.filter((x) => !recent.has(x[0]));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/**
 * 시험 하나를 만든다: 유형마다 최근에 풀지 않은 문제를 하나씩 뽑아 녹음할 과제 7개로 편다.
 * @param {'normal'|'easy'} level
 * @param {Set<string>} [recent] 다시 내지 않을 문제 id
 * @param {() => number} [rand] 0~1 난수
 * @returns {{level: string, bankIds: string[], tasks: object[]}}
 *   tasks: {part, id, prep, answer, ...} 순서대로 (read, picture, respond×3, info, opinion)
 */
export function buildTest(level, recent = new Set(), rand = Math.random) {
  const lv = LEVELS[level] ? level : 'normal';
  const t = TIMING[lv];
  const read = pickOne(READ[lv], recent, rand);
  const pic = pickOne(PICTURES, recent, rand);
  const qs = pickOne(QSETS[lv], recent, rand);
  const info = pickOne(INFO[lv], recent, rand);
  const op = pickOne(OPINIONS[lv], recent, rand);
  const tasks = [
    { part: 'read', id: read[0], prep: t.read[0], answer: t.read[1], text: read[1], reference: read[1] },
    {
      part: 'picture',
      id: pic[0],
      prep: t.picture[0],
      answer: t.picture[1],
      query: pic[1],
      fallback: pic[2],
      image: '',
    },
    ...qs[2].map((question, k) => ({
      part: 'respond',
      id: `${qs[0]}-${k + 1}`,
      n: k + 1,
      intro: qs[1],
      question,
      prep: t.respond[0],
      answer: t.respond[1][k],
    })),
    {
      part: 'info',
      id: info[0],
      read: t.info[0],
      prep: t.info[1],
      answer: t.info[2],
      title: info[1],
      rows: info[2],
      caller: info[3],
      question: info[4],
    },
    { part: 'opinion', id: op[0], prep: t.opinion[0], answer: t.opinion[1], question: op[1] },
  ];
  return { level: lv, bankIds: [read[0], pic[0], qs[0], info[0], op[0]], tasks };
}

/** 과제에서 응시자에게 보여 준(들려준) 지시문 (성적표·채점 요청용) */
export function promptText(task) {
  switch (task.part) {
    case 'read':
      return `Read the text aloud: "${task.text}"`;
    case 'picture':
      return `Describe the picture in as much detail as you can. (The picture shows ${task.fallback}.)`;
    case 'respond':
      return `${task.intro} Question ${task.n}: ${task.question}`;
    case 'info':
      return `Information: ${task.title}. ${task.rows.map((r) => r.join(' — ')).join('; ')}. Caller: "${task.caller} ${task.question}"`;
    default:
      return task.question;
  }
}

/** 난이도별 말하는 시간 합계(초) = Azure 사용량 */
export function speakingSeconds(level) {
  return buildTest(level, new Set(), () => 0).tasks.reduce((a, t) => a + t.answer, 0);
}

/* ---------- Azure 발음 평가 결과 ---------- */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Azure 인식 결과 JSON(SpeechServiceResponse_JsonResult) 한 토막 → 점수와 단어들
 * @returns {{text: string, accuracy: number|null, fluency: number|null, prosody: number|null, completeness: number|null,
 *   words: {word: string, accuracy: number|null, error: string}[]}|null}
 */
export function parseAzureResult(json, fallbackText = '') {
  let j;
  try {
    j = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  const nb = j?.NBest?.[0];
  if (!nb) return null;
  const pa = nb.PronunciationAssessment || {};
  const words = (Array.isArray(nb.Words) ? nb.Words : [])
    .map((w) => ({
      word: String(w?.Word ?? ''),
      accuracy: num(w?.PronunciationAssessment?.AccuracyScore),
      error: String(w?.PronunciationAssessment?.ErrorType ?? 'None'),
    }))
    .filter((w) => w.word);
  return {
    text: String(nb.Display ?? nb.Lexical ?? fallbackText ?? '').trim(),
    accuracy: num(pa.AccuracyScore),
    fluency: num(pa.FluencyScore),
    prosody: num(pa.ProsodyScore),
    completeness: num(pa.CompletenessScore),
    words,
  };
}

/**
 * 토막들을 하나로: 점수는 단어 수로 가중 평균, 글은 이어 붙인다. 토막이 없으면(말소리 없음) 점수 0
 * @returns {{transcript: string, scores: {pronunciation: number, fluency: number, prosody: number, completeness: number|null},
 *   words: object[], utterances: number}}
 */
export function mergeAzureParts(parts) {
  const list = (parts || []).filter(Boolean);
  const avg = (key) => {
    let s = 0;
    let w = 0;
    for (const p of list) {
      if (p[key] == null) continue;
      const n = Math.max(1, p.words.length);
      s += p[key] * n;
      w += n;
    }
    return w ? Math.round((s / w) * 10) / 10 : null;
  };
  const transcript = list
    .map((p) => p.text)
    .filter(Boolean)
    .join(' ');
  return {
    transcript,
    scores: {
      pronunciation: avg('accuracy') ?? 0,
      fluency: avg('fluency') ?? 0,
      prosody: avg('prosody') ?? 0,
      completeness: avg('completeness'),
    },
    words: list.flatMap((p) => p.words),
    utterances: list.length,
  };
}

const tokens = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * 문장 읽기: 읽을 글의 낱말 가운데 실제로 읽힌(인식된) 비율 0~100 (두 낱말 열의 가장 긴 공통 순서).
 * Azure는 이어서 인식할 때 빠뜨린 구절을 잘 잡지 못하므로 앱이 직접 센다
 * @param {string} reference 읽을 글
 * @param {({word: string}|string)[]|string} spoken Azure가 인식한 낱말들 (또는 받아쓴 글)
 */
export function readCoverage(reference, spoken) {
  const a = tokens(reference);
  const b = (Array.isArray(spoken) ? spoken.map((w) => (typeof w === 'string' ? w : w?.word)) : [spoken]).flatMap(
    tokens
  );
  if (!a.length) return 100;
  if (!b.length) return 0;
  const row = new Array(b.length + 1).fill(0);
  for (const x of a) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = x === b[j - 1] ? diag + 1 : Math.max(up, row[j - 1]);
      diag = up;
    }
  }
  return Math.round((row[b.length] / a.length) * 100);
}

/**
 * Azure 취소(오류) → 사용자에게 보여 줄 문장. codes: SDK의 CancellationErrorCode 열거
 * @param {{code?: number, details?: string}} e
 */
export function azureErrorMessage(e, codes = {}) {
  const details = String(e?.details ?? '');
  const code = e?.code;
  if (/quota/i.test(details)) return '이번 달 Azure 무료 사용량(5시간)을 다 썼어요. 다음 달 1일에 다시 할 수 있어요.';
  if (code === codes.AuthenticationFailure || code === codes.Forbidden || /\b40[13]\b/.test(details))
    return 'Azure 음성 키나 지역이 맞지 않아요. 설정에서 확인하세요.';
  if (code === codes.TooManyRequests || /\b429\b|throttl/i.test(details))
    return 'Azure 요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
  if (code === codes.ConnectionFailure || code === codes.ServiceTimeout || /connection|network|timeout/i.test(details))
    return 'Azure에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도하세요.';
  return `Azure 음성 평가 오류: ${details || '알 수 없는 오류'}`;
}

/* ---------- 점수 모으기·환산 ---------- */

const clamp100 = (v) => Math.min(100, Math.max(0, Number(v) || 0));
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 과제별 점수를 항목마다 모은다 (답변 시간으로 가중 평균). 총점은 항목 가중치(WEIGHTS)로.
 * @param {{scores: Record<string, number>, limit?: number}[]} items scores: 그 과제에서 매긴 항목만 (문장 읽기는 문법·어휘 없음)
 * @returns {{scores: Record<string, number>, total: number}}
 */
export function aggregate(items) {
  const scores = {};
  for (const { key } of DIMENSIONS) {
    let s = 0;
    let w = 0;
    for (const it of items) {
      const v = it?.scores?.[key];
      if (v == null || !Number.isFinite(Number(v))) continue;
      const weight = Math.max(1, Number(it.limit) || 1);
      s += clamp100(v) * weight;
      w += weight;
    }
    scores[key] = w ? round1(s / w) : null;
  }
  let ts = 0;
  let tw = 0;
  for (const { key } of DIMENSIONS) {
    if (scores[key] == null) continue;
    ts += scores[key] * WEIGHTS[key];
    tw += WEIGHTS[key];
  }
  return { scores, total: tw ? round1(ts / tw) : 0 };
}

/** 토익스피킹 등급 (2022년 개편 8+3단계): [이 점수 이상, 약어, 이름] */
export const TOEIC_LEVELS = [
  [200, 'AH', 'Advanced High'],
  [180, 'AM', 'Advanced Mid'],
  [160, 'AL', 'Advanced Low'],
  [140, 'IH', 'Intermediate High'],
  [130, 'IM3', 'Intermediate Mid 3'],
  [120, 'IM2', 'Intermediate Mid 2'],
  [110, 'IM1', 'Intermediate Mid 1'],
  [90, 'IL', 'Intermediate Low'],
  [60, 'NH', 'Novice High'],
  [40, 'NM', 'Novice Mid'],
  [0, 'NL', 'Novice Low'],
];
/** OPIc 등급: [총점(0~100) 이 값 이상, 등급] */
export const OPIC_LEVELS = [
  [80, 'AL'],
  [70, 'IH'],
  [65, 'IM3'],
  [60, 'IM2'],
  [55, 'IM1'],
  [45, 'IL'],
  [30, 'NH'],
  [20, 'NM'],
  [0, 'NL'],
];

/** 총점(0~100) → 토익스피킹 예상 점수 (0~200, 10점 단위) */
export function toeicScore(total) {
  return Math.max(0, Math.min(200, Math.round((clamp100(total) * 2) / 10) * 10));
}
/** 토익스피킹 점수 → [최저 점수, 약어, 이름] */
export function toeicLevel(score) {
  return TOEIC_LEVELS.find(([min]) => score >= min) ?? TOEIC_LEVELS.at(-1);
}
/** 총점(0~100) → OPIc 예상 등급 */
export function opicLevel(total) {
  return (OPIC_LEVELS.find(([min]) => clamp100(total) >= min) ?? OPIC_LEVELS.at(-1))[1];
}

/** 등급 띠 그리기용: 낮은 등급부터 [약어, 시작, 끝] (토익스피킹은 0~200, OPIc은 0~100) */
export function toeicBands() {
  const asc = [...TOEIC_LEVELS].reverse();
  return asc.map(([min, code], i) => [code, min, i + 1 < asc.length ? asc[i + 1][0] : 201]);
}
export function opicBands() {
  const asc = [...OPIC_LEVELS].reverse();
  return asc.map(([min, code], i) => [code, min, i + 1 < asc.length ? asc[i + 1][0] : 100]);
}

/* ---------- Azure 무료 사용량 ---------- */

export const FREE_SECONDS_PER_MONTH = 5 * 3600; // F0(무료) 등급: 음성 인식·발음 평가 한 달 5시간

export function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 이 기기에서 이번 달 보낸 시간과 남은 예상 횟수
 * @param {{month?: string, seconds?: number}} usage
 */
export function usageSummary(usage, now = Date.now()) {
  const month = monthKey(now);
  const usedSec = usage?.month === month ? Math.max(0, Number(usage.seconds) || 0) : 0;
  const leftSec = Math.max(0, FREE_SECONDS_PER_MONTH - usedSec);
  return {
    month,
    usedSec,
    usedMin: Math.round(usedSec / 60),
    freeMin: FREE_SECONDS_PER_MONTH / 60,
    leftSec,
    percent: Math.min(100, Math.round((usedSec / FREE_SECONDS_PER_MONTH) * 100)),
    leftTests: Object.fromEntries(Object.keys(LEVELS).map((lv) => [lv, Math.floor(leftSec / speakingSeconds(lv))])),
  };
}

/** 성적표 날짜: 2026.11.07 23:39 */
export function formatTestDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

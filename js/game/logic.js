// 영어 방탈출 게임 규칙 (순수 함수, 단위 테스트 대상): 수준·플레이어·역할, 팀 코드(여러 폰이 서버 없이 같은 게임을 만들도록),
// 시드 난수, 방마다 임무(스테이션)를 누구에게 줄지, 답 맞추기, 말한 문장이 목표 문장과 얼마나 맞는지.
//
// 여러 폰 연결 방식: 서버가 없으므로 한 폰이 팀 코드(플레이어·수준·시드)를 만들고, 다른 폰은 그 코드를 넣는다.
// 같은 코드 → 같은 문제·같은 임무 배정이 모든 폰에서 똑같이 계산된다. 폰끼리는 데이터를 주고받지 않고,
// 각자 가진 단서를 "영어로 말해서" 전한다 (그게 이 게임의 핵심 학습 활동).

import { TAKERS } from '../lib/level.js';

/* ---------- 수준 · 플레이어 · 역할 ---------- */

export const LEVELS = ['basic', 'im1', 'im2', 'im3'];
export const LEVEL_INFO = {
  basic: { label: 'Basic', grade: '초등 1·2학년', rank: 0 },
  im1: { label: 'IM1', grade: '초등 3·4학년', rank: 1 },
  im2: { label: 'IM2', grade: '초등 5·6학년', rank: 2 },
  im3: { label: 'IM3', grade: '중·고등학생', rank: 3 },
};
export const levelRank = (lv) => LEVEL_INFO[lv]?.rank ?? 0;

/** 고를 수 있는 얼굴 (가족 4명은 레벨테스트 응시자와 같다 + 손님 4명) */
export const AVATARS = [
  ...TAKERS.map(({ id, name, emoji }) => ({ id, name, emoji })),
  { id: 'rabbit', name: '토끼', emoji: '🐰' },
  { id: 'panda', name: '판다', emoji: '🐼' },
  { id: 'fox', name: '여우', emoji: '🦊' },
  { id: 'tiger', name: '호랑이', emoji: '🐯' },
];
export const avatarOf = (id) => AVATARS.find((a) => a.id === id) ?? { id, name: id || '?', emoji: '🙂' };

export const ROLES = {
  buddy: { emoji: '🤖', name: '핍의 짝꿍', en: "Pip's Buddy", desc: '핍에게 힌트를 받아 팀에 영어로 알려 줘요' },
  engineer: { emoji: '🔧', name: '엔지니어', en: 'Engineer', desc: '기계를 고치고 단서를 전해요' },
  navigator: { emoji: '🧭', name: '항해사', en: 'Navigator', desc: '지도와 기록을 읽고 길을 찾아요' },
  captain: { emoji: '⭐', name: '캡틴', en: 'Captain', desc: '어려운 기록을 읽고 마지막 추리를 이끌어요' },
};

/**
 * 역할: 가장 낮은 수준 → 핍의 짝꿍(힌트 담당), 가장 높은 수준 → 캡틴, 나머지는 엔지니어·항해사.
 * 혼자면 캡틴이면서 짝꿍(힌트도 직접 본다)
 * @param {string[]} levels 플레이어 순서대로의 수준
 * @returns {{roles: string[], buddy: number, captain: number}}
 */
export function assignRoles(levels) {
  const n = levels.length;
  const order = levels.map((lv, i) => ({ i, r: levelRank(lv) })).sort((a, b) => a.r - b.r || a.i - b.i);
  const buddy = order[0].i;
  if (n === 1) return { roles: ['captain'], buddy: 0, captain: 0 };
  const captain = order[n - 1].i;
  const roles = Array(n).fill('');
  roles[buddy] = 'buddy';
  roles[captain] = 'captain';
  const rest = ['engineer', 'navigator'];
  for (const { i } of order) if (!roles[i]) roles[i] = rest.shift();
  return { roles, buddy, captain };
}

/* ---------- 시드 난수 ---------- */

/** 문자열 → 32비트 해시 (FNV-1a) */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 0 이상 1 미만을 돌려주는 시드 난수 (mulberry32). 같은 시드·태그면 늘 같은 순서 */
export function rngFor(seed, tag = '') {
  let a = hash32(`${seed}:${tag}`) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 팀 코드 ---------- */

// 헷갈리는 글자(0·O·1·I)는 뺀 32글자. 7글자(35비트) 자료 + 확인 글자 1개 = 8글자 (예: K7M2-QX4P)
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_VERSION = 0;
export const MAX_PLAYERS = 4;
export const SEED_MAX = 4096;

function checkChar(chars) {
  let sum = 0;
  for (let i = 0; i < chars.length; i++) sum += (2 * i + 1) * ALPHABET.indexOf(chars[i]); // 홀수 가중치: 한 글자 틀림은 모두 찾는다
  return ALPHABET[sum % 32];
}

/** 대문자로, 공백·하이픈 빼기 */
export function normalizeCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

export const formatCode = (code) => {
  const c = normalizeCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

/**
 * @param {{seed: number, players: {avatar: string, level: string}[]}} team
 * @returns {string} 8글자 코드 (하이픈 없음)
 */
export function encodeTeam({ seed, players }) {
  const n = players.length;
  if (n < 1 || n > MAX_PLAYERS) throw new Error('플레이어는 1~4명이어야 해요.');
  if (new Set(players.map((p) => p.avatar)).size !== n) throw new Error('같은 얼굴을 두 번 고를 수 없어요.');
  let v = CODE_VERSION;
  v = v * 4 + (n - 1);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    const a = p ? AVATARS.findIndex((x) => x.id === p.avatar) : 0;
    const l = p ? LEVELS.indexOf(p.level) : 0;
    if (a < 0 || l < 0) throw new Error('알 수 없는 얼굴이나 수준이에요.');
    v = v * 8 + a;
    v = v * 4 + l;
  }
  v = v * SEED_MAX + (Math.floor(seed) % SEED_MAX);
  let chars = '';
  for (let i = 0; i < 7; i++) {
    chars = ALPHABET[v % 32] + chars;
    v = Math.floor(v / 32);
  }
  return chars + checkChar(chars);
}

/**
 * 코드 → 팀. 틀린 코드는 한국어 메시지와 함께 Error
 * @returns {{seed: number, players: {avatar: string, level: string}[]}}
 */
export function decodeTeam(input) {
  const code = normalizeCode(input);
  const bad = () => new Error('팀 코드가 맞지 않아요. 8글자를 다시 확인하세요 (숫자 0·1과 글자 O·I는 쓰지 않아요).');
  if (code.length !== 8 || [...code].some((c) => !ALPHABET.includes(c))) throw bad();
  const chars = code.slice(0, 7);
  if (checkChar(chars) !== code[7]) throw bad();
  let v = 0;
  for (const c of chars) v = v * 32 + ALPHABET.indexOf(c);
  const seed = v % SEED_MAX;
  v = Math.floor(v / SEED_MAX);
  const slots = [];
  for (let i = MAX_PLAYERS - 1; i >= 0; i--) {
    const l = v % 4;
    v = Math.floor(v / 4);
    const a = v % 8;
    v = Math.floor(v / 8);
    slots[i] = { avatar: AVATARS[a].id, level: LEVELS[l] };
  }
  const n = (v % 4) + 1;
  const version = Math.floor(v / 4);
  if (version !== CODE_VERSION) throw bad();
  const players = slots.slice(0, n);
  if (new Set(players.map((p) => p.avatar)).size !== n) throw bad();
  return { seed, players };
}

/** 새 팀의 시드 */
export const newSeed = (random = Math.random) => Math.floor(random() * SEED_MAX);

/* ---------- 임무(스테이션) 배정 ---------- */

// 방마다 "단서 → 잠금" 짝이 4개 있다. 스테이션 k = 짝 k의 잠금 + 짝 (k+1)의 단서.
// 스테이션 k를 맡은 사람은 자기 잠금을 풀려면 스테이션 (k-1)을 맡은 사람의 단서가 필요하다 → 2명 이상이면 늘 서로 말해야 한다.
// 단서는 처음부터 볼 수 있으므로 서로 기다리다 막히는 일(교착)이 없다.
export const PAIRS_PER_ROOM = 4;

/** 방 room에서 스테이션 k의 주인 (플레이어 번호). 방마다 돌아가며 맡는다 */
export const stationOwner = (room, k, n) => (k + room) % n;

/** 짝 p의 잠금을 푸는 사람과 단서를 가진 사람 */
export function pairOwners(room, p, n) {
  return {
    lock: stationOwner(room, p, n),
    clue: stationOwner(room, (p + PAIRS_PER_ROOM - 1) % PAIRS_PER_ROOM, n),
  };
}

/** 한 플레이어가 이 방에서 맡은 일: 잠금을 풀 짝들, 단서를 볼 짝들 */
export function jobsOf(room, player, n) {
  const locks = [];
  const clues = [];
  for (let p = 0; p < PAIRS_PER_ROOM; p++) {
    const o = pairOwners(room, p, n);
    if (o.lock === player) locks.push(p);
    if (o.clue === player) clues.push(p);
  }
  return { locks, clues };
}

/* ---------- 답 맞추기 ---------- */

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const letters = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/**
 * 잠금 입력이 맞는지 (말하기 잠금은 따로: voicePass)
 * @param {string} widget colors | melody | arrows | switches | sliders | keypad | choice | multi | word | clock | wires
 */
export function sameAnswer(widget, input, expected) {
  switch (widget) {
    case 'keypad':
      return String(input ?? '').replace(/\D/g, '') === String(expected);
    case 'choice':
      return input === expected;
    case 'multi':
      return Array.isArray(input) && input.length === expected.length && expected.every((x) => input.includes(x));
    case 'word': {
      const alts = Array.isArray(expected) ? expected : [expected];
      return alts.some((w) => letters(w) === letters(input) && letters(input).length > 0);
    }
    case 'clock':
      return Number(input?.h) === expected.h && Number(input?.m) === expected.m;
    case 'wires':
      return Object.keys(expected).every((k) => input?.[k] === expected[k]);
    default:
      return eqArr(input, expected);
  }
}

/* ---------- 말한 문장 맞추기 (음성 인식 결과는 철자·숫자 표기가 들쭉날쭉하다) ---------- */

const NUM_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
const CONTRACTIONS = [
  [/\b(it|that|what|there|here|he|she|who|where)'s\b/g, '$1 is'],
  [/\bi'm\b/g, 'i am'],
  [/\b(you|we|they)'re\b/g, '$1 are'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\bcan't\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\bcannot\b/g, 'can not'],
];

/** 소문자, 문장부호 제거, 숫자 → 영어 낱말(0~20), 줄임말 풀기 */
export function normalizeSpeech(s) {
  let t = String(s ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  t = t.replace(/\d+/g, (d) => (Number(d) <= 20 ? ` ${NUM_WORDS[Number(d)]} ` : ` ${d.split('').map((x) => NUM_WORDS[x]).join(' ')} `));
  return t
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordsOf = (s) => normalizeSpeech(s).split(' ').filter(Boolean);

/** 편집 거리 (짧은 낱말용) */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 낱말이 거의 같은지 (복수형, 아이 발음으로 한 글자쯤 틀린 인식은 봐준다) */
export function similarWord(a, b) {
  if (a === b) return true;
  const strip = (w) => w.replace(/(es|s)$/, '');
  if (a.length > 3 && b.length > 3 && strip(a) === strip(b)) return true;
  const len = Math.max(a.length, b.length);
  if (len >= 7) return editDistance(a, b) <= 2;
  if (len >= 4) return editDistance(a, b) <= 1;
  return false;
}

/** 목표 문장의 낱말 중 몇 %를 말했는지 (0~1, 순서는 보지 않는다) */
export function speechScore(heard, target) {
  const h = wordsOf(heard);
  const t = wordsOf(target);
  if (!t.length) return 0;
  const used = new Set();
  let hit = 0;
  for (const w of t) {
    const i = h.findIndex((x, k) => !used.has(k) && similarWord(x, w));
    if (i >= 0) {
      used.add(i);
      hit++;
    }
  }
  return hit / t.length;
}

/** 열쇠말이 모두 들어 있는지. 열쇠말은 문자열이거나 대신 쓸 수 있는 말들의 배열, 여러 낱말 구도 된다 */
export function hasKeywords(heard, keywords) {
  const h = wordsOf(heard);
  const joined = h.join('');
  return keywords.every((k) =>
    (Array.isArray(k) ? k : [k]).some((alt) => {
      const ws = wordsOf(alt);
      if (ws.length > 1) return ws.every((w) => h.some((x) => similarWord(x, w))) || joined.includes(ws.join(''));
      // "sun shine"처럼 띄어 인식된 합성어도 받는다
      return h.some((x) => similarWord(x, ws[0])) || (ws[0].length >= 6 && joined.includes(ws[0]));
    })
  );
}

/** 수준별 따라 말하기 통과 기준 */
export const SPEECH_PASS = { basic: 0.5, im1: 0.6, im2: 0.7, im3: 0.75 };

/**
 * 말하기 잠금 통과 여부
 * @param {string} heard 음성 인식 결과
 * @param {{keywords?: (string|string[])[], target?: string, minWords?: number, level?: string}} rule
 */
export function voicePass(heard, { keywords = [], target = '', minWords = 0, level = 'im1' } = {}) {
  const n = wordsOf(heard).length;
  if (!n || n < minWords) return false;
  if (keywords.length && !hasKeywords(heard, keywords)) return false;
  if (target && speechScore(heard, target) < (SPEECH_PASS[level] ?? 0.6)) return false;
  return true;
}

/* ---------- 시간 ---------- */

export const STORM_MS = 40 * 60 * 1000; // 태양 폭풍까지 (게임 안 시간, 화면을 보고 있을 때만 흐른다)

export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

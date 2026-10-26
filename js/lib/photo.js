// 사진 번역 (순수 함수, 단위 테스트 대상): 보낼 사진 크기·조각, 줄이지 못한 사진을 그대로 보낼지, 블록 언어, 결과 글 모으기

export const MAX_SIDE = 2048; // 보통 사진은 긴 변을 이만큼까지 줄인다 (글자는 읽히고 보내는 양은 적게)
export const KEEP_SHORT = 1080; // 길쭉한 화면 캡처는 짧은 변을 이만큼 남긴다 (글자가 너무 작아지지 않게)
export const MAX_LONG = 4096; // 그래도 긴 변은 이보다 길게 보내지 않는다 (가로로 긴 파노라마)
// 세로로 아주 긴 스크롤 캡처는 한 장으로 보내면 Gemini가 줄여 읽어 글자가 뭉개지므로 위에서부터 조각내 보낸다
export const SLICE_H = 3000; // 조각 하나의 최대 높이
export const SLICE_OVERLAP = 80; // 이웃 조각과 겹치는 높이 (경계에 걸린 줄도 한 조각에서는 온전히 보이게)
export const MAX_SLICES = 6; // 조각은 이만큼까지. 더 길면 사진을 줄여 이 안에 맞춘다
export const JPEG_QUALITY = 0.85;
// 열지 못한 사진을 원본 그대로 보낼 수 있는 크기. Gemini 한 번 요청은 약 20MB이고 base64로 보내면 4/3배가 된다
export const RAW_MAX_BYTES = 14e6;
const HISTORY_SOURCE_MAX = 3000; // 번역 기록에 넣는 원문 최대 글자 수
const HISTORY_PREVIEW_MAX = 120; // 번역 기록에 넣는 번역 미리 보기 글자 수

// Gemini가 읽는 사진 형식 (크롬이 못 여는 HEIC·HEIF도 Gemini는 읽는다)
const RAW_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const px = (v) => Math.max(1, Math.round(v) || 1);

/**
 * 보낼 크기: 긴 변을 MAX_SIDE까지 줄이되, 화면 캡처처럼 길쭉하면 짧은 변을 KEEP_SHORT까지 남긴다 (긴 변은 MAX_LONG까지).
 * 작은 사진은 그대로 둔다.
 */
export function fitSize(width, height) {
  const w = px(width);
  const h = px(height);
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const k = Math.min(1, Math.max(MAX_SIDE / long, KEEP_SHORT / short), MAX_LONG / long);
  return { width: px(w * k), height: px(h * k) };
}

/**
 * 보낼 크기와 조각. 보통 사진은 fitSize 크기 한 장.
 * 너비를 KEEP_SHORT까지 줄여도 SLICE_H보다 긴 세로 캡처는 위에서부터 SLICE_OVERLAP씩 겹치게 MAX_SLICES 조각까지 나눈다.
 * 그래도 길면 MAX_SLICES 조각에 맞게 줄이고 small: true (글자가 작아질 수 있다고 알린다).
 * @returns {{width: number, height: number, slices: {y: number, height: number}[], small: boolean}}
 *   width·height: 줄인 사진 전체 크기, slices: 그 안에서 자를 위치(y)와 높이 (조각 너비는 width)
 */
export function photoPlan(width, height) {
  const w = px(width);
  const h = px(height);
  let k = Math.min(1, KEEP_SHORT / w);
  if (px(h * k) <= SLICE_H) {
    const s = fitSize(w, h);
    return { ...s, slices: [{ y: 0, height: s.height }], small: false };
  }
  const maxTotal = MAX_SLICES * SLICE_H - (MAX_SLICES - 1) * SLICE_OVERLAP;
  const small = h * k > maxTotal;
  if (small) k = maxTotal / h;
  const W = px(w * k);
  const H = Math.min(maxTotal, px(h * k));
  const n = Math.ceil((H - SLICE_OVERLAP) / (SLICE_H - SLICE_OVERLAP));
  // 조각 높이를 고르게: n조각이 서로 SLICE_OVERLAP 이상 겹치면서 전체를 덮는 가장 작은 높이
  const sh = Math.ceil((H + (n - 1) * SLICE_OVERLAP) / n);
  const slices = Array.from({ length: n }, (_, i) => ({ y: Math.round((i * (H - sh)) / (n - 1)), height: sh }));
  return { width: W, height: H, slices, small };
}

/** 사진 형식. 형식이 비어 있거나 사진 형식이 아니면(일부 갤러리 앱·공유) 파일 이름의 확장자로 짐작한다 */
export function imageType({ type = '', name = '' } = {}) {
  const t = String(type || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (t.startsWith('image/')) return t === 'image/jpg' ? 'image/jpeg' : t;
  const ext = String(name || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  return RAW_TYPES[ext] || t;
}

/**
 * 크롬이 열지 못한 사진(갤럭시 HEIF 사진 등)을 원본 그대로 보낼지. Gemini가 읽는 형식이고 크기가 맞을 때만 보낸다.
 * @param {{type?: string, name?: string, size?: number}} file
 * @returns {{ok: true, mimeType: string} | {ok: false, reason: 'type'|'size'}}
 */
export function rawFallback(file = {}) {
  const mimeType = imageType(file);
  if (!Object.values(RAW_TYPES).includes(mimeType)) return { ok: false, reason: 'type' };
  if (!(file.size > 0) || file.size > RAW_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, mimeType };
}

const str = (v) => String(v ?? '').trim();
const LANGS = ['en', 'ko', 'other'];
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/; // lib/lang.js의 detectLang과 같은 범위
// 영어 알파벳(A-Z)이 아닌 글자: é·ñ·ơ·đ 같은 다른 언어의 라틴 글자, 가나·한자, 키릴 문자 등 (한글은 먼저 따로 본다)
const NOT_ENGLISH_LETTER = /[^\P{L}A-Za-z]/u;

/**
 * Gemini가 원문 언어를 주지 않았거나 여러 언어가 섞였을 때 글자로 짐작한다. 영어는 조심스럽게만:
 * 한글이 있으면 'ko', 영어 알파벳만 있으면 'en', 다른 언어 글자가 하나라도 있거나 글자가 없으면 'other'
 * @returns {'en'|'ko'|'other'}
 */
export function guessLang(text) {
  const s = String(text ?? '');
  if (HANGUL.test(s)) return 'ko';
  if (NOT_ENGLISH_LETTER.test(s)) return 'other';
  return /[A-Za-z]/.test(s) ? 'en' : 'other';
}

/**
 * 스캔한 글의 원문 언어: Gemini가 준 sourceLang(en·ko·other), 섞여 있거나(mixed) 없으면 원문 글자로
 * (한글이 있으면 텍스트 번역처럼 'ko', 다른 언어 글자가 있으면 'other', 아니면 'en')
 * @returns {'en'|'ko'|'other'}
 */
export function scanLang(r) {
  if (LANGS.includes(r?.sourceLang)) return r.sourceLang;
  return guessLang(r?.original);
}

/**
 * 텍스트 번역 방향. 텍스트 번역은 한국어 ↔ 영어만 고를 수 있어서, 한국어가 아니면 모두 '영어 → 한국어'로 번역한다
 * (Gemini는 일본어·베트남어 등 다른 언어도 한국어로 옮긴다).
 * @param {'en'|'ko'|'other'|string} lang
 */
export function textDirection(lang) {
  return lang === 'ko' ? { from: 'ko', to: 'en' } : { from: 'en', to: 'ko' };
}

/**
 * 번역 기록에 넣을 항목. 텍스트 번역 기록과 같은 모양({source, result, from, to})에 스캔 표시(photo)를 더한다.
 * from은 원문 언어 그대로 ('en'|'ko'|'other'). 영어도 한국어도 아닌 글(other)을 영어로 적지 않는다.
 * 기록을 누르면 원문을 다시 번역하므로(textDirection 방향) 원문은 남기고, 번역은 짧은 미리 보기만 남긴다.
 * 저작권 때문에 원문 대신 요약을 받았거나 글자가 없으면 넣지 않는다 (null).
 */
export function scanHistoryItem(r) {
  if (r?.paraphrased) return null;
  const source = str(r?.original).slice(0, HISTORY_SOURCE_MAX);
  if (!source) return null;
  const from = scanLang(r);
  const all = str(r?.translation).replace(/\s+/g, ' ');
  const result = all.length > HISTORY_PREVIEW_MAX ? `${all.slice(0, HISTORY_PREVIEW_MAX - 1)}…` : all;
  return { source, result, from, to: textDirection(from).to, photo: true };
}

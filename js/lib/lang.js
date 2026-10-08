// 언어 판별·텍스트 분할 등 DOM 없이 동작하는 순수 함수 모음

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const LATIN = /[A-Za-z]/;

/** 한글이 하나라도 있으면 'ko', 영문자가 있으면 'en', 둘 다 없으면 null */
export function detectLang(text) {
  const s = String(text || '');
  if (HANGUL.test(s)) return 'ko';
  if (LATIN.test(s)) return 'en';
  return null;
}

export function otherLang(lang) {
  return lang === 'ko' ? 'en' : 'ko';
}

/** 사전 검색어로 쓸 만한 짧은 단어/구인지 (공백 기준 4어절 이하, 문장부호 없음) */
export function isLookupTerm(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 40) return false;
  if (/[.!?。,;:"“”]/.test(s)) return false;
  return s.split(/\s+/).length <= 4;
}

/** 검색어 정리: 앞뒤 공백·따옴표·문장부호 제거, 연속 공백 축소 */
export function normalizeTerm(text) {
  return String(text || '')
    .trim()
    .replace(/^[\s"'“”‘’(\[{<]+|[\s"'“”‘’)\]}>.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

const encoder = new TextEncoder();
export function utf8Length(s) {
  return encoder.encode(s).length;
}

/**
 * 번역 API의 요청 크기 제한(바이트)에 맞게 텍스트를 나눈다.
 * 문장 → 단어 → 글자 순서로 경계를 찾아 자르며, 이어 붙이면 원문과 같은 내용이 된다(공백 정규화 제외).
 */
export function splitForTranslation(text, maxBytes = 480) {
  const src = String(text || '').trim();
  if (!src) return [];
  if (utf8Length(src) <= maxBytes) return [src];

  const sentences = src.match(/[^.!?。！？\n]+[.!?。！？]*[\s\n]*|[\n]+/g) || [src];
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  const addPiece = (piece) => {
    if (utf8Length(cur + piece) <= maxBytes) {
      cur += piece;
      return;
    }
    push();
    if (utf8Length(piece) <= maxBytes) {
      cur = piece;
      return;
    }
    // 한 문장이 너무 길면 단어 단위로
    for (const word of piece.split(/(\s+)/)) {
      if (utf8Length(cur + word) <= maxBytes) {
        cur += word;
        continue;
      }
      push();
      if (utf8Length(word) <= maxBytes) {
        cur = word;
        continue;
      }
      // 공백 없는 아주 긴 덩어리는 글자 단위로
      for (const ch of word) {
        if (utf8Length(cur + ch) > maxBytes) push();
        cur += ch;
      }
    }
  };
  for (const s of sentences) addPiece(s);
  push();
  return chunks;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** &amp; &#39; &#x27; 같은 HTML 엔티티를 문자로 바꾼다 */
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = ENTITIES[code.toLowerCase()];
    return v ?? m;
  });
}

/** HTML 태그를 제거하고 엔티티를 풀어 순수 텍스트로 만든다 */
export function stripHtml(s) {
  return decodeEntities(
    String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 변화형 단어의 원형 후보 (사전에 없을 때 차례로 찾아본다). 첫 항목은 소문자로 바꾼 원래 단어.
 * 예: stopped → [stopped, stop, stoppe, stopp], studies → [studies, study, studie]
 */
export function lemmaCandidates(word) {
  const w = String(word || '')
    .toLowerCase()
    .replace(/’/g, "'");
  const out = [w];
  const add = (x) => {
    if (x && x.length >= 2 && !out.includes(x)) out.push(x);
  };
  add(w.replace(/'s$/, ''));
  if (/ies$/.test(w)) add(w.replace(/ies$/, 'y'));
  if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) add(w.replace(/es$/, ''));
  if (/[^s']s$/.test(w)) add(w.replace(/s$/, ''));
  if (/ied$/.test(w)) add(w.replace(/ied$/, 'y'));
  if (/([b-df-hj-np-tv-z])\1(ed|ing)$/.test(w)) add(w.replace(/([b-df-hj-np-tv-z])\1(ed|ing)$/, '$1'));
  if (/ed$/.test(w)) {
    add(w.replace(/d$/, ''));
    add(w.replace(/ed$/, ''));
  }
  if (/ing$/.test(w)) {
    add(w.replace(/ing$/, ''));
    add(w.replace(/ing$/, 'e'));
  }
  return out.slice(0, 4);
}

/** 영어 문장을 단어/비단어 토큰으로 나눈다 (단어 탭 사전에 사용) */
export function tokenizeEnglish(text) {
  const out = [];
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ word: false, text: text.slice(last, m.index) });
    out.push({ word: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ word: false, text: text.slice(last) });
  return out;
}

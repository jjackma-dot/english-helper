// 자막 파일(SRT, WebVTT, SAMI/SMI, TTML/DFXP) 파서와 시간 구간 조회 함수
// 모든 함수는 DOM 없이 동작한다. Cue = { start: 초, end: 초, text: 문자열 }

import { decodeEntities, detectLang } from './lang.js';

export const SUBTITLE_ACCEPT = '.srt,.vtt,.smi,.sami,.ttml,.dfxp,.xml,.txt';

/** 파일 바이트를 문자열로. BOM → UTF-8 → EUC-KR(CP949) 순으로 시도한다 (국내 SMI 자막은 대부분 CP949) */
export function decodeSubtitleBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

export function detectFormat(text, fileName = '') {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'smi' || ext === 'sami') return 'smi';
  if (ext === 'ttml' || ext === 'dfxp') return 'ttml';
  const head = text.slice(0, 4000);
  if (/^﻿?\s*WEBVTT/.test(head)) return 'vtt';
  if (/<sami[\s>]|<sync\s/i.test(head)) return 'smi';
  if (/<tt[\s>]|xmlns="http:\/\/www\.w3\.org\/ns\/ttml/i.test(head)) return 'ttml';
  if (/-->/.test(head)) return 'srt';
  return null;
}

/** "01:02:03,456", "02:03.4", "1:02:03.456" → 초 */
export function parseTimestamp(str) {
  const m = String(str)
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const [, h, mm, ss, frac] = m;
  const ms = frac ? parseInt(frac.padEnd(3, '0'), 10) : 0;
  return (+h || 0) * 3600 + +mm * 60 + +ss + ms / 1000;
}

/** 자막 텍스트의 서식 태그·ASS 태그를 지우고 줄바꿈을 정리한다 */
export function cleanCueText(raw) {
  return decodeEntities(
    String(raw)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const TIME_LINE = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/;

/** SRT와 WebVTT 공통 파서 (시간 줄을 기준으로 블록을 읽는다) */
export function parseSrtOrVtt(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(TIME_LINE);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    i++;
    const body = [];
    while (i < lines.length && lines[i].trim() !== '' && !TIME_LINE.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    // 빈 줄이 빠진 잘못된 SRT: 다음 큐의 번호 줄이 본문에 섞이는 것을 막는다
    if (i < lines.length && TIME_LINE.test(lines[i]) && /^\d+$/.test(body[body.length - 1]?.trim() || '')) {
      body.pop();
    }
    const cueText = cleanCueText(body.join('\n'));
    if (cueText && Number.isFinite(start) && Number.isFinite(end)) {
      cues.push({ start, end: Math.max(end, start + 0.1), text: cueText });
    }
  }
  return sortCues(cues);
}

/** SAMI(.smi) 파서. 언어 클래스(ENCC, KRCC 등)별로 트랙을 나눈다 */
export function parseSmi(text) {
  const src = text.replace(/\r\n?/g, '\n');
  const bodyStart = src.search(/<body[^>]*>/i);
  const body = bodyStart >= 0 ? src.slice(bodyStart) : src;
  const syncRe = /<sync\b([^>]*)>/gi;
  const syncs = [];
  let m;
  while ((m = syncRe.exec(body))) {
    const startMs = m[1].match(/start\s*=\s*["']?(-?\d+)/i);
    if (!startMs) continue;
    syncs.push({ time: parseInt(startMs[1], 10) / 1000, from: m.index + m[0].length, tagStart: m.index });
  }
  const events = new Map(); // className → [{time, text}]
  for (let s = 0; s < syncs.length; s++) {
    const end = s + 1 < syncs.length ? syncs[s + 1].tagStart : body.length;
    let chunk = body.slice(syncs[s].from, end).replace(/<\/?(?:body|sami)[^>]*>/gi, '');
    const parts = chunk.split(/<p\b([^>]*)>/i);
    // split 결과: [p 앞 텍스트, p1 속성, p1 내용, p2 속성, p2 내용, ...]
    const pieces = [];
    if (parts.length === 1) pieces.push(['DEFAULT', parts[0]]);
    else {
      if (parts[0].replace(/<[^>]*>/g, '').trim()) pieces.push(['DEFAULT', parts[0]]);
      for (let k = 1; k < parts.length; k += 2) {
        const cls = parts[k].match(/class\s*=\s*["']?([\w-]+)/i)?.[1] || 'DEFAULT';
        pieces.push([cls.toUpperCase(), parts[k + 1] || '']);
      }
    }
    for (const [cls, content] of pieces) {
      const cleaned = cleanCueText(content.replace(/<\/p>/gi, ''));
      if (!events.has(cls)) events.set(cls, []);
      events.get(cls).push({ time: syncs[s].time, text: cleaned });
    }
  }
  const tracks = [];
  for (const [cls, evs] of events) {
    const cues = [];
    for (let i = 0; i < evs.length; i++) {
      if (!evs[i].text) continue;
      const next = evs.slice(i + 1).find((e) => e.time > evs[i].time);
      const endTime = next ? next.time : evs[i].time + 4;
      cues.push({ start: evs[i].time, end: Math.min(endTime, evs[i].time + 15), text: evs[i].text });
    }
    if (cues.length) tracks.push({ id: cls, lang: guessTrackLang(cls, cues), cues: sortCues(mergeSameCues(cues)) });
  }
  return tracks;
}

function guessTrackLang(className, cues) {
  if (/^(EN|EG|ENG|ENUS|ENGB)/i.test(className)) return 'en';
  if (/^(KR|KO|KOR)/i.test(className)) return 'ko';
  return guessLangFromCues(cues);
}

export function guessLangFromCues(cues) {
  const sample = cues
    .slice(0, 60)
    .map((c) => c.text)
    .join(' ');
  const hangul = (sample.match(/[가-힯]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (hangul === 0 && latin === 0) return 'unknown';
  return hangul * 2 >= latin ? 'ko' : 'en';
}

/** 같은 내용이 연달아 이어지는 큐(SMI에서 흔함)를 하나로 합친다 */
function mergeSameCues(cues) {
  const out = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.text === c.text && Math.abs(prev.end - c.start) < 0.05) prev.end = c.end;
    else out.push({ ...c });
  }
  return out;
}

/** TTML/DFXP 시간 표현식 → 초 */
export function parseTtmlTime(expr, { tickRate = 1, frameRate = 30 } = {}) {
  const s = String(expr || '').trim();
  let m;
  if ((m = s.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/))) {
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? parseFloat('0.' + m[4]) : 0);
  }
  if ((m = s.match(/^(\d+):(\d{2}):(\d{2}):(\d+(?:\.\d+)?)$/))) {
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + parseFloat(m[4]) / frameRate;
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/))) {
    const v = parseFloat(m[1]);
    switch (m[2]) {
      case 'h':
        return v * 3600;
      case 'm':
        return v * 60;
      case 's':
        return v;
      case 'ms':
        return v / 1000;
      case 'f':
        return v / frameRate;
      case 't':
        return v / tickRate;
    }
  }
  return NaN;
}

/** TTML/DFXP(넷플릭스 자막 형식 등) 파서 */
export function parseTtml(text) {
  const attr = (name) => text.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i'))?.[1];
  const frameRate = parseFloat(attr('ttp:frameRate')) || 30;
  const mult = attr('ttp:frameRateMultiplier');
  const effFrameRate = mult ? (frameRate * +mult.split(/\s+/)[0]) / +mult.split(/\s+/)[1] : frameRate;
  const subFrameRate = parseFloat(attr('ttp:subFrameRate')) || 1;
  const tickRate = parseFloat(attr('ttp:tickRate')) || (attr('ttp:frameRate') ? frameRate * subFrameRate : 1);
  const opts = { tickRate, frameRate: effFrameRate };
  const lang = (text.match(/<tt\b[^>]*xml:lang\s*=\s*"([^"]+)"/i)?.[1] || '').toLowerCase();

  const cues = [];
  const pRe = /<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p>/gi;
  let m;
  while ((m = pRe.exec(text))) {
    const attrs = m[1];
    const get = (n) => attrs.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*"([^"]+)"`, 'i'))?.[1];
    const begin = parseTtmlTime(get('begin'), opts);
    let end = parseTtmlTime(get('end'), opts);
    const dur = parseTtmlTime(get('dur'), opts);
    if (!Number.isFinite(end) && Number.isFinite(begin) && Number.isFinite(dur)) end = begin + dur;
    if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
    const cueText = cleanCueText(m[2]);
    if (cueText) cues.push({ start: begin, end: Math.max(end, begin + 0.1), text: cueText });
  }
  const sorted = sortCues(cues);
  const guessed = lang.startsWith('ko') ? 'ko' : lang.startsWith('en') ? 'en' : guessLangFromCues(sorted);
  return { lang: guessed, cues: sorted };
}

/**
 * 자막 파일 내용 → { format, tracks: [{ id, lang, cues }] }
 * 지원하지 않는 형식이거나 대사가 하나도 없으면 Error를 던진다.
 */
export function parseSubtitles(text, fileName = '') {
  const format = detectFormat(text, fileName);
  let tracks = [];
  if (format === 'srt' || format === 'vtt') {
    const cues = parseSrtOrVtt(text);
    tracks = [{ id: format.toUpperCase(), lang: guessLangFromCues(cues), cues }];
  } else if (format === 'smi') {
    tracks = parseSmi(text);
  } else if (format === 'ttml') {
    const { lang, cues } = parseTtml(text);
    tracks = [{ id: 'TTML', lang, cues }];
  } else {
    throw new Error('지원하지 않는 자막 형식입니다. SRT, VTT, SMI, TTML(DFXP) 파일을 사용하세요.');
  }
  tracks = tracks.filter((t) => t.cues.length);
  if (!tracks.length) throw new Error('자막 파일에서 대사를 찾지 못했습니다.');
  return { format, tracks };
}

export function sortCues(cues) {
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 영어 큐마다 시간이 겹치는 한국어 자막을 찾아 `ko` 필드로 붙인 새 배열을 돌려준다 */
export function pairTracks(enCues, koCues) {
  if (!koCues?.length) return enCues.map((c) => ({ ...c }));
  let from = 0;
  return enCues.map((c) => {
    while (from < koCues.length && koCues[from].end <= c.start - 30) from++;
    const matched = [];
    for (let i = from; i < koCues.length && koCues[i].start < c.end; i++) {
      const k = koCues[i];
      const overlap = Math.min(c.end, k.end) - Math.max(c.start, k.start);
      if (overlap <= 0) continue;
      const shorter = Math.min(c.end - c.start, k.end - k.start) || 1;
      if (overlap / shorter >= 0.3) matched.push(k.text);
    }
    return matched.length ? { ...c, ko: [...new Set(matched)].join('\n') } : { ...c };
  });
}

/** start <= t 인 마지막 큐의 인덱스 (없으면 -1). cues는 start 기준 정렬되어 있어야 한다 */
export function lastStartedIndex(cues, t) {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 시각 t에 화면에 떠 있는 큐들 */
export function activeCues(cues, t) {
  const idx = lastStartedIndex(cues, t);
  const out = [];
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    if (cues[i].end > t) out.unshift(cues[i]);
  }
  return out;
}

/** [from, to] 구간에 조금이라도 걸치는 큐들 (시간순) */
export function cuesInRange(cues, from, to) {
  return cues.filter((c) => c.end > from && c.start < to);
}

/**
 * 되감기 시 보여줄 대사: 최근 `seconds`초 동안의 대사.
 * 그 구간이 대사 없이 조용했다면 직전 대사 `fallbackCount`개를 대신 돌려준다.
 */
export function reviewWindow(cues, t, seconds, fallbackCount = 2) {
  const inRange = cuesInRange(cues, t - seconds, t);
  if (inRange.length) return { cues: inRange, fallback: false };
  const idx = lastStartedIndex(cues, t);
  if (idx < 0) return { cues: [], fallback: true };
  return { cues: cues.slice(Math.max(0, idx - fallbackCount + 1), idx + 1), fallback: true };
}

export function pickTrack(tracks, lang) {
  return tracks.find((t) => t.lang === lang) || null;
}

// 기기 안에만 저장되는 데이터: 설정·단어장·기록(localStorage), 자막 보관함(IndexedDB)

import { DEFAULT_TUTOR_OPTIONS } from './lib/prompts.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const DEFAULT_SETTINGS = {
  geminiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  useGemini: true, // 키가 있을 때 사전·번역에 Gemini 사용
  myMemoryEmail: '', // 무료 번역 한도 상향(선택)
  voiceURI: '', // 영어 발음 음성 (빈 값이면 자동)
  ttsRate: 0.95,
  rewindSeconds: 10,
  ottShowKorean: true,
  ottHideEnglish: false,
  ottRate: 1,
  ottRewindClock: true, // 되감기 때 앱 시계도 함께 되돌림
  autoSpeakTranslation: false,
  tutor: { ...DEFAULT_TUTOR_OPTIONS },
};

const KEYS = {
  settings: 'eh.settings.v1',
  words: 'eh.wordbook.v1',
  dictHistory: 'eh.dictHistory.v1',
  translateHistory: 'eh.translateHistory.v1',
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- 설정 ---------- */

let settingsCache = null;

export function getSettings() {
  if (!settingsCache) {
    const saved = readJson(KEYS.settings, {});
    settingsCache = { ...DEFAULT_SETTINGS, ...saved, tutor: { ...DEFAULT_SETTINGS.tutor, ...(saved.tutor || {}) } };
  }
  return settingsCache;
}

export function updateSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  writeJson(KEYS.settings, settingsCache);
  window.dispatchEvent(new CustomEvent('settings-changed', { detail: patch }));
  return settingsCache;
}

export function geminiEnabled() {
  const s = getSettings();
  return Boolean(s.geminiKey && s.useGemini);
}

/* ---------- 단어장 ---------- */

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function listWords() {
  return readJson(KEYS.words, []);
}

/**
 * 단어/문장 저장. 같은 텍스트가 있으면 뜻·출처를 갱신하고 맨 위로 올린다.
 * @param {{text: string, meaning?: string, type?: 'word'|'sentence', source?: string, context?: string}} item
 */
export function addWord(item) {
  const text = String(item.text || '').trim();
  if (!text) return null;
  const words = listWords();
  const idx = words.findIndex((w) => w.text.toLowerCase() === text.toLowerCase());
  const prev = idx >= 0 ? words.splice(idx, 1)[0] : null;
  const entry = {
    id: prev?.id || newId(),
    text,
    meaning: String(item.meaning || prev?.meaning || '').trim(),
    type: item.type || prev?.type || (text.split(/\s+/).length > 4 ? 'sentence' : 'word'),
    source: item.source || prev?.source || '',
    context: item.context || prev?.context || '',
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  words.unshift(entry);
  writeJson(KEYS.words, words);
  window.dispatchEvent(new CustomEvent('words-changed'));
  return entry;
}

export function hasWord(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase();
  return listWords().some((w) => w.text.toLowerCase() === t);
}

export function removeWord(id) {
  writeJson(
    KEYS.words,
    listWords().filter((w) => w.id !== id)
  );
  window.dispatchEvent(new CustomEvent('words-changed'));
}

/** 백업 파일(JSON)에서 단어장 합치기. 추가된 개수를 돌려준다 */
export function importWords(data) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
  if (!items) throw new Error('단어장 백업 파일 형식이 아닙니다.');
  const words = listWords();
  const known = new Set(words.map((w) => w.text.toLowerCase()));
  let added = 0;
  for (const it of items) {
    const text = String(it?.text || '').trim();
    if (!text || known.has(text.toLowerCase())) continue;
    words.push({
      id: newId(),
      text,
      meaning: String(it.meaning || ''),
      type: it.type === 'sentence' ? 'sentence' : 'word',
      source: String(it.source || ''),
      context: String(it.context || ''),
      createdAt: Number(it.createdAt) || Date.now(),
      updatedAt: Date.now(),
    });
    known.add(text.toLowerCase());
    added++;
  }
  writeJson(KEYS.words, words);
  window.dispatchEvent(new CustomEvent('words-changed'));
  return added;
}

/* ---------- 기록 ---------- */

export function getDictHistory() {
  return readJson(KEYS.dictHistory, []);
}

export function pushDictHistory(term) {
  const t = String(term).trim();
  if (!t) return;
  const list = getDictHistory().filter((x) => x.toLowerCase() !== t.toLowerCase());
  list.unshift(t);
  writeJson(KEYS.dictHistory, list.slice(0, 20));
}

export function clearDictHistory() {
  writeJson(KEYS.dictHistory, []);
}

export function getTranslateHistory() {
  return readJson(KEYS.translateHistory, []);
}

export function pushTranslateHistory(item) {
  const list = getTranslateHistory().filter((x) => x.source !== item.source || x.to !== item.to);
  list.unshift({ ...item, at: Date.now() });
  writeJson(KEYS.translateHistory, list.slice(0, 50));
}

export function clearTranslateHistory() {
  writeJson(KEYS.translateHistory, []);
}

export function clearAllData() {
  for (const k of Object.values(KEYS)) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 무시 */
    }
  }
  settingsCache = null;
  return clearSubtitles();
}

/* ---------- 자막 보관함 (IndexedDB) ---------- */

const DB_NAME = 'english-helper';
const STORE = 'subtitles';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('저장소 작업이 취소되었습니다.'));
  });
}

/** @param {{title: string, cues: Array, files: string[]}} rec */
export async function saveSubtitle(rec) {
  const item = { id: rec.id || newId(), addedAt: Date.now(), position: 0, offset: 0, ...rec, openedAt: Date.now() };
  await tx('readwrite', (s) => s.put(item));
  return item;
}

export async function getSubtitle(id) {
  return tx('readonly', (s) => s.get(id));
}

/** 목록용 요약 (대사 배열 제외), 최근 연 순서 */
export async function listSubtitles() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all
    .map(({ cues, ...meta }) => ({ ...meta, cueCount: cues?.length || 0 }))
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

export async function updateSubtitle(id, patch) {
  const cur = await getSubtitle(id);
  if (!cur) return;
  await tx('readwrite', (s) => s.put({ ...cur, ...patch }));
}

export async function deleteSubtitle(id) {
  await tx('readwrite', (s) => s.delete(id));
}

async function clearSubtitles() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* 무시 */
  }
}

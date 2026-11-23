// 기기 안에만 저장되는 데이터: 설정·단어장·기록(localStorage), 자막 보관함(IndexedDB)

import { DEFAULT_TUTOR_OPTIONS } from './lib/prompts.js';
import { FAST_MODEL, LEGACY_DEFAULT_MODELS } from './lib/gemini-policy.js';
import { clearAiCache } from './services/ai-cache.js';
import { clearSharedPhotos } from './services/photo-file.js';

export const DEFAULT_GEMINI_MODEL = FAST_MODEL;

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
  ottListenSeconds: 20, // "방금 뭐라고?"로 보낼 최근 구간(초)
  autoSpeakTranslation: false,
  voiceBargeIn: true, // 음성 튜터 "말로 끊기": 튜터가 말하는 중에 내가 말하면 멈춘다 (스피커일 때는 메아리를 걸러 내 목소리만 알아챔)
  voiceMediaVolume: true, // 음성 튜터 "미디어 음량으로 듣기"(안드로이드): 에코 제거를 끈 마이크로 들어 통화 모드가 되지 않게 (볼륨 버튼 = 미디어 음량)
  tutor: { ...DEFAULT_TUTOR_OPTIONS },
  azureKey: '', // 레벨테스트 발음 평가 (Azure AI Speech, 무료 F0 등급)
  azureRegion: 'koreacentral',
  levelTaker: '', // 레벨테스트에서 마지막으로 고른 응시자·난이도
  levelLevel: 'normal',
};

const KEYS = {
  settings: 'eh.settings.v1',
  words: 'eh.wordbook.v1',
  dictHistory: 'eh.dictHistory.v1',
  translateHistory: 'eh.translateHistory.v1',
  levelTests: 'eh.levelTests.v1',
  azureUsage: 'eh.azureUsage.v1',
  game: 'eh.game.v1', // 영어 게임 진행 (이 폰)
  gamePrefs: 'eh.gamePrefs.v1',
  gameLog: 'eh.gameLog.v1', // 끝낸 미션 기록
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
    // 예전 기본 모델(생각 단계가 길어 느림)이 저장돼 있으면 빠른 기본 모델로 바꾼다
    if (LEGACY_DEFAULT_MODELS.includes(saved.geminiModel)) saved.geminiModel = DEFAULT_GEMINI_MODEL;
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

export function azureEnabled() {
  const s = getSettings();
  return Boolean(s.azureKey && s.azureRegion);
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

/* ---------- 레벨테스트 결과 (최근 것부터, 녹음은 남기지 않는다) · Azure 사용량 (이 기기, 이번 달) ---------- */

/** @returns {{month: string, seconds: number}} 이 기기에서 Azure로 보낸 음성 시간 */
export function getAzureUsage() {
  const u = readJson(KEYS.azureUsage, {});
  return { month: String(u?.month ?? ''), seconds: Math.max(0, Number(u?.seconds) || 0) };
}

/** 보낸 음성 시간을 더한다 (달이 바뀌면 처음부터) */
export function addAzureUsage(seconds, month) {
  const u = getAzureUsage();
  const next = u.month === month ? u.seconds + seconds : seconds;
  writeJson(KEYS.azureUsage, { month, seconds: Math.max(0, next) });
}

export function getLevelTests() {
  const list = readJson(KEYS.levelTests, []);
  return Array.isArray(list) ? list : [];
}

/** 결과를 넣거나(같은 at이면) 바꾼다 */
export function saveLevelTest(result) {
  const list = getLevelTests().filter((x) => x.at !== result.at);
  list.unshift(result);
  list.sort((a, b) => b.at - a.at);
  writeJson(KEYS.levelTests, list.slice(0, 20));
}

/* ---------- 영어 게임 (진행·설정·끝낸 기록, 이 기기에만) ---------- */

export function getGameSave() {
  const save = readJson(KEYS.game, null);
  return save && save.v === 1 && typeof save.code === 'string' ? save : null;
}

export function setGameSave(save) {
  if (save) writeJson(KEYS.game, save);
  else {
    try {
      localStorage.removeItem(KEYS.game);
    } catch {
      /* 무시 */
    }
  }
}

const GAME_PREFS = { sound: true, glow: true, autoRead: true, timer: true, team: [] };

export function getGamePrefs() {
  return { ...GAME_PREFS, ...readJson(KEYS.gamePrefs, {}) };
}

export function updateGamePrefs(patch) {
  const p = { ...getGamePrefs(), ...patch };
  writeJson(KEYS.gamePrefs, p);
  return p;
}

export function getGameLog() {
  const list = readJson(KEYS.gameLog, []);
  return Array.isArray(list) ? list : [];
}

export function addGameLog(entry) {
  const list = getGameLog().filter((x) => x.at !== entry.at);
  list.unshift(entry);
  writeJson(KEYS.gameLog, list.slice(0, 20));
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
  for (const k of ['eh.geminiCooldown.v1', 'eh.liveBlocked.v1']) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 무시 */
    }
  }
  return Promise.all([clearSubtitles(), clearAiCache(), clearSharedPhotos()]);
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

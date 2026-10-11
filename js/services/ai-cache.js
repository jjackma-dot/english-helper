// AI 결과 보관함 (IndexedDB, 이 기기에만 저장): 같은 단어·대사를 다시 찾으면 바로 보여 주고 무료 한도도 아낀다.
// 저장소를 쓸 수 없으면(사생활 보호 모드 등) 조용히 건너뛴다.

const DB_NAME = 'eh-ai-cache';
const STORE = 'entries';
const TTL_MS = 180 * 24 * 3600 * 1000;
const MAX_ENTRIES = 3000;

const memory = new Map();
const inflight = new Map();
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'k' });
          store.createIndex('ts', 'ts');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** 보관함 열쇠: 종류 + 소문자로 정리한 내용 */
export function cacheKey(kind, ...parts) {
  return `${kind}:${parts.map((p) => String(p ?? '').trim().replace(/\s+/g, ' ').toLowerCase()).join('|')}`;
}

export async function getCached(key) {
  if (memory.has(key)) return memory.get(key);
  const db = await openDb();
  if (!db) return undefined;
  const row = await tx(db, 'readonly', (s) => s.get(key));
  if (!row || Date.now() - row.ts > TTL_MS) return undefined;
  memory.set(key, row.value);
  return row.value;
}

export async function setCached(key, value) {
  memory.set(key, value);
  const db = await openDb();
  if (!db) return;
  await tx(db, 'readwrite', (s) => s.put({ k: key, value, ts: Date.now() }));
  prune(db);
}

let pruning = false;
async function prune(db) {
  if (pruning) return;
  pruning = true;
  try {
    const count = await tx(db, 'readonly', (s) => s.count());
    if (count > MAX_ENTRIES) {
      await tx(db, 'readwrite', (s) => {
        let toDelete = count - MAX_ENTRIES;
        const cur = s.index('ts').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || toDelete-- <= 0) return;
          c.delete();
          c.continue();
        };
      });
    }
  } finally {
    pruning = false;
  }
}

/**
 * 보관함에 있으면 그것을, 없으면 make()로 만들어 저장한다. 같은 열쇠의 동시 요청은 하나로 합친다.
 * @param {string} key
 * @param {() => Promise<any>} make
 * @param {{fresh?: boolean}} [opts] fresh: 보관함을 건너뛰고 새로 만든다
 * @returns {Promise<{value: any, cached: boolean}>}
 */
export async function cached(key, make, { fresh = false } = {}) {
  if (!fresh) {
    const hit = await getCached(key);
    if (hit !== undefined) return { value: hit, cached: true };
  }
  if (inflight.has(key)) return { value: await inflight.get(key), cached: false };
  const p = (async () => {
    const value = await make();
    await setCached(key, value);
    return value;
  })();
  inflight.set(key, p);
  try {
    return { value: await p, cached: false };
  } finally {
    inflight.delete(key);
  }
}

/** 모든 AI 결과 지우기 (설정 → 모든 데이터 지우기) */
export async function clearAiCache() {
  memory.clear();
  const db = await openDb();
  if (db) await tx(db, 'readwrite', (s) => s.clear());
}

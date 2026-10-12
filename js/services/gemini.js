// Google Gemini API (사용자가 설정에 키를 넣은 경우에만 사용). 키는 이 기기에만 저장된다.
// 응답은 스트리밍으로 받아 첫 글자부터 보여 줄 수 있고, 일시 오류·한도 초과 때는 잠시 뒤 다시 하거나 다른 모델로 넘어간다.

import { getSettings, DEFAULT_GEMINI_MODEL } from '../store.js';
import { geminiErrorMessage, parseJsonLoose } from '../lib/api-parse.js';
import { parsePartialJson } from '../lib/partial-json.js';
import {
  bareModel,
  chunkText,
  classifyGeminiError,
  modelChain,
  splitSse,
  thinkingFor,
} from '../lib/gemini-policy.js';

export const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const COOLDOWN_KEY = 'eh.geminiCooldown.v1';
const MAX_ATTEMPTS = 4; // 한 번 요청에 보내는 최대 네트워크 요청 수

export function apiKey() {
  return getSettings().geminiKey || '';
}

function modelPath(model) {
  return `models/${encodeURIComponent(bareModel(model || DEFAULT_GEMINI_MODEL))}`;
}

class GeminiHttpError extends Error {
  constructor(status, json) {
    super(geminiErrorMessage(status, json));
    this.name = 'GeminiHttpError';
    this.status = status;
    this.json = json;
  }
}

class GeminiTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeminiTimeoutError';
  }
}

/* ---------- 모델별 쉬는 시간 (한도 초과 시) ---------- */

/** @returns {Record<string, {until: number, daily: boolean}>} 아직 쉬는 중인 모델 */
function readCooldowns() {
  try {
    const all = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, c]) => c?.until > now));
  } catch {
    return {};
  }
}

function setCooldown(model, until, daily) {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify({ ...readCooldowns(), [bareModel(model)]: { until, daily } }));
  } catch {
    /* 저장 실패는 무시 */
  }
}

/** 가장 빨리 다시 쓸 수 있는 쉬는 기록 */
function soonestCooldown(list) {
  return list.reduce((a, b) => (!a || b.until < a.until ? b : a), null);
}

/** 모든 모델이 쉬는 중이면 가장 빨리 다시 쓸 수 있는 시각 */
export function quotaResumeTime() {
  const c = readCooldowns();
  const models = modelChain(getSettings().geminiModel);
  if (!models.length || !models.every((m) => c[m])) return null;
  return soonestCooldown(models.map((m) => c[m])).until;
}

function resumeText({ until, daily }) {
  const t = new Date(until).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return daily
    ? `오늘 무료 AI 사용 한도를 다 썼습니다. ${t}부터 다시 쓸 수 있고, 그동안은 무료 사전·번역으로 보여 드립니다.`
    : `AI 사용량이 잠시 많습니다. ${t}쯤 다시 시도하세요.`;
}

/* ---------- 신호(취소·시간 제한) ---------- */

function linkedController(signal) {
  const ctl = new AbortController();
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctl.abort(signal.reason), { once: true });
  }
  return ctl;
}

/** 다시 시도해도 결과가 같은 오류 (reason: 'RECITATION' | 'SAFETY') */
function finalError(message, reason) {
  const e = new Error(message);
  e.final = true;
  e.reason = reason;
  return e;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true }
    );
  });

/* ---------- 요청 ---------- */

async function call(path, { method = 'GET', body, signal, key } = {}) {
  const k = key ?? apiKey();
  if (!k) throw new Error('Gemini API 키가 설정되지 않았습니다. 설정에서 키를 입력하세요.');
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiHttpError(res.status, json);
  return json;
}

/**
 * streamGenerateContent 한 번. 첫 조각·조각 사이·전체 시간 제한을 둔다.
 * @returns {Promise<{text: string, finishReason: string, modelVersion: string, emitted: boolean}>}
 */
async function streamOnce(model, body, { signal, key, onText, firstChunkMs, idleMs, totalMs }) {
  const ctl = linkedController(signal);
  let timer = 0;
  let timeoutMsg = '';
  const arm = (ms, msg) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timeoutMsg = msg;
      ctl.abort();
    }, ms);
  };
  const totalTimer = setTimeout(() => {
    timeoutMsg = 'Gemini 응답이 너무 오래 걸립니다.';
    ctl.abort();
  }, totalMs);
  arm(firstChunkMs, 'Gemini가 응답하지 않습니다.');

  let text = '';
  let finishReason = '';
  let modelVersion = '';
  let emitted = false;
  try {
    const res = await fetch(`${BASE}/${modelPath(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new GeminiHttpError(res.status, json);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const handle = (data) => {
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      if (json.error) throw new GeminiHttpError(json.error.code || 500, json);
      const c = chunkText(json);
      if (c.blockReason) throw finalError('Gemini가 이 요청에 답하지 않았습니다(안전 필터).', 'SAFETY');
      modelVersion = json.modelVersion || modelVersion;
      if (c.finishReason) finishReason = c.finishReason;
      if (c.text) {
        text += c.text;
        emitted = true;
        onText?.(text);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm(idleMs, 'Gemini 응답이 중간에 멈췄습니다.');
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = splitSse(buf);
      buf = rest;
      for (const ev of events) handle(ev);
    }
    buf += decoder.decode();
    for (const ev of splitSse(`${buf}\n\n`).events) handle(ev);
    return { text, finishReason, modelVersion, emitted };
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timeoutMsg) {
      const err = new GeminiTimeoutError(timeoutMsg);
      err.emitted = emitted;
      err.partialText = text;
      throw err;
    }
    if (e && typeof e === 'object') {
      e.emitted = emitted;
      e.partialText = text;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    clearTimeout(totalTimer);
  }
}

/**
 * @param {{prompt?: string, parts?: object[], contents?: object[], system?: string, schema?: object, json?: boolean,
 *          signal?: AbortSignal, model?: string, key?: string, fallback?: boolean, maxOutputTokens?: number,
 *          onPartial?: (partial: any) => void, onMeta?: (meta: {model: string, modelVersion: string}) => void,
 *          firstChunkMs?: number, idleMs?: number, timeoutMs?: number}} o
 *   onPartial: 스트리밍 중 지금까지의 결과 (schema/json이면 덜 끝난 JSON을 읽은 객체, 아니면 텍스트)
 *   fallback: false면 지정한 모델만 쓴다 (연결 테스트용)
 * @returns {Promise<string|object>} json/schema가 있으면 파싱된 객체
 */
export async function generate(o) {
  const key = o.key ?? apiKey();
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 설정에서 키를 입력하세요.');
  const wantJson = Boolean(o.schema || o.json);
  const base = {
    contents: o.contents || [{ role: 'user', parts: o.parts || [{ text: o.prompt }] }],
    generationConfig: {},
  };
  if (o.system) base.systemInstruction = { parts: [{ text: o.system }] };
  if (wantJson) {
    base.generationConfig.responseMimeType = 'application/json';
    if (o.schema) base.generationConfig.responseSchema = o.schema;
  }
  if (o.maxOutputTokens) base.generationConfig.maxOutputTokens = o.maxOutputTokens;

  const preferred = o.model || getSettings().geminiModel || DEFAULT_GEMINI_MODEL;
  const cooldowns = readCooldowns();
  const chain =
    o.fallback === false ? [bareModel(preferred)] : modelChain(preferred, { cooled: (m) => Boolean(cooldowns[m]) });
  if (!chain.length) throw new Error(resumeText(soonestCooldown(Object.values(cooldowns))));

  const onText = o.onPartial
    ? (text) => {
        if (!wantJson) return o.onPartial(text);
        const partial = parsePartialJson(text);
        if (partial !== undefined) o.onPartial(partial);
      }
    : undefined;

  let attempts = 0;
  let lastError = null;
  let soonest = null; // 이번 요청에서 쉬게 된 모델 중 가장 빨리 돌아오는 것
  for (const model of chain) {
    let thinking = thinkingFor(model);
    let retried = false;
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const body = { ...base, generationConfig: { ...base.generationConfig } };
      if (thinking) body.generationConfig.thinkingConfig = thinking;
      try {
        const r = await streamOnce(model, body, {
          signal: o.signal,
          key,
          onText,
          firstChunkMs: o.firstChunkMs ?? 15000,
          idleMs: o.idleMs ?? 12000,
          totalMs: o.timeoutMs ?? 45000,
        });
        o.onMeta?.({ model, modelVersion: r.modelVersion || model });
        if (r.finishReason === 'RECITATION') {
          // 영화·드라마 대사처럼 저작권이 있는 글을 그대로 옮기는 것을 막았다
          throw finalError('저작권 보호 때문에 Gemini가 원문을 그대로 보여 주지 못했습니다.', 'RECITATION');
        }
        if (/SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(r.finishReason) && !r.text) {
          throw finalError('Gemini가 이 요청에 답하지 않았습니다(안전 필터).', 'SAFETY');
        }
        if (!wantJson) return r.text;
        try {
          return parseJsonLoose(r.text);
        } catch (e) {
          // 출력 한도에 걸려 잘렸으면 읽을 수 있는 데까지라도 돌려준다
          const partial = parsePartialJson(r.text);
          if (r.finishReason === 'MAX_TOKENS' && partial !== undefined) return partial;
          throw e;
        }
      } catch (e) {
        if (e.name === 'AbortError' || e.final) throw e;
        lastError = e;
        // 이미 화면에 일부가 나간 뒤 끊기면 같은 내용을 다시 받느라 한도를 쓰지 않고 오류로 알린다
        if (e.emitted) throw e;
        if (e instanceof GeminiHttpError) {
          const c = classifyGeminiError(e.status, e.json);
          if (c.action === 'fatal') throw e;
          if (c.action === 'no-thinking' && thinking) {
            thinking = undefined;
            continue;
          }
          if (c.action === 'retry' && !retried) {
            retried = true;
            await sleep(c.waitMs + Math.floor(Math.random() * 700), o.signal);
            continue;
          }
          if (c.action === 'cooldown') {
            setCooldown(model, c.until, Boolean(c.daily));
            soonest = soonestCooldown([soonest, { until: c.until, daily: Boolean(c.daily) }].filter(Boolean));
          }
          break; // 다음 모델
        }
        // 시간 초과·네트워크 오류: 같은 모델로 한 번 더, 그다음 모델
        if (!retried) {
          retried = true;
          await sleep(600, o.signal);
          continue;
        }
        break;
      }
    }
    if (attempts >= MAX_ATTEMPTS) break;
  }
  if (lastError instanceof GeminiHttpError && lastError.status === 429 && soonest) {
    throw new Error(resumeText(soonest));
  }
  if (lastError instanceof TypeError) {
    throw new Error('Gemini에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
  }
  throw lastError || new Error('Gemini가 응답하지 않습니다. 잠시 후 다시 시도하세요.');
}

/** 이 키로 쓸 수 있는 텍스트 생성 모델 이름 목록 */
export async function listModels(key) {
  const names = [];
  let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const json = await call(`models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      key,
    });
    for (const m of json.models || []) {
      if ((m.supportedGenerationMethods || []).includes('generateContent')) {
        names.push(m.name.replace(/^models\//, ''));
      }
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return names;
}

/** 스키마 작성용 짧은 표기. 객체 키는 적은 순서대로 나오게 한다 (지정하지 않으면 Gemini가 알파벳순으로 쓴다) */
export const S = {
  str: (description) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  arr: (items, description) => ({ type: 'ARRAY', items, ...(description ? { description } : {}) }),
  obj: (properties, required = Object.keys(properties)) => ({
    type: 'OBJECT',
    properties,
    required,
    propertyOrdering: Object.keys(properties),
  }),
};

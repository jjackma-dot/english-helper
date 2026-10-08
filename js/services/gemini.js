// Google Gemini API (사용자가 설정에 키를 넣은 경우에만 사용). 키는 이 기기에만 저장된다.

import { getSettings, DEFAULT_GEMINI_MODEL } from '../store.js';
import { extractGeminiText, geminiErrorMessage, parseJsonLoose } from '../lib/api-parse.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function modelPath(model) {
  const name = String(model || DEFAULT_GEMINI_MODEL)
    .trim()
    .replace(/^models\//, '');
  return `models/${encodeURIComponent(name)}`;
}

async function call(path, { method = 'GET', body, signal, key } = {}) {
  const apiKey = key ?? getSettings().geminiKey;
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다. 설정에서 키를 입력하세요.');
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(geminiErrorMessage(res.status, json));
  return json;
}

/**
 * @param {{prompt?: string, parts?: object[], system?: string, schema?: object, json?: boolean,
 *          temperature?: number, signal?: AbortSignal, model?: string, key?: string}} o
 * @returns {Promise<string|object>} json/schema가 있으면 파싱된 객체
 */
export async function generate(o) {
  const body = {
    contents: [{ role: 'user', parts: o.parts || [{ text: o.prompt }] }],
    generationConfig: { temperature: o.temperature ?? 0.3 },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.schema || o.json) {
    body.generationConfig.responseMimeType = 'application/json';
    if (o.schema) body.generationConfig.responseSchema = o.schema;
  }
  const json = await call(`${modelPath(o.model || getSettings().geminiModel)}:generateContent`, {
    method: 'POST',
    body,
    signal: o.signal,
    key: o.key,
  });
  const text = extractGeminiText(json);
  return o.schema || o.json ? parseJsonLoose(text) : text;
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

/** 스키마 작성용 짧은 표기 */
export const S = {
  str: (description) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  arr: (items, description) => ({ type: 'ARRAY', items, ...(description ? { description } : {}) }),
  obj: (properties, required = Object.keys(properties)) => ({ type: 'OBJECT', properties, required }),
};

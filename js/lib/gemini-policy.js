// Gemini 호출 규칙 (순수 함수, 단위 테스트 대상): 모델 선택, 생각(thinking) 설정, 오류 분류, 스트림 해석

/** 빠른 응답용 기본 모델. 사전·번역·해설처럼 짧은 답에 쓴다 (무료 등급, 기본 생각 수준 minimal) */
export const FAST_MODEL = 'gemini-3.5-flash-lite';

/** 기본 모델이 한도에 걸리거나 일시 오류일 때 차례로 시도할 모델 (모델마다 무료 한도가 따로 있다) */
export const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

/** 예전 기본값. 생각 수준이 medium이라 느리므로 저장된 설정에 남아 있으면 FAST_MODEL로 바꾼다 */
export const LEGACY_DEFAULT_MODELS = ['gemini-flash-latest'];

export function bareModel(model) {
  return String(model || '')
    .trim()
    .replace(/^models\//, '');
}

/** 시도할 모델 순서: 설정한 모델 → 예비 모델 (중복·식는 중인 모델 제외) */
export function modelChain(preferred, { cooled = () => false } = {}) {
  const out = [];
  for (const m of [bareModel(preferred), ...FALLBACK_MODELS]) {
    if (m && !out.includes(m) && !cooled(m)) out.push(m);
  }
  return out;
}

/**
 * 모델별 생각 설정. 생각을 줄여야 첫 글자가 빨리 나온다.
 * - 2.5 계열은 thinkingBudget, 3.x 이후는 thinkingLevel (둘을 함께 보내면 400 오류)
 * - 3.7·3.8 Flash와 Pro는 'minimal'을 거부하므로 'low'
 * @returns {object|undefined} generationConfig.thinkingConfig
 */
export function thinkingFor(model) {
  const m = bareModel(model);
  if (/^gemini-2\.5-flash-lite/.test(m)) return undefined;
  if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  if (/^gemini-2\.5-pro/.test(m)) return undefined;
  if (/-live|tts|embedding|image/.test(m)) return undefined;
  if (/flash-lite|^gemma-4/.test(m)) return { thinkingLevel: 'minimal' };
  if (/^gemini-3(\.[056])?-flash(?!-lite)/.test(m)) return { thinkingLevel: 'minimal' };
  return { thinkingLevel: 'low' };
}

/** "44s", "44.09s", "1.5s", "500ms" → 밀리초 */
export function parseDuration(s) {
  const m = String(s || '').match(/^\s*([\d.]+)\s*(ms|s)?\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(m[2] === 'ms' ? n : n * 1000);
}

/** 429 응답에서 다시 시도까지 기다릴 시간(ms). RetryInfo가 없으면 메시지의 "Please retry in 56.18s"를 읽는다 */
export function retryDelayMs(json) {
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  for (const d of details) {
    if (String(d?.['@type'] || '').endsWith('google.rpc.RetryInfo')) {
      const ms = parseDuration(d.retryDelay);
      if (ms != null) return ms;
    }
  }
  const m = String(json?.error?.message || '').match(/retry in ([\d.]+)\s*(ms|s)\b/i);
  return m ? parseDuration(`${m[1]}${m[2]}`) : null;
}

/** 하루 한도(일일 쿼터) 초과인지 */
export function isDailyQuota(json) {
  const msg = String(json?.error?.message || '');
  if (/limit:\s*0\b/.test(msg)) return true;
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  return details.some((d) =>
    (d?.violations || []).some((v) => /PerDay|Daily/i.test(`${v?.quotaId || ''} ${v?.quotaMetric || ''}`))
  );
}

/** 다음 태평양 시간 자정(무료 일일 한도가 다시 채워지는 시각)의 epoch ms */
export function nextPacificMidnight(now = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const msIntoDay = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (now % 1000);
  // 서머타임 전환일에도 맞도록, 대략 계산한 뒤 현지 시각이 0시가 될 때까지 보정한다
  let t = now - msIntoDay + 24 * 3600 * 1000;
  for (let i = 0; i < 3; i++) {
    const q = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const off = ((Number(q.hour) * 60 + Number(q.minute)) * 60 + Number(q.second)) * 1000;
    if (off === 0) break;
    t -= off > 12 * 3600 * 1000 ? off - 24 * 3600 * 1000 : off;
  }
  return t;
}

/**
 * 오류를 보고 다음 행동을 정한다.
 * @returns {{action: 'retry'|'next'|'cooldown'|'no-thinking'|'fatal', waitMs?: number, until?: number, daily?: boolean}}
 *  retry: 같은 모델로 waitMs 뒤 한 번 더 / next: 다음 모델 / cooldown: until까지 이 모델을 쉬고 다음 모델 (daily: 일일 한도)
 *  no-thinking: 생각 설정을 빼고 같은 모델로 다시 / fatal: 다시 시도해도 소용없음(키 오류 등)
 */
export function classifyGeminiError(status, json, { now = Date.now() } = {}) {
  const msg = `${json?.error?.message || ''} ${JSON.stringify(json?.error?.details || '')}`;
  if (status === 400 && /thinking/i.test(msg)) return { action: 'no-thinking' };
  if (status === 429) {
    if (isDailyQuota(json)) return { action: 'cooldown', until: nextPacificMidnight(now), daily: true };
    const wait = retryDelayMs(json);
    if (wait != null && wait <= 3000) return { action: 'retry', waitMs: wait + 250 };
    return { action: 'cooldown', until: now + Math.min(Math.max(wait ?? 60000, 5000), 15 * 60000) };
  }
  if (status === 404) return { action: 'next' };
  if ([408, 500, 502, 503, 504].includes(status) || status === 0) return { action: 'retry', waitMs: 1000 };
  return { action: 'fatal' };
}

/**
 * SSE 버퍼를 사건(event) 단위로 나눈다.
 * @returns {{events: string[], rest: string}} events: 각 사건의 data 내용
 */
export function splitSse(buffer) {
  const events = [];
  let rest = buffer;
  for (;;) {
    const m = rest.match(/\r\n\r\n|\n\n|\r\r/);
    if (!m) break;
    const chunk = rest.slice(0, m.index);
    rest = rest.slice(m.index + m[0].length);
    const data = chunk
      .split(/\r\n|\n|\r/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

/** 스트림 조각 응답에서 본문 텍스트(생각 부분 제외)와 끝난 이유를 꺼낸다 */
export function chunkText(json) {
  const c = json?.candidates?.[0];
  const text = (c?.content?.parts || [])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  return { text, finishReason: c?.finishReason || '', blockReason: json?.promptFeedback?.blockReason || '' };
}

// 시간 표시/입력 변환

/** 초 → "h:mm:ss" 또는 "m:ss" (withTenths면 ".d" 추가) */
export function formatClock(seconds, { withTenths = false } = {}) {
  const neg = seconds < 0;
  let t = Math.abs(seconds);
  if (withTenths) t = Math.round(t * 10) / 10;
  else t = Math.floor(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const pad = (n) => String(n).padStart(2, '0');
  let out = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (withTenths) out += `.${Math.round((t - Math.floor(t)) * 10) % 10}`;
  return (neg ? '-' : '') + out;
}

/**
 * 사용자가 입력한 시간 문자열을 초로 바꾼다.
 * "1:02:03", "12:34", "754", "12:34.5", "1h2m3s", "12분 34초" 형식을 허용한다. 해석할 수 없으면 null.
 */
export function parseClock(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const unit = s.match(/^(?:(\d+)\s*(?:h|시간))?\s*(?:(\d+)\s*(?:m|분))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|초))?$/);
  if (unit && (unit[1] || unit[2] || unit[3])) {
    return (+unit[1] || 0) * 3600 + (+unit[2] || 0) * 60 + (+unit[3] || 0);
  }
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(s)) return null;
  const parts = s.split(':');
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (i > 0 && v >= 60) return null;
    total = total * 60 + v;
  }
  return total;
}

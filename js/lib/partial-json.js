// 스트리밍 중인(아직 덜 끝난) JSON을 닫아서 읽는다. AI 사전이 첫 뜻부터 바로 보이게 하는 데 쓴다.

/**
 * 덜 끝난 JSON 문자열의 열린 문자열·배열·객체를 닫아 준다.
 * 끝에 걸친 쉼표, 값이 없는 "키": , 끝나지 않은 \ 이스케이프는 잘라 낸다.
 */
export function closePartialJson(text) {
  const s = String(text || '');
  const start = s.search(/[[{]/);
  if (start < 0) return '';
  const stack = [];
  let inString = false;
  let escape = false;
  let out = '';
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return out; // 최상위 값이 끝났다 (뒤에 붙은 글은 버림)
    }
  }
  if (inString) {
    if (escape) out = out.slice(0, -1);
    // 끝나지 않은 \u 이스케이프 제거
    out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
    out += '"';
  }
  // 값이 오기 전에 끊긴 꼬리 정리: `,` / `"key":` / `"key"` (객체 안) / 끝나지 않은 숫자·리터럴
  for (;;) {
    const before = out;
    out = out.replace(/\s+$/, '');
    out = out.replace(/,$/, '');
    out = out.replace(/:\s*$/, ':null');
    if (stack[stack.length - 1] === '}') out = out.replace(/([{,])\s*"(?:[^"\\]|\\.)*"$/, '$1');
    out = out.replace(/:\s*(?:-|tr?u?|fa?l?s?|nu?l?)$/, ':null');
    out = out.replace(/:\s*-?\d+\.$/, (m) => m.slice(0, -1));
    if (out === before) break;
  }
  return out + stack.reverse().join('');
}

/** 덜 끝난 JSON을 최대한 읽는다. 읽을 수 없으면 undefined (절대 throw하지 않음) */
export function parsePartialJson(text) {
  try {
    const closed = closePartialJson(text);
    return closed ? JSON.parse(closed) : undefined;
  } catch {
    return undefined;
  }
}

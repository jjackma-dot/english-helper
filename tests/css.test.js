// 스타일 파일의 { } 짝이 맞는지 확인한다. (하나라도 안 닫히면 뒤의 규칙이 모두 그 안으로 들어가 적용되지 않는다)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('css/app.css의 중괄호 짝이 맞다', () => {
  const css = fs
    .readFileSync(path.join(root, 'css/app.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"]*"|'[^']*'/g, '');
  let depth = 0;
  css.split('\n').forEach((line, i) => {
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      assert.ok(depth >= 0, `${i + 1}번째 줄에서 닫는 괄호가 더 많습니다`);
    }
  });
  assert.equal(depth, 0, '닫히지 않은 { 가 있습니다');
});

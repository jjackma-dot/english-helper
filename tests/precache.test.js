// 서비스 워커가 미리 저장하는 파일 목록이 실제 앱 파일과 일치하는지 확인한다.
// (목록에서 빠진 파일은 오프라인·설치 상태에서 화면이 깨지는 원인이 된다)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.posix.join(dir, d.name);
    return d.isDirectory() ? walk(rel) : [rel];
  });
}

function precacheList() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('sw.js ASSETS에 앱 파일이 빠짐없이 들어 있다', () => {
  const assets = new Set(precacheList());
  const appFiles = [
    'index.html',
    'manifest.webmanifest',
    ...walk('css'),
    ...walk('js'),
    ...walk('icons'),
    ...walk('samples'),
  ];
  const missing = appFiles.filter((f) => !assets.has(f));
  assert.deepEqual(missing, [], `sw.js ASSETS에 추가하세요: ${missing.join(', ')}`);
});

test('sw.js ASSETS의 파일이 모두 실제로 있다', () => {
  const absent = precacheList().filter((f) => f !== './' && !fs.existsSync(path.join(root, f)));
  assert.deepEqual(absent, []);
});

test('manifest 아이콘·index.html이 참조하는 파일이 있다', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
    assert.ok(fs.existsSync(path.join(root, ref)), ref);
  }
});

test('배포 워크플로가 버전 표시를 바꾼다', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(wf, /__BUILD__/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'__BUILD__'/);
  assert.match(fs.readFileSync(path.join(root, 'js/version.js'), 'utf8'), /'__BUILD__'/);
});

test('모든 JS 모듈의 상대 import 경로가 실제 파일을 가리킨다', () => {
  for (const file of walk('js')) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, spec] of src.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/g)) {
      const target = path.join(root, path.dirname(file), spec);
      assert.ok(fs.existsSync(target), `${file} → ${spec}`);
    }
  }
});

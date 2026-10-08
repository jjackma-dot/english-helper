// 서비스 워커: 앱 파일을 미리 저장해 두고(오프라인 실행), 새 버전은 사용자가 "업데이트"를 누르면 적용한다.
// 외부 API 요청(사전·번역·이미지·Gemini)은 가로채지 않는다.

const VERSION = '__BUILD__'; // 배포 시 GitHub Actions가 바꾼다
const CACHE = `eh-${VERSION}`;

// 새 파일을 추가하면 여기에도 넣어야 한다 (tests/precache.test.js가 확인)
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/icons.js',
  'js/install.js',
  'js/speech.js',
  'js/store.js',
  'js/ui.js',
  'js/version.js',
  'js/components/word-sheet.js',
  'js/lib/api-parse.js',
  'js/lib/clock.js',
  'js/lib/lang.js',
  'js/lib/prompts.js',
  'js/lib/subtitles.js',
  'js/lib/timefmt.js',
  'js/lib/wav.js',
  'js/services/dictionary.js',
  'js/services/gemini.js',
  'js/services/recorder.js',
  'js/services/translate.js',
  'js/views/dictionary.js',
  'js/views/ott.js',
  'js/views/settings.js',
  'js/views/translate.js',
  'js/views/tutor.js',
  'js/views/wordbook.js',
  'js/worklets/pcm-recorder.js',
  'samples/sample-en.srt',
  'samples/sample-ko.srt',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('eh-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === `${scopePath}index.html`)) {
    // 공유받기(?text=…)·바로가기(#/dict) 등 앱 진입은 저장해 둔 index.html 하나로 처리
    event.respondWith(caches.match('index.html').then((cached) => cached || fetch(req)));
    return;
  }
  // ignoreSearch를 쓰면 크롬이 캐시 전체를 훑어 파일마다 수백 ms가 걸린다 (앱 파일 주소에는 ?…가 붙지 않는다)
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

// 서비스 워커: 앱 파일을 미리 저장해 두고(오프라인 실행), 새 버전은 사용자가 "업데이트"를 누르면 적용한다.
// 외부 API 요청(사전·번역·이미지·Gemini)은 가로채지 않는다. 다른 앱에서 공유한 글·사진(POST)은 여기서 받는다.

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
  'js/components/voice-tutor.js',
  'js/components/word-sheet.js',
  'js/lib/api-parse.js',
  'js/lib/barge-in.js',
  'js/lib/clock.js',
  'js/lib/dict-entry.js',
  'js/lib/gemini-policy.js',
  'js/lib/lang.js',
  'js/lib/live-protocol.js',
  'js/lib/partial-json.js',
  'js/lib/photo.js',
  'js/lib/prompts.js',
  'js/lib/ring.js',
  'js/lib/subtitles.js',
  'js/lib/timefmt.js',
  'js/lib/wav.js',
  'js/services/ai-cache.js',
  'js/services/dictionary.js',
  'js/services/gemini.js',
  'js/services/listen-buffer.js',
  'js/services/live.js',
  'js/services/photo-file.js',
  'js/services/recorder.js',
  'js/services/translate.js',
  'js/services/voice-fallback.js',
  'js/services/wake-lock.js',
  'js/views/dictionary.js',
  'js/views/ott-listen.js',
  'js/views/ott.js',
  'js/views/settings.js',
  'js/views/translate.js',
  'js/views/tutor.js',
  'js/views/wordbook.js',
  'js/worklets/pcm-recorder.js',
  'js/worklets/pcm16-capture.js',
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

// 다른 앱에서 "공유 → English Helper"(manifest share_target, POST). GitHub Pages는 POST를 못 받으므로 여기서 받는다.
// 사진은 잠시 share-inbox에 넣고 번역 화면으로 보내고(화면이 꺼내면서 지운다), 글은 예전처럼 ./?text=…로 넘긴다.
// share-inbox는 'eh-'로 시작하지 않아야 새 버전을 켤 때(activate) 지워지지 않는다 (js/services/photo-file.js와 같은 이름)
const SHARE_INBOX = 'share-inbox';

async function receiveShare(req) {
  const scope = self.registration.scope;
  try {
    const form = await req.formData();
    const photo = form.getAll('image').find((f) => typeof f !== 'string' && f.size > 0);
    if (photo) {
      const key = new URL('shared-photo', scope).href;
      try {
        const inbox = await caches.open(SHARE_INBOX);
        await inbox.put(key, new Response(photo, { headers: { 'X-File-Name': encodeURIComponent(photo.name || '') } }));
      } catch {
        // 저장 공간이 모자라(QuotaExceededError) 넣지 못했다. 그래도 사진 번역 화면으로 보내
        // "공유받은 사진을 찾지 못했습니다. 다시 공유해 주세요."를 보여 준다 (예전에 남은 사진이 대신 나오지 않게 지운다)
        try {
          await (await caches.open(SHARE_INBOX)).delete(key);
        } catch {
          /* 무시 */
        }
      }
      return Response.redirect(`${scope}#/translate?photo=shared`, 303);
    }
    const sp = new URLSearchParams();
    for (const k of ['title', 'text', 'url']) {
      const v = form.get(k);
      if (typeof v === 'string' && v.trim()) sp.set(k, v);
    }
    return Response.redirect(String(sp) ? `${scope}?${sp}` : scope, 303);
  } catch {
    return Response.redirect(`${scope}#/translate`, 303);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const scopePath = new URL(self.registration.scope).pathname;
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === `${scopePath}share-target`) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === `${scopePath}index.html`)) {
    // 공유받기(?text=…)·바로가기(#/dict) 등 앱 진입은 저장해 둔 index.html 하나로 처리
    event.respondWith(caches.match('index.html').then((cached) => cached || fetch(req)));
    return;
  }
  // ignoreSearch를 쓰면 크롬이 캐시 전체를 훑어 파일마다 수백 ms가 걸린다 (앱 파일 주소에는 ?…가 붙지 않는다)
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

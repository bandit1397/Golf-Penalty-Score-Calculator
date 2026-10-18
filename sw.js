// 오프라인 캐시: 골프장에서 통신이 끊겨도 앱이 열리고 계산되도록 한다.
// 파일을 바꾸면 VERSION을 올려서 새 캐시를 받게 한다.
const VERSION = 'v1.1.0';
const CACHE = `smart-golf-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/engine.js',
  'js/rules.js',
  'js/voice.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패하면 캐시 (새 버전은 온라인일 때 자동 반영)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

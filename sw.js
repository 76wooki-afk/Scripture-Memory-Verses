/*
 * 서비스 워커: 앱 파일을 휴대폰에 저장해 두어 인터넷 없이도 열리게 합니다.
 * 구절이나 디자인을 고친 뒤에는 아래 VERSION 숫자를 올려 주세요.
 * (그래야 휴대폰이 새 파일을 다시 받아옵니다)
 */
const VERSION = "v6";
const CACHE = "smv-" + VERSION;
const FILES = [
  "./",
  "index.html",
  "css/style.css",
  "js/verses.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 인터넷이 되면 최신 파일, 안 되면 저장해 둔 파일 사용
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

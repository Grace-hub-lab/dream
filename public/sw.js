// Service Worker：页面网络优先（保证拿到最新版本），静态资源缓存兜底离线
// 修改前端文件后，把 VERSION 加 1 即可让已安装的 PWA 自动更新
const VERSION = 'v2';
const CACHE = `dream-${VERSION}`;
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // API 请求与跨域请求不走缓存
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // 网络优先，失败时回退缓存
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
  );
});

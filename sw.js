// sw.js
const CACHE_NAME = 'pose-app-v1';  // バージョンを上げるとキャッシュ更新される
const urlsToCache = [
  '/',                          // index.html（またはtest.html）
  '/test.html',
  '/kickposeapp2.js',
  '/three.module.js',           // ローカルに置いた場合
  // CDNのものは事前にダウンロードしてローカルに置くか、または以下のように
  // 'https://cdn.jsdelivr.net/npm/three@0.182/build/three.module.js',
  // MediaPipe関連（wasm + モデル）
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm/...',  // 必要なwasmファイル全部
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
  // 他に必要なJS、CSS、画像なども追加
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('キャッシュインストール中...');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // キャッシュにあればすぐ返す（Cache First）
        if (response) {
          return response;
        }
        // なければネットワークに取りに行く
        return fetch(event.request).then(networkResponse => {
          // 成功したらキャッシュにも保存（次回オフライン用）
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return networkResponse;
        });
      })
  );
});
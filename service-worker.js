/* =====================================================
   기숙사 관리일지 Service Worker
   - CDN 라이브러리: 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
   - 메인 앱: 캐시 우선 + 백그라운드 갱신
   - Google Drive API / accounts.google.com: 캐시 안 함 (항상 최신 필요)
   ===================================================== */

const CACHE_NAME = 'dormitory-journal-v16';

/* 설치 시 미리 캐시할 리소스 목록 */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icons8-home2-192.png',
  './icons/icons8-home2-512.png',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
];

/* 캐시하지 않을 URL 패턴 (Google 인증·Drive API는 항상 네트워크 직접 사용) */
const NO_CACHE_PATTERNS = [
  'accounts.google.com',
  'googleapis.com/drive',
  'googleapis.com/upload',
  'oauth2',
];

/* ── 설치 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /* 실패해도 설치 계속 진행 (CDN 일시 불가 대비) */
      const safeAdd = url => cache.add(url).catch(e => console.warn('캐시 건너뜀:', url, e));
      return Promise.all(PRECACHE.map(safeAdd));
    })
  );
  self.skipWaiting(); // 즉시 활성화
});

/* ── 활성화: 이전 버전 캐시 삭제 ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('이전 캐시 삭제:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

/* ── 요청 가로채기 ── */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  /* Google 인증/Drive API: 캐시 건너뜀 */
  if (NO_CACHE_PATTERNS.some(p => url.includes(p))) return;

  /* GET 요청만 처리 */
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      /* 캐시가 있으면 즉시 반환 + 백그라운드에서 갱신 */
      if (cached) {
        fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, response.clone()))
                .catch(() => {});
            }
          })
          .catch(() => {});
        return cached;
      }

      /* 캐시 없으면 네트워크 요청 후 저장 */
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request.clone(), response.clone()))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => {
          /* 오프라인 + 캐시 없음: index.html 반환 (앱 Shell) */
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

/* =====================================================
   기숙사 관리일지 Service Worker
   - CDN 라이브러리: 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
   - 메인 앱: 캐시 우선 + 백그라운드 갱신 (./와 ./index.html은 한 저장본, 브라우저 HTTP 캐시 거치지 않고 받음)
   - Google Drive API / accounts.google.com: 캐시 안 함 (항상 최신 필요)
   ===================================================== */

const CACHE_NAME = 'pwa-worklog-han-v5';
/* 이 앱 캐시 판정 — 같은 주소의 다른 기숙사 앱 캐시는 지우지 않는다(원본 규칙: ROSA scripts/dorm-pwa) */
const OWN_PREFIXES = ['pwa-worklog-han-v', 'dormitory-journal-v'];
function isOwnCache(key) {
  if (key === CACHE_NAME) return false;
  return OWN_PREFIXES.some(p => key.startsWith(p) && /^[0-9]/.test(key.slice(p.length)));
}

/* 설치 시 미리 캐시할 리소스 목록 */
const PRECACHE = [
  './index.html',
  './handover.js?v=1',
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
  'script.google.com',
  'script.googleusercontent.com',
];

/* ── 설치 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /* 실패해도 설치 계속 진행 (CDN 일시 불가 대비), 브라우저 HTTP 캐시의 옛 파일을 담지 않게 새로 받음 */
      const safeAdd = url => cache.add(new Request(url, { cache: 'reload' })).catch(e => console.warn('캐시 건너뜀:', url, e));
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
          .filter(isOwnCache)
          .map(k => {
            console.log('이전 캐시 삭제:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

/* 앱 화면: 설치 앱(./)과 주소 직접 입력(./index.html)을 한 저장본으로 — 어느 쪽으로 켜도 같은 화면, 같이 갱신 */
const SHELL_URL = new URL('./index.html', self.location.href).href;
const SHELL_PATHS = [new URL('./', self.location.href).pathname, new URL(SHELL_URL).pathname];

/* ── 요청 가로채기 ── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  /* Google 인증/Drive API: 캐시 건너뜀 */
  if (NO_CACHE_PATTERNS.some(p => url.includes(p))) return;

  /* GET 요청만 처리 */
  if (req.method !== 'GET') return;

  const u = new URL(url);
  const own = u.origin === self.location.origin;
  const shell = own && SHELL_PATHS.includes(u.pathname);
  const key = shell ? SHELL_URL : req;
  /* 이 앱 파일은 브라우저 HTTP 캐시를 거치지 않고 받는다(옛 화면을 다시 저장하지 않게), CDN 라이브러리는 판 번호가 붙어 바뀌지 않으니 원래 요청 그대로 */
  const netReq = shell ? new Request(SHELL_URL, { cache: 'no-store' }) : own ? new Request(req, { cache: 'no-store' }) : req;

  /* 네트워크에서 받아 저장이 끝난 뒤 돌려준다(캐시 실패는 무시) */
  const net = fetch(netReq).then(response => {
    if (!response || response.status !== 200 || response.redirected) return response;
    const copy = response.clone();
    return caches.open(CACHE_NAME)
      .then(cache => cache.put(key, copy))
      .catch(() => {})
      .then(() => response);
  });

  /* 캐시가 있으면 즉시 반환 + 백그라운드 갱신(다음 실행에 반영), 없으면 네트워크 */
  event.respondWith(
    caches.match(key)
      .catch(() => undefined)
      .then(cached => cached || net)
      .catch(() => {
        /* 오프라인 + 캐시 없음: index.html 반환 (앱 Shell) */
        if (req.mode === 'navigate') {
          return caches.match(SHELL_URL);
        }
      })
  );
  /* 화면을 보여 준 뒤에도 갱신 저장이 끝날 때까지 서비스 워커를 붙잡아 둔다 */
  event.waitUntil(net.catch(() => {}));
});

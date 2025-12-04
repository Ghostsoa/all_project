// Service Worker - 缓存CDN资源到浏览器本地
const CACHE_NAME = 'webssh-static-v1';
const CDN_CACHE = 'webssh-cdn-v1';

// 需要缓存的CDN资源
const CDN_RESOURCES = [
    'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css',
    'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css',
];

// 安装Service Worker时预缓存资源
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    event.waitUntil(
        caches.open(CDN_CACHE).then((cache) => {
            console.log('[SW] Caching CDN resources');
            return cache.addAll(CDN_RESOURCES).catch(err => {
                console.error('[SW] Failed to cache some resources:', err);
            });
        })
    );
    self.skipWaiting(); // 立即激活
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== CDN_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// 拦截请求，优先使用缓存
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    
    // 对CDN资源使用缓存优先策略
    if (CDN_RESOURCES.some(cdn => url.includes(cdn.split('/').slice(-1)[0]))) {
        event.respondWith(
            caches.match(event.request).then((response) => {
                if (response) {
                    console.log('[SW] Serving from cache:', url);
                    return response;
                }
                
                // 缓存未命中，从网络获取并缓存
                return fetch(event.request).then((response) => {
                    // 只缓存成功的响应
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CDN_CACHE).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                });
            })
        );
    }
    // 其他请求直接通过
});

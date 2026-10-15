/*
 * Service worker : ouvrir l'application sans reseau.
 *
 * En magasin, le telephone n'est plus sur le Wi-Fi de la maison et le
 * serveur ne repond pas. Ce worker garde l'interface et la derniere
 * collection lue : l'application s'ouvre quand meme, et le scan repond.
 *
 *   - la page : reseau d'abord, copie si le serveur tarde ou ne repond pas ;
 *   - les fichiers versionnes (/a/<empreinte>/…) : copie d'abord, ils ne
 *     changent jamais sous une meme adresse ;
 *   - la collection (/api/games) : reseau d'abord, copie a defaut ;
 *   - les jaquettes televersees : copie d'abord.
 *
 * Les jaquettes hebergees ailleurs ne sont pas gardees : une reponse
 * d'un autre site est opaque et compterait plusieurs megaoctets chacune.
 */

const CACHE = 'gamevault';
const DELAI_RESEAU_MS = 3500;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* La page annonce sa version : les fichiers des versions precedentes partent. */
self.addEventListener('message', (event) => {
  const version = event.data?.type === 'version' ? event.data.version : null;
  if (!version) return;
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const request of await cache.keys()) {
        const match = new URL(request.url).pathname.match(/^\/a\/([0-9a-f]{10})\//);
        if (match && match[1] !== version) await cache.delete(request);
      }
    }),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('delai')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function networkFirst(request, key = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), DELAI_RESEAU_MS);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Toutes les adresses de l'application partagent la meme page.
    event.respondWith(networkFirst(request, '/'));
  } else if (url.pathname.startsWith('/a/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === '/api/games' || url.pathname === '/api/config') {
    event.respondWith(networkFirst(request, url.pathname));
  }
});

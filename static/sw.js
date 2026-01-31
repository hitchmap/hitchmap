// Choose a cache name
const cacheName = 'hitchmap-v1';
// List the files to precache
const precacheResources = ['/', '/favicon.ico', 'https://a.tile.openstreetmap.org/0/0/0.png'];

// When the service worker is installing, open the cache and add the precache resources to it
self.addEventListener('install', (event) => {
    console.log('Service worker install event!');
    event.waitUntil(
        caches.open(cacheName).then((cache) => cache.addAll(precacheResources))
    );
});

// Listen for fetch events
self.addEventListener('fetch', (event) => {
    if (event.request.method != 'GET') return;

    event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
    // Don't cache media files
    if (['image', 'video', 'audio'].includes(request.destination)) {
        return fetch(request);
    }

    function stripQuery(url) {
        const urlObject = new URL(url);
        if (urlObject.hostname !== self.location.hostname) return url;
        urlObject.search = '';
        return urlObject.toString();
    }

    const cache = await caches.open(cacheName);
    const strippedUrl = stripQuery(request.url);
    const isExternal = new URL(request.url).hostname !== self.location.hostname;

    const isCapacitor = typeof Capacitor !== 'undefined';
    const isHomepage = strippedUrl === stripQuery(self.location.origin + '/');

    if (isCapacitor && isHomepage) {
        const cachedResponse = await cache.match(strippedUrl);

        if (cachedResponse) {
            const dateHeader = cachedResponse.headers.get('Date');
            const cachedTime = dateHeader ? Date.parse(dateHeader) : null;

            // If Date header is missing or invalid, go network-first
            if (!cachedTime) {
                try {
                    const fetchedResponse = await fetch(request);
                    await cache.put(strippedUrl, fetchedResponse.clone());
                    return fetchedResponse;
                } catch {
                    return cachedResponse;
                }
            }

            const cacheAge = Date.now() - cachedTime;
            const sixHours = 6 * 60 * 60 * 1000;

            if (cacheAge > sixHours) {
                try {
                    const fetchedResponse = await fetch(request);
                    await cache.put(strippedUrl, fetchedResponse.clone());
                    return fetchedResponse;
                } catch {
                    return cachedResponse;
                }
            }

            return cachedResponse;
        }

        try {
            const fetchedResponse = await fetch(request);
            await cache.put(strippedUrl, fetchedResponse.clone());
            return fetchedResponse;
        } catch (error) {
            throw error;
        }
    }

    if (isExternal) {
        const cachedResponse = await cache.match(strippedUrl);
        if (cachedResponse) return cachedResponse;

        const fetchedResponse = await fetch(request);
        await cache.put(strippedUrl, fetchedResponse.clone());
        return fetchedResponse;
    }

    try {
        const fetchedResponse = await fetch(request);
        await cache.put(strippedUrl, fetchedResponse.clone());
        return fetchedResponse;
    } catch (error) {
        const cachedResponse = await cache.match(strippedUrl);
        if (cachedResponse) return cachedResponse;
        throw error;
    }
}

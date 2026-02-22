// Choose a cache name
const cacheName = 'hitchmap-v1';
// List the files to precache
const precacheResources = ['/', '/favicon.ico', 'https://tile.openstreetmap.org/0/0/0.png', '/error.html'];

// When the service worker is installing, open the cache and add the precache resources to it
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(cacheName)
            .then((cache) => cache.addAll(precacheResources))
            .catch((err) => console.warn('Precache failed:', err))
    );
});

// Listen for fetch events
self.addEventListener('fetch', (event) => {
    if (event.request.method != 'GET') return;
    event.respondWith(handleFetch(event));
});

async function handleFetch(event) {
    const {request} = event;

    // Don't cache media files
    if (['image', 'video', 'audio'].includes(request.destination)) {
        return fetch(request);
    }

    // Helper function to strip query parameters from a URL
    function stripQuery(url) {
        const urlObject = new URL(url);
        if (urlObject.hostname !== self.location.hostname) return url;
        urlObject.search = ''; // Remove query parameters
        return urlObject.toString();
    }

    const cache = await caches.open(cacheName);
    const strippedUrl = stripQuery(request.url);
    const isExternal = new URL(request.url).hostname !== self.location.hostname;

    // Check if Capacitor is defined and if this is the homepage
    const isCapacitor = typeof Capacitor !== 'undefined';
    const isHomepage = strippedUrl === stripQuery(self.location.origin + '/');

    // Special handling for homepage in Capacitor
    if (isCapacitor && isHomepage) {
        const cachedResponse = await cache.match(strippedUrl);
        if (cachedResponse) {
            const responseTime = cachedResponse.headers.get('sw-response-time');
            // If no sw-response-time header, go network-first
            if (!responseTime) {
                try {
                    const fetchedResponse = await fetch(request);
                    event.waitUntil(cache.put(strippedUrl, fetchedResponse.clone()));
                    return fetchedResponse;
                } catch (error) {
                    return cachedResponse;
                }
            }
            // Check if cached response is older than 6 hours
            const cacheAge = Date.now() - parseInt(responseTime);
            const sixHours = 6 * 60 * 60 * 1000;
            if (cacheAge > sixHours) {
                // Cached response is stale, fetch fresh
                try {
                    const fetchedResponse = await fetch(request);
                    event.waitUntil(cache.put(strippedUrl, fetchedResponse.clone()));
                    return fetchedResponse;
                } catch (error) {
                    return cachedResponse;
                }
            }
            // Cache is fresh, return it
            return cachedResponse;
        }
        // No cache, fetch from network
        try {
            const fetchedResponse = await fetch(request);
            event.waitUntil(cache.put(strippedUrl, fetchedResponse.clone()));
            return fetchedResponse;
        } catch (error) {
            // Both network and cache missed — show error page
            const errorResponse = await cache.match('/error.html');
            if (errorResponse) return errorResponse;
            throw error;
        }
    }

    if (isExternal) {
        // Cache-first for external domains
        const cachedResponse = await cache.match(strippedUrl);
        if (cachedResponse) {
            return cachedResponse;
        }
        // If not in cache, fetch from network
        const fetchedResponse = await fetch(request);
        event.waitUntil(cache.put(strippedUrl, fetchedResponse.clone()));
        return fetchedResponse;
    } else {
        // Network-first for same-origin requests
        try {
            const fetchedResponse = await fetch(request);
            event.waitUntil(cache.put(strippedUrl, fetchedResponse.clone()));
            return fetchedResponse;
        } catch (error) {
            // If the network is unavailable, get from cache
            const cachedResponse = await cache.match(strippedUrl);
            if (cachedResponse) {
                return cachedResponse;
            }
            // Both network and cache missed — show error page for HTML requests
            if (request.destination === 'document') {
                const errorResponse = await cache.match('/error.html');
                if (errorResponse) return errorResponse;
            }
            throw error;
        }
    }
}

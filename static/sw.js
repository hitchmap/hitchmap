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
    
    // Helper function to strip query parameters from a URL
    function stripQuery(url) {
        const urlObject = new URL(url);
        if (urlObject.hostname !== self.location.hostname) return url;
        urlObject.search = ''; // Remove query parameters
        return urlObject.toString();
    }

    // Open the cache
    event.respondWith(
        caches.open(cacheName).then((cache) => {
            const strippedUrl = stripQuery(event.request.url);

            // Go network-first
            return fetch(event.request)
                .then((fetchedResponse) => {
                    // IMPORTANT: Tell the service worker what not to cache
                    if (!['image', 'video', 'audio'].includes(event.request.destination)) {
                        cache.put(strippedUrl, fetchedResponse.clone());
                    }
                    return fetchedResponse;
                })
                .catch(() => {
                    // If the network is unavailable, get from cache
                    return cache.match(strippedUrl);
                });
        })
    );
});

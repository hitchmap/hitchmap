// Choose a cache name
const cacheName = 'hitchmap-v1';
// List the files to precache
const precacheResources = ['/', '/favicon.ico', 'https://a.tile.openstreetmap.org/0/0/0.png'];

const NETWORK_STATE_CACHE = 'network-state-cache';
const NETWORK_STATE_URL = 'app://network-state';

// Network toggle state - stored in a variable that persists in the service worker
let networkEnabled = true;

// Initialize network state from cache
async function initializeNetworkState() {
    try {
        const cache = await caches.open(NETWORK_STATE_CACHE);
        const response = await cache.match(NETWORK_STATE_URL);
        if (response) {
            const data = await response.json();
            networkEnabled = data.enabled;
            console.log('Initialized network state from cache:', networkEnabled);
        }
    } catch (err) {
        console.error('Error initializing network state:', err);
    }
}

// Save network state to cache
async function saveNetworkState() {
    try {
        const cache = await caches.open(NETWORK_STATE_CACHE);
        const response = new Response(JSON.stringify({ enabled: networkEnabled }), {
            headers: { 'Content-Type': 'application/json' }
        });
        await cache.put(NETWORK_STATE_URL, response);
    } catch (err) {
        console.error('Error saving network state:', err);
    }
}

// Broadcast state to all connected clients
async function broadcastNetworkState() {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
        client.postMessage({
            type: 'NETWORK_STATE_CHANGED',
            enabled: networkEnabled
        });
    });
}

self.addEventListener('activate', initializeNetworkState);

// When the service worker is installing, open the cache and add the precache resources to it
self.addEventListener('install', (event) => {
    console.log('Service worker install event!');
    event.waitUntil(
        caches.open(cacheName).then((cache) => cache.addAll(precacheResources))
    );
});

// Listen for messages from the main thread to toggle network
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'TOGGLE_NETWORK') {
        networkEnabled = event.data.enabled;
        await saveNetworkState();
        await broadcastNetworkState();
        console.log('Network enabled:', networkEnabled);
    } else if (event.data && event.data.type === 'GET_NETWORK_STATE') {
        event.ports[0].postMessage({
            type: 'NETWORK_STATE_CHANGED',
            enabled: networkEnabled
        });
    }
});

self.addEventListener('fetch', (event) => {
    if (event.request.method != 'GET')
        return;
    
    // Helper function to strip query parameters from a URL
    function stripQuery(url) {
        const urlObject = new URL(url);
        if (urlObject.hostname !== self.location.hostname)
            return url;
        urlObject.search = ''; // Remove query parameters
        return urlObject.toString();
    }
    
    // Open the cache
    event.respondWith(caches.open(cacheName).then((cache) => {
        const strippedUrl = stripQuery(event.request.url);
        
        // If network is disabled, go cache-first
        if (!networkEnabled) {
            return cache.match(strippedUrl).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // If not in cache, try network anyway for first-time resources
                return fetch(event.request);
            });
        }
        
        // If network is enabled, go network-first (original behavior)
        return fetch(event.request).then((fetchedResponse) => {
            // IMPORTANT: Tell the service worker what not to cache
            if (!['image', 'video', 'audio'].includes(event.request.destination)) {
                cache.put(strippedUrl, fetchedResponse.clone());
            }
            return fetchedResponse;
        }).catch(() => {
            // If the network is unavailable, get from cache
            return cache.match(strippedUrl);
        });
    }));
});

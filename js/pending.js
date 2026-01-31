const localStorageKey = "pending_markers_v1";
import {$$} from './utils';

export const pendingGroup = new L.layerGroup()

export async function addPending(lat, lon) {
    const pendingData = {
        date: new Date().toISOString(),
        lat,
        lon
    };

    // Retrieve existing from localStorage
    let pending = JSON.parse(localStorage.getItem(localStorageKey)) || [];

    // Add new pending
    pending.push(pendingData);

    // Save back to localStorage
    localStorage.setItem(localStorageKey, JSON.stringify(pending));

    if ('caches' in window) {
        try {
            await caches.delete('hitchmap-v1');
            console.log('Cache cleared after adding pending marker');
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }
    }
}

export function getFuturePending() {
    let pending = JSON.parse(localStorage.getItem(localStorageKey)) || [];

    // Filter pending added after the page's generation date
    return pending.filter(marker => new Date(marker.date) > new Date(document.body.dataset.generated));
}

export function updatePendingMarkers() {
    pendingGroup.clearLayers();
    for (let o of getFuturePending()) {
        let m = L.marker([o.lat, o.lon], {opacity: 0.5})
        m.on('click', _ => {
            // Prevent interaction if certain UI elements are visible
            if ($$('.topbar.visible') || $$('.sidebar.spot-form-container.visible'))
                return
            location.href = '#success'
        })
        m.addTo(pendingGroup)
    }
}

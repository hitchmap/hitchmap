const localStorageKey = "pending_markers_v3";
import {$$, clearCacheExceptErrorPage} from './utils';

export const pendingGroup = new L.layerGroup()

export async function addPending(points) {
    const pendingData = {
        date: new Date().toISOString(),
        points
    };

    // Retrieve existing from localStorage
    let pending = JSON.parse(localStorage.getItem(localStorageKey)) || [];

    // Add new pending
    pending.push(pendingData);

    // Save back to localStorage
    localStorage.setItem(localStorageKey, JSON.stringify(pending));

    await clearCacheExceptErrorPage();
}

export function getFuturePending() {
    let pending = JSON.parse(localStorage.getItem(localStorageKey)) || [];

    // Filter pending added after the page's generation date
    return pending.filter(marker => new Date(marker.date) > new Date(document.body.dataset.generated));
}

export function updatePendingMarkers(active) {
    pendingGroup.clearLayers();
    for (let f of getFuturePending()) {
        console.log(f)
        let m = L.marker([f.points[0].lat, f.points[0].lng], {opacity: 0.5})
        m.on('click', _ => {
            // Prevent interaction if certain UI elements are visible
            if ($$('.topbar.visible') || $$('.sidebar.spot-form-container.visible'))
                return
            location.href = '#success'
            const jumpReviewBtn = document.querySelector('#jump-to-review');

            // this is only shown on a click, not on direct navigation to #success
            jumpReviewBtn.style.display = '';
            jumpReviewBtn.onclick = () => {
                window.navigateHome();
                window.map.setView([f.points[0].lat, f.points[0].lng], 15);
            }

            const jumpDestinationBtn = document.querySelector('#jump-to-destination');
            if (f.points[1].lat != null && f.points[1].lat !== 'nan') {
                console.log('yeah')
                jumpDestinationBtn.style.display = '';
                jumpDestinationBtn.onclick = () => {
                    window.navigateHome();
                    window.map.setView([f.points[1].lat, f.points[1].lng], 15);
                };
            }
        })
        m.addTo(pendingGroup)

        console.log(f.points)
        console.log(active)
        if (JSON.stringify(f.points) === JSON.stringify(active)) {
            location.href = '#success'
            m.fire('click', {})
        }
    }
}

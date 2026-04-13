import { C } from './utils.js';
export let currentUser, userRecordings;
export let userMarkerGroup = L.layerGroup();

export async function fetchCurrentUser() {
    const res = await fetch('/user');
    const userData = await res.json();
    if (!userData.username) {
        currentUser = undefined;
        return currentUser;
    }
    currentUser = {
        logged_in: userData.logged_in,
        username: userData.username,
        _permissions: userData._permissions,
        location_share_secret: userData.location_share_secret,
        last_location_timestamp: userData.last_location_timestamp,
    };

    const recordingIds = userData.recording_ids ?? [];
    userRecordings = {};
    for (const recordingId of recordingIds) {
        const res = await fetch(`/recording/${encodeURIComponent(recordingId)}`);
        if (!res.ok) {
            console.warn(`Failed to fetch recording ${recordingId}: ${res.status}`);
            continue;
        }
        const { locations } = await res.json();
        if (locations && locations.length > 0) {
            userRecordings[recordingId] = locations;
        }
    }

    currentUser.recordings = userRecordings;
    currentUser.recording_ids = recordingIds;
    return currentUser;
}

export let firstUserPromise = fetchCurrentUser();
firstUserPromise.then(user => {
    if (window.Capacitor && !user) {
        window.location = '/login';
    }
});

export function createUserMarkers() {
    if (!currentUser) return;
    userMarkerGroup.clearLayers();
    const userMarkers = window.reviewData.filter(
        review => review[C.HITCHHIKER] &&
                  review[C.HITCHHIKER].toLowerCase() === currentUser.username.toLowerCase()
    ).map(review => review._marker);
    for (const marker of userMarkers) {
        marker.bringToFront();
        const userDot = new L.circleMarker(marker.getLatLng(), {
            stroke: false,
            fill: true,
            radius: 1,
            fillColor: 'black',
            fillOpacity: 1,
            interactive: false,
        });
        userDot.addTo(userMarkerGroup);
    }
}

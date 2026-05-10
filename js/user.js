import { C } from './utils.js';
export let currentUser, userRecordings;
export let userMarkerGroup = L.layerGroup();
export let userMarkers = [];

export async function fetchCurrentUser() {
    const res = await fetch('/user');
    const userData = await res.json();
    if (!userData.username) {
        currentUser = undefined;
        return currentUser;
    }
    userData.recordings = userData.recordings ?? [];
    return userData;
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
    userMarkers = window.reviewData.filter(
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

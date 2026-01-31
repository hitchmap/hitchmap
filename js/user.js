import { C } from './utils.js';

export let currentUser, userRecordings;
export let userMarkerGroup = L.layerGroup();

export async function fetchCurrentUser() {
    let res = await fetch('/user')
    let userData = await res.json();
    currentUser = userData.username ? userData : undefined;
    return currentUser
}

export let firstUserPromise = fetchCurrentUser();

firstUserPromise.then(user => {
    if(window.Capacitor && !user)
        window.location = '/login';
})

export function createUserMarkers() {
    if (!currentUser) return
    userMarkerGroup.clearLayers()
    let userMarkers = window.reviewData.filter(
        review => review[C.HITCHHIKER] && review[C.HITCHHIKER].toLowerCase() == currentUser.username.toLowerCase()
    ).map(
        review => review._marker
    )
    for (let marker of userMarkers) {
        marker.bringToFront();
        let userDot = new L.circleMarker(marker.getLatLng(), {stroke: false, fill: true, radius: 1, fillColor: 'black', fillOpacity: 1, interactive: false})
        userDot.addTo(userMarkerGroup)
    }
}

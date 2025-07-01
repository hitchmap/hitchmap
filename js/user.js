export let currentUser;
export let userMarkerGroup = L.layerGroup();

export async function fetchCurrentUser() {
    let res = await fetch('/user')
    currentUser = (await res.json()).username
    return currentUser
}

export let firstUserPromise = fetchCurrentUser();

setTimeout(fetchCurrentUser, 60000)

let userColors = {1: 'darkred', 2: 'darkred', 3: 'darkred', 4: 'green', 5: 'green'};

export function createUserMarkers(markers) {
    if (!currentUser) return
    userMarkerGroup.clearLayers()
    let userMarkers = markers.filter(
        marker => marker.options._row[6] && marker.options._row[6]
            .map(x => x[0].toLowerCase())
            .includes(currentUser.toLowerCase())
    )
    for (let marker of userMarkers) {
        let userDot = new L.circleMarker(marker.getLatLng(), {stroke: false, fill: true, radius: 1, fillColor: 'black', fillOpacity: 1, interactive: false})
        userDot.addTo(userMarkerGroup)
    }
}

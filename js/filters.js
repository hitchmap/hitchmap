const knob = document.getElementById('knob');
const knobLine = document.getElementById('knobLine');
const knobCone = document.getElementById('knobCone');
const rotationValue = document.getElementById('rotationValue');
const spreadInput = document.getElementById('spreadInput');
spreadInput.value = 70
const knobToggle = document.getElementById('knob-toggle');
const textFilter = document.getElementById('text-filter');
const userFilter = document.getElementById('user-filter');
const distanceFilter = document.getElementById('distance-filter');
const startTimeFilter = document.getElementById('start-time-filter');
const endTimeFilter = document.getElementById('end-time-filter');
const clearFilters = document.getElementById('clear-filters');

let isDragging = false, radAngle = 0;

export let filterDestLineGroup = null,
    filterMarkerGroup = null;


const RemoveFilterButtons = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        this.filterButtons = L.DomUtil.create('div', 'remove-filter-group');
        // TODO: add a leaflet-bar with an a for every active filter
        // var controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button remove-filter', this.filterButtons);
        // var container = L.DomUtil.create('a', '', controlDiv);
        return this.filterButtons
    }
});

export const removeFilterButtons = new RemoveFilterButtons()

function setQueryParameter(key, value) {
    const url = new URL(window.location.href); // Get the current URL
    if (value || value === 0)
        url.searchParams.set(key, value); // Set or update the query parameter
    else
        url.searchParams.delete(key);
    window.history.replaceState({}, '', url.toString()); // Update the URL without reloading
    window.navigate();
}

function getQueryParameter(key) {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
}

export function clearParams() {
    const url = new URL(window.location.href);
    let newURL = url.origin + url.pathname + url.hash;
    window.history.replaceState({}, '', newURL.toString());
    window.navigate();
}

clearFilters.onclick = () => {
    clearParams()
}

knob.addEventListener('mousedown', (e) => {
    isDragging = true;
    updateRotation(e);
    const angle = Math.round(radAngle * (180 / Math.PI) + 90) % 360;
    const normalizedAngle = (angle + 360) % 360; // Normalize angle
    setQueryParameter('direction', normalizedAngle);
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        updateRotation(e);
        const angle = Math.round(radAngle * (180 / Math.PI) + 90) % 360;
        const normalizedAngle = (angle + 360) % 360; // Normalize angle
        setQueryParameter('direction', normalizedAngle);
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

spreadInput.addEventListener('input', updateConeSpread);
knobToggle.addEventListener('input', () => setQueryParameter('mydirection', knobToggle.checked));
userFilter.addEventListener('input', () => setQueryParameter('user', userFilter.value));
textFilter.addEventListener('input', () => setQueryParameter('text', textFilter.value));
distanceFilter.addEventListener('input', () => setQueryParameter('mindistance', distanceFilter.value));
startTimeFilter.addEventListener('input', () => setQueryParameter('starttime', startTimeFilter.value));
endTimeFilter.addEventListener('input', () => setQueryParameter('endtime', endTimeFilter.value));

function updateRotation(event) {
    const rect = knob.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;

    radAngle = Math.atan2(dy, dx);
}

function updateConeSpread() { // Clamp spread between 1 and 89
    const spread = Math.min(89, parseInt(spreadInput.value, 10) || 0);

    if (spread > 0)
        setQueryParameter('spread', spread);
}

export function applyParams() {
    const normalizedAngle = parseFloat(getQueryParameter('direction'));
    const spread = parseFloat(getQueryParameter('spread')) || 70;

    if (!isNaN(normalizedAngle)) {
        knobLine.style.transform = `translateX(-50%) rotate(${normalizedAngle}deg)`;
        knobCone.style.transform = `rotate(${normalizedAngle}deg)`;
        rotationValue.textContent = `${Math.round(normalizedAngle)}°`;
        radAngle = (normalizedAngle - 90) * (Math.PI / 180); // Update radAngle for consistency
    }

    spreadInput.value = spread;
    const radiansSpread = spread * (Math.PI / 180); // Convert spread angle to radians

    const multiplier = 100; // Factor to increase the cone's distance

    // Calculate cone boundaries using trigonometry and multiply by the multiplier
    const leftX = 50 - Math.sin(radiansSpread) * 50 * multiplier; // 50 is the radius
    const rightX = 50 + Math.sin(radiansSpread) * 50 * multiplier;
    const topY = 50 - Math.cos(radiansSpread) * 50 * multiplier; // Top vertex

    knobCone.style.clipPath = `polygon(50% 50%, ${leftX}% ${topY}%, ${rightX}% ${topY}%)`;

    knobToggle.checked = getQueryParameter('mydirection') == 'true'
    textFilter.value = getQueryParameter('text')
    userFilter.value = getQueryParameter('user')
    distanceFilter.value = getQueryParameter('mindistance')
    startTimeFilter.value = getQueryParameter('starttime');
    endTimeFilter.value = getQueryParameter('endtime');

    updateRemoveFilterButtons()

    if (knobToggle.checked || textFilter.value || userFilter.value || distanceFilter.value) {
        if (filterMarkerGroup) filterMarkerGroup.remove()
        if (filterDestLineGroup) filterDestLineGroup.remove()

        let filterMarkers = knobToggle.checked || distanceFilter.value ? window.destinationMarkers : window.allMarkers;
        // display filters pane
        document.body.classList.add('filtering')

        if (userFilter.value) {
            const users = userFilter.value
            .split(';')
            .map(u => u.trim().toLowerCase())
            .filter(u => u.length > 0);

            filterMarkers = filterMarkers.filter(
            marker =>
                marker.options._row[6] &&
                marker.options._row[6]
                .map(x => x.toLowerCase())
                .some(user => users.includes(user))
            );
        }
        if (startTimeFilter.value) {
            const startTime = new Date(startTimeFilter.value).getTime();
            filterMarkers = filterMarkers.filter(
                x => {
                    const markerTime = new Date(x.options._row[9]).getTime();
                    return !isNaN(markerTime) && markerTime >= startTime;
                }
            );
        }
        if (endTimeFilter.value) {
            const endTime = new Date(endTimeFilter.value).getTime();
            filterMarkers = filterMarkers.filter(
                x => {
                    const markerTime = new Date(x.options._row[9]).getTime();
                    return !isNaN(markerTime) && markerTime <= endTime;
                }
            );
        }
        if (textFilter.value) {
            filterMarkers = filterMarkers.filter(
                x => x.options._row[3].toLowerCase().includes(textFilter.value.toLowerCase())
            )
        }
        if (distanceFilter.value) {
            filterMarkers = filterMarkers.filter(
                x => {
                    let from = x.getLatLng()
                    let lats = x.options._row[7]
                    let lons = x.options._row[8]

                    for (let i in lats) {
                        // Road distance is on average 25% longer than straight distance
                        if (from.distanceTo([lats[i], lons[i]]) * 1.25 / 1000 > distanceFilter.value)
                            return true
                    }
                    return false
                }
            )
        }
        if (knobToggle.checked) {
            filterMarkers = filterMarkers.filter(
                x => {
                    let from = x.getLatLng()
                    let lats = x.options._row[7]
                    let lons = x.options._row[8]

                    for (let i in lats) {
                        let travelAngle = Math.atan2(from.lat - lats[i], lons[i] - from.lng);
                        // difference between the travel direction and the cone line
                        let coneLineDiff = Math.abs(travelAngle - radAngle)
                        let wrappedDiff = Math.min(coneLineDiff, 2 * Math.PI - coneLineDiff)
                        // if the direction falls within the knob's cone
                        if (wrappedDiff < radiansSpread)
                            return true
                    }
                    return false
                }
            )
        }

        // duplicate all markers to the filtering pane
        filterMarkers = filterMarkers.map(
            spot => {
                let loc = spot.getLatLng()
                let marker = new L.circleMarker(loc, Object.assign({}, spot.options, { pane: 'filtering'}))
                marker.on('click', e => spot.fire('click', e))
                return marker
            }
        )

        filterMarkerGroup = L.layerGroup(
            filterMarkers.reverse(), {pane: 'filtering'}
        ).addTo(window.map)
    } else {
        document.body.classList.remove('filtering')
    }
}

function updateRemoveFilterButtons() {
    // Clear existing buttons
    const filterButtons = document.querySelector('.remove-filter-group');
    if (!filterButtons) return;
    filterButtons.innerHTML = '';

    // Check each filter and create remove buttons for active ones
    const activeFilters = [
        { key: 'mydirection', label: 'Directional filter', value: getQueryParameter('mydirection') },
        { key: 'text', label: 'Text', value: getQueryParameter('text') },
        { key: 'user', label: 'User', value: getQueryParameter('user') },
        { key: 'mindistance', label: 'Min Distance', value: getQueryParameter('mindistance') }
    ].filter(filter => filter.value !== null);

    // Create buttons for active filters
    activeFilters.forEach(filter => {
        const controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button remove-filter', filterButtons);
        const container = L.DomUtil.create('a', '', controlDiv);
        container.innerText = filter.key === 'mydirection' ? filter.label : `${filter.label} | ${filter.value}`;
        const CLOSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="21" height="18" viewBox="-3 0 24 24" style="vertical-align: middle;"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
        container.innerHTML += CLOSE_ICON;
        container.href = 'javascript:;';

        // Add click handler to remove the filter
        container.onclick = (e) => {
            L.DomEvent.stopPropagation(e);
            setQueryParameter(filter.key, null);
            applyParams();
        };
    });
}

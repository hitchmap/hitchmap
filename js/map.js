import {addGeocoder} from './geocoder'
import {exportAsGPX} from './export-gpx';
import {$$, bar, bars, arrowLine, C, addAsLeafletControl} from './utils';
import {clearParams, applyParams, filterMarkerGroup, removeFilterButtons} from './filters';
import {restoreView, storageAvailable, summaryText, closestMarker} from './utils';
import {currentUser, firstUserPromise, userMarkerGroup, createUserMarkers} from './user';
import {pendingGroup, updatePendingMarkers, addPending} from './pending';
import {renderReviews} from './render-reviews';

// Register service worker for offline functionality
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(e => console.error(e));
}

// Initialize global variables for spot tracking
var addSpotPoints = [], // Array to store points when adding new spots
    addSpotLine = null, // Line connecting spots
    active = [], // Currently active/selected markers
    destLineGroup = L.layerGroup(), // Group for destination lines
    spotMarker, // Marker for hitchhiking spot
    destMarker // Marker for destination

// Handle marker click events
function handleMarkerClick(marker, point, e) {
    // Prevent interaction if certain UI elements are visible
    if ($$('.topbar.visible') || $$('.sidebar.spot-form-container.visible')) return

    window.location.hash = `${point.lat},${point.lng}`

    L.DomEvent.stopPropagation(e)
}

// Handle navigation to a marker
var handleMarkerNavigation = function (marker) {
    var row = marker.options._row, point = marker.getLatLng()
    active = [marker]

    addSpotPoints = []
    renderPoints()

    // Update sidebar with spot information
    setTimeout(() => {
        bar('.sidebar.show-spot')
        // Create location link based on device type (mobile vs desktop)
        $$('#spot-header a').href = window.ontouchstart ? `geo:${row[0]},${row[1]}` : ` https://www.google.com/maps/place/${row[0]},${row[1]}`
        $$('#spot-header a').innerText = `${row[0].toFixed(4)}, ${row[1].toFixed(4)} ☍`

        $$('#spot-summary').innerText = summaryText(row)

        // Handle spot description and additional info
        $$('#spot-text').replaceChildren(renderReviews(marker.options._reviews));
        $$('#extra-review-button').style.display = row[3].length > 200 ? 'block': 'none';
    }, 100)
};

$$(".sidebar.show-spot").addEventListener("click", function (event) {
    const link = event.target.closest("a"); // Ensure it's an <a> tag
    if (!link) return
    const linkUrl = new URL(link.href, window.location.origin);

    if (linkUrl.origin === window.location.origin) {
        L.DomEvent.stopPropagation(e)
        history.pushState({}, "", link.href); // Update the URL without reloading
        navigate();
    }
});

var map = L.map(
    "hitch-map",
    {
        center: [0.0, 0.0],
        crs: L.CRS.EPSG3857,
        zoom: 1,
        zoomControl: true,
        preferCanvas: true,
        worldCopyJump: true,
    }
);
window.map = map

let allCoords = window.markerData.map(m => [m[0], m[1]])

let allMarkers = [];

let allMarkersRenderer = map.getRenderer(map)
let normalDrawFunction = allMarkersRenderer._redraw

let heatLayer = L.heatLayer(allCoords, {radius: 5, blur: 1, maxZoom: 1, minOpacity: 1, max: 100, gradient: {0: 'black', 0.9: 'black', 1: 'lightgreen'}}).addTo(map)

// Note: neither will be shown when a filter is active
function showHeatmapOrDefaultPane() {
    let {canvas} = allMarkersRenderer._ctx
    if (map.getZoom() < 7) {
        canvas.style.display = 'none';
        allMarkersRenderer._ctx.clearRect(0, 0, canvas.width, canvas.height)
        // performance hack: override redraw to stop (off-screen) draws
        allMarkersRenderer._redraw = function(){}
        heatLayer.addTo(map)
    }
    else {
        canvas.style.display = '';
        allMarkersRenderer._redraw = normalDrawFunction
        heatLayer.remove()
    }
}

showHeatmapOrDefaultPane()

L.control.scale().addTo(map);

// Create custom map panes for layering
let filterPane = map.createPane('filtering')
filterPane.style.zIndex = 450

let arrowlinePane = map.createPane('arrowlines')
filterPane.style.zIndex = 1450

for (let row of window.markerData) {
    let color = {1: 'red', 2: 'orange', 3: 'yellow', 4: 'lightgreen', 5: 'lightgreen'}[row[2]];
    let opacity = {1: 0.3, 2: 0.4, 3: 0.6, 4: 0.8, 5: 0.8}[row[2]];
    let point = new L.LatLng(row[0], row[1])
    let reviewIndices = row[6] || []
    let reviews = reviewIndices.map(i => window.reviewData[i])
    let weight = reviews.length > 2 ? 2 : 1
    let marker = L.circleMarker(point, {radius: 5, weight, fillOpacity: opacity, color: 'black', fillColor: color, _row: row, _reviews: reviews});

    for (let r of reviews)
        r._marker = marker;

    marker.on('click', function(e) {
        handleMarkerClick(marker, point, e)
    })

    allMarkers.push(marker)
}

firstUserPromise.then(_ => createUserMarkers(allMarkers))

let allMarkerGroup = L.layerGroup(allMarkers)
allMarkerGroup.addTo(map)
userMarkerGroup.addTo(map)

updatePendingMarkers()
pendingGroup.addTo(map)

// Store the original OSM tile layer
var osmLayer = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {"attribution": "\u0026copy; \u003ca href=\"https://www.openstreetmap.org/copyright\"\u003eOpenStreetMap\u003c/a\u003e contributors", "detectRetina": false, "maxNativeZoom": 19, "maxZoom": 19, "minZoom": 1, "noWrap": false, "opacity": 1, "subdomains": "abc", "tms": false}
);

// Create Esri satellite layers (requires esri-leaflet library)
var esriImagery = L.esri.basemapLayer('Imagery');
var esriLabels = L.esri.basemapLayer('ImageryLabels', {pane: 'tilePane'});
var esriTransport = L.esri.basemapLayer('ImageryTransportation', {pane: 'tilePane'});

// Create layer groups
var esriGroup = L.layerGroup([esriImagery, esriTransport, esriLabels]);
var osmGroup = L.layerGroup([osmLayer]);

// --- Attach HTML-defined controls to Leaflet ---

// Menu button
const menuEl = addAsLeafletControl('#menu-control');
menuEl.querySelector('a').addEventListener('click', e => {
    L.DomEvent.stopPropagation(e)
    navigateHome();
    if (document.body.classList.contains('menu')) bar();
    else bar('.sidebar.menu');
    document.body.classList.toggle('menu');
});

// Add spot button
const addSpotEl = addAsLeafletControl('#addspot-control');
addSpotEl.querySelector('a').addEventListener('click', e => {
    L.DomEvent.stopPropagation(e)
    if (window.location.href.includes('light')) {
        if (confirm('Do you want to be redirected to the full version where you can add spots?')) {
            window.location = '/';
        }
        return;
    }
    clearParams();
    navigateHome();
    document.body.classList.add('adding-spot');
    bar('.topbar.spot.step1');
});

// Account button
addAsLeafletControl('#account-control');

// Filter button
addAsLeafletControl('#filter-control');

// Optional layout break
addAsLeafletControl('#flex-break-1');

// Remove filter buttons (existing control)
map.addControl(removeFilterButtons);

// Optional layout break
addAsLeafletControl('#flex-break-2');

// Tile toggle button
// Initialize from localStorage, default to 'osm' if not set
// Start with the opposite of what we want, so toggleLayer() gives us the right one
var currentTileLayer = localStorage.getItem('currentTileLayer') === 'esri' ? 'osm' : 'esri';

function updateAttribution() {
    const attrControl = $$('.leaflet-control-attribution');
    if (currentTileLayer === 'osm') {
        attrControl.innerHTML = `
            © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>,
            <a href="https://hitchmap.com/copyright.html">Hitchmap</a> contributors
        `;
    } else {
        // For Esri, let it manage its own dynamic attribution and just append Hitchmap if not already there
        if (!attrControl.innerHTML.includes('Hitchmap')) {
            attrControl.innerHTML += `, <a href="https://hitchmap.com/copyright.html">Hitchmap</a> contributors`;
        }
    }
}

// Tile toggle button
const tileToggleEl = addAsLeafletControl('#tile-control');
const img = tileToggleEl.querySelector('img');
img.style.cursor = 'pointer';
img.style.width = '30px';

function updateToggleImage() {
    if (currentTileLayer === 'osm') {
        // Show Esri preview when on OSM
        img.src = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/2';
        img.title = 'Switch to Satellite View';
    } else {
        // Show OSM preview when on Esri
        img.src = 'https://tile.openstreetmap.org/2/2/1.png';
        img.title = 'Switch to Street Map';
    }
}

function toggleLayer() {
    if (currentTileLayer === 'osm') {
        map.removeLayer(osmGroup);
        esriGroup.addTo(map);
        currentTileLayer = 'esri';
    } else {
        map.removeLayer(esriGroup);
        osmGroup.addTo(map);
        currentTileLayer = 'osm';
    }
    // Save to localStorage whenever the layer changes
    localStorage.setItem('currentTileLayer', currentTileLayer);
    updateToggleImage();
    updateAttribution();
}

// Initialize with saved layer preference by toggling to it
toggleLayer();

img.addEventListener('click', e => {
    L.DomEvent.stopPropagation(e)
    e.stopPropagation();
    toggleLayer();
});

// GPS and geocoder remain in the same sequence
L.control.locate().addTo(map);
addGeocoder(map);

// Optional layout break
addAsLeafletControl('#flex-break-3');

// Move zoom control to bottom
var zoom = $$('.leaflet-control-zoom')
zoom.parentNode.appendChild(zoom)

$$('#sb-close').onclick = function (e) {
    navigateHome()
}

$$('a.step2-help').onclick = e => alert(e.target.title)

// Update visual line connecting spots
function updateAddSpotLine() {
    if (addSpotLine) {
        map.removeLayer(addSpotLine)
        addSpotLine = null
    }
    if (addSpotPoints.length == 1) {
        addSpotLine = arrowLine(addSpotPoints[0], map.getCenter()).addTo(map)
    }
}

map.on('move', updateAddSpotLine)

const errorMessage = document.getElementById('nickname-error-message');

// Handle multi-step spot addition process
var addSpotStep = function (e) {
    if (e.target.tagName != 'BUTTON') return
    if (e.target.innerText == 'Done') {
        let center = map.getCenter()
        if (addSpotPoints[0] && center.distanceTo(addSpotPoints[0]) < 1000 && !confirm("Are you sure this was where the car took you? It's less than 1 km away from the hitchhiking spot."))
            return
        else
            addSpotPoints.push(center)
    }
    if (e.target.innerText.includes("didn't get"))
        addSpotPoints.push(addSpotPoints[0])
    if (e.target.innerText == "Skip")
        addSpotPoints.push({ lat: 'nan', lng: 'nan' })
    if (e.target.innerText.includes('Review')) {
        addSpotPoints.push(active[0].getLatLng())
        active = []
    }

    renderPoints()

    if (e.target.innerText == 'Done' || e.target.innerText.includes("didn't get") || e.target.innerText.includes('Review') || e.target.innerText == "Skip") {
        if (addSpotPoints.length == 1) {
            if (map.getZoom() > 9) map.setZoom(9);
            map.panTo(addSpotPoints[0])
            bar('.topbar.spot.step2')
        }
        else if (addSpotPoints.length == 2) {
            const destinationProvided = addSpotPoints[1].lat !== 'nan'
            
            if (destinationProvided) {
                var bounds = new L.LatLngBounds(addSpotPoints);
                map.fitBounds(bounds, {})
            }
            map.setZoom(map.getZoom() - 1)

            initializeSpotForm(addSpotPoints, destinationProvided)
        }
    }
    else if (e.target.innerText == 'Cancel') {
        navigateHome()
    }

    document.body.classList.toggle('adding-spot', addSpotPoints.length > 0)
}

// New function for form initialization logic
function initializeSpotForm(points, destinationProvided) {
    bar('.sidebar.spot-form-container')
    var dest = destinationProvided ? `${points[1].lat.toFixed(4)}, ${points[1].lng.toFixed(4)}` : 'unknown destination'
    $$('.sidebar.spot-form-container p.greyed').innerText = `${points[0].lat.toFixed(4)}, ${points[0].lng.toFixed(4)} → ${dest}`
    $$("#no-ride").classList.toggle("make-invisible", destinationProvided);

    // nicknames wont be recorded if a user is logged in
    $$("#nickname-container").classList.toggle("make-invisible", !!currentUser);
    $$('#spot-form input[name=coords]').value = `${points[0].lat},${points[0].lng},${points[1].lat},${points[1].lng}`

    const form = $$("#spot-form");
    form.reset();

    if (storageAvailable('localStorage')) {
        var uname = $$('input[name=nickname]')
        uname.value = localStorage.getItem('nick')
        uname.onchange = e => localStorage.setItem('nick', uname.value)
    }
}

bars.forEach(bar => {
    if (bar.classList.contains('spot')) bar.onclick = addSpotStep
})

let extendedForm = document.getElementById('extended_info');
extendedForm.open = localStorage.getItem('details-open') == 'true';
extendedForm.ontoggle = () => localStorage.setItem('details-open', extendedForm.open ? 'true' : 'false');

// Map click handler for mobile misclicks
map.on('click', e => {
    var opened = false;

    if (!document.body.classList.contains('zoomed-out') && window.innerWidth < 780) {
        var layerPoint = map.latLngToLayerPoint(e.latlng)
        let markers = document.body.classList.contains('filtering') ? filterMarkerGroup.getLayers() : allMarkers
        var closest = closestMarker(markers, e.latlng.lat, e.latlng.lng)
        if (closest && map.latLngToLayerPoint(closest.getLatLng()).distanceTo(layerPoint) < 20) {
            opened = true
            closest.fire('click', e)
        }
    }
    if (!opened && $$('.sidebar.visible') && !$$('.sidebar.spot-form-container.visible')) {
        navigateHome()
    }

    L.DomEvent.stopPropagation(e)
})

function updateZoomClasses() {
    showHeatmapOrDefaultPane()
    document.body.classList.toggle('zoomed-out', map.getZoom() < 7)
    document.body.classList.toggle('mid-zoom', map.getZoom() < 9)
}

map.on('zoom', updateZoomClasses)
updateZoomClasses()
map.on('zoomstart', _ => document.body.classList.add('zooming')); // Hide the layer while pinch zooming
map.on('zoomend', _ => document.body.classList.remove('zooming')); // Show the layer

function renderPoints() {
    if (spotMarker) map.removeLayer(spotMarker)
    if (destMarker) map.removeLayer(destMarker)

    if (destLineGroup)
        destLineGroup.clearLayers()

    spotMarker = destMarker = null
    if (addSpotPoints[0]) {
        spotMarker = L.marker(addSpotPoints[0])
        spotMarker.addTo(map)
    }
    if (addSpotPoints[1] && addSpotPoints[1].lat !== 'nan') {
        destMarker = L.marker(addSpotPoints[1], { color: 'red' })
        destMarker.addTo(map)
    }
    document.body.classList.toggle('has-points', addSpotPoints.length)

    for (let a of active) {
        let reviews = a.options._reviews.filter(r => r[C.DEST_LAT] != null)
        for (let review of reviews) {
            let lat = review[C.DEST_LAT]
            let lon = review[C.DEST_LON]
            arrowLine(a.getLatLng(), [lat, lon]).addTo(destLineGroup)
        }
    }

    destLineGroup.addTo(map)
}

function clear() {
    bar()
    addSpotPoints = []
    active = []
    renderPoints()
    updateAddSpotLine()
    document.body.classList.remove('adding-spot', 'menu')
}

if (!window.location.hash.includes(',')) // we'll center on coord
    if (!restoreView.apply(map))
        map.fitBounds([[-35, -40], [60, 40]])
if (map.getZoom() > 17) map.setZoom(17);

$$('.hitch-map').focus()

// validate add spot form input
$$('#spot-form').addEventListener('submit', async function(event) {
    L.DomEvent.stopPropagation(e)

    let pendingLoc = addSpotPoints[0]

    let submitButton = this.querySelector("button");
    submitButton.disabled = true;

    let formData = new FormData(this);
    let resp = await fetch(this.action, {
        method: "POST",
        body: formData
    })

    let result;
    try {
        result = await resp.json();
    } catch (error) {
        console.error("Response is not valid JSON:", error);
        result = {}; // Default to an empty object if parsing fails
    }

    if (resp.ok) {
        location.hash = '#success';
        addPending(pendingLoc.lat, pendingLoc.lng)
        updatePendingMarkers()
    }
    else {
        errorMessage.textContent = result.error || "An unknown error occurred.";
        setTimeout(_ => errorMessage.textContent = '', 10000)
    }
    submitButton.disabled = false;
});

let oldUrl;

function navigate() {
    applyParams();

    if (location.href == oldUrl && location.hash.slice(1))
        return

    oldUrl = location.href;

    let args = window.location.hash.slice(1).split(',')
    if (args[0] == 'location') {
        clear()
        map.setView([+args[1], +args[2]], args[3])
    }
    else if (args[0] == 'filters') {
        clear()
        bar('.sidebar.filters')
    }
    else if (args.length == 2 && !isNaN(args[0])) {
        clear()
        let lat = +args[0], lon = +args[1]
        let m = closestMarker(allMarkers, lat, lon)
        handleMarkerNavigation(m)
        if (map.getZoom() < 3)
            map.setView(m.getLatLng(), 16)
        return
    }
    else if (args[0] == 'success') {
        clear()
        bar('.sidebar.success')
    }
    else {
        clear()
    }
}

function navigateHome() {
    if (window.location.hash) {
        window.history.pushState(null, null, ' ')
    }
    navigate() // clears rest
}

// Export functions to window object
window.navigate = navigate
window.navigateHome = navigateHome
window.handleMarkerClick = handleMarkerClick
window.allMarkers = allMarkers;
window.allMarkerGroup = allMarkerGroup;

// Set up hash change listener
window.onhashchange = navigate
window.onpopstate = navigate

// Initial navigation
navigate()
applyParams()

// Handle special hash states (registered)
// Keep this after the initial navigation to prevent the messages from being cleared immediately

if (window.location.hash == '#registered') {
    history.replaceState(null, null, ' ')
    bar('.sidebar.registered')
}

document.querySelector('#export-gpx').onclick = exportAsGPX

import {addGeocoder} from './geocoder'
import {exportAsGPX} from './export-gpx';
import {$$, bar, bars, arrowLine, C} from './utils';
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
        event.preventDefault(); // Prevent default navigation
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

var tileLayer = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {"attribution": "\u0026copy; \u003ca href=\"https://www.openstreetmap.org/copyright\"\u003eOpenStreetMap\u003c/a\u003e contributors", "detectRetina": false, "maxNativeZoom": 19, "maxZoom": 19, "minZoom": 1, "noWrap": false, "opacity": 1, "subdomains": "abc", "tms": false}
);


tileLayer.addTo(map);

var AddSpotButton = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        var controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button add-spot');
        var container = L.DomUtil.create('a', '', controlDiv);
        container.href = "javascript:void(0);";
        container.innerText = "📍 Add spot";

        container.onclick = function (e) {
            if (window.location.href.includes('light')) {
                if (confirm('Do you want to be redirected to the full version where you can add spots?'))
                    window.location = '/'
                return;
            }
            clearParams()
            navigateHome()
            document.body.classList.add('adding-spot')
            bar('.topbar.spot.step1')

            L.DomEvent.stopPropagation(e)
        }

        return controlDiv;
    }
});

var MenuButton = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        var controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button menu');
        var container = L.DomUtil.create('a', '', controlDiv);
        container.href = "javascript:void(0);";
        container.innerHTML = "☰";

        container.onclick = function (e) {
            navigateHome()
            if (document.body.classList.contains('menu'))
                bar()
            else
                bar('.sidebar.menu')
            document.body.classList.toggle('menu')
            L.DomEvent.stopPropagation(e)
        }

        return controlDiv;
    }
});

var AccountButton = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        var controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button your-account');
        var container = L.DomUtil.create('a', '', controlDiv);
        container.href = "/me";
        container.innerHTML = "👤 Account";
        container.onclick = L.DomEvent.stopPropagation

        return controlDiv;
    }
});

var FilterButton = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        var controlDiv = L.DomUtil.create('div', 'leaflet-bar horizontal-button filter-button');
        var container = L.DomUtil.create('a', '', controlDiv);
        container.href = "#filters";
        container.innerHTML = "🔍 Filters";
        container.onclick = L.DomEvent.stopPropagation

        return controlDiv;
    }
});

// newline in leaflet control land
var FlexBreak = L.Control.extend({
    options: {position: 'topleft'},
    onAdd: function (map) {
        var controlDiv = L.DomUtil.create('div', 'flex-break');
        return controlDiv;
    }
});

////// Add interaction buttons to the map //////
map.addControl(new MenuButton());
map.addControl(new AddSpotButton());
map.addControl(new AccountButton());
map.addControl(new FilterButton());
map.addControl(new FlexBreak());
map.addControl(removeFilterButtons);
map.addControl(new FlexBreak());
// Add GPS
L.control.locate().addTo(map);
// Add geocoding functionality
addGeocoder(map);
map.addControl(new FlexBreak());

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

$$('.leaflet-control-attribution').innerHTML = `
    © <a href=https://openstreetmap.org/copyright>OpenStreetMap</a>, <a href=https://hitchmap.com/copyright.html>Hitchmap</a> contributors
`

if (!window.location.hash.includes(',')) // we'll center on coord
    if (!restoreView.apply(map))
        map.fitBounds([[-35, -40], [60, 40]])
if (map.getZoom() > 17) map.setZoom(17);

$$('.hitch-map').focus()

// validate add spot form input
$$('#spot-form').addEventListener('submit', async function(event) {
    event.preventDefault(); // Prevents the default page reload

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

    if (location.href == oldUrl)
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
window.map = map
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

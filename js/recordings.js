import { firstUserPromise, userMarkers } from './user';
import { UserLocationDisplay } from './user-location-display';
import { outlinedPolyline, findClosestLocation, closestMarker, polygonDistanceToLatLng, addOutlineRing, C, $$, throttleWithTrailing} from './utils';

// 'idle' | 'permissions' | 'locating' | 'tracking'
let trackingState = 'idle';
let shareSecret;
let recordingId;
let receivedLocations = false;
export let localLocationsList = [];

let userLocationDisplay;
let lastRecordingTimestamp;
export let recordingGroup;
let localRecordingGroup;
let localRecordingGroupBack;

// ─── Recording storage ────────────────────────────────────────────────────────
let loadedRecordings = {};
let knownRecordingIds = [];

let shownAlert = false;

async function fetchRecording(id) {
    try {
        const res = await fetch(`/recording/${encodeURIComponent(id)}`);
        if (!res.ok) {
            console.warn(`Failed to fetch recording ${id}: ${res.status}`);
            return null;
        }
        const data = await res.json();
        if (data.locations && data.locations.length > 0) {
            loadedRecordings[id] = data;
            return data;
        }
    } catch (e) {
        console.error(`Error fetching recording ${id}:`, e);
    }
    return null;
}

async function ensureRecordingLoaded(id) {
    return loadedRecordings[id] ?? await fetchRecording(id);
}

// ─── Recording picker state ───────────────────────────────────────────────────
const PICKER_STORAGE_KEY   = 'hitchmap_active_picker_selection';
const SHOW_ALL_STORAGE_KEY = 'hitchmap_show_all_recordings';

let activePickerSelection = null;

function loadPickerSelection() {
    try { return localStorage.getItem(PICKER_STORAGE_KEY) || null; } catch { return null; }
}

function loadShowAll() {
    try { return localStorage.getItem(SHOW_ALL_STORAGE_KEY) === 'true'; } catch { return false; }
}

function saveShowAll(on) {
    try {
        if (on) localStorage.setItem(SHOW_ALL_STORAGE_KEY, 'true');
        else    localStorage.removeItem(SHOW_ALL_STORAGE_KEY);
    } catch { /* ignore */ }
}

function savePickerSelection(id, completedIds) {
    try {
        const isLast = id === completedIds[completedIds.length - 1];
        if (isLast) localStorage.removeItem(PICKER_STORAGE_KEY);
        else        localStorage.setItem(PICKER_STORAGE_KEY, id);
    } catch { /* ignore */ }
}

export async function initializeUserLocationDisplay() {
    recordingGroup = L.layerGroup([], {hitchmapBackground: true}).addTo(window.map);
    if (!window.Capacitor) return;

    userLocationDisplay = window.hitchmapTracker.uld = new UserLocationDisplay(window.map, {
        drawCircle: true,
        drawMarker: true,
        showCompass: true
    });
    localRecordingGroup     = L.layerGroup().addTo(window.map);
    localRecordingGroupBack = L.layerGroup().addTo(window.map);
}

function generateRecordingId() {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function updateState() {
    document.body.dataset.trackingState = trackingState;
    document.body.classList.toggle('sharing-location', !!shareSecret);
}

function renderTrackSvg(svgEl, locations, color, date) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    const vb = svgEl.viewBox.baseVal;
    const W = vb.width, H = vb.height;
    const ns = 'http://www.w3.org/2000/svg';

    if (!locations || locations.length === 0) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', W * 0.2); line.setAttribute('y1', H / 2);
        line.setAttribute('x2', W * 0.8); line.setAttribute('y2', H / 2);
        line.setAttribute('stroke', '#ccc');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '4 3');
        svgEl.appendChild(line);
    } else {
        const pad = 4;
        const lats = locations.map(l => l.latitude);
        const lngs = locations.map(l => l.longitude);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const dLat = maxLat - minLat || 1e-9;
        const dLng = maxLng - minLng || 1e-9;

        const step = Math.max(1, Math.floor(locations.length / 60));
        const pts = [];
        for (let i = 0; i < locations.length; i += step) {
            const { longitude: lng, latitude: lat } = locations[i];
            const x = pad + ((lng - minLng) / dLng) * (W - 2 * pad);
            const y = H - pad - ((lat - minLat) / dLat) * (H - 2 * pad);
            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }

        const polyline = document.createElementNS(ns, 'polyline');
        polyline.setAttribute('points', pts.join(' '));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', color);
        polyline.setAttribute('stroke-width', '2');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('stroke-linecap', 'round');
        svgEl.appendChild(polyline);

        const [sx, sy] = pts[0].split(',').map(Number);
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', sx); dot.setAttribute('cy', sy);
        dot.setAttribute('r', '2'); dot.setAttribute('fill', color);
        svgEl.appendChild(dot);
    }

    if (date) {
        const line1 = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const line2 = date.toLocaleDateString(undefined, { year: 'numeric' });

        function makeText(content, y) {
            const t = document.createElementNS(ns, 'text');
            t.setAttribute('x', W / 2);
            t.setAttribute('y', y);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('dominant-baseline', 'central');
            t.setAttribute('font-size', '9');
            t.setAttribute('fill', 'black');
            t.setAttribute('stroke', 'white');
            t.setAttribute('stroke-width', '2');
            t.setAttribute('paint-order', 'stroke');
            t.textContent = content;
            svgEl.appendChild(t);
        }

        makeText(line1, line2 ? H * 0.38 : H * 0.5);
        if (line2) makeText(line2, H * 0.68);
    }
}

function recordingDate(recId) {
    const match = recId.match(/rec_(\d+)_/);
    if (match) {
        const d = new Date(parseInt(match[1]));
        if (!isNaN(d)) return d;
    }
}

// ─── Recording picker ─────────────────────────────────────────────────────────

export async function initRecordingPicker(recordings, lastTimestamp) {
    if (lastTimestamp) lastRecordingTimestamp = lastTimestamp;

    if (!recordings || Object.keys(recordings).length === 0) return;

    const recordingIds = Object.keys(recordings).sort();
    knownRecordingIds = recordingIds;
    const completedIds = recordingIds.filter(id => id !== recordingId);

    document.body.classList.toggle('has-multiple-recordings', completedIds.length >= 2);

    // Initialise selection once
    if (activePickerSelection === null) {
        const stored = loadPickerSelection();
        activePickerSelection = (stored && completedIds.includes(stored))
            ? stored
            : (completedIds[completedIds.length - 1] ?? null);
    }

    // Clamp to a valid entry
    if (activePickerSelection && !completedIds.includes(activePickerSelection)) {
        activePickerSelection = completedIds[completedIds.length - 1] ?? null;
    }

    // Restore show-all from its own key
    const showAll = loadShowAll();
    document.body.classList.toggle('showing-all-recordings', showAll);

    await applyAndRender(completedIds);
    bindPickerControls(completedIds);
}

async function applyAndRender(completedIds) {
    if (loadShowAll()) {
        await drawRecordingsForIds(completedIds);
    } else {
        await applyPickerSelection(activePickerSelection);
    }
    // Use whatever is already loaded for the thumb (non-blocking)
    updateThumb(completedIds, activePickerSelection);
}

function updateThumb(completedIds, selection) {
    const svgEl = document.getElementById('recording-picker-thumb-svg');
    if (!svgEl) return;

    const locs      = (selection && loadedRecordings[selection]?.locations) || [];
    const isCurrent = selection === recordingId;
    renderTrackSvg(svgEl, locs, isCurrent ? '#e33' : '#009',
        isCurrent ? 'now' : (selection ? recordingDate(selection) : null));

    const idx     = completedIds.indexOf(selection);
    const prevBtn = document.getElementById('recording-picker-prev');
    const nextBtn = document.getElementById('recording-picker-next');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= completedIds.length - 1;
}

function bindPickerControls(completedIds) {
    const control   = document.getElementById('recording-picker-control');
    const prevBtn   = document.getElementById('recording-picker-prev');
    const nextBtn   = document.getElementById('recording-picker-next');
    const thumb     = document.getElementById('recording-picker-thumb');
    const tooltip   = document.getElementById('recording-thumb-tooltip');
    const showAllCb = document.getElementById('rtt-show-all-toggle');

    prevBtn.onclick = async (e) => {
        L.DomEvent?.stopPropagation(e);
        control?.classList.remove('tooltip-open');
        const idx = completedIds.indexOf(activePickerSelection);
        if (idx > 0) {
            activePickerSelection = completedIds[idx - 1];
            savePickerSelection(activePickerSelection, completedIds);
            await applyAndRender(completedIds);
            await panToSelection(activePickerSelection);
        }
    };

    nextBtn.onclick = async (e) => {
        L.DomEvent?.stopPropagation(e);
        control?.classList.remove('tooltip-open');
        const idx = completedIds.indexOf(activePickerSelection);
        if (idx < completedIds.length - 1) {
            activePickerSelection = completedIds[idx + 1];
            savePickerSelection(activePickerSelection, completedIds);
            await applyAndRender(completedIds);
            await panToSelection(activePickerSelection);
        }
    };

    thumb.onclick = async (e) => {
        L.DomEvent?.stopPropagation(e);
        await panToSelection(activePickerSelection);
        if (showAllCb) showAllCb.checked = document.body.classList.contains('showing-all-recordings');
        control?.classList.toggle('tooltip-open');
    };

    showAllCb.onchange = async (e) => {
        const on = e.target.checked;
        saveShowAll(on);
        document.body.classList.toggle('showing-all-recordings', on);
        control?.classList.remove('tooltip-open');

        if (on) {
            await drawRecordingsForIds(completedIds);
            const allLocs = completedIds.flatMap(id => loadedRecordings[id]?.locations || []);
            if (allLocs.length) {
                window.map.fitBounds(
                    L.latLngBounds(allLocs.map(l => [l.latitude, l.longitude])),
                    { padding: [40, 40], animate: true }
                );
            }
        } else {
            await applyPickerSelection(activePickerSelection);
        }
    };

    // Stop tooltip clicks from closing it
    tooltip.onclick = (e) => e.stopPropagation();

    // Close tooltip on outside click
    document.addEventListener('click', () => control?.classList.remove('tooltip-open'));
}

async function panToSelection(selection) {
    if (!selection) return;
    const locs = await ensureRecordingLoaded(selection);
    if (!locs?.locations?.length) return;
    const latlngs = locs.locations.map(l => [l.latitude, l.longitude]);
    if (latlngs.length === 1) {
        window.map.setView(latlngs[0], 19, { animate: true });
    } else {
        window.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: true });
    }
}

/**
 * Fetch all given IDs in parallel, then draw them all.
 */
async function drawRecordingsForIds(ids) {
    await Promise.all(ids.map(id => ensureRecordingLoaded(id)));
    const recordingsMap = {};
    for (const id of ids) {
        if (loadedRecordings[id]?.locations) recordingsMap[id] = loadedRecordings[id].locations;
    }
    drawRecordings(recordingsMap, lastRecordingTimestamp);
}

// ─── Capacitor background geolocation ────────────────────────────────────────

if (window.Capacitor) {
    const BackgroundGeolocation = window.BackgroundGeolocation;
    const {SplashScreen, Share, App, ScreenOrientation, LocalNotifications} = window.Capacitor.Plugins;

    if (ScreenOrientation) ScreenOrientation.lock({ orientation: 'portrait' });

    let lastResumeTime = 0;

    App.addListener('resume', async () => {
        const now = Date.now();
        if (now - lastResumeTime < 1000) return;
        lastResumeTime = now;

        console.log('App has resumed');
        if (trackingState !== 'idle') await startService();
    });

    SplashScreen.hide();
    window.addEventListener('beforeunload', () => { SplashScreen.show(); });

    let compassWatchId     = null;
    let lastCompassHeading = null;

    function startCompassWatch() {
        if (!navigator.compass || compassWatchId !== null) return;
        compassWatchId = navigator.compass.watchHeading(
            (heading) => {
                lastCompassHeading = heading.magneticHeading;
                userLocationDisplay.updateHeading(lastCompassHeading);
            },
            (error) => { console.error('Compass error:', error); },
            { frequency: 1000 }
        );
    }

    function stopCompassWatch() {
        if (!navigator.compass || compassWatchId === null) return;
        navigator.compass.clearWatch(compassWatchId);
        compassWatchId     = null;
        lastCompassHeading = null;
    }

    async function isServiceRunning() {
        try {
            const status = await BackgroundGeolocation.checkStatus();
            return status.isRunning;
        } catch (error) {
            console.error('Error checking status:', error);
            return false;
        }
    }

    async function configure() {
        try {
            if (await isServiceRunning() && trackingState !== 'idle') {
                const oldConfig = await BackgroundGeolocation.getConfig();
                recordingId = oldConfig.postTemplate.recording_id;
            }
            if (!recordingId) recordingId = generateRecordingId();

            window.useraw = window.Capacitor.getPlatform() !== 'android';
            const locationProvider = window.useraw ? BackgroundGeolocation.RAW_PROVIDER : BackgroundGeolocation.ACTIVITY_PROVIDER;

            await BackgroundGeolocation.configure({
                stationaryRadius: 0,
                distanceFilter: 0,
                desiredAccuracy: BackgroundGeolocation.HIGH_ACCURACY,
                debug: false,
                notificationsEnabled: true,
                notificationTitle: "Hitchmap",
                notificationText: "Location tracking active",
                stopOnTerminate: false,
                startOnBoot: false,
                startForeground: true,
                locationProvider,
                interval: 5000,
                fastestInterval: 5000,
                activitiesInterval: 5000,
                stopOnStillActivity: false,
                url: `${location.origin}/location`,
                syncUrl: `${location.origin}/location`,
                syncThreshold: 1,
                httpHeaders: { "Content-Type": "application/json" },
                maxLocations: 10000,
                postTemplate: {
                    latitude:     "@latitude",
                    longitude:    "@longitude",
                    accuracy:     "@accuracy",
                    timestamp:    "@time",
                    bearing:      "@bearing",
                    recording_id: recordingId,
                    platform: window.Capacitor.getPlatform()
                }
            });
        } catch (error) {
            console.error('Error configuring:', error);
        }
    }

    async function startService() {
        let geoStatus = await BackgroundGeolocation.checkStatus();
        let notificationStatus = await LocalNotifications?.checkPermissions();
        let willAskForNotify = window.Capacitor.getPlatform() === 'android' && notificationStatus && notificationStatus.display !== 'granted';

        if (willAskForNotify || !geoStatus.hasPermissions) {
            if (!shownAlert) {
                alert("To track your trip, you must give permissions for both notifications and exact location usage. We will only use notifications to keep the app alive while your phone is on standby.");
                shownAlert = true;
            }
        }

        if (!geoStatus.locationServicesEnabled) {
            alert('Enable GPS to get an accurate recording.');
        }

        await configure();
        startCompassWatch();
        if (!await isServiceRunning()) receivedLocations = false;
        try {
            await BackgroundGeolocation.start();
            console.log('Service started');
        } catch (error) {
            console.error('Error starting:', error);
        }
    }

    async function stopService() {
        shownAlert = false;
        if (!await isServiceRunning()) return;
        try {
            document.body.classList.remove('has-user-location');
            userLocationDisplay.disable();
            stopCompassWatch();
            if (document.body.dataset.centeringMode === 'user')
                document.body.dataset.centeringMode = null;

            await BackgroundGeolocation.stop();
            recordingId = generateRecordingId();
            configure();
            console.log('Service stopped');
        } catch (error) {
            console.error('Error stopping:', error);
        }
    }

    async function startTracking() {
        trackingState = 'permissions';
        updateState();

        await startService();

        trackingState = 'locating';
        updateState();

        startRecordingPoll();
    }

    async function stopTracking() {
        if (shareSecret && !confirm('You are currently sharing your location. Stopping tracking will also stop sharing. Continue?')) {
            return;
        }

        const completedId = recordingId;

        trackingState = 'idle';

        if (shareSecret) {
            await stopSharing();
        }

        updateState();
        recordingId = null;

        stopRecordingPoll();
        await stopService();

        if (completedId) {
            const data = await fetchRecording(completedId);

            if (data?.locations?.length) {
                const minTs = data.locations[0].timestamp;
                const ageMs = Date.now() - minTs;

                if (ageMs < 10 * 60 * 1000) {
                    // Recording is less than 10 minutes old — delete it automatically
                    try {
                        const res = await fetch(`/delete-recording/${completedId}`, {
                            method: 'DELETE',
                            credentials: 'include'
                        });
                        const result = await res.json();
                        if (result.success) {
                            delete loadedRecordings[completedId];
                            knownRecordingIds = knownRecordingIds.filter(id => id !== completedId);
                            alert('Recording was less than 10 minutes long and has been automatically deleted.');
                        }
                    } catch (e) {
                        console.error('Failed to auto-delete short recording:', e);
                    }
                }
                else {
                    if (!knownRecordingIds.includes(completedId)) {
                        knownRecordingIds.push(completedId);
                    }

                    activePickerSelection = completedId;
                    savePickerSelection(activePickerSelection, knownRecordingIds);
                    await applyAndRender(knownRecordingIds);
                }
            }

            localLocationsList.length = 0;
            drawLocalRecordings();
        }
    }

    async function startSharing() {
        try {
            if (!shareSecret) {
                const response = await fetch('/share-location', { method: 'POST' });
                const data     = await response.json();
                if (data.success) shareSecret = data.location_share_secret;
            }

            if (trackingState === 'idle') {
                await startTracking();
            }

            const shareUrl = `${location.origin}/?share-secret=${shareSecret}`;
            updateState();
            Share.share({ url: shareUrl });
        } catch (error) {
            console.error('Error starting share:', error);
            alert('Failed to start sharing location');
        }
    }

    async function stopSharing() {
        try {
            await fetch('/unshare-location', { method: 'POST', credentials: 'include' });
            shareSecret = false;
            updateState();
            if (trackingState === 'idle') {
                stopRecordingPoll();
                await stopService();
            }
        } catch (error) {
            console.error('Error stopping share:', error);
        }
    }

    const throttledDraw = throttleWithTrailing(async (location) => {
        drawLocalRecordings();
        userLocationDisplay.enable();
        userLocationDisplay.updateLocation(location);
        if (document.body.dataset.centeringMode === 'user') {
            window.map.setView([location.latitude, location.longitude], window.map.getZoom(), {
                animate: true, duration: 0.5
            });
        }
    }, 500);

    BackgroundGeolocation.on('location', async (location) => {
        localLocationsList.push(location);
        if (!receivedLocations) {
            receivedLocations = true;
            if (await isServiceRunning()) {
                document.body.classList.add('has-user-location');
                await startCompassWatch();
            }
            if (document.body.dataset.centeringMode !== 'shared')
                document.body.dataset.centeringMode = 'user';
            if (trackingState === 'locating') {
                trackingState = 'tracking';
                updateState();
            }
        }
        throttledDraw(location);
    });

    BackgroundGeolocation.on('error', (error) => {
        console.error('Background geolocation error:', error);
    });

    document.getElementById('start-tracking')?.addEventListener('click', startTracking);
    document.getElementById('stop-tracking')?.addEventListener('click', stopTracking);
    document.getElementById('tracking-status-permissions')?.addEventListener('click', stopTracking);
    document.getElementById('tracking-status-locating')?.addEventListener('click', stopTracking);
    document.getElementById('share-location')?.addEventListener('click', startSharing);
    document.getElementById('send-location')?.addEventListener('click', startSharing);
    document.getElementById('unshare-location')?.addEventListener('click', stopSharing);

    firstUserPromise.then(async (user) => {
        const running = await isServiceRunning();
        shareSecret = shareSecret || user.location_share_secret;

        if (!running && shareSecret) await stopSharing();

        if (running) {
            trackingState = 'tracking';
            await startService();
        } else {
            trackingState = 'idle';
            await stopService();
        }

        updateState();
    });

    window.hitchmapTracker = {
        startTracking,
        stopTracking,
        startSharing,
        trackingState:    () => trackingState,
        shareSecret:      () => shareSecret,
        recordingId:      () => recordingId,
        isServiceRunning,
        localLocationsList
    };
}


// ─── Drawing ──────────────────────────────────────────────────────────────────

let recordingMarkers = [];
const svgRenderer = L.svg();

export function drawRecordings(recordings, lastTimestamp) {
    recordingGroup.clearLayers();

    if (!recordingGroup._backGroup) {
        recordingGroup._backGroup = L.layerGroup([], { pane: 'user-recordings' }).addTo(window.map);
    }
    const backGroup = recordingGroup._backGroup;
    backGroup.clearLayers();

    if (!recordings) return;

    if (window.Capacitor) drawLocalRecordings();

    if (lastTimestamp) lastRecordingTimestamp = lastTimestamp;

    const hitchmapBackground = recordingGroup.options.hitchmapBackground;

    Object.entries(recordings).forEach(([drawRecordingId, locations]) => {
        if (!locations || locations.length === 0) return;

        const isCurrentRecording = recordingId === drawRecordingId;
        const trackColor    = isCurrentRecording ? '#e33' : '#38f';
        const baseOpacity   = isCurrentRecording ? 0.7 : 0.3;
        const markerOpacity = 1;

        const recordingLayers = [];

        const stops = locations.filter(loc => loc.seconds_spent > 30);

        function resetRecording() {
            recordingLayers.forEach(({ layer, type }) => {
                if (type === 'polyline') {
                    layer.setStyle({ color: trackColor, opacity: baseOpacity });
                } else {
                    layer.setStyle({ fillColor: trackColor, color: 'white', fillOpacity: markerOpacity });
                }
            });
        }

        function deleteRecording(closePopupFn) {
            if (!confirm(`Delete recording ${drawRecordingId}? This cannot be undone.`)) return;
            fetch(`/delete-recording/${drawRecordingId}`, { method: 'DELETE', credentials: 'include' })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        closePopupFn();
                        resetRecording();
                        recordingLayers.forEach(({ layer }) => layer.remove());
                        recordingLayers.length = 0;
                        delete loadedRecordings[drawRecordingId];
                        knownRecordingIds = knownRecordingIds.filter(id => id !== drawRecordingId);
                    } else {
                        alert(data.error || 'Failed to delete recording.');
                    }
                })
                .catch(() => alert('Failed to delete recording.'));
        }

        const outlineColor = isCurrentRecording ? '#900' : '#009';
        const plBack = outlinedPolyline(locations.map(l => [l.latitude, l.longitude]), {
            color: trackColor,
            weight: isCurrentRecording ? 2 : 1,
            opacity: baseOpacity,
            pane: 'user-recordings', // blocked by the main pane
            interactive: true, // interactions are only fired from map.onclick in map.js
            outline: true,
            outlineColor,
            outlineWidth: 1,
        });
        recordingLayers.push({ layer: plBack, type: 'polyline' });

        plBack.bindPopup((layer) => {
            const anchor = layer.getPopup()?.getLatLng();
            const loc    = anchor ? findClosestLocation(locations, anchor) : null;

            const container = L.DomUtil.create('div');
            container.innerHTML = `
                ${loc ? `
                    ${new Date(loc.timestamp).toLocaleString()}<br>
                    Accuracy: ${loc.accuracy}m<br>
                    Speed: ${loc.speed}m<br>
                    ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}<br>
                ` : ''}
                Stops: ${stops.length}<br>
                <button class="delete-recording-btn" style="margin-top:6px;color:white;background:#e53e3e;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Delete recording</button>
                <button class="add-review-btn" style="margin-top:6px;color:white;background:#38a169;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Add review</button>
            `;
            container.querySelector('.delete-recording-btn').addEventListener('click', () => {
                deleteRecording(() => plBack.closePopup());
            });
            container.querySelector('.add-review-btn').addEventListener('click', () => {
                const latlng = layer.getPopup()?.getLatLng() ?? layer.getCenter();
                window.map.setView([latlng.lat, latlng.lng], 17, { animate: true });
                plBack.closePopup();
                document.querySelector('#addspot-control a')?.click();
            });
            return container;
        });

        plBack.on('click', e => {
            L.DomEvent.stopPropagation(e)
        });

        plBack.on('popupopen', () => {
            plBack.setStyle({ color: 'red', opacity: 0.8 });
            recordingLayers.forEach(({ layer, type }) => {
                if (layer === plBack) return;
                if (type === 'polyline') layer.setStyle({ color: 'purple', opacity: 0.7 });
                else                    layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
            });
        });

        plBack.on('popupclose', () => {
            plBack.setStyle({ color: trackColor, opacity: baseOpacity });
            resetRecording();
        });

        plBack.addTo(recordingGroup);

        stops.forEach((loc, index) => {
            const radius        = 5;
            const isSinglePoint = locations.length === 1;
            const latlng        = [loc.latitude, loc.longitude];

            const cm = L.circleMarker(latlng, {
                radius,
                fillColor: trackColor,
                fillOpacity: markerOpacity,
                color: isCurrentRecording ? trackColor : 'white',
                weight: 2,
                interactive: true,
                renderer: svgRenderer
            });
            recordingLayers.push({ layer: cm, type: 'circleMarker' });

            cm.bindPopup(() => {
                const container = L.DomUtil.create('div');
                container.innerHTML = `
                    Stop ${index + 1} of ${stops.length}<br>
                    Arrival: ${loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'N/A'}<br>
                    Time spent: ${Math.ceil(loc.seconds_spent/60)} min<br>
                    Accuracy: ${loc.accuracy}m<br>
                    Speed: ${loc.speed}m<br>
                    ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}<br>
                    ${isSinglePoint ? `<button class="delete-recording-btn" style="margin-top:6px;color:white;background:#e53e3e;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Delete recording</button>` : ''}
                    <button class="add-review-btn" style="margin-top:6px;color:white;background:#38a169;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Add review</button>
                `;
                if (isSinglePoint) {
                    container.querySelector('.delete-recording-btn').addEventListener('click', () => {
                        deleteRecording(() => cm.closePopup());
                    });
                }
                container.querySelector('.add-review-btn').addEventListener('click', () => {
                    window.map.setView([loc.latitude, loc.longitude], 17, { animate: true });
                    cm.closePopup();
                    document.querySelector('#addspot-control a')?.click();
                    window._recording = {stops, activeIndex: index, id: drawRecordingId};
                });
                return container;
            });

            cm.on('popupopen', () => {
                cm.setStyle({ fillColor: 'red', color: 'red', fillOpacity: 0.9 });
                recordingLayers.forEach(({ layer, type }) => {
                    if (layer === cm) return;
                    if (type === 'polyline') layer.setStyle({ color: 'purple', opacity: 0.7 });
                    else                    layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
                });
            });

            cm.on('popupclose', () => {
                cm.setStyle({ fillColor: trackColor, color: isCurrentRecording ? trackColor : 'white', fillOpacity: markerOpacity });
                resetRecording();
            });

            cm.addTo(recordingGroup);
            cm.bringToFront();

            if (loc.nearby_point) {
                let closest = getMarkerForStop(loc);
                if (closest) {
                    cm.setStyle({fillOpacity: 0.5, opacity: 0.5, radius: 4});

                    const nearbyMarker = L.circleMarker(closest.getLatLng(), {
                        ...closest.options,
                        fillOpacity: 1,
                        fillColor: '#38f',
                        color: 'white',
                        weight: 2,
                        interactive: true,
                        renderer: svgRenderer,
                    });
                    nearbyMarker.on('click', e => {
                        window._recording = {stops, activeIndex: index, nearbyMarker: closest, id: drawRecordingId};
                        closest.fire('click', e);
                    });

                    if (window.hitch.active == closest) {
                        window._recording = {stops, activeIndex: index, nearbyMarker: closest, id: drawRecordingId};
                        updateRecordingInfo(closest);
                    }

                    nearbyMarker.addTo(recordingGroup);

                    if (closest in userMarkers) {
                        const userDot = new L.circleMarker(closest.getLatLng(), {
                            stroke: false,
                            fill: true,
                            radius: 1,
                            fillColor: 'white',
                            fillOpacity: 1,
                            interactive: false,
                            renderer: svgRenderer
                        });
                        userDot.addTo(recordingGroup);
                    }

                    recordingLayers.push({ layer: nearbyMarker, type: 'circleMarker' });
                    setTimeout(() => nearbyMarker.bringToFront(), 0);
                }
            }
        });

        if (hitchmapBackground) {
            plBack.bringToBack();
        }
    });
}

export function getMarkerForStop(loc) {
    if (!loc?.nearby_point) return undefined;
    return window.reviewData.find(review => review[C.SHORT_ID] === loc.nearby_point)?._marker;
}

function drawLocalRecordings() {
    if (!localRecordingGroup || !localRecordingGroupBack) return;

    localRecordingGroup.clearLayers();
    localRecordingGroupBack.clearLayers();

    if (!lastRecordingTimestamp) return;

    localLocationsList
        .filter(loc => loc.time > lastRecordingTimestamp)
        .forEach((loc) => {
            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 5,
                fillColor: '#e33',
                fillOpacity: 1,
                color: '#900',
                weight: 2,
                interactive: false,
                pane: 'user-recordings',
            }).addTo(localRecordingGroupBack);

            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 5,
                fillColor: '#e33',
                fillOpacity: 0,
                color: 'transparent',
                weight: 2,
                interactive: true,
            }).bindPopup(`
                <i>Local (not yet synced)</i><br>
                Time: ${loc.time ? new Date(loc.time).toLocaleString() : 'N/A'}<br>
                ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
            `).addTo(localRecordingGroup);
        });

    localRecordingGroupBack.getLayers().forEach(l => l.bringToBack?.());
    localRecordingGroup.getLayers().forEach(l => l.bringToBack?.());
}

export function lastCoordinate(recordingsMap) {
    if (!recordingsMap || Object.keys(recordingsMap).length === 0) return null;

    const recordingIds    = Object.keys(recordingsMap);
    const lastRecordingId = recordingIds[recordingIds.length - 1];
    const lastRecording   = recordingsMap[lastRecordingId];
    if (!lastRecording || lastRecording.length === 0) return null;

    const lastLocation = lastRecording[lastRecording.length - 1];
    return {
        recordingId:  lastRecordingId,
        location:     lastLocation,
        coordinates:  [lastLocation.latitude, lastLocation.longitude]
    };
}

async function applyPickerSelection(selection) {
    const filtered = {};

    if (selection) {
        const data = await ensureRecordingLoaded(selection);
        if (data?.locations) filtered[selection] = data.locations;
    }

    if (recordingId) {
        const data = await ensureRecordingLoaded(recordingId);
        if (data?.locations) filtered[recordingId] = data.locations;
    }

    drawRecordings(filtered, lastRecordingTimestamp);
}

export function updateRecordingInfo(marker) {
    const isRecordingMarker = marker === window._recording?.nearbyMarker;
    document.body.classList.toggle('recording-marker-is-open', isRecordingMarker);

    const stop = window._recording?.stops?.[window._recording?.activeIndex];
    if (stop) {
        $$('#show-spot-arrival').innerText = stop.timestamp
            ? new Date(stop.timestamp).toLocaleString()
            : 'N/A';
        $$('#show-spot-time-spent').innerText = stop.seconds_spent != null
            ? `${Math.ceil(stop.seconds_spent / 60)} min`
            : 'N/A';
    }
}

let recordingPollInterval = null;

async function refreshRecording(rec) {
    if (!rec) return;
    const data = await fetchRecording(rec);
    if (!data) return;
    const completedIds = knownRecordingIds.filter(id => id !== rec);
    if (loadShowAll()) {
        await drawRecordingsForIds(knownRecordingIds);
    } else {
        await applyPickerSelection(activePickerSelection);
    }
    updateThumb(completedIds, activePickerSelection);
}

function startRecordingPoll() {
    if (recordingPollInterval) return;
    recordingPollInterval = setInterval(_ => refreshRecording(recordingId), 30_000);
}

function stopRecordingPoll() {
    if (!recordingPollInterval) return;
    clearInterval(recordingPollInterval);
    recordingPollInterval = null;
}

import { firstUserPromise } from './user';
import { UserLocationDisplay } from './user-location-display';
import { outlinedPolyline } from './utils';

let isTracking = false;
let shareSecret;
let recordingId;
let receivedLocations = false;
export let localLocationsList = [];

let userLocationDisplay;
let lastRecordingTimestamp;
let localRecordingGroup;
let localRecordingGroupBack;

// ─── Recording picker state ───────────────────────────────────────────────────
const PICKER_STORAGE_KEY   = 'hitchmap_active_picker_selection';
const SHOW_ALL_STORAGE_KEY = 'hitchmap_show_all_recordings';

let activePickerSelection = null; // null = not yet initialized

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

/**
 * Persist the selected recording ID.
 * When it's the last completed recording, remove the key so newly created
 * recordings are picked up automatically on the next visit.
 */
function savePickerSelection(id, completedIds) {
    try {
        const isLast = id === completedIds[completedIds.length - 1];
        if (isLast) localStorage.removeItem(PICKER_STORAGE_KEY);
        else        localStorage.setItem(PICKER_STORAGE_KEY, id);
    } catch { /* ignore */ }
}

export async function initializeUserLocationDisplay() {
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
    document.body.classList.toggle('tracking', isTracking);
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

// ─── Recording picker (prev/next arrows + tooltip) ───────────────────────────

export function initRecordingPicker(recordingGroup, recordings) {
    if (!recordings) return;

    const completedIds = Object.keys(recordings).filter(id => id !== recordingId);

    document.body.classList.toggle('has-multiple-recordings', completedIds.length >= 2);

    // Initialise selection once
    if (activePickerSelection === null) {
        const stored = loadPickerSelection();
        activePickerSelection = (stored && recordings[stored])
            ? stored
            : (completedIds[completedIds.length - 1] ?? null);
    }

    // Clamp to a valid entry
    if (activePickerSelection && !recordings[activePickerSelection]) {
        activePickerSelection = completedIds[completedIds.length - 1] ?? null;
    }

    // Restore show-all from its own key
    const showAll = loadShowAll();
    document.body.classList.toggle('showing-all-recordings', showAll);

    applyAndRender(recordingGroup, recordings, completedIds);
    bindPickerControls(recordingGroup, recordings, completedIds);
}

function applyAndRender(recordingGroup, recordings, completedIds) {
    if (loadShowAll()) {
        drawRecordings(recordingGroup, recordings, lastRecordingTimestamp);
    } else {
        applyPickerSelection(recordingGroup, recordings, activePickerSelection);
    }
    updateThumb(recordings, completedIds, activePickerSelection);
}

function updateThumb(recordings, completedIds, selection) {
    const svgEl = document.getElementById('recording-picker-thumb-svg');
    if (!svgEl) return;

    const locs      = (selection && recordings[selection]) || [];
    const isCurrent = selection === recordingId;
    renderTrackSvg(svgEl, locs, isCurrent ? '#e33' : '#38f',
        isCurrent ? 'now' : (selection ? recordingDate(selection) : null));

    const idx     = completedIds.indexOf(selection);
    const prevBtn = document.getElementById('recording-picker-prev');
    const nextBtn = document.getElementById('recording-picker-next');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= completedIds.length - 1;
}

function bindPickerControls(recordingGroup, recordings, completedIds) {
    const control   = document.getElementById('recording-picker-control');
    const prevBtn   = document.getElementById('recording-picker-prev');
    const nextBtn   = document.getElementById('recording-picker-next');
    const thumb     = document.getElementById('recording-picker-thumb');
    const tooltip   = document.getElementById('recording-thumb-tooltip');
    const showAllCb = document.getElementById('rtt-show-all-toggle');

    prevBtn.onclick = (e) => {
        L.DomEvent?.stopPropagation(e);
        control?.classList.remove('tooltip-open');
        const idx = completedIds.indexOf(activePickerSelection);
        if (idx > 0) {
            activePickerSelection = completedIds[idx - 1];
            savePickerSelection(activePickerSelection, completedIds);
            applyAndRender(recordingGroup, recordings, completedIds);
            panToSelection(recordings, activePickerSelection);
        }
    };

    nextBtn.onclick = (e) => {
        L.DomEvent?.stopPropagation(e);
        control?.classList.remove('tooltip-open');
        const idx = completedIds.indexOf(activePickerSelection);
        if (idx < completedIds.length - 1) {
            activePickerSelection = completedIds[idx + 1];
            savePickerSelection(activePickerSelection, completedIds);
            applyAndRender(recordingGroup, recordings, completedIds);
            panToSelection(recordings, activePickerSelection);
        }
    };

    thumb.onclick = (e) => {
        L.DomEvent?.stopPropagation(e);
        panToSelection(recordings, activePickerSelection);
        if (showAllCb) showAllCb.checked = document.body.classList.contains('showing-all-recordings');
        control?.classList.toggle('tooltip-open');
    };

    showAllCb.onchange = (e) => {
        const on = e.target.checked;
        saveShowAll(on);
        document.body.classList.toggle('showing-all-recordings', on);
        control?.classList.remove('tooltip-open');

        if (on) {
            drawRecordings(recordingGroup, recordings, lastRecordingTimestamp);
            const allLocs = completedIds.flatMap(id => recordings[id] || []);
            if (allLocs.length) {
                window.map.fitBounds(
                    L.latLngBounds(allLocs.map(l => [l.latitude, l.longitude])),
                    { padding: [40, 40], animate: true }
                );
            }
        } else {
            applyPickerSelection(recordingGroup, recordings, activePickerSelection);
        }
    };

    // Stop tooltip clicks from closing it
    tooltip.onclick = (e) => e.stopPropagation();

    // Close tooltip on outside click
    document.addEventListener('click', () => control?.classList.remove('tooltip-open'));
}

function panToSelection(recordings, selection) {
    const locs = (selection && recordings[selection]) || [];
    if (!locs.length) return;
    const latlngs = locs.map(l => [l.latitude, l.longitude]);
    if (latlngs.length === 1) {
        window.map.setView(latlngs[0], 19, { animate: true });
    } else {
        window.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], animate: true });
    }
}

// ─── Capacitor background geolocation ────────────────────────────────────────

if (window.Capacitor) {
    const BackgroundGeolocation = window.BackgroundGeolocation;
    const {SplashScreen, Share} = window.Capacitor.Plugins;

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
            if (await isServiceRunning()) {
                const oldConfig = await BackgroundGeolocation.getConfig();
                recordingId = oldConfig.postTemplate.recording_id;
            }
            if (!recordingId) recordingId = generateRecordingId();

            await BackgroundGeolocation.configure({
                stationaryRadius: 0,
                distanceFilter: 0,
                desiredAccuracy: BackgroundGeolocation.MEDIUM_ACCURACY,
                debug: true,
                notificationsEnabled: true,
                notificationTitle: "Hitchmap",
                notificationText: "Location tracking active",
                stopOnTerminate: false,
                startOnBoot: false,
                startForeground: true,
                locationProvider: BackgroundGeolocation.ACTIVITY_PROVIDER,
                interval: 30000,
                fastestInterval: 30000,
                activitiesInterval: 30000,
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
                    speed:        "@speed",
                    // heading:      "@heading",
                    bearing:      "@bearing",
                    tracking:     isTracking,
                    recording_id: recordingId
                }
            });
        } catch (error) {
            console.error('Error configuring:', error);
        }
    }

    async function startService() {
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
        isTracking = true;
        updateState();
        await startService();
    }

    async function stopTracking() {
        isTracking = false;
        updateState();
        if (!shareSecret) await stopService();
        else              await configure();
    }

    async function startSharing() {
        try {
            if (!shareSecret) {
                const response = await fetch('/share-location', { method: 'POST', credentials: 'include' });
                const data     = await response.json();
                if (data.success) shareSecret = data.location_share_secret;
            }

            const shareUrl = `${location.origin}/?share-secret=${shareSecret}`;
            updateState();
            await startService();
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
            if (!isTracking) await stopService();
        } catch (error) {
            console.error('Error stopping share:', error);
        }
    }

    BackgroundGeolocation.on('location', async (location) => {
        if (!receivedLocations) {
            if (await isServiceRunning()) {
                document.body.classList.add('has-user-location');
                await startCompassWatch();
            }
            if (document.body.dataset.centeringMode !== 'shared')
                document.body.dataset.centeringMode = 'user';
            receivedLocations = true;
        }
        localLocationsList.push(location);
        drawLocalRecordings();

        console.log(lastCompassHeading);

        userLocationDisplay.enable();
        userLocationDisplay.updateLocation(location);

        if (document.body.dataset.centeringMode === 'user') {
            window.map.setView([location.latitude, location.longitude], window.map.getZoom(), {
                animate: true, duration: 0.5
            });
        }
    });

    BackgroundGeolocation.on('error', (error) => {
        console.error('Background geolocation error:', error);
    });

    document.getElementById('start-tracking')?.addEventListener('click', startTracking);
    document.getElementById('stop-tracking')?.addEventListener('click', stopTracking);
    document.getElementById('share-location')?.addEventListener('click', startSharing);
    document.getElementById('send-location')?.addEventListener('click', startSharing);
    document.getElementById('unshare-location')?.addEventListener('click', stopSharing);

    firstUserPromise.then(async (user) => {
        const isRunning = await isServiceRunning();
        isTracking  = isRunning && (await BackgroundGeolocation.getConfig()).postTemplate.tracking === true;
        shareSecret = shareSecret || user.location_share_secret;

        if (shareSecret || isTracking)   await startService();
        if (!shareSecret && !isTracking) await stopService();

        updateState();
    });

    window.hitchmapTracker = {
        startTracking,
        stopTracking,
        startSharing,
        stopSharing,
        isTracking:       () => isTracking,
        shareSecret:      () => shareSecret,
        recordingId:      () => recordingId,
        isServiceRunning,
        localLocationsList
    };
}


/**
 * Build one recording's layers into two groups:
 *   backGroup  – visible layers on 'user-recordings' pane (below markers)
 *   frontGroup – invisible (opacity 0) layers on the default overlay pane
 *                kept solely for Leaflet hit-testing / click events
 *
 * Color scheme:
 *   - Current recording (recordingId)  → red (#e33)
 *   - All other (completed) recordings → blue (#38f)
 */
export function drawRecordings(recordingGroup, recordings, lastTimestamp) {
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
        const markerOpacity = isCurrentRecording ? 1 : 0.9;

        const recordingLayers = [];

        function resetRecording() {
            recordingLayers.forEach(({ layer, type }) => {
                if (type === 'polyline') {
                    layer.setStyle({ color: trackColor, opacity: baseOpacity });
                } else {
                    layer.setStyle({ fillColor: trackColor, color: isCurrentRecording ? trackColor : 'white', fillOpacity: markerOpacity });
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
            pane: 'user-recordings',
            interactive: false,
            outline: true,
            outlineColor,
            outlineWidth: 1,
        });
        plBack.addTo(backGroup);
        recordingLayers.push({ layer: plBack, type: 'polyline' });

        const latLngs = locations.map(loc => [loc.latitude, loc.longitude]);
        const pl = outlinedPolyline(latLngs, {
            weight: isCurrentRecording ? 2 : 1,
            opacity: 0,
            fillOpacity: 0,
            outline: true,
            outlineWidth: 1
        });

        pl.bindPopup((layer) => {
            const container = L.DomUtil.create('div');
            container.innerHTML = `
                <b>Recording ${drawRecordingId}</b><br>
                Points: ${locations.length}<br>
                <button class="delete-recording-btn" style="margin-top:6px;color:white;background:#e53e3e;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Delete</button>
                <button class="add-review-btn" style="margin-top:6px;color:white;background:#38a169;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Add review</button>
            `;
            container.querySelector('.delete-recording-btn').addEventListener('click', () => {
                deleteRecording(() => pl.closePopup());
            });
            container.querySelector('.add-review-btn').addEventListener('click', () => {
                const latlng = layer.getPopup()?.getLatLng() ?? layer.getCenter();
                window.map.setView([latlng.lat, latlng.lng], 19, { animate: true });
                pl.closePopup();
                document.querySelector('#addspot-control a')?.click();
            });
            return container;
        });

        pl.on('popupopen', () => {
            plBack.setStyle({ color: 'red', opacity: 0.8 });
            recordingLayers.forEach(({ layer, type }) => {
                if (layer === plBack) return;
                if (type === 'polyline') layer.setStyle({ color: 'purple', opacity: 0.7 });
                else                    layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
            });
        });

        pl.on('popupclose', () => {
            plBack.setStyle({ color: trackColor, opacity: baseOpacity });
            resetRecording();
        });

        pl.addTo(recordingGroup);

        locations.forEach((loc, index) => {
            if (loc.seconds_spent <= 300) return;
            const radius        = 5;
            const isSinglePoint = locations.length === 1;

            const cmBack = L.circleMarker(latLngs[index], {
                radius,
                fillColor: trackColor,
                fillOpacity: markerOpacity,
                color: isCurrentRecording ? trackColor : 'white',
                weight: 1,
                interactive: false,
                pane: 'user-recordings',
            });
            cmBack.addTo(backGroup);
            recordingLayers.push({ layer: cmBack, type: 'circleMarker' });

            const cm = L.circleMarker(latLngs[index], {
                radius,
                fillColor: trackColor,
                fillOpacity: 0,
                color: 'transparent',
                weight: 1,
                interactive: true,
            });

            cm.bindPopup(() => {
                const container = L.DomUtil.create('div');
                container.innerHTML = `
                    <b>Recording ${drawRecordingId}</b><br>
                    Point ${index + 1} of ${locations.length}<br>
                    Arrival: ${loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'N/A'}<br>
                    Time spent: ${Math.ceil(loc.seconds_spent/60)} min<br>
                    Lat: ${loc.latitude.toFixed(6)}<br>
                    Lng: ${loc.longitude.toFixed(6)}<br>
                    ${isSinglePoint ? `<button class="delete-recording-btn" style="margin-top:6px;color:white;background:#e53e3e;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Delete</button>` : ''}
                    <button class="add-review-btn" style="margin-top:6px;color:white;background:#38a169;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;">Add review</button>
                `;
                if (isSinglePoint) {
                    container.querySelector('.delete-recording-btn').addEventListener('click', () => {
                        deleteRecording(() => cm.closePopup());
                    });
                }
                container.querySelector('.add-review-btn').addEventListener('click', () => {
                    window.map.setView([loc.latitude, loc.longitude], 19, { animate: true });
                    cm.closePopup();
                    document.querySelector('#addspot-control a')?.click();
                    window.prefillReviewData = loc;
                });
                return container;
            });

            cm.on('popupopen', () => {
                cmBack.setStyle({ fillColor: 'red', color: 'red', fillOpacity: 0.9 });
                recordingLayers.forEach(({ layer, type }) => {
                    if (layer === cmBack) return;
                    if (type === 'polyline') layer.setStyle({ color: 'purple', opacity: 0.7 });
                    else                    layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
                });
            });

            cm.on('popupclose', () => {
                cmBack.setStyle({ fillColor: trackColor, color: isCurrentRecording ? trackColor : 'white', fillOpacity: markerOpacity });
                resetRecording();
            });

            cm.addTo(recordingGroup);

            if (hitchmapBackground) {
                cmBack.bringToBack();
                cm.bringToBack();
            }
        });

        if (hitchmapBackground) {
            plBack.bringToBack();
            pl.bringToBack();
        }
    });
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
                <b>Recording ${loc.recording_id}</b><br>
                <i>Local (not yet synced)</i><br>
                Time: ${loc.time ? new Date(loc.time).toLocaleString() : 'N/A'}<br>
                Lat: ${loc.latitude.toFixed(6)}<br>
                Lng: ${loc.longitude.toFixed(6)}
            `).addTo(localRecordingGroup);
        });

    localRecordingGroupBack.getLayers().forEach(l => l.bringToBack?.());
    localRecordingGroup.getLayers().forEach(l => l.bringToBack?.());
}

export function lastCoordinate(recordings) {
    if (!recordings || Object.keys(recordings).length === 0) return null;

    const recordingIds    = Object.keys(recordings);
    const lastRecordingId = recordingIds[recordingIds.length - 1];
    const lastRecording   = recordings[lastRecordingId];
    if (!lastRecording || lastRecording.length === 0) return null;

    const lastLocation = lastRecording[lastRecording.length - 1];
    return {
        recordingId:  lastRecordingId,
        location:     lastLocation,
        coordinates:  [lastLocation.latitude, lastLocation.longitude]
    };
}

function applyPickerSelection(recordingGroup, recordings, selection) {
    if (!recordings) return;

    const filtered = {};
    if (selection && recordings[selection])     filtered[selection]   = recordings[selection];
    if (recordingId && recordings[recordingId]) filtered[recordingId] = recordings[recordingId];

    drawRecordings(recordingGroup, filtered, lastRecordingTimestamp);
}

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

export async function initializeUserLocationDisplay() {
    userLocationDisplay = window.hitchmapTracker.uld = new UserLocationDisplay(window.map, {
        drawCircle: true,    // Show accuracy circle
        drawMarker: true,    // Show position marker
        showCompass: true    // Show bearing arrow
    });
    localRecordingGroup = L.layerGroup().addTo(window.map);
    localRecordingGroupBack = L.layerGroup().addTo(window.map);
}

function generateRecordingId() {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function updateState() {
    document.body.classList.toggle('tracking', isTracking);
    document.body.classList.toggle('sharing-location', !!shareSecret);
}

if (window.Capacitor) {
    const BackgroundGeolocation = window.BackgroundGeolocation;
    const {SplashScreen, Share} = window.Capacitor.Plugins;

    SplashScreen.hide();
    window.addEventListener('beforeunload', () => {
        SplashScreen.show();
    });

    // Compass heading management
    let compassWatchId = null;
    let lastCompassHeading = null;

    function startCompassWatch() {
        if (!navigator.compass || compassWatchId !== null) return;

        compassWatchId = navigator.compass.watchHeading(
            (heading) => {
                lastCompassHeading = heading.magneticHeading;
                userLocationDisplay.updateHeading(lastCompassHeading);
            },
            (error) => {
                console.error('Compass error:', error);
            },
            { frequency: 1000 } // Update every second
        );
    }

    function stopCompassWatch() {
        if (!navigator.compass || compassWatchId === null) return;

        navigator.compass.clearWatch(compassWatchId);
        compassWatchId = null;
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
            // don't change the recording ID if the service is already running!
            if (await isServiceRunning()) {
                let oldConfig = await BackgroundGeolocation.getConfig()
                recordingId = oldConfig.postTemplate.recording_id
            }

            if (!recordingId)
                recordingId = generateRecordingId()

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
                httpHeaders: {
                    "Content-Type": "application/json"
                },
                maxLocations: 10000,
                postTemplate: {
                    latitude: "@latitude",
                    longitude: "@longitude",
                    accuracy: "@accuracy",
                    timestamp: "@time",
                    speed: "@speed",
                    heading: "@heading",
                    bearing: "@bearing",
                    tracking: isTracking,
                    recording_id: recordingId
                }
            });
        } catch (error) {
            console.error('Error configuring:', error);
        }
    }

    async function startService() {
        await configure();
        startCompassWatch(); // Start compass when service starts
        if (!await isServiceRunning())
            receivedLocations = false;
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
            stopCompassWatch(); // Stop compass when service stops

            if (document.body.dataset.centeringMode === 'user')
                document.body.dataset.centeringMode = null;

            await BackgroundGeolocation.stop();
            recordingId = generateRecordingId();
            // reset recording ID
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

        if (!shareSecret) {
            await stopService();
        } else {
            await configure();
        }
    }

    async function startSharing() {
        try {
            if (!shareSecret) {
                const response = await fetch('/share-location', {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await response.json();

                if (data.success) {
                    shareSecret = data.location_share_secret;
                }
            }

            const shareUrl = `${location.origin}/?share-secret=${shareSecret}`;

            updateState();
            await startService();

            Share.share({
                url: shareUrl,
            });
        } catch (error) {
            console.error('Error starting share:', error);
            alert('Failed to start sharing location');
        }
    }

    async function stopSharing() {
        try {
            await fetch('/unshare-location', {
                method: 'POST',
                credentials: 'include'
            });

            shareSecret = false;
            updateState();

            if (!isTracking) {
                await stopService();
            }
        } catch (error) {
            console.error('Error stopping share:', error);
        }
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(text);
                alert('Share link copied to clipboard:\n' + text);
            } catch {
                alert('Share link:\n' + text);
            }
        } else {
            alert('Share link:\n' + text);
        }
    }

    BackgroundGeolocation.on('location', async (location) => {
        if (!receivedLocations) {
            if (await isServiceRunning()) {
                document.body.classList.add('has-user-location');
                await startCompassWatch();
            }

            if (document.body.dataset.centeringMode !== 'shared') {
                document.body.dataset.centeringMode = 'user';
            }
            receivedLocations = true;
        }
        localLocationsList.push(location);
        drawLocalRecordings();

        console.log(lastCompassHeading)

        userLocationDisplay.enable();
        userLocationDisplay.updateLocation(location);

        if (document.body.dataset.centeringMode === 'user') {
            const coords = [location.latitude, location.longitude];
            window.map.setView(coords, window.map.getZoom(), {
                animate: true,
                duration: 0.5
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
        const isRunning = await isServiceRunning()
        isTracking = isRunning && (await BackgroundGeolocation.getConfig()).postTemplate.tracking === true
        shareSecret = shareSecret || user.location_share_secret;

        if (shareSecret || isTracking) {
            await startService();
        }

        if (!shareSecret && !isTracking) {
            await stopService();
        }

        updateState();
    });

    window.hitchmapTracker = {
        startTracking,
        stopTracking,
        startSharing,
        stopSharing,
        isTracking: () => isTracking,
        shareSecret: () => shareSecret,
        recordingId: () => recordingId,
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
 * Both groups are kept in sync so bringToBack() order is consistent.
 */
export function drawRecordings(recordingGroup, recordings, lastTimestamp) {
    recordingGroup.clearLayers();

    if (!recordingGroup._backGroup) {
        recordingGroup._backGroup = L.layerGroup([], { pane: 'user-recordings' }).addTo(window.map);
    }
    const backGroup = recordingGroup._backGroup;
    backGroup.clearLayers();

    if (!recordings) return;

    if (window.Capacitor)
        drawLocalRecordings();

    if (lastTimestamp)
        lastRecordingTimestamp = lastTimestamp;

    const hitchmapBackground = recordingGroup.options.hitchmapBackground;

    Object.entries(recordings).forEach(([drawRecordingId, locations]) => {
        if (!locations || locations.length === 0) return;

        const trackColor = '#38f';
        const latLngs = locations.map(loc => [loc.latitude, loc.longitude]);
        const isCurrentRecording = recordingId === drawRecordingId;
        const baseOpacity = isCurrentRecording ? 0.6 : 0.4;
        const markerOpacity = isCurrentRecording ? 1 : 0.9;

        const recordingLayers = [];

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
                    } else {
                        alert(data.error || 'Failed to delete recording.');
                    }
                })
                .catch(() => alert('Failed to delete recording.'));
        }

        // --- Back-pane polyline (visible) ---
        let plBack = L.polyline(latLngs, {
            color: trackColor,
            weight: 3,
            opacity: baseOpacity,
            pane: 'user-recordings',
            interactive: false,
        });
        plBack.addTo(backGroup);
        recordingLayers.push({ layer: plBack, type: 'polyline' });

        // --- Front-pane polyline (invisible, handles interaction) ---
        let pl = L.polyline(latLngs, {
            color: trackColor,
            weight: 3,
            opacity: 0,
            fillOpacity: 0,
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
                const addspotLink = document.querySelector('#addspot-control a');
                if (addspotLink) addspotLink.click();
            });
            return container;
        });

        pl.on('popupopen', () => {
            plBack.setStyle({ color: 'red', opacity: 0.8 });
            recordingLayers.forEach(({ layer, type }) => {
                if (layer === plBack) return;
                if (type === 'polyline') {
                    layer.setStyle({ color: 'purple', opacity: 0.7 });
                } else {
                    layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
                }
            });
        });

        pl.on('popupclose', () => {
            plBack.setStyle({ color: trackColor, opacity: baseOpacity });
            resetRecording();
        });

        pl.addTo(recordingGroup);

        // --- Per-location markers ---
        locations.forEach((loc, index) => {
            if (loc.seconds_spent <= 300) return;
            const radius = 5;
            const isSinglePoint = locations.length === 1;

            // Back-pane marker (visible)
            let cmBack = L.circleMarker(latLngs[index], {
                radius,
                fillColor: trackColor,
                fillOpacity: markerOpacity,
                color: 'white',
                weight: 1,
                interactive: false,
                pane: 'user-recordings',
            });
            cmBack.addTo(backGroup);
            recordingLayers.push({ layer: cmBack, type: 'circleMarker' });

            // Front-pane marker (invisible, handles interaction)
            let cm = L.circleMarker(latLngs[index], {
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
                    Time: ${loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'N/A'}<br>
                    Time spent: ${loc.seconds_spent}s<br>
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
                    const addspotLink = document.querySelector('#addspot-control a');
                    if (addspotLink) addspotLink.click();
                });
                return container;
            });

            cm.on('popupopen', () => {
                cmBack.setStyle({ fillColor: 'red', color: 'red', fillOpacity: 0.9 });
                recordingLayers.forEach(({ layer, type }) => {
                    if (layer === cmBack) return;
                    if (type === 'polyline') {
                        layer.setStyle({ color: 'purple', opacity: 0.7 });
                    } else {
                        layer.setStyle({ fillColor: 'purple', color: 'purple', fillOpacity: 0.7 });
                    }
                });
            });

            cm.on('popupclose', () => {
                cmBack.setStyle({ fillColor: trackColor, color: 'white', fillOpacity: markerOpacity });
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
            console.log('GOT LOC', loc);

            // Back-pane (visible)
            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 5,
                fillColor: 'black',
                fillOpacity: 1,
                color: 'white',
                weight: 2,
                interactive: false,
                pane: 'user-recordings',
            }).addTo(localRecordingGroupBack);

            // Front (invisible, interactive)
            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 5,
                fillColor: 'black',
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

    // Keep consistent back order
    localRecordingGroupBack.getLayers().forEach(l => l.bringToBack && l.bringToBack());
    localRecordingGroup.getLayers().forEach(l => l.bringToBack && l.bringToBack());
}

export function lastCoordinate(recordings) {
    if (!recordings || Object.keys(recordings).length === 0) return null;

    const recordingIds = Object.keys(recordings);
    const lastRecordingId = recordingIds[recordingIds.length - 1];

    const lastRecording = recordings[lastRecordingId];
    if (!lastRecording || lastRecording.length === 0) return null;

    const lastLocation = lastRecording[lastRecording.length - 1];

    return {
        recordingId: lastRecordingId,
        location: lastLocation,
        coordinates: [lastLocation.latitude, lastLocation.longitude]
    };
}

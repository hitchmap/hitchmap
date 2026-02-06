import { firstUserPromise } from './user';
import { UserLocationDisplay } from './user-location-display';

let isTracking = false;
let shareSecret;
let recordingId;
let receivedLocations = false;
export let localLocationsList = [];

let userLocationDisplay;
let lastRecordingTimestamp;
let localRecordingGroup;

export async function initializeUserLocationDisplay(map) {
    userLocationDisplay = window.hitchmapTracker.uld = new UserLocationDisplay(map, {
        drawCircle: true,    // Show accuracy circle
        drawMarker: true,    // Show position marker
        showCompass: true    // Show bearing arrow
    });
    localRecordingGroup = L.layerGroup().addTo(map);
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


export function drawRecordings(recordingGroup, recordings, lastTimestamp) {
    recordingGroup.clearLayers();
    if (!recordings) return;

    lastRecordingTimestamp = lastTimestamp;

    // Pass 1: polylines and server-recording dots
    Object.entries(recordings).forEach(([thisRecordingId, locations]) => {
        if (!locations || locations.length === 0) return;
        const latLngs = locations.map(loc => [loc.latitude, loc.longitude]);

        L.polyline(latLngs, {
            color: '#3388ff',
            weight: 3,
            opacity: recordingId === thisRecordingId ? 0.4 : 0.2
        }).addTo(recordingGroup);

        locations.forEach((loc, index) => {
            L.circleMarker(latLngs[index], {
                radius: 3,
                fillColor: '#3388ff',
                opacity: recordingId === thisRecordingId ? 0.6 : 0.2,
                color: 'white',
                weight: 1,
                interactive: true
            }).bindPopup(`
                <b>Recording ${thisRecordingId}</b><br>
                Point ${index + 1} of ${locations.length}<br>
                Time: ${loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'N/A'}<br>
                Lat: ${loc.latitude.toFixed(6)}<br>
                Lng: ${loc.longitude.toFixed(6)}
            `).addTo(recordingGroup);
        });
    });
    if (window.Capacitor)
        drawLocalRecordings();
}

function drawLocalRecordings() {
    localRecordingGroup.clearLayers();

    // Pass 2: local dots drawn last, on top
    if (!lastRecordingTimestamp) return;
    localLocationsList
        .filter(loc => loc.time > lastRecordingTimestamp)
        .forEach((loc) => {
            console.log('GOT LOC')
            console.log(loc)
            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 5,
                fillColor: 'black',
                fillOpacity: 0.5,
                color: 'white',
                weight: 2,
                interactive: true
            }).bindPopup(`
                <b>Recording ${loc.recording_id}</b><br>
                <i>Local (not yet synced)</i><br>
                Time: ${loc.time ? new Date(loc.time).toLocaleString() : 'N/A'}<br>
                Lat: ${loc.latitude.toFixed(6)}<br>
                Lng: ${loc.longitude.toFixed(6)}
            `).addTo(localRecordingGroup);
        });
}

export function lastCoordinate(recordings) {
    if (!recordings || Object.keys(recordings).length === 0) return null;

    // Get the last recording ID (assuming ordered by date)
    const recordingIds = Object.keys(recordings);
    const lastRecordingId = recordingIds[recordingIds.length - 1];

    // Get the last location in that recording
    const lastRecording = recordings[lastRecordingId];
    if (!lastRecording || lastRecording.length === 0) return null;

    const lastLocation = lastRecording[lastRecording.length - 1];

    return {
        recordingId: lastRecordingId,
        location: lastLocation,
        coordinates: [lastLocation.latitude, lastLocation.longitude]
    };
}

import { firstUserPromise } from './user';
import { UserLocationDisplay } from './user-location-display';

let isTracking = false;
let shareSecret;
let recordingId = generateRecordingId();
let receivedLocations = false;

export let lastUserLocation;
let userLocationDisplay;

export async function initializeUserLocationDisplay(map) {
    userLocationDisplay = new UserLocationDisplay(map, {
        drawCircle: true,    // Show accuracy circle
        drawMarker: true,    // Show position marker
        showCompass: true    // Show bearing arrow
    });
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
        if (await isServiceRunning()) return;
        receivedLocations = false;

        try {
            await BackgroundGeolocation.start();
            startCompassWatch(); // Start compass when service starts
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
            lastUserLocation = null;
            stopCompassWatch(); // Stop compass when service stops

            if (document.body.dataset.centeringMode === 'user')
                document.body.dataset.centeringMode = null;

            await BackgroundGeolocation.stop();
            recordingId = generateRecordingId();
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
        lastUserLocation = location;

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

        if (shareSecret) {
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
        isServiceRunning
    };
}


export function drawRecordings(recordingGroup, recordings) {
    recordingGroup.clearLayers();

    if (!recordings) return;

    // Iterate through each recording
    Object.entries(recordings).forEach(([recordingId, locations]) => {
        if (!locations || locations.length === 0) return;

        // Extract coordinates for the polyline
        const latLngs = locations.map(loc => [loc.latitude, loc.longitude]);

        // Create polyline for the recording
        const polyline = L.polyline(latLngs, {
            color: '#3388ff',
            weight: 3,
            opacity: 0.7
        });
        polyline.addTo(recordingGroup);

        // Add dots on each vertex
        latLngs.forEach((latLng, index) => {
            const dot = L.circleMarker(latLng, {
                radius: 3,
                fillColor: '#3388ff',
                fillOpacity: 1,
                color: 'white',
                weight: 1,
                interactive: true
            });

            // Optional: Add popup with timestamp and position info
            const timestamp = locations[index].timestamp;
            dot.bindPopup(`
                <b>Recording ${recordingId}</b><br>
                Point ${index + 1} of ${locations.length}<br>
                Time: ${new Date(timestamp).toLocaleString()}<br>
                Lat: ${latLng[0].toFixed(6)}<br>
                Lng: ${latLng[1].toFixed(6)}
            `);

            dot.addTo(recordingGroup);
        });
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

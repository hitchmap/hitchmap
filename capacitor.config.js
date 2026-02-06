module.exports = {
    appId: 'com.hitchmap.app',
    appName: 'Hitchmap',
    webDir: 'dist',
    server: {
        url: 'http://192.168.2.4:5000',
        cleartext: true,
    },
    ios: {
        contentInset: 'automatic',
        prefersStatusBarHidden: false,
        // Ensures the app respects safe areas on iOS
        allowsLinkPreview: false,
        backgroundColor: '#ffffff', // Prevents transparency behind status bar
    },
    android: {
        allowMixedContent: true,
        useLegacyBridge: false,
        backgroundColor: '#ffffff',
        // Disable fullscreen so content doesn't extend behind status/home bars
        fullscreen: false,
        immersiveMode: false,
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 0,
            androidScaleType: 'CENTER_CROP',
            showSpinner: true,
        },
        EdgeToEdge: {
            // Optional UI polish [1]
            backgroundColor: '#003366'
        },
        "CapacitorHttp": {
            "enabled": true
        },
        "CapacitorCookies": {
            "enabled": true
        },
    },
};

document.addEventListener("DOMContentLoaded", function() {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    // --- Android announcement ---
    const overlay = document.getElementById('app-announcement-overlay');
    const closeBtn = document.getElementById('close-app-overlay');
    const dontShowCheckbox = document.getElementById('dont-show-app-again');
    const isDismissed = localStorage.getItem('hideAndroidAnnouncement') === 'true';

    if (isAndroid && !window.Capacitor && !isDismissed) {
        overlay.classList.add('visible');
    }

    closeBtn.addEventListener('click', function() {
        if (dontShowCheckbox.checked) {
            localStorage.setItem('hideAndroidAnnouncement', 'true');
        }
        overlay.classList.remove('visible');
    });

    const appLink = document.querySelector('.android-app-link-btn');
    appLink.addEventListener('click', function(e) {
        e.preventDefault();
        const marketUrl = 'market://details?id=com.hitchmap.app';
        const fallbackUrl = 'https://play.google.com/store/apps/details?id=com.hitchmap.app';
        // Try to open the Play Store app directly
        window.location.href = marketUrl;
        // If Play Store doesn't open within ~1.5s, fall back to browser
        setTimeout(() => {
            window.location.href = fallbackUrl;
        }, 1500);
    });

    // --- iOS announcement ---
    const iosOverlay = document.getElementById('ios-app-announcement-overlay');
    const iosCloseBtn = document.getElementById('close-ios-app-overlay');
    const dontShowIosCheckbox = document.getElementById('dont-show-ios-app-again');
    const isIosDismissed = localStorage.getItem('hideIOSAnnouncement') === 'true';

    if (isIOS && !window.Capacitor && !isIosDismissed) {
        iosOverlay.classList.add('visible');
    }

    iosCloseBtn.addEventListener('click', function() {
        if (dontShowIosCheckbox.checked) {
            localStorage.setItem('hideIOSAnnouncement', 'true');
        }
        iosOverlay.classList.remove('visible');
    });
});

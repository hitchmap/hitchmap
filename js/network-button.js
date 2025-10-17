import {addAsLeafletControl} from './utils';

export function maybeAddNetworkButton() {
    // Always add the control immediately
    const networkToggleEl = addAsLeafletControl('#network-control');
    
    // Hide it by default if service worker not supported
    if (!('serviceWorker' in navigator)) {
        networkToggleEl.style.display = 'none';
        return networkToggleEl;
    }
    
    // Try to access service worker readiness without async
    navigator.serviceWorker.ready
        .then((registration) => {
            if (!registration.active) {
                networkToggleEl.style.display = 'none';
                return;
            }
            
            const networkToggleBtn = networkToggleEl.querySelector('#network-toggle');
            let networkEnabled = true; // Default
            
            function updateNetworkButton() {
                if (networkEnabled) {
                    networkToggleBtn.classList.remove('disabled');
                    networkToggleBtn.title = networkToggleBtn.getAttribute('data-title-enabled');
                } else {
                    networkToggleBtn.classList.add('disabled');
                    networkToggleBtn.title = networkToggleBtn.getAttribute('data-title-disabled');
                }
            }
            
            function toggleNetwork() {
                networkEnabled = !networkEnabled;
                updateNetworkButton();
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'TOGGLE_NETWORK',
                        enabled: networkEnabled
                    });
                }
            }
            
            // Request initial state from SW
            registration.active.postMessage({ type: 'GET_NETWORK_STATE' });
            
            // Listen for state updates from SW
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'NETWORK_STATE_CHANGED') {
                    networkEnabled = event.data.enabled;
                    updateNetworkButton();
                }
            });
            
            // Initialize
            updateNetworkButton();
            
            networkToggleBtn.addEventListener('click', (e) => {
                L.DomEvent.stopPropagation(e);
                e.preventDefault();
                toggleNetwork();
            });
        })
        .catch((err) => {
            console.log('Service worker not ready:', err);
            networkToggleEl.style.display = 'none';
        });
    
    return networkToggleEl;
}


/**
 * cloud-sync.js
 * Hijacks localStorage to passively sync State to the Neon Database via our Render Proxy.
 * 
 * Usage:
 * Add <script src="cloud-sync.js"></script> before <script src="db.js"></script>
 */

const SYNC_URL = 'https://attendease-messenger.onrender.com/api/db/sync';
const originalSetItem = Storage.prototype.setItem;

// 1. Hijack LocalStorage to push patches to Cloud automatically
let syncTimer = null;
Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (key.startsWith('attendease_')) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            const state = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('attendease_')) state[k] = localStorage.getItem(k);
            }
            try {
                await fetch(SYNC_URL, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(state)
                });
                console.log('[CloudSync] State pushed to Neon db');
            } catch (err) {
                console.warn('[CloudSync] Failed to push state', err);
            }
        }, 1000);
    }
};

// 2. Initial state hydration before the app boots
window.initCloudDb = async function() {
    try {
        console.log('[CloudSync] Fetching global state from Neon db...');
        const res = await fetch(SYNC_URL);
        const data = await res.json();
        
        if (data.ok && data.state && Object.keys(data.state).length > 0) {
            for (const [key, value] of Object.entries(data.state)) {
                // write silently without triggering our own hook
                originalSetItem.call(localStorage, key, value);
            }
            console.log('[CloudSync] Overwritten local state with Neon state!');
        }
    } catch (err) {
        console.warn('[CloudSync] Server down or not reachable, using local DB memory.', err);
    }
};

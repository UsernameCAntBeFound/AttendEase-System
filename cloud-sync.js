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
        const res = await fetch(SYNC_URL);
        const data = await res.json();
        
        if (data.ok && data.state && Object.keys(data.state).length > 0) {
            let changed = false;
            for (const [key, value] of Object.entries(data.state)) {
                if (localStorage.getItem(key) !== value) {
                    originalSetItem.call(localStorage, key, value);
                    changed = true;
                }
            }
            if (changed) {
                console.log('[CloudSync] Synced local state with Neon DB!');
                // Auto-refresh UI components if they exist
                if (window.renderDashboard) window.renderDashboard();
                if (window.refreshAttendanceSummary) window.refreshAttendanceSummary();
            }
        }
    } catch (err) {
        // silent fail on loop
    }
};

// 3. Keep polling the cloud every 3 seconds to keep UI live!
setInterval(() => {
    if (window.initCloudDb) window.initCloudDb();
}, 3000);

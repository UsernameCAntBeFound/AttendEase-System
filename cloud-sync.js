/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AttendEase â€” Cloud Synchronization Interface
   Target Proxy: https://attendease-sync.onrender.com/sync
   
   Behavior:
   This engine hijacks localStorage.setItem to detect changes.
   It debounces updates to batch rapid writes (like profile pic uploads).
   It pulls global state periodically to ensure cross-device consistency.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const SYNC_URL    = 'https://attendease-sync.onrender.com/sync';
const DEBOUNCE_MS = 1000;   // Near real-time syncing

// â”€â”€ 0. Internal State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const originalSetItem = Storage.prototype.setItem;
let syncTimeout       = null;
window.__cloudSyncPauseUntil = 0;

function _triggerSync() {
    window.__cloudSyncPauseUntil = Date.now() + 5000;
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        try {
            const state = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('attendease_')) {
                    state[k] = _stripHeavyFields(k, localStorage.getItem(k));
                }
            }
            // Add sync version
            const newVersion = Date.now().toString();
            state['__sync_version'] = newVersion;
            originalSetItem.call(localStorage, '__sync_version', newVersion);

            await fetch(SYNC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state })
            });
        } catch (err) {
            console.warn('Cloud pull failed, retrying later...', err);
        }
    }, DEBOUNCE_MS);
}

/** 
 * Strips heavy base64 blobs from cloud storage to save Neon DB space.
 * Heavy blobs (profile pictures, attachments) are kept in LOCAL storage only.
 */
function _stripHeavyFields(key, value) {
    if (!value) return value;
    try {
        const parsed = JSON.parse(value);
        
        // Strip profile pictures from all roles
        if (parsed.profilePic) {
            const { profilePic, ...rest } = parsed;
            return JSON.stringify(rest);
        }

        // Strip heavy attachments from news/announcements
        if (key.startsWith('attendease_teacher_')) {
            const rest = { ...parsed };
            if (Array.isArray(rest.announcements)) {
                rest.announcements = rest.announcements.map(a => ({
                    ...a,
                    attachments: (a.attachments || []).map(att => ({
                        name: att.name,
                        type: att.type,
                        // dataUrl intentionally omitted â€” kept in teacher's local only
                    })),
                }));
            }
            return JSON.stringify(rest);
        }

        return value;
    } catch {
        return value;
    }
}

// â”€â”€ 1. Change Detection â€” Hijack SetItem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Storage.prototype.setItem = function (key, value) {
    originalSetItem.apply(this, arguments);
    if (key.startsWith('attendease_')) {
        _triggerSync();
    }
};

window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('attendease_')) {
        // Pause cloud pull in other tabs when one tab updates storage
        window.__cloudSyncPauseUntil = Date.now() + 5000;
    }
});

// â”€â”€ 2. Initial hydration â€” pull cloud state before app boots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.initCloudDb = async function () {
    if (Date.now() < window.__cloudSyncPauseUntil) return; 
    try {
        // Cache bust with timestamp to prevent Vercel/CDN caching
        const res = await fetch(`${SYNC_URL}?t=${Date.now()}`);
        const data = await res.json();

        if (data.ok && data.state && Object.keys(data.state).length > 0) {
            let changed = false;

            for (const [key, value] of Object.entries(data.state)) {
                // Merge remote into local
                const localStr = localStorage.getItem(key);
                if (!localStr) {
                    originalSetItem.call(localStorage, key, value);
                    changed = true;
                    continue;
                }

                try {
                    const local  = JSON.parse(localStr);
                    const remote = JSON.parse(value);
                    
                    // Preserve local heavy data
                    if (local.profilePic) remote.profilePic = local.profilePic;
                    
                    const merged = JSON.stringify(remote);
                    if (localStr !== merged) {
                        originalSetItem.call(localStorage, key, merged);
                        changed = true;
                    }
                } catch {
                    if (localStr !== value) {
                        originalSetItem.call(localStorage, key, value);
                        changed = true;
                    }
                }
            }

            // Trigger UI update if dashboard is loaded
            if (changed && window.renderDashboard) {
                window.renderDashboard();
            }
        }
    } catch (err) {
        console.error('Initial Cloud Sync failed:', err);
    }
};

// â”€â”€ 3. Background Polling â€” Keep state fresh for all users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const POLL_ACTIVE_MS  =  2000;  // 2s pull when tab is open
const POLL_HIDDEN_MS  = 10000;  // 10s when hidden

function _schedulePoll() {
    const delay = document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
    setTimeout(async () => {
        await window.initCloudDb();
        _schedulePoll();
    }, delay);
}

// Start polling
_schedulePoll();

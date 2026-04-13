/**
 * cloud-sync.js
 * Hijacks localStorage to passively sync State to the Neon Database via our Render Proxy.
 *
 * NOTE: profilePic (for students and teachers) and admin profile pictures
 * (attendease_admin_pic_*) are intentionally excluded from cloud sync — they
 * are large base64 blobs that exceed typical API payload limits. They live in
 * localStorage only and persist across logouts since localStorage is never
 * cleared on sign-out.
 *
 * Usage:
 * Add <script src="cloud-sync.js"></script> before <script src="db.js"></script>
 */

const SYNC_URL = 'https://attendease-messenger.onrender.com/api/db/sync';
const originalSetItem = Storage.prototype.setItem;

/** Strip profilePic from any parsed student OR teacher data object before syncing. */
function _stripProfilePic(state) {
    const cleaned = {};
    for (const [key, value] of Object.entries(state)) {
        if (key.startsWith('attendease_student_') || key.startsWith('attendease_teacher_')) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && parsed.profilePic) {
                    const { profilePic, ...rest } = parsed;
                    cleaned[key] = JSON.stringify(rest);
                } else {
                    cleaned[key] = value;
                }
            } catch {
                cleaned[key] = value;
            }
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

// 1. Hijack LocalStorage to push patches to Cloud automatically
let syncTimer = null;
Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (key.startsWith('attendease_')) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            const state = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                // Exclude raw admin pic blobs and local-only notif lists
                if (k.startsWith('attendease_')
                    && !k.startsWith('attendease_admin_pic_')
                    && !k.startsWith('attendease_notifs_')) {
                    state[k] = localStorage.getItem(k);
                }
            }
            try {
                await fetch(SYNC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(_stripProfilePic(state))
                });
                console.log('[CloudSync] State pushed to Neon db');
            } catch (err) {
                console.warn('[CloudSync] Failed to push state', err);
            }
        }, 1000);
    }
};

// 2. Initial state hydration before the app boots
window.initCloudDb = async function () {
    try {
        const res = await fetch(SYNC_URL);
        const data = await res.json();

        if (data.ok && data.state && Object.keys(data.state).length > 0) {
            let changed = false;
            for (const [key, value] of Object.entries(data.state)) {
                // Never overwrite a student record from cloud if it would erase
                // a locally-stored profilePic (cloud never has it).
                if (key.startsWith('attendease_student_')) {
                    try {
                        const local = JSON.parse(localStorage.getItem(key) || '{}');
                        const remote = JSON.parse(value || '{}');
                        if (local.profilePic) {
                            // Preserve the local profilePic while merging everything else
                            remote.profilePic = local.profilePic;
                        }
                        const merged = JSON.stringify(remote);
                        if (localStorage.getItem(key) !== merged) {
                            originalSetItem.call(localStorage, key, merged);
                            changed = true;
                        }
                    } catch {
                        // Fallback: just write the remote value
                        if (localStorage.getItem(key) !== value) {
                            originalSetItem.call(localStorage, key, value);
                            changed = true;
                        }
                    }
                } else if (key.startsWith('attendease_teacher_')) {
                    // Same protection as students: never let cloud overwrite a local profilePic.
                    try {
                        const local = JSON.parse(localStorage.getItem(key) || '{}');
                        const remote = JSON.parse(value || '{}');
                        if (local.profilePic) {
                            remote.profilePic = local.profilePic;
                        }
                        const merged = JSON.stringify(remote);
                        if (localStorage.getItem(key) !== merged) {
                            originalSetItem.call(localStorage, key, merged);
                            changed = true;
                        }
                    } catch {
                        if (localStorage.getItem(key) !== value) {
                            originalSetItem.call(localStorage, key, value);
                            changed = true;
                        }
                    }
                } else if (key.startsWith('attendease_admin_pic_') || key.startsWith('attendease_notifs_')) {
                    // Local-only: raw base64 blobs and notification lists — never overwrite from cloud.
                } else {
                    if (localStorage.getItem(key) !== value) {
                        originalSetItem.call(localStorage, key, value);
                        changed = true;
                    }
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

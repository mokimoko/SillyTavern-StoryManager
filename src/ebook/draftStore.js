/** IndexedDB-backed recovery drafts. Saved ebooks never depend on this cache. */

const DB_NAME = 'StoryManager_EbookDrafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

let dbPromise = null;

function openDatabase() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'storylineId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB failed to open.'));
    }).catch(() => null);
    return dbPromise;
}

async function withStore(mode, operation) {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let request;
        try {
            request = operation(store);
        } catch (error) {
            reject(error);
            return;
        }
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || new Error('IndexedDB operation failed.'));
    });
}

export async function loadRecoveryDraft(storylineId) {
    try {
        return await withStore('readonly', store => store.get(String(storylineId || '')));
    } catch {
        return null;
    }
}

export async function saveRecoveryDraft(document) {
    if (!document?.storylineId) return;
    try {
        await withStore('readwrite', store => store.put({
            storylineId: String(document.storylineId),
            savedAt: Date.now(),
            // IndexedDB snapshots values with the structured-clone algorithm
            // when put() is called, so cloning the whole manuscript first only
            // doubles the work and temporary memory used by recovery saves.
            document,
        }));
    } catch {
        // Recovery is best-effort and must never prevent normal editing.
    }
}

export async function deleteRecoveryDraft(storylineId) {
    try {
        await withStore('readwrite', store => store.delete(String(storylineId || '')));
    } catch {
        // Best-effort cleanup.
    }
}

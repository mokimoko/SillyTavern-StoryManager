/**
 * fileStore.js — File-backed persistence for StoryManager
 *
 * Single file: user/files/archive_storymanager.json
 * Debounced saves (2s) + beforeunload beacon flush.
 *
 * Adapted from SillyTavern-SimpleSummarizer's fileStore.js — same proven
 * pattern (debounce + beacon), with the filename and store shape swapped.
 * This module is intentionally storage-shape-agnostic: it loads/saves the
 * whole document and exposes getStore/save helpers. The Book/Storyline CRUD
 * lives in storage.js on top of this.
 */
import { getRequestHeaders } from '../../../../../script.js';

const logError = (...args) => console.error('[StoryManager FileStore]', ...args);

const FILENAME = 'archive_storymanager.json';
const FILE_PATH = `user/files/${FILENAME}`;
const FILE_URL = `/${FILE_PATH}`;
const DEBOUNCE_MS = 2000;

// In-memory cache
let cache = null;
let loaded = false;

// Debounce state
let saveTimer = null;
let pendingData = null;
let unloadRegistered = false;

// ============================================================
// File API helpers
// ============================================================

function encodeBase64(data) {
    const json = JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function uploadJSON(data) {
    const base64 = encodeBase64(data);

    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: FILENAME, data: base64 }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
    }

    return (await response.json()).path;
}

async function downloadJSON() {
    const response = await fetch(FILE_URL, {
        method: 'GET',
        headers: getRequestHeaders(),
    });

    if (response.status === 404) return null;
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Download failed: ${errorText}`);
    }

    const text = await response.text();
    return JSON.parse(text);
}

// ============================================================
// Debounced persistence
// ============================================================

function scheduleSave(data) {
    if (saveTimer) clearTimeout(saveTimer);
    pendingData = data;

    saveTimer = setTimeout(async () => {
        try {
            await uploadJSON(data);
            pendingData = null;
            saveTimer = null;
        } catch (e) {
            logError('Debounced save failed:', e.message);
            saveTimer = null; // keep pendingData for unload flush
        }
    }, DEBOUNCE_MS);
}

async function saveImmediate(data) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    pendingData = null;
    await uploadJSON(data);
}

// Conservative ceiling for navigator.sendBeacon. The spec-mandated minimum
// UA limit is 64KB; past it sendBeacon returns false and queues nothing.
const BEACON_MAX = 60000;

function flushOnUnload() {
    if (!pendingData) return;
    try {
        const base64 = encodeBase64(pendingData);
        const payload = JSON.stringify({ name: FILENAME, data: base64 });
        const blob = new Blob([payload], { type: 'application/json' });

        // Preferred: sendBeacon — purpose-built for unload, fully fire-and-forget.
        // It silently caps at the UA limit (~64KB) and returns false if the
        // payload is too large to enqueue, so we only trust it under BEACON_MAX
        // and verify its return value.
        if (payload.length < BEACON_MAX) {
            const queued = navigator.sendBeacon('/api/files/upload', blob);
            if (queued) { pendingData = null; return; }
            // Fall through to the keepalive fetch if the beacon was rejected.
        }

        // Fallback for larger payloads: a keepalive fetch survives page unload.
        // Note keepalive bodies are themselves capped (~64KB across in-flight
        // requests) by the Fetch spec, so for very large stores this is still
        // best-effort — but it covers the common "store grew past 60KB" case
        // that the old beacon-only path dropped silently.
        fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: payload,
            keepalive: true,
        }).catch(() => { /* unload context — nothing more we can do */ });
    } catch (e) {
        logError('Unload save failed:', e);
    }
    pendingData = null;
}

// ============================================================
// Store shape
// ============================================================

export function createEmptyStore() {
    return {
        version: 1,
        lastModified: new Date().toISOString(),
        books: {},
        storylines: {},
    };
}

// ============================================================
// Public API
// ============================================================

/** Initialize the file store. Call once on extension init. */
export function initFileStore() {
    if (!unloadRegistered) {
        window.addEventListener('beforeunload', flushOnUnload);
        unloadRegistered = true;
    }
}

/** Load the store from disk (or return cached copy). */
export async function getStore() {
    if (loaded && cache) return cache;
    try {
        const data = await downloadJSON();
        cache = data || createEmptyStore();
        // Forward-compat: ensure top-level collections always exist.
        if (!cache.books) cache.books = {};
        if (!cache.storylines) cache.storylines = {};
    } catch (e) {
        logError('Failed to load store:', e.message);
        cache = createEmptyStore();
    }
    loaded = true;
    return cache;
}

/** Persist the current (or provided) store. Debounced. */
export function saveStore(data) {
    const store = data || cache;
    if (!store) return;
    store.lastModified = new Date().toISOString();
    cache = store;
    scheduleSave(store);
}

/** Force an immediate save (critical writes). */
export async function flushStore() {
    if (cache) {
        cache.lastModified = new Date().toISOString();
        await saveImmediate(cache);
    }
}

/** Invalidate the in-memory cache (force reload on next access). */
export function invalidateCache() {
    cache = null;
    loaded = false;
}

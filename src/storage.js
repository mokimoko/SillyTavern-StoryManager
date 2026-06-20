/**
 * storage.js — Book / Storyline CRUD for StoryManager
 *
 * Sits on top of fileStore.js. Implements the data model from the gameplan:
 *   Book ──contains──► Storyline(s) ──contains──► Chat(s)
 *
 * Resolved design decisions baked in here:
 *  - A chat belongs to AT MOST ONE storyline (ownership lookup + warn-on-move).
 *  - Books are collections of storylines; a storyline references its book via bookId.
 *  - Chats are embedded inside their owning storyline (chats[] array).
 */
import { getStore, saveStore } from './fileStore.js';

export const MODULE_NAME = 'storyManager';

// ============================================================
// ID generation
// ============================================================

function genId(prefix) {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

// ============================================================
// Factories (canonical shapes — single source of truth)
// ============================================================

export function makeBook(partial = {}) {
    const now = Date.now();
    return {
        id: partial.id || genId('book'),
        title: partial.title || 'Untitled Book',
        description: partial.description || '',
        descriptionGenerated: partial.descriptionGenerated || false,
        coverImage: partial.coverImage || null,
        coverThumb: partial.coverThumb || null,
        storylineIds: Array.isArray(partial.storylineIds) ? partial.storylineIds : [],
        timespan: partial.timespan || { mode: 'auto', label: '', start: null, end: null },
        freeformTags: Array.isArray(partial.freeformTags) ? partial.freeformTags : [],
        stTags: Array.isArray(partial.stTags) ? partial.stTags : [],
        created: partial.created || now,
        modified: now,
    };
}

export function makeStoryline(partial = {}) {
    const now = Date.now();
    return {
        id: partial.id || genId('story'),
        title: partial.title || 'Untitled Storyline',
        description: partial.description || '',
        descriptionGenerated: partial.descriptionGenerated || false,
        coverImage: partial.coverImage || null,
        coverThumb: partial.coverThumb || null,
        heroImage: partial.heroImage || null,
        heroThumb: partial.heroThumb || null,
        character: partial.character || { name: '', avatar: '', displayName: '' },
        mainPersonas: Array.isArray(partial.mainPersonas) ? partial.mainPersonas : [],
        tags: partial.tags || { character: [], persona: [], npc: [], freeform: [] },
        chats: Array.isArray(partial.chats) ? partial.chats : [],
        bookId: partial.bookId || null,
        darPlaylist: partial.darPlaylist || null,
        lastModified: new Date().toISOString(),
        created: partial.created || now,
    };
}

export function makeChatEntry(partial = {}) {
    return {
        file_name: partial.file_name || '',
        character: partial.character || '',
        avatar: partial.avatar || '',
        image: partial.image || null,
        imageThumb: partial.imageThumb || null,
        blurb: partial.blurb || '',
        chronoOrder: typeof partial.chronoOrder === 'number' ? partial.chronoOrder : 0,
        chronoLabel: partial.chronoLabel || null,
        hasSummary: partial.hasSummary || false,
        images: Array.isArray(partial.images) ? partial.images : [],
        // images: [{ src, thumb, caption }]
        quotes: Array.isArray(partial.quotes) ? partial.quotes : [],
        // quotes: [{ text, speaker, context, source: 'summarizer'|'manual' }]
    };
}

// ============================================================
// Books — CRUD
// ============================================================

export async function getBooks() {
    const store = await getStore();
    return store.books;
}

export async function getBook(bookId) {
    const store = await getStore();
    return store.books[bookId] || null;
}

export async function createBook(partial = {}) {
    const store = await getStore();
    const book = makeBook(partial);
    store.books[book.id] = book;
    saveStore(store);
    return book;
}

export async function updateBook(bookId, updates = {}) {
    const store = await getStore();
    const book = store.books[bookId];
    if (!book) return null;
    Object.assign(book, updates, { id: book.id, modified: Date.now() });
    saveStore(store);
    return book;
}

export async function deleteBook(bookId) {
    const store = await getStore();
    if (!store.books[bookId]) return false;
    // Detach member storylines (don't delete them — books and storylines
    // have independent lifecycles; orphaned storylines just become bookless).
    for (const sl of Object.values(store.storylines)) {
        if (sl.bookId === bookId) sl.bookId = null;
    }
    delete store.books[bookId];
    saveStore(store);
    return true;
}

// ============================================================
// Storylines — CRUD
// ============================================================

export async function getStorylines() {
    const store = await getStore();
    return store.storylines;
}

export async function getStoryline(storylineId) {
    const store = await getStore();
    return store.storylines[storylineId] || null;
}

export async function createStoryline(partial = {}) {
    const store = await getStore();
    const storyline = makeStoryline(partial);
    store.storylines[storyline.id] = storyline;
    // Keep the book's ordered storylineIds in sync if a book is assigned.
    if (storyline.bookId && store.books[storyline.bookId]) {
        const ids = store.books[storyline.bookId].storylineIds;
        if (!ids.includes(storyline.id)) ids.push(storyline.id);
    }
    saveStore(store);
    return storyline;
}

export async function updateStoryline(storylineId, updates = {}) {
    const store = await getStore();
    const sl = store.storylines[storylineId];
    if (!sl) return null;
    Object.assign(sl, updates, { id: sl.id, lastModified: new Date().toISOString() });
    saveStore(store);
    return sl;
}

export async function deleteStoryline(storylineId) {
    const store = await getStore();
    const sl = store.storylines[storylineId];
    if (!sl) return false;
    // Remove from any owning book's ordered list.
    if (sl.bookId && store.books[sl.bookId]) {
        const book = store.books[sl.bookId];
        book.storylineIds = book.storylineIds.filter(id => id !== storylineId);
    }
    delete store.storylines[storylineId];
    saveStore(store);
    return true;
}

// ============================================================
// Book ⇄ Storyline assignment
// ============================================================

export async function assignStorylineToBook(storylineId, bookId) {
    const store = await getStore();
    const sl = store.storylines[storylineId];
    if (!sl) return false;

    // Remove from previous book's list.
    if (sl.bookId && store.books[sl.bookId]) {
        const prev = store.books[sl.bookId];
        prev.storylineIds = prev.storylineIds.filter(id => id !== storylineId);
    }

    sl.bookId = bookId || null;
    if (bookId && store.books[bookId]) {
        const ids = store.books[bookId].storylineIds;
        if (!ids.includes(storylineId)) ids.push(storylineId);
    }
    sl.lastModified = new Date().toISOString();
    saveStore(store);
    return true;
}

// ============================================================
// Chat ownership (≤1 storyline per chat)
// ============================================================

/**
 * Find which storyline (if any) currently owns a chat file.
 * Accepts an optional pre-fetched store to avoid redundant getStore() calls
 * when used inside other storage functions that already hold a reference.
 * @param {string} fileName
 * @param {object} [_store] - optional pre-fetched store object
 * @returns {{storyline: object, index: number} | null}
 */
export async function getStorylineForChat(fileName, _store) {
    const store = _store || await getStore();
    for (const sl of Object.values(store.storylines)) {
        const index = sl.chats.findIndex(c => c.file_name === fileName);
        if (index !== -1) return { storyline: sl, index };
    }
    return null;
}

/**
 * Assign a chat to a storyline. Enforces the ≤1-owner rule.
 * If the chat already belongs to another storyline and `move` is false,
 * returns a conflict descriptor so the UI can warn + offer to move.
 *
 * @returns {{ok: true} | {ok: false, conflict: {storylineId, title}}}
 */
export async function assignChatToStoryline(fileName, storylineId, chatData = {}, move = false) {
    const store = await getStore();
    const target = store.storylines[storylineId];
    if (!target) return { ok: false, error: 'Target storyline not found' };

    // Pass the store through to avoid a redundant getStore() call.
    const existing = await getStorylineForChat(fileName, store);
    if (existing && existing.storyline.id !== storylineId) {
        if (!move) {
            return {
                ok: false,
                conflict: {
                    storylineId: existing.storyline.id,
                    title: existing.storyline.title,
                },
            };
        }
        // Move: detach from the previous owner first.
        existing.storyline.chats.splice(existing.index, 1);
        existing.storyline.lastModified = new Date().toISOString();
    }

    // Already in the target? Merge, preserving any existing fields that the
    // incoming chatData doesn't explicitly provide (prevents accidental
    // clobbering of images/quotes/blurb when a caller omits them).
    const idx = target.chats.findIndex(c => c.file_name === fileName);
    if (idx !== -1) {
        // Build defaults from the EXISTING entry, then overlay incoming data.
        const merged = { ...target.chats[idx] };
        for (const [k, v] of Object.entries(chatData)) {
            if (v !== undefined) merged[k] = v;
        }
        merged.file_name = fileName; // always canonical
        target.chats[idx] = merged;
    } else {
        // New entry — makeChatEntry for safe defaults.
        const entry = makeChatEntry({ ...chatData, file_name: fileName });
        const maxOrder = target.chats.reduce((m, c) => Math.max(m, c.chronoOrder || 0), -1);
        entry.chronoOrder = chatData.chronoOrder ?? maxOrder + 1;
        target.chats.push(entry);
    }
    target.lastModified = new Date().toISOString();
    saveStore(store);
    return { ok: true };
}

/**
 * Remove a chat from its storyline (becomes unowned).
 * Accepts an optional pre-fetched store for batch operations.
 */
export async function removeChatFromStoryline(fileName, _store) {
    const store = _store || await getStore();
    // Re-find the index against the live store to avoid stale-index bugs.
    const existing = await getStorylineForChat(fileName, store);
    if (!existing) return false;
    existing.storyline.chats.splice(existing.index, 1);
    existing.storyline.lastModified = new Date().toISOString();
    saveStore(store);
    return true;
}

// ============================================================
// Queries
// ============================================================

/** All storylines whose character.avatar matches (the in-chat sidebar uses this). */
export async function getStorylinesForCharacter(avatar) {
    const store = await getStore();
    return Object.values(store.storylines).filter(sl => sl.character?.avatar === avatar);
}

/** Storylines, in a book's curated order. */
export async function getStorylinesInBook(bookId) {
    const store = await getStore();
    const book = store.books[bookId];
    if (!book) return [];
    return book.storylineIds
        .map(id => store.storylines[id])
        .filter(Boolean);
}

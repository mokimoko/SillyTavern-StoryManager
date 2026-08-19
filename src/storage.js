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
// Cast helpers (multi-character / group support)
// ============================================================
//
// A storyline has a single `primary` anchor (cover/title subject) plus an
// open-ended `participants` set. Both a character and a whole group can be a
// cast member. The legacy `character` field is kept mirrored to a
// character-type primary so older readers keep working during the transition.
// See docs/GAMEPLAN-multichar-groups.md.

/** Build the primary cast anchor from a partial, deriving it from the legacy
 *  `character` field when no explicit `primary` is supplied. */
function normalizePrimary(partial = {}) {
    if (partial.primary && partial.primary.type) {
        const p = partial.primary;
        return p.type === 'group'
            ? { type: 'group', groupId: p.groupId || '', name: p.name || '' }
            : {
                type: 'character',
                avatar: p.avatar || '',
                name: p.name || '',
                displayName: p.displayName || p.name || '',
            };
    }
    const c = partial.character || {};
    return {
        type: 'character',
        avatar: c.avatar || '',
        name: c.name || '',
        displayName: c.displayName || c.name || '',
    };
}

/** True if a cast entry carries any identity (used to decide whether a lone
 *  primary should seed the participants list). */
function partHasIdentity(p) {
    return !!(p && (p.avatar || p.groupId || p.name));
}

/** The effective participant list for a storyline, tolerant of un-migrated
 *  data (falls back to primary, then the legacy `character`). */
function participantsOf(sl) {
    if (Array.isArray(sl?.participants) && sl.participants.length) return sl.participants;
    if (sl?.primary && partHasIdentity(sl.primary)) return [sl.primary];
    if (sl?.character && partHasIdentity(sl.character)) {
        return [{ type: 'character', ...sl.character }];
    }
    return [];
}

/** Does a storyline's cast include the referenced character or group?
 *  @param {{avatar?:string, groupId?:string}} ref */
function storylineHasParticipant(sl, ref) {
    return participantsOf(sl).some(p => {
        if (ref.avatar) return (p.type ?? 'character') === 'character' && p.avatar === ref.avatar;
        if (ref.groupId) return p.type === 'group' && p.groupId === ref.groupId;
        return false;
    });
}

/** Composite match for a chat entry: file name plus (when supplied) its source
 *  and owning character/group. Prevents same-named files from different sources
 *  (e.g. "New Chat" under two cards, or a group chat) colliding in the
 *  ≤1-owner rule. A missing `ref` preserves the legacy file-name-only match.
 *  @param {{source?:string, avatar?:string, groupId?:string}} [ref] */
function chatEntryMatches(entry, fileName, ref) {
    if (entry.file_name !== fileName) return false;
    if (!ref) return true;
    const entrySource = entry.source || 'character';
    const refSource = ref.source || 'character';
    if (entrySource !== refSource) return false;
    if (refSource === 'group') {
        // Only exclude on a genuine mismatch; tolerate blanks on legacy entries.
        return !(ref.groupId && entry.groupId && ref.groupId !== entry.groupId);
    }
    return !(ref.avatar && entry.avatar && ref.avatar !== entry.avatar);
}

/** Derive a chat-match ref from an entry / assignment payload. */
function refFromChatData(data = {}) {
    return { source: data.source || 'character', avatar: data.avatar || '', groupId: data.groupId || '' };
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
    const primary = normalizePrimary(partial);
    const participants = Array.isArray(partial.participants) && partial.participants.length
        ? partial.participants.map(p => ({ ...p }))
        : (partHasIdentity(primary) ? [{ ...primary }] : []);
    // Legacy mirror: keep `character` in sync with a character-type primary so
    // code still reading storyline.character during the transition keeps working.
    const character = primary.type === 'character'
        ? { name: primary.name, avatar: primary.avatar, displayName: primary.displayName }
        : (partial.character || { name: '', avatar: '', displayName: '' });
    return {
        id: partial.id || genId('story'),
        title: partial.title || 'Untitled Storyline',
        description: partial.description || '',
        descriptionGenerated: partial.descriptionGenerated || false,
        coverImage: partial.coverImage || null,
        coverThumb: partial.coverThumb || null,
        heroImage: partial.heroImage || null,
        heroThumb: partial.heroThumb || null,
        primary,
        participants,
        character,
        mainPersonas: Array.isArray(partial.mainPersonas) ? partial.mainPersonas : [],
        tags: partial.tags || { character: [], persona: [], npc: [], freeform: [] },
        chats: Array.isArray(partial.chats) ? partial.chats : [],
        bookId: partial.bookId || null,
        darPlaylist: partial.darPlaylist || null,
        ebook: partial.ebook || null,
        lastModified: new Date().toISOString(),
        created: partial.created || now,
    };
}

export function makeChatEntry(partial = {}) {
    return {
        file_name: partial.file_name || '',
        // Source discriminator: 'character' (owned by a card, uses `avatar`) or
        // 'group' (owned by an ST group, uses `groupId`). Defaults to character
        // so every legacy entry reads correctly without migration.
        source: partial.source || 'character',
        groupId: partial.groupId || '',
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
// Migration (legacy single-character → primary + participants)
// ============================================================

/**
 * Bring a loaded store up to the multi-cast shape in place. Idempotent and
 * cheap: only touches storylines/chats still missing the new fields, so it's
 * safe to run on every load. Returns true if anything changed.
 */
export function migrateStoreShape(store) {
    if (!store || !store.storylines) return false;
    let changed = false;
    for (const sl of Object.values(store.storylines)) {
        if (!sl.primary) {
            sl.primary = normalizePrimary(sl);
            changed = true;
        }
        if (!Array.isArray(sl.participants)) {
            sl.participants = partHasIdentity(sl.primary) ? [{ ...sl.primary }] : [];
            changed = true;
        }
        for (const c of (sl.chats || [])) {
            if (!c.source) { c.source = 'character'; changed = true; }
            if (c.groupId === undefined) { c.groupId = ''; changed = true; }
        }
    }
    if (changed) store.version = 2;
    return changed;
}

/**
 * Run migration once at extension init. Wired from index.js before any UI
 * opens. Persists only if the migration actually changed something.
 */
export async function initStorage() {
    const store = await getStore();
    if (migrateStoreShape(store)) saveStore(store);
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
    // Legacy editors update `character` without touching the cast. Keep primary +
    // participants coherent by re-deriving them — but only when the caller didn't
    // manage the cast explicitly (Step 3's editor passes primary/participants and
    // must not be clobbered here).
    if ('character' in updates && !('primary' in updates) && !('participants' in updates)) {
        sl.primary = normalizePrimary(sl);
        sl.participants = partHasIdentity(sl.primary) ? [{ ...sl.primary }] : [];
    }
    saveStore(store);
    return sl;
}

export async function deleteStoryline(storylineId) {
    const store = await getStore();
    const sl = store.storylines[storylineId];
    if (!sl) return false;
    // Ebook contents live in a per-storyline user file. Remove it before the
    // owning storyline disappears so no inaccessible orphan manuscript remains.
    try {
        if (sl.ebook?.file) {
            const ebookStore = await import('./ebook/store.js');
            await ebookStore.deleteEbookFile(storylineId);
        }
        const draftStore = await import('./ebook/draftStore.js');
        await draftStore.deleteRecoveryDraft(storylineId);
    } catch (error) {
        console.error('[StoryManager] Failed to delete storyline ebook:', error);
        return false;
    }
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
 * @param {{source?:string, avatar?:string, groupId?:string}} [ref] - optional
 *   source descriptor; when supplied, matching is composite (file + source +
 *   owner) so same-named files from different cards/groups don't collide.
 * @returns {{storyline: object, index: number} | null}
 */
export async function getStorylineForChat(fileName, _store, ref) {
    const store = _store || await getStore();
    for (const sl of Object.values(store.storylines)) {
        const index = sl.chats.findIndex(c => chatEntryMatches(c, fileName, ref));
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

    // Pass the store through to avoid a redundant getStore() call. Match on the
    // composite ref so a same-named file from a different card/group isn't seen
    // as a conflict.
    const ref = refFromChatData(chatData);
    const existing = await getStorylineForChat(fileName, store, ref);
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
    const idx = target.chats.findIndex(c => chatEntryMatches(c, fileName, ref));
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
export async function removeChatFromStoryline(fileName, _store, ref) {
    const store = _store || await getStore();
    // Re-find the index against the live store to avoid stale-index bugs.
    const existing = await getStorylineForChat(fileName, store, ref);
    if (!existing) return false;
    existing.storyline.chats.splice(existing.index, 1);
    existing.storyline.lastModified = new Date().toISOString();
    saveStore(store);
    return true;
}

// ============================================================
// Queries
// ============================================================

/**
 * All storylines whose cast includes the referenced character or group.
 * @param {{avatar?:string, groupId?:string}} ref
 */
export async function getStorylinesForParticipant(ref) {
    if (!ref || (!ref.avatar && !ref.groupId)) return [];
    const store = await getStore();
    return Object.values(store.storylines).filter(sl => storylineHasParticipant(sl, ref));
}

/**
 * All storylines whose cast includes this character avatar (the in-chat sidebar
 * uses this). Now matches the full participants set, not just the primary, so a
 * multi-cast storyline surfaces under every character in it.
 */
export async function getStorylinesForCharacter(avatar) {
    return getStorylinesForParticipant({ avatar });
}

/** All storylines whose cast includes this group. */
export async function getStorylinesForGroup(groupId) {
    return getStorylinesForParticipant({ groupId });
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


// ============================================================
// Word counts (cached, populated by wordCountCapture.js)
// ============================================================

/**
 * Canonical key for the wordCounts map: chat file name without the .jsonl
 * extension. Every read/write goes through this so a chat stored as
 * "foo.jsonl" and one stored as "foo" resolve to the same bucket.
 */
export function normalizeChatKey(fileName) {
    return String(fileName || '').replace(/\.jsonl$/i, '');
}

/**
 * Record (or update) the cached word count for a single chat.
 * Called from the cheap active-chat capture path — never bulk work.
 * No-ops on an empty file name. Persists via the debounced saveStore.
 */
export async function recordChatWordCount(fileName, count) {
    const key = normalizeChatKey(fileName);
    if (!key) return;
    const store = await getStore();
    if (!store.wordCounts) store.wordCounts = {};
    const n = Number(count) || 0;
    // Skip a write if nothing actually changed (avoids needless saves).
    if (store.wordCounts[key] === n) return;
    store.wordCounts[key] = n;
    saveStore(store);
}

/**
 * Get the whole file_name → count map (safe empty default).
 * The Display loads this once per open and reads from it synchronously.
 */
export async function getWordCountMap() {
    const store = await getStore();
    return store.wordCounts || {};
}

/**
 * Sum cached word counts for an array of chat entries against a map.
 * Chats with no recorded count (never opened since install) contribute 0.
 * @param {Array<{file_name:string}>} chats
 * @param {Object<string,number>} map
 */
export function sumWordsForChats(chats, map) {
    if (!Array.isArray(chats) || !map) return 0;
    let total = 0;
    for (const c of chats) {
        total += map[normalizeChatKey(c.file_name)] || 0;
    }
    return total;
}

/**
 * Sum cached word counts across every storyline assigned to a book.
 * @param {{storylineIds?: string[]}} book
 * @param {Object<string,object>} storylinesMap - id → storyline
 * @param {Object<string,number>} wordMap - file_name → count
 */
export function sumWordsForBook(book, storylinesMap, wordMap) {
    if (!book || !storylinesMap || !wordMap) return 0;
    let total = 0;
    for (const id of book.storylineIds || []) {
        const sl = storylinesMap[id];
        if (sl) total += sumWordsForChats(sl.chats, wordMap);
    }
    return total;
}

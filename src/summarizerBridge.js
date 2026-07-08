/**
 * summarizerBridge.js — Read-only bridge to SimpleSummarizer
 *
 * Fetches comprehensive-summary quotes for a given chat filename.
 * Zero imports from SimpleSummarizer — reads its archive file directly.
 * If SimpleSummarizer isn't installed (file 404), every function returns
 * empty/null gracefully.
 *
 * Archive location: user/files/archive_summarizer.json
 * Structure: { version, lastModified, summaries: { [chatFilename]: { text, quotes, ... } } }
 * Quote shape: { speaker, text, context, pinned }
 */
import { getRequestHeaders } from '../../../../../script.js';
import { logWarn } from './display/util.js';

const ARCHIVE_URL = '/user/files/archive_summarizer.json';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30s — stale is fine for display reads

/**
 * Fetch and cache the archive. Returns null on any failure.
 */
async function loadArchive() {
    if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;

    try {
        const res = await fetch(ARCHIVE_URL, {
            method: 'GET',
            headers: getRequestHeaders(),
        });
        if (!res.ok) {
            _cache = null;
            return null;
        }
        _cache = await res.json();
        _cacheTime = Date.now();
        return _cache;
    } catch (e) {
        logWarn('SimpleSummarizer archive not available:', e.message);
        _cache = null;
        return null;
    }
}

// ============================================================
// Public API
// ============================================================

/**
 * Check whether SimpleSummarizer's archive is available at all.
 */
export async function isSummarizerAvailable() {
    const archive = await loadArchive();
    return archive !== null;
}

/**
 * Get the comprehensive summary object for a chat, or null.
 */
export async function getComprehensiveSummary(chatFilename) {
    const archive = await loadArchive();
    return archive?.summaries?.[chatFilename] || null;
}

/**
 * Get quotes from a chat's comprehensive summary.
 * Returns [{ text, speaker, context, source: 'summarizer' }] or [].
 */
export async function getQuotesForChat(chatFilename) {
    const summary = await getComprehensiveSummary(chatFilename);
    if (!summary?.quotes?.length) return [];

    return summary.quotes.map(q => ({
        text: q.text || '',
        speaker: q.speaker || '',
        context: q.context || '',
        source: 'summarizer',
    }));
}

/**
 * Batch-fetch quotes for multiple chat filenames.
 * Returns { [filename]: [quotes] }.
 */
export async function getQuotesForChats(filenames) {
    const archive = await loadArchive();
    if (!archive?.summaries) return {};

    const result = {};
    for (const fn of filenames) {
        const summary = archive.summaries[fn];
        if (summary?.quotes?.length) {
            result[fn] = summary.quotes.map(q => ({
                text: q.text || '',
                speaker: q.speaker || '',
                context: q.context || '',
                source: 'summarizer',
            }));
        }
    }
    return result;
}

/**
 * Presence-only check for a set of chats: does each have summary text and/or
 * summary quotes? One cached archive read, no per-chat fetches. Used by the
 * storyline page to decide which rows get a "has details" dot + click popup.
 * Returns { [filename]: { hasText: boolean, hasQuotes: boolean } }.
 * Chats with no archive entry are simply absent from the map.
 */
export async function getSummaryPresenceForChats(filenames) {
    const archive = await loadArchive();
    const result = {};
    if (!archive?.summaries) return result;

    for (const fn of filenames) {
        const summary = archive.summaries[fn];
        if (!summary) continue;
        const hasText = !!summary.text?.trim();
        const hasQuotes = Array.isArray(summary.quotes) && summary.quotes.length > 0;
        if (hasText || hasQuotes) {
            result[fn] = { hasText, hasQuotes };
        }
    }
    return result;
}

/**
 * Invalidate the cache (e.g. if the user just generated a new summary).
 */
export function invalidateCache() {
    _cache = null;
    _cacheTime = 0;
}

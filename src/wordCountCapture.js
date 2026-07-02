/**
 * wordCountCapture.js — cheap, incremental word-count capture for StoryManager.
 *
 * The Display shows per-chat and aggregate word counts. Rather than bulk-fetch
 * chat metadata for every chat on every open (which hits ST's chats API and
 * slows things down — the exact problem VerseManager avoided), we snapshot the
 * word count of the ACTIVE chat whenever it changes and cache it into our own
 * store (archive_storymanager.json → wordCounts map). The active chat is always
 * in memory, so this is essentially free.
 *
 * Counts therefore accumulate as you open chats. A chat never opened since this
 * was installed simply has no cached count yet (the Display shows nothing for
 * it rather than a misleading 0).
 *
 * The word-count formula matches SillyTavern-WordCount's exactly (whitespace
 * split, system messages excluded), so the numbers agree with its HUD. This
 * works whether or not WordCount is installed — we compute from the chat
 * directly and don't depend on its metadata.
 */
import { eventSource, event_types, getCurrentChatId } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { recordChatWordCount } from './storage.js';

const DEBOUNCE_MS = 600;
let captureTimer = null;

/** Count words the same way WordCount does: non-empty whitespace-delimited tokens. */
function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/** Sum word counts across the active chat's non-system messages. */
function computeActiveChatWordCount() {
    const context = getContext();
    const chat = context?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return 0;
    let total = 0;
    for (const msg of chat) {
        if (msg && !msg.is_system) total += countWords(msg.mes);
    }
    return total;
}

/** Snapshot the current chat's word count into the store (debounced). */
function scheduleCapture() {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(async () => {
        captureTimer = null;
        try {
            const chatId = getCurrentChatId();
            if (!chatId) return; // no chat open (e.g. between swaps)
            const count = computeActiveChatWordCount();
            await recordChatWordCount(chatId, count);
        } catch (e) {
            console.warn('[StoryManager] word count capture failed:', e?.message);
        }
    }, DEBOUNCE_MS);
}

/**
 * Wire capture to the events that can change a chat's word count.
 * Mirrors the set WordCount listens to, plus edits/swipes when available.
 */
export function initWordCountCapture() {
    const events = [
        event_types.CHAT_CHANGED,
        event_types.MESSAGE_SENT,
        event_types.MESSAGE_RECEIVED,
        event_types.MESSAGE_DELETED,
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_SWIPED,
    ].filter(Boolean); // guard against event names absent in older ST builds

    for (const ev of events) {
        eventSource.on(ev, scheduleCapture);
    }

    // Capture whatever chat is already open at load.
    scheduleCapture();
}

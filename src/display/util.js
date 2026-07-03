/**
 * display/util.js — shared rendering helpers for StoryManager.
 *
 * CANONICAL source for escapeHtml / escapeAttr / escapeCssUrl / coverBg /
 * prettyChatName.  Every module in the extension imports from HERE instead
 * of defining its own copies.  If you need to change escaping behaviour,
 * change it once in this file.
 *
 * Also the canonical home for the extension's debug loggers (mirrors the
 * pattern used across the other extensions, e.g. ScenarioCrafter's utils.js):
 *   log()/logWarn() are gated behind DEBUG and stay silent in normal use;
 *   logError() ALWAYS fires so real failures are never swallowed.
 * Flip DEBUG to true (or set window.SM_DEBUG = true before load) to surface
 * the verbose boot/diagnostic chatter when troubleshooting.
 */

// ============================================================
// Debug logging
// ============================================================

// Debug flag — set to true (or window.SM_DEBUG = true) to enable verbose logs.
const DEBUG = false;

function debugOn() {
    return DEBUG || (typeof window !== 'undefined' && window.SM_DEBUG === true);
}

/** Gated info log — silent unless debug is on. */
export function log(...args) {
    if (debugOn()) console.log('[StoryManager]', ...args);
}

/** Gated warning — silent unless debug is on (use for noisy retry/fallback chatter). */
export function logWarn(...args) {
    if (debugOn()) console.warn('[StoryManager]', ...args);
}

/** Always-on error log — real failures should never be swallowed. */
export function logError(...args) {
    console.error('[StoryManager]', ...args);
}

/** Escape text for safe insertion into HTML text nodes / innerHTML. */
export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Escape a string for use inside a double-quoted HTML attribute. */
export function escapeAttr(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

/**
 * Escape a URL for safe insertion inside a CSS url('…') context.
 * Prevents breakout via unescaped quotes or parentheses in filenames/URLs.
 */
export function escapeCssUrl(s) {
    return String(s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\)/g, '\\)')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * Build the inner HTML for a .sm-cover-bg element from an image URL.
 * Real images render as a background-image; missing images fall back to a
 * neutral .sm-cover-empty fill with an icon (no broken-image artifacts).
 * @param {string|null} url
 * @param {string} icon - FontAwesome class for the empty state
 */
export function coverBg(url, icon = 'fa-book') {
    if (url) {
        return `<div class="sm-cover-bg" style="background-image:url('${escapeCssUrl(url)}')"></div>`;
    }
    return `<div class="sm-cover-bg sm-cover-empty"><i class="fa-solid ${icon}"></i></div>`;
}

/** Strip the .jsonl extension for friendlier chat display names. */
export function prettyChatName(fileName) {
    return String(fileName || '').replace(/\.jsonl$/i, '');
}

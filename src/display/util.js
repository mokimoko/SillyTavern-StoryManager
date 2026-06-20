/**
 * display/util.js — shared rendering helpers for StoryManager.
 *
 * CANONICAL source for escapeHtml / escapeAttr / escapeCssUrl / coverBg /
 * prettyChatName.  Every module in the extension imports from HERE instead
 * of defining its own copies.  If you need to change escaping behaviour,
 * change it once in this file.
 */

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

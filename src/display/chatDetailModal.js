/**
 * display/chatDetailModal.js — the chat detail popup.
 *
 * Replaces the old inline accordion (removed from storylinePage.js). A single
 * centered popup, appended to <body>, shown when a chat row is clicked. It
 * surfaces everything known about one chat in a storyline:
 *   1. Header — pretty chat name + chrono date + "open in ST" + close.
 *   2. Blurb.
 *   3. Comprehensive summary text (from SimpleSummarizer, if installed).
 *   4. Quotes — manual quotes merged with summarizer-pulled quotes.
 *   5. Image grid, 3 per row. The cover image gets a star badge; each tile
 *      click opens the shared lightbox.
 * Any section with no content is omitted entirely (no empty headers).
 *
 * This module is ALSO the canonical home for `mergeQuotes()` and
 * `openLightbox()` — both were lifted out of storylinePage.js so the popup and
 * any other caller share one copy instead of diverging.
 *
 * Token-scope note: like the hover panel, this popup lives on <body>, OUTSIDE
 * the `.sm-display` scope where `--sm-*` tokens are defined. The CSS re-derives
 * `--sm-bg-modal` from `--SmartThemeBlurTintColor` (see .sm-cd-modal in
 * display.css) so it tracks the theme's light/dark background — never a
 * hardcoded fill.
 *
 * Export: openChatDetail(chat, { onOpenChat })
 *   - chat: the chat entry object ({ file_name, blurb, chronoLabel, images, quotes })
 *   - onOpenChat(chat): open the chat in SillyTavern (reuses the row goto action)
 */
import { escapeHtml, escapeAttr, prettyChatName, coverImage, logWarn } from './util.js';
import { getComprehensiveSummary, getQuotesForChat } from '../summarizerBridge.js';

const MODAL_ID = 'sm-chat-detail-modal';

// ============================================================
// Shared helpers (lifted from storylinePage.js — canonical here now)
// ============================================================

/**
 * Merge stored manual quotes with auto-pulled SimpleSummarizer quotes.
 * Deduplicates by text content — manual quotes take precedence.
 * Returns [{ text, speaker, context, source }].
 */
export async function mergeQuotes(chat) {
    const manual = (chat.quotes || []).filter(q => q.source === 'manual');
    let summarizerQuotes = [];

    try {
        summarizerQuotes = await getQuotesForChat(chat.file_name);
    } catch (e) {
        logWarn('Failed to fetch summarizer quotes:', e);
    }

    const manualTexts = new Set(manual.map(q => q.text.trim().toLowerCase()));
    const deduped = summarizerQuotes.filter(q => !manualTexts.has(q.text.trim().toLowerCase()));

    return [...manual, ...deduped];
}

/**
 * Simple lightbox — full-screen overlay showing a single image.
 * Click anywhere (or press Escape) to close.
 */
export function openLightbox(src, caption) {
    const overlay = document.createElement('div');
    overlay.className = 'sm-lightbox';
    overlay.innerHTML = `
        <div class="sm-lightbox-backdrop"></div>
        <div class="sm-lightbox-content">
            <img src="${escapeAttr(src)}" alt="" />
            ${caption ? `<div class="sm-lightbox-caption">${escapeHtml(caption)}</div>` : ''}
        </div>
    `;

    const close = () => {
        overlay.classList.remove('sm-lightbox-visible');
        setTimeout(() => overlay.remove(), 200);
        document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => { if (e.key === 'Escape') close(); };

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('sm-lightbox-visible'));
}

// ============================================================
// Section builders — each returns '' when it has no content, so
// empty sections never render a bare header.
// ============================================================

/** Blurb section. */
function blurbSection(chat) {
    const blurb = chat.blurb?.trim();
    if (!blurb) return '';
    return `
        <div class="sm-cd-section">
            <div class="sm-cd-blurb">${escapeHtml(blurb)}</div>
        </div>`;
}

/** Comprehensive summary section (SimpleSummarizer). Long text is capped
 *  with a "show more" expander wired after render. */
function summarySection(summaryText) {
    const text = summaryText?.trim();
    if (!text) return '';
    return `
        <div class="sm-cd-section">
            <div class="sm-cd-label"><i class="fa-solid fa-align-left"></i> Summary</div>
            <div class="sm-cd-summary sm-cd-clamped">${escapeHtml(text)}</div>
            <button class="sm-cd-summary-toggle" hidden>Show more</button>
        </div>`;
}

/** Quotes section. `quotes` is the merged array. */
function quotesSection(quotes) {
    if (!quotes?.length) return '';
    const items = quotes.map(q => `
        <blockquote class="sm-cd-quote ${q.source === 'summarizer' ? 'sm-quote-auto' : 'sm-quote-manual'}">
            <div class="sm-cd-quote-text">${escapeHtml(String(q.text ?? '').trim())}</div>
            ${q.speaker && String(q.speaker).trim() ? `<cite class="sm-cd-quote-speaker">${escapeHtml(String(q.speaker).trim())}</cite>` : ''}
            ${q.context && String(q.context).trim() ? `<div class="sm-cd-quote-context">${escapeHtml(String(q.context).trim())}</div>` : ''}
        </blockquote>`).join('');
    return `
        <div class="sm-cd-section">
            <div class="sm-cd-label"><i class="fa-solid fa-quote-left"></i> Quotes · ${quotes.length}</div>
            <div class="sm-cd-quotes">${items}</div>
        </div>`;
}

/** Image grid section — 3 per row. Cover gets a star badge. Tiles are
 *  wired to the lightbox after render (data-img-idx). */
function imagesSection(images) {
    if (!images?.length) return '';
    const cover = coverImage({ images });
    const tiles = images.map((img, i) => {
        const isCover = cover && img === cover;
        return `
            <div class="sm-cd-grid-tile" data-img-idx="${i}">
                <div class="sm-cd-grid-img">
                    <img src="${escapeAttr(img.thumb || img.src)}"
                         alt="${escapeAttr(img.caption || '')}" loading="lazy" />
                    ${isCover ? `<div class="sm-cd-grid-star" title="Cover image"><i class="fa-solid fa-star"></i></div>` : ''}
                </div>
                ${img.caption ? `<div class="sm-cd-grid-caption">${escapeHtml(img.caption)}</div>` : ''}
            </div>`;
    }).join('');
    return `
        <div class="sm-cd-section">
            <div class="sm-cd-label"><i class="fa-solid fa-images"></i> Gallery · ${images.length} image${images.length === 1 ? '' : 's'}</div>
            <div class="sm-cd-grid">${tiles}</div>
        </div>`;
}

// ============================================================
// Open / close
// ============================================================

/** Tear down any existing popup + its key handler. */
function destroyModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
        existing.classList.remove('sm-cd-visible');
        setTimeout(() => existing.remove(), 180);
    }
    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
    }
}

let _escHandler = null;

/**
 * Open the chat detail popup for a single chat.
 * @param {object} chat - chat entry ({ file_name, blurb, chronoLabel, images, quotes })
 * @param {{ onOpenChat?: (chat:object)=>void }} [opts]
 */
export async function openChatDetail(chat, { onOpenChat } = {}) {
    if (!chat) return;
    destroyModal();

    const images = chat.images || [];

    // Shell first — header + a body placeholder while async content loads.
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'sm-cd-modal';
    overlay.innerHTML = `
        <div class="sm-cd-backdrop"></div>
        <div class="sm-cd-panel" role="dialog" aria-modal="true">
            <div class="sm-cd-header">
                <div class="sm-cd-header-text">
                    <div class="sm-cd-title">${escapeHtml(prettyChatName(chat.file_name))}</div>
                    ${chat.chronoLabel ? `<div class="sm-cd-chrono">${escapeHtml(chat.chronoLabel)}</div>` : ''}
                </div>
                <button class="sm-cd-goto" title="Open in SillyTavern">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </button>
                <button class="sm-cd-close" title="Close">✕</button>
            </div>
            <div class="sm-cd-body">
                ${blurbSection(chat)}
                <div class="sm-cd-async"><div class="sm-cd-loading">Loading…</div></div>
                ${imagesSection(images)}
            </div>
        </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('sm-cd-visible'));

    // Wire close (backdrop + button + Escape).
    const close = () => destroyModal();
    overlay.querySelector('.sm-cd-backdrop')?.addEventListener('click', close);
    overlay.querySelector('.sm-cd-close')?.addEventListener('click', close);
    _escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', _escHandler);

    // Goto → open in ST (delegates to the same action the row goto uses).
    // Close the popup first: onOpenChat closes the display, but this popup
    // lives on <body> outside .sm-display, so it wouldn't be torn down with it.
    overlay.querySelector('.sm-cd-goto')?.addEventListener('click', () => {
        close();
        onOpenChat?.(chat);
    });

    // Wire image tiles → lightbox. (Images are in the shell already.)
    wireImageTiles(overlay, images);

    // Async: summary + quotes. Fetch in parallel, then fill the async slot.
    let summary = null;
    let quotes = [];
    try {
        [summary, quotes] = await Promise.all([
            getComprehensiveSummary(chat.file_name),
            mergeQuotes(chat),
        ]);
    } catch (e) {
        logWarn('Chat detail async load failed:', e);
    }

    // The popup may have been closed while awaiting — bail if so.
    if (!document.body.contains(overlay)) return;

    const asyncSlot = overlay.querySelector('.sm-cd-async');
    if (asyncSlot) {
        const summaryHtml = summarySection(summary?.text);
        const quotesHtml = quotesSection(quotes);
        asyncSlot.outerHTML = summaryHtml + quotesHtml;
    }

    // Wire the summary "show more" expander if the text overflows its clamp.
    wireSummaryToggle(overlay);
}

// ============================================================
// Post-render wiring
// ============================================================

/** Wire each image tile to open the lightbox with the FULL-size src. */
function wireImageTiles(overlay, images) {
    overlay.querySelectorAll('.sm-cd-grid-tile[data-img-idx]').forEach(el => {
        const idx = parseInt(el.dataset.imgIdx, 10);
        const img = images[idx];
        if (!img) return;
        el.addEventListener('click', () => openLightbox(img.src, img.caption));
    });
}

/** Reveal the "show more" toggle only when the summary is actually clamped,
 *  i.e. its content overflows the collapsed max-height. */
function wireSummaryToggle(overlay) {
    const summary = overlay.querySelector('.sm-cd-summary');
    const toggle = overlay.querySelector('.sm-cd-summary-toggle');
    if (!summary || !toggle) return;

    if (summary.scrollHeight <= summary.clientHeight + 4) return; // fits, no toggle needed
    toggle.hidden = false;

    toggle.addEventListener('click', () => {
        const clamped = summary.classList.toggle('sm-cd-clamped');
        toggle.textContent = clamped ? 'Show more' : 'Show less';
    });
}

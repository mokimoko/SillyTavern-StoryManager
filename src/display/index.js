/**
 * display/index.js — The Display gallery (Phase 4).
 *
 * The aesthetic, header-less library view: a left book-shelf column, a storyline
 * card grid, and a full storyline page. Built from the approved mock
 * (story-manager-display-mock.html); see that file for the canonical layout.
 *
 * This module is the orchestrator. It:
 *   - owns the persistent overlay DOM (created once, reused across open/close),
 *   - holds view state (active book, grid-vs-page),
 *   - loads books/storylines from storage on open,
 *   - owns the shared, cursor-tracked chat detail panel,
 *   - delegates rendering to bookShelf / storylineGrid / storylinePage,
 *   - hands off to the management modal via the ⚙ button + closes cleanly.
 *
 * Exports: openDisplay(), closeDisplay()
 */
import {
    getBooks, getStorylines, getStorylinesInBook,
    getWordCountMap, sumWordsForChats, sumWordsForBook,
} from '../storage.js';
import { openChatEntry, getSTTags } from '../stContext.js';
import { getSummaryPresenceForChats } from '../summarizerBridge.js';
import { renderBookShelf } from './bookShelf.js';
import { renderStorylineGrid } from './storylineGrid.js';
import { renderStorylinePage } from './storylinePage.js';
import { coverBg, escapeHtml, escapeAttr, prettyChatName, coverImage, logError } from './util.js';

const BACKDROP_ID = 'sm-display-backdrop';
const DISPLAY_ID = 'sm-display-frame';

// ============================================================
// State
// ============================================================

let isOpen = false;
let activeBookId = null;       // null = "All storylines" pseudo-book
let detailEl = null;           // shared cursor-tracked chat detail panel

// Cached store snapshot for the current open session.
let books = [];                // array of book objects
let booksOrdered = [];         // books in a stable display order
let storylinesMap = {};        // id → storyline (for book-wide word totals)
let wordCounts = {};           // file_name → cached word count (no live fetch)

// ============================================================
// Open / Close
// ============================================================

export async function openDisplay(options = {}) {
    ensureDOM();
    isOpen = true;

    requestAnimationFrame(() => {
        document.getElementById(BACKDROP_ID)?.classList.add('sm-visible');
        document.getElementById(DISPLAY_ID)?.classList.add('sm-visible');
    });

    await refreshData();
    if (Object.prototype.hasOwnProperty.call(options || {}, 'bookId')) {
        const requestedBookId = options.bookId || null;
        activeBookId = requestedBookId && booksOrdered.some(book => book.id === requestedBookId)
            ? requestedBookId
            : null;
    } else if (activeBookId && !booksOrdered.some(book => book.id === activeBookId)) {
        activeBookId = null;
    }
    renderShelf();
    if (options?.storylineId) {
        await showPage(options.storylineId, await storylinesForActiveBook());
    } else {
        showGrid();
    }
}

export function closeDisplay() {
    if (!isOpen) return;
    isOpen = false;
    hideDetail();
    document.getElementById(BACKDROP_ID)?.classList.remove('sm-visible');
    document.getElementById(DISPLAY_ID)?.classList.remove('sm-visible');
}

export function isDisplayOpen() {
    return isOpen;
}

// ============================================================
// Data
// ============================================================

async function refreshData() {
    const booksMap = await getBooks();
    booksOrdered = Object.values(booksMap || {})
        .sort((a, b) => (a.created || 0) - (b.created || 0));
    books = booksOrdered;

    // Snapshot the storyline map + cached word counts once per open. Both are
    // pure in-memory reads from our own store — no ST chat API calls here.
    storylinesMap = (await getStorylines()) || {};
    wordCounts = (await getWordCountMap()) || {};
}

/** Storylines to show for the current active book (or all, ordered). */
async function storylinesForActiveBook() {
    if (activeBookId) {
        return await getStorylinesInBook(activeBookId);
    }
    const map = await getStorylines();
    return Object.values(map || {}).sort((a, b) => (a.created || 0) - (b.created || 0));
}

// ============================================================
// DOM creation
// ============================================================

function ensureDOM() {
    if (document.getElementById(DISPLAY_ID)) return;

    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'sm-display-backdrop';
    backdrop.addEventListener('click', closeDisplay);
    document.body.appendChild(backdrop);

    const frame = document.createElement('div');
    frame.id = DISPLAY_ID;
    frame.className = 'sm-display';
    frame.innerHTML = `
        <button class="sm-display-close" title="Close">✕</button>
        <button class="sm-display-manage" title="Open management modal">
            <i class="fa-solid fa-sliders"></i> Management
        </button>
        <div class="sm-shelf" id="sm-display-shelf"></div>
        <div class="sm-book-detail" id="sm-book-detail"></div>
        <div class="sm-display-main" id="sm-display-main"></div>
    `;
    document.body.appendChild(frame);

    frame.querySelector('.sm-display-close')?.addEventListener('click', closeDisplay);
    frame.querySelector('.sm-display-manage')?.addEventListener('click', openManagement);

    // Escape closes the display, but NOT if the modal is open on top of it
    // (the modal has its own Escape handler and should close first).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen && !document.querySelector('.sm-modal.sm-visible')) {
            closeDisplay();
        }
    });

    // Shared chat detail panel lives on <body> so it can float above everything.
    detailEl = document.createElement('div');
    detailEl.className = 'sm-chat-detail';
    document.body.appendChild(detailEl);
}

// Lazy-import the modal to avoid a circular import (modal imports openDisplay).
async function openManagement() {
    closeDisplay();
    try {
        const modal = await import('../modal/index.js');
        modal.openModal('storylines');
    } catch (e) {
        logError('Failed to open management modal:', e);
    }
}

// ============================================================
// Shelf
// ============================================================

function renderShelf() {
    const host = document.getElementById('sm-display-shelf');
    if (!host) return;
    renderBookShelf(host, {
        books: booksOrdered,
        activeBookId,
        onSelectBook: (bookId) => {
            activeBookId = bookId;
            renderShelf();   // refresh active state
            showGrid();
        },
    });
}

// ============================================================
// Book Detail Panel (between shelf + grid when a book is active)
// ============================================================

function renderBookDetail() {
    const panel = document.getElementById('sm-book-detail');
    if (!panel) return;

    if (!activeBookId) {
        panel.classList.remove('sm-book-detail-visible');
        panel.innerHTML = '';
        return;
    }

    const book = books.find(b => b.id === activeBookId);
    if (!book) {
        panel.classList.remove('sm-book-detail-visible');
        panel.innerHTML = '';
        return;
    }

    // Resolve ST tag IDs → full tag objects for colour + name.
    const allSTTags = getSTTags();
    const resolvedTags = (book.stTags || [])
        .map(id => allSTTags.find(t => t.id === id))
        .filter(Boolean);

    const tagsHtml = resolvedTags.length
        ? resolvedTags.map(tag => {
            const bg = tag.color || 'rgba(255,255,255,0.08)';
            const fg = tag.color2 || 'rgba(255,255,255,0.85)';
            return `<span class="sm-book-detail-tag"
                          style="--sttag-bg: ${escapeAttr(bg)}; --sttag-fg: ${escapeAttr(fg)};">
                        ${escapeHtml(tag.name)}
                    </span>`;
        }).join('')
        : '<span class="sm-muted" style="font-size:11px;">No tags</span>';

    const descHtml = book.description?.trim()
        ? `<div class="sm-book-detail-desc">${escapeHtml(book.description)}</div>`
        : `<div class="sm-book-detail-desc sm-muted">No description yet.</div>`;

    const countSl = book.storylineIds?.length || 0;

    // Book-wide word total: sum across every storyline assigned to this book.
    const bookWords = sumWordsForBook(book, storylinesMap, wordCounts);
    const bookWordsHtml = bookWords > 0
        ? `<div class="sm-book-detail-words" title="Total words across this book">
               <i class="fa-solid fa-book-open"></i> ${bookWords.toLocaleString()} word${bookWords === 1 ? '' : 's'}
           </div>`
        : '';

    panel.innerHTML = `
        <div class="sm-book-detail-inner">
            <div class="sm-book-detail-cover">
                ${coverBg(book.coverThumb || book.coverImage, 'fa-layer-group')}
            </div>
            <div class="sm-book-detail-title">${escapeHtml(book.title)}</div>
            <div class="sm-book-detail-count">${countSl} storyline${countSl === 1 ? '' : 's'}</div>
            ${bookWordsHtml}
            <div class="sm-book-detail-section">
                <div class="sm-book-detail-label">Tags</div>
                <div class="sm-book-detail-tags">${tagsHtml}</div>
            </div>
            <div class="sm-book-detail-section">
                <div class="sm-book-detail-label">Description</div>
                ${descHtml}
            </div>
        </div>
    `;

    panel.classList.add('sm-book-detail-visible');
}

// ============================================================
// Grid view
// ============================================================

async function showGrid() {
    const main = document.getElementById('sm-display-main');
    if (!main) return;
    hideDetail();
    renderBookDetail();

    const storylines = await storylinesForActiveBook();

    // Header label/meta depend on whether a specific book is active.
    let headerTitle, headerMeta;
    if (activeBookId) {
        const book = books.find(b => b.id === activeBookId);
        headerTitle = book?.title || 'Book';
        const tagBits = (book?.freeformTags || []).join(', ');
        const n = storylines.length;
        headerMeta = `${n} storyline${n === 1 ? '' : 's'}${tagBits ? ' · ' + tagBits : ''}`;
    } else {
        headerTitle = 'All Storylines';
        const n = storylines.length;
        headerMeta = `${n} storyline${n === 1 ? '' : 's'} across your library`;
    }

    if (!storylines.length) {
        main.innerHTML = emptyStateHtml(activeBookId
            ? 'This book has no storylines yet.'
            : 'No storylines yet.',
            'Use the Management view to create one.');
        return;
    }

    renderStorylineGrid(main, {
        headerTitle,
        headerMeta,
        storylines,
        onOpenStoryline: (slId) => showPage(slId, storylines),
    });
}

// ============================================================
// Storyline page view
// ============================================================

async function showPage(storylineId, gridStorylines) {
    const main = document.getElementById('sm-display-main');
    if (!main) return;
    hideDetail();

    // Hide book detail panel on storyline page — full width for the page view.
    const detailPanel = document.getElementById('sm-book-detail');
    if (detailPanel) {
        detailPanel.classList.remove('sm-book-detail-visible');
        detailPanel.innerHTML = '';
    }

    const storyline = (gridStorylines || []).find(s => s.id === storylineId)
        || (await getStorylines())[storylineId];
    if (!storyline) { showGrid(); return; }

    // Page view replaces the whole main column; wrap in a .sm-page scroller.
    main.innerHTML = `<div class="sm-page" id="sm-display-page"></div>`;
    const pageHost = main.querySelector('#sm-display-page');

    // Resolve summary-presence for every chat in one cached archive read, so
    // the page can dot + gate the popup on summary/quotes/images synchronously.
    let summaryPresence = {};
    try {
        const filenames = (storyline.chats || []).map(c => c.file_name).filter(Boolean);
        summaryPresence = await getSummaryPresenceForChats(filenames);
    } catch (e) {
        logError('Failed to resolve summary presence:', e);
    }

    renderStorylinePage(pageHost, {
        storyline,
        wordCounts,
        summaryPresence,
        onBack: () => showGrid(),
        onOpenChat: async (chat) => {
            // Source-aware open: chat entries carry their own source + owner
            // (character avatar or group id). Fall back to the storyline's
            // primary avatar for legacy character entries missing an avatar.
            try {
                const entry = (chat.source === 'group')
                    ? chat
                    : { ...chat, avatar: chat.avatar || storyline.character?.avatar };
                await openChatEntry(entry);
                closeDisplay();
            } catch (e) {
                logError('Failed to open chat:', e);
            }
        },
        onReadEbook: storyline.ebook?.file ? async () => {
            const returnBookId = activeBookId;
            try {
                const reader = await import('../ebook/reader/index.js');
                const opened = await reader.openEbookReader(storyline.id, {
                    returnTarget: { type: 'display', bookId: returnBookId },
                });
                if (opened) closeDisplay();
            } catch (error) {
                logError('Failed to open ebook reader:', error);
            }
        } : null,
        onDownloadEbook: storyline.ebook?.file ? async () => {
            try {
                const [{ downloadEpub }, { notify }] = await Promise.all([
                    import('../ebook/export/epub.js'),
                    import('../ebook/ui.js'),
                ]);
                const { report } = await downloadEpub(storyline.id);
                if (report.skippedImages) {
                    notify(`EPUB downloaded, but ${report.skippedImages} image${report.skippedImages === 1 ? '' : 's'} could not be embedded.`, 'warning');
                } else if (!report.embeddedFont) {
                    notify('EPUB downloaded. The Google font was unavailable, so reader serif fonts will be used.', 'warning');
                } else {
                    notify('EPUB download started.', 'success');
                }
            } catch (error) {
                logError('Failed to download ebook:', error);
                const { notify } = await import('../ebook/ui.js');
                notify(error.message || 'The EPUB could not be created.', 'error');
            }
        } : null,
        wireChatHover: wireChatHover,
    });
}

// ============================================================
// Shared chat detail panel (cursor-tracked)
// ============================================================

function wireChatHover(rowEl, chat) {
    rowEl.addEventListener('mouseenter', (e) => { showDetail(chat); positionDetail(e); });
    rowEl.addEventListener('mousemove', positionDetail);
    rowEl.addEventListener('mouseleave', hideDetail);
}

function showDetail(chat) {
    if (!detailEl) return;
    const cover = coverImage(chat);
    const hasImg = !!cover;
    const imgHtml = hasImg
        ? `<div class="sm-chat-detail-img">${coverBg(cover.thumb || cover.src, 'fa-comment')}</div>`
        : '';
    const blurb = chat.blurb?.trim();
    const blurbHtml = blurb
        ? `<div class="sm-chat-detail-desc">${escapeHtml(blurb)}</div>`
        : `<div class="sm-chat-detail-desc sm-muted">No blurb yet.</div>`;
    const chrono = chat.chronoLabel
        ? `<div class="sm-chat-detail-chrono">${escapeHtml(chat.chronoLabel)}</div>`
        : '';

    detailEl.className = 'sm-chat-detail' + (hasImg ? '' : ' sm-chat-detail-text-only');
    detailEl.innerHTML = `
        ${imgHtml}
        <div class="sm-chat-detail-text">
            <div class="sm-chat-detail-title">${escapeHtml(prettyChatName(chat.file_name))}</div>
            ${chrono}
            ${blurbHtml}
        </div>
    `;
    detailEl.classList.add('sm-chat-detail-visible');
}

function positionDetail(e) {
    if (!detailEl) return;
    const pad = 14;
    const dw = detailEl.offsetWidth;
    const dh = detailEl.offsetHeight;
    let x = e.clientX + pad;
    let y = e.clientY - dh - 8;  // above-right of cursor by default

    if (x + dw > window.innerWidth - 8) x = e.clientX - dw - pad;  // flip left
    if (y < 8) y = e.clientY + pad + 4;                            // flip below

    detailEl.style.left = x + 'px';
    detailEl.style.top = y + 'px';
}

function hideDetail() {
    detailEl?.classList.remove('sm-chat-detail-visible');
}

// ============================================================
// Helpers
// ============================================================

function emptyStateHtml(text, hint) {
    return `
        <div class="sm-display-empty">
            <div class="sm-display-empty-icon"><i class="fa-solid fa-book-open"></i></div>
            <div class="sm-display-empty-text">${escapeHtml(text)}</div>
            ${hint ? `<div class="sm-display-empty-hint">${escapeHtml(hint)}</div>` : ''}
        </div>`;
}

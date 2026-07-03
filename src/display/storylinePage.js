/**
 * display/storylinePage.js — full storyline view.
 *
 * Hero (heroImage || coverImage) + title overlay, timespan, description, the
 * full four-type tag set, and the chat list ordered by chronoOrder. Chat rows
 * are click-to-open and expose a hover detail panel; the panel itself (shared,
 * cursor-tracked) is owned by display/index.js, which passes in `wireChatHover`.
 *
 * Each chat row has a "See more" expander chevron on the right. Clicking it
 * opens an accordion panel below the row showing:
 *   - Gallery images assigned to the chat (horizontal scroll strip)
 *   - Quotes — auto-pulled from SimpleSummarizer comprehensive summaries
 *     (if installed) merged with any manually-stored quotes
 * The expander is lazy: detail content is fetched/rendered on first open only.
 *
 * When a Dynamic Audio Redux playlist is linked (storyline.darPlaylist), the
 * chat section becomes a two-column layout: chats on the left, playlist cover
 * art + play button on the right. If DAR is not installed or the linked
 * playlist no longer exists, the chat list renders full-width as usual.
 *
 * Export: renderStorylinePage(host, {
 *     storyline, onBack, onOpenChat, wireChatHover
 * })
 *   - onBack(): return to the grid
 *   - onOpenChat(chatEntry): open a chat in ST
 *   - wireChatHover(rowEl, chatEntry): attach the shared detail-panel listeners
 */
import { coverBg, escapeHtml, escapeAttr, prettyChatName, logWarn } from './util.js';
import { extension_settings } from '../../../../../extensions.js';
import { getQuotesForChat } from '../summarizerBridge.js';
import { normalizeChatKey, sumWordsForChats } from '../storage.js';

// ============================================================
// Dynamic Audio Redux bridge
// ============================================================

/**
 * Resolve a storyline's linked playlist to its cover art URLs.
 * Returns null if DAR isn't installed or the playlist doesn't exist.
 */
function resolveLinkedPlaylist(playlistName) {
    if (!playlistName) return null;
    const pl = extension_settings.audio?.playlists?.[playlistName];
    if (!pl) return null;
    return {
        name: playlistName,
        coverImage: pl.coverImage || null,
        coverThumb: pl.coverThumb || null,
    };
}

/**
 * Check whether DAR is currently playing the given playlist.
 */
function isDarPlayingPlaylist(name) {
    const audio = extension_settings.audio;
    if (!audio?.enabled || audio.mode !== 'playlist') return false;
    if (audio.active_playlist !== name) return false;
    const el = document.getElementById('audio_bgm');
    return el && !el.paused;
}

/**
 * Trigger DAR to play the named playlist. Sets mode + active playlist,
 * then fires the `/d-audio on` slash command which goes through DAR's
 * own selectTrack → playTrack pipeline (handles both smart + manual).
 */
async function playDarPlaylist(name) {
    const audio = extension_settings.audio;
    if (!audio?.playlists?.[name]) return;

    audio.active_playlist = name;
    audio.mode = 'playlist';

    try {
        const { executeSlashCommands } = await import('../../../../../slash-commands.js');
        if (executeSlashCommands) {
            await executeSlashCommands('/d-audio on');
        }
    } catch (e) {
        logWarn('DAR playback trigger failed:', e);
        // Fallback: enable and hope the worker picks it up
        audio.enabled = true;
    }
}

/**
 * Pause DAR playback (direct audio element control).
 */
function pauseDarPlayback() {
    const el = document.getElementById('audio_bgm');
    if (el && !el.paused) el.pause();
}

// ============================================================
// Tags helper
// ============================================================

function allTagsHtml(tags = {}) {
    const pills = [];
    (tags.character || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-character">${escapeHtml(t)}</span>`));
    (tags.persona || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-persona">${escapeHtml(t)}</span>`));
    (tags.npc || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-npc">${escapeHtml(t?.name || t)}</span>`));
    (tags.freeform || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-freeform">${escapeHtml(t)}</span>`));
    return pills.join('');
}

// ============================================================
// Render
// ============================================================

export function renderStorylinePage(host, { storyline, onBack, onOpenChat, wireChatHover, wordCounts = {} }) {
    const sl = storyline;
    const heroUrl = sl.heroImage || sl.coverImage || null;

    // Chats in curated chronological order.
    const chats = [...(sl.chats || [])].sort((a, b) => (a.chronoOrder || 0) - (b.chronoOrder || 0));

    // Storyline word total (subtle, shown beside the title). Sums cached
    // per-chat counts — no live fetch.
    const storylineWords = sumWordsForChats(chats, wordCounts);
    const storylineWordsHtml = storylineWords > 0
        ? `<span class="sm-page-title-words" title="Total words in this storyline">
               <i class="fa-solid fa-book-open"></i> ${storylineWords.toLocaleString()} words
           </span>`
        : '';

    const desc = sl.description?.trim();
    const descHtml = desc
        ? `<div class="sm-page-desc">${escapeHtml(desc)}</div>`
        : `<div class="sm-page-desc sm-muted">No description yet.</div>`;

    const tagsHtml = allTagsHtml(sl.tags);
    const timespanHtml = sl.timespan?.label
        ? `<div class="sm-page-timespan">${escapeHtml(sl.timespan.label)}</div>`
        : '';

    const chatsHtml = chats.length
        ? chats.map((c, i) => {
            const thumb = c.image
                ? `<div class="sm-page-chat-thumb">${coverBg(c.imageThumb || c.image, 'fa-comment')}</div>`
                : `<div class="sm-page-chat-thumb"><div class="sm-page-chat-thumb-empty"><i class="fa-solid fa-comment"></i></div></div>`;
            const order = typeof c.chronoOrder === 'number' ? c.chronoOrder + 1 : i + 1;
            const blurb = c.blurb?.trim();
            const blurbHtml = blurb
                ? `<div class="sm-page-chat-blurb">${escapeHtml(blurb)}</div>`
                : `<div class="sm-page-chat-blurb sm-muted">No blurb yet.</div>`;
            const chronoLine = c.chronoLabel
                ? `<div class="sm-page-chat-chrono">${escapeHtml(c.chronoLabel)}</div>`
                : '';
            // Per-chat word count (cached). Sits beneath the date, or takes the
            // date's slot when no chronoLabel is assigned. Hidden if uncached.
            const wc = wordCounts[normalizeChatKey(c.file_name)] || 0;
            const wcLine = wc > 0
                ? `<div class="sm-page-chat-wordcount" title="Words in this chat"><i class="fa-solid fa-book-open"></i> ${wc.toLocaleString()}</div>`
                : '';
            const chrono = (chronoLine || wcLine)
                ? `<div class="sm-page-chat-meta">${chronoLine}${wcLine}</div>`
                : '';
            const hasStored = (c.images?.length > 0) || (c.quotes?.length > 0);
            return `
                <div class="sm-page-chat-wrapper" data-chat-idx="${i}">
                    <div class="sm-page-chat ${hasStored ? 'sm-chat-expandable' : ''}">
                        <div class="sm-page-chat-order">${order}</div>
                        ${thumb}
                        <div class="sm-page-chat-body">
                            <div class="sm-page-chat-name">${escapeHtml(prettyChatName(c.file_name))}</div>
                            ${blurbHtml}
                        </div>
                        ${chrono}
                        <button class="sm-page-chat-goto" title="Open in SillyTavern">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </button>
                        ${hasStored ? `<button class="sm-page-chat-expand sm-has-details" title="See more">
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>` : ''}
                    </div>
                    <div class="sm-page-chat-details" hidden></div>
                </div>`;
        }).join('')
        : `<div class="sm-muted" style="padding:8px 0">No chats assigned to this storyline yet.</div>`;

    const coverUrl = sl.coverImage || null;

    // Resolve linked playlist (if any).
    const linked = resolveLinkedPlaylist(sl.darPlaylist);
    const playlistCoverUrl = linked?.coverImage || linked?.coverThumb || null;

    const playlistPanelHtml = linked ? `
        <div class="sm-page-playlist-panel">
            <div class="sm-page-playlist-cover" id="sm-page-pl-cover">
                ${playlistCoverUrl
                    ? `<img src="${escapeAttr(playlistCoverUrl)}" alt="" />`
                    : `<div class="sm-page-playlist-empty"><i class="fa-solid fa-music"></i></div>`}
                <button class="sm-page-playlist-play" id="sm-page-pl-play" title="Play playlist">
                    <i class="fa-solid fa-play" id="sm-page-pl-icon"></i>
                </button>
            </div>
        </div>
    ` : '';

    // When a playlist is linked, chats + playlist panel sit side-by-side.
    const chatsSection = linked
        ? `<div class="sm-page-chats-section">
               <div class="sm-page-chats-col">
                   <div class="sm-page-chats-label">Chapters · ${chats.length} chat${chats.length === 1 ? '' : 's'}</div>
                   ${chatsHtml}
               </div>
               ${playlistPanelHtml}
           </div>`
        : `<div class="sm-page-chats-label">Chapters · ${chats.length} chat${chats.length === 1 ? '' : 's'}</div>
           ${chatsHtml}`;

    host.innerHTML = `
        <button class="sm-page-back"><i class="fa-solid fa-arrow-left"></i> Back to grid</button>
        <div class="sm-page-hero">
            ${coverBg(heroUrl, 'fa-book-open')}
            <div class="sm-page-hero-overlay"></div>
        </div>
        <div class="sm-page-body">
            <div class="sm-page-meta">
                <div class="sm-page-cover">
                    ${coverBg(coverUrl, 'fa-book-open')}
                </div>
                <div class="sm-page-info">
                    <div class="sm-page-title-row">
                        <div class="sm-page-title">${escapeHtml(sl.title)}</div>
                        ${storylineWordsHtml}
                    </div>
                    ${timespanHtml}
                    ${descHtml}
                    ${tagsHtml ? `<div class="sm-page-tags">${tagsHtml}</div>` : ''}
                </div>
            </div>
            <hr class="sm-page-divider">
            ${chatsSection}
        </div>
    `;

    host.querySelector('.sm-page-back')?.addEventListener('click', () => onBack?.());

    // Wire each chat row: row click expands (if expandable), goto button opens chat.
    host.querySelectorAll('.sm-page-chat-wrapper[data-chat-idx]').forEach(wrapper => {
        const idx = parseInt(wrapper.dataset.chatIdx, 10);
        const chat = chats[idx];
        if (!chat) return;

        const row = wrapper.querySelector('.sm-page-chat');
        const gotoBtn = wrapper.querySelector('.sm-page-chat-goto');
        const expandBtn = wrapper.querySelector('.sm-page-chat-expand');
        const detailPanel = wrapper.querySelector('.sm-page-chat-details');

        // Goto button → open chat in ST.
        gotoBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            onOpenChat?.(chat);
        });

        // Row click → expand accordion (only if this chat has an expand button).
        if (expandBtn && detailPanel) {
            row?.addEventListener('click', (e) => {
                if (e.target.closest('.sm-page-chat-goto')) return;
                expandBtn.click();
            });
            wireChatExpand(expandBtn, detailPanel, chat);
        }

        wireChatHover?.(row, chat);
    });

    // Wire playlist play/pause button.
    if (linked) {
        wirePlaylistButton(linked.name);
    }
}

// ============================================================
// Chat "See more" expander
// ============================================================

/**
 * Wire the expand/collapse toggle for a chat row's detail panel.
 * Detail content is fetched + rendered lazily on the FIRST open.
 */
function wireChatExpand(btn, panel, chat) {
    let loaded = false;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const isOpen = !panel.hidden;

        if (isOpen) {
            // Collapse.
            panel.hidden = true;
            btn.classList.remove('sm-expanded');
            return;
        }

        // First open → populate.
        if (!loaded) {
            panel.innerHTML = `<div class="sm-page-details-loading">Loading…</div>`;
            panel.hidden = false;
            btn.classList.add('sm-expanded');

            await populateChatDetails(panel, chat);
            loaded = true;
            return;
        }

        // Subsequent opens — just reveal.
        panel.hidden = false;
        btn.classList.add('sm-expanded');
    });
}

/**
 * Merge stored quotes with auto-pulled SimpleSummarizer quotes.
 * Deduplicates by text content — manual quotes take precedence.
 */
async function mergeQuotes(chat) {
    const manual = (chat.quotes || []).filter(q => q.source === 'manual');
    let summarizerQuotes = [];

    try {
        summarizerQuotes = await getQuotesForChat(chat.file_name);
    } catch (e) {
        logWarn('Failed to fetch summarizer quotes:', e);
    }

    // Deduplicate: if a manual quote has the same text as a summarizer one, keep manual.
    const manualTexts = new Set(manual.map(q => q.text.trim().toLowerCase()));
    const deduped = summarizerQuotes.filter(q => !manualTexts.has(q.text.trim().toLowerCase()));

    return [...manual, ...deduped];
}

/**
 * Render the detail panel content: image gallery + quotes.
 */
async function populateChatDetails(panel, chat) {
    const images = chat.images || [];
    const quotes = await mergeQuotes(chat);

    if (!images.length && !quotes.length) {
        panel.innerHTML = `
            <div class="sm-page-details-empty">
                <span>No images or quotes for this chapter yet.</span>
            </div>`;
        return;
    }

    let html = '';

    // Image gallery strip.
    if (images.length) {
        html += `
            <div class="sm-page-details-section">
                <div class="sm-page-details-label">
                    <i class="fa-solid fa-images"></i> Gallery · ${images.length} image${images.length === 1 ? '' : 's'}
                </div>
                <div class="sm-page-details-gallery">
                    ${images.map((img, i) => `
                        <div class="sm-page-details-img" data-img-idx="${i}">
                            <img src="${escapeAttr(img.thumb || img.src)}"
                                 alt="${escapeAttr(img.caption || '')}"
                                 loading="lazy" />
                            ${img.caption ? `<div class="sm-page-details-img-caption">${escapeHtml(img.caption)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    // Quotes.
    if (quotes.length) {
        html += `
            <div class="sm-page-details-section">
                <div class="sm-page-details-label">
                    <i class="fa-solid fa-quote-left"></i> Quotes · ${quotes.length}
                </div>
                <div class="sm-page-details-quotes">
                    ${quotes.map(q => `
                        <blockquote class="sm-page-details-quote ${q.source === 'summarizer' ? 'sm-quote-auto' : 'sm-quote-manual'}">
                            <div class="sm-page-details-quote-text">${escapeHtml(q.text)}</div>
                            ${q.speaker ? `<cite class="sm-page-details-quote-speaker">— ${escapeHtml(q.speaker)}</cite>` : ''}
                            ${q.context ? `<div class="sm-page-details-quote-context">${escapeHtml(q.context)}</div>` : ''}
                        </blockquote>
                    `).join('')}
                </div>
            </div>`;
    }

    html += `<button class="sm-page-details-close">
        <i class="fa-solid fa-chevron-up"></i> Close
    </button>`;

    panel.innerHTML = html;

    // Wire close button.
    panel.querySelector('.sm-page-details-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden = true;
        // Sync the chevron button back to collapsed state.
        const wrapper = panel.closest('.sm-page-chat-wrapper');
        wrapper?.querySelector('.sm-page-chat-expand')?.classList.remove('sm-expanded');
    });

    // Wire image clicks → lightbox (open full-size in overlay).
    panel.querySelectorAll('.sm-page-details-img[data-img-idx]').forEach(el => {
        const idx = parseInt(el.dataset.imgIdx, 10);
        const img = images[idx];
        if (!img) return;
        el.addEventListener('click', () => openLightbox(img.src, img.caption));
    });
}

/**
 * Simple lightbox — full-screen overlay showing a single image.
 * Click anywhere (or press Escape) to close.
 */
function openLightbox(src, caption) {
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
    // Force reflow, then animate in.
    requestAnimationFrame(() => overlay.classList.add('sm-lightbox-visible'));
}

// ============================================================
// Playlist play/pause wiring
// ============================================================

// Abort controller for audio event listeners — prevents leaking handlers
// when the user navigates between storyline pages.
let _playlistAC = null;

function wirePlaylistButton(playlistName) {
    const btn = document.getElementById('sm-page-pl-play');
    const icon = document.getElementById('sm-page-pl-icon');
    if (!btn || !icon) return;

    // Tear down any listeners left over from a previous page view.
    if (_playlistAC) _playlistAC.abort();
    _playlistAC = new AbortController();
    const { signal } = _playlistAC;

    // Sync icon to current DAR state.
    function syncIcon() {
        const playing = isDarPlayingPlaylist(playlistName);
        icon.className = playing
            ? 'fa-solid fa-pause'
            : 'fa-solid fa-play';
    }

    syncIcon();

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isDarPlayingPlaylist(playlistName)) {
            pauseDarPlayback();
        } else {
            await playDarPlaylist(playlistName);
        }
        // Brief delay for DAR to react, then sync the icon.
        setTimeout(syncIcon, 300);
    }, { signal });

    // Listen for audio state changes to keep icon in sync.
    const audioEl = document.getElementById('audio_bgm');
    if (audioEl) {
        const handler = () => syncIcon();
        audioEl.addEventListener('play', handler, { signal });
        audioEl.addEventListener('pause', handler, { signal });
        audioEl.addEventListener('ended', handler, { signal });
    }
}

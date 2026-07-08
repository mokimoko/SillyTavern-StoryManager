/**
 * display/storylinePage.js — full storyline view.
 *
 * Hero (heroImage || coverImage) + title overlay, timespan, description, the
 * full four-type tag set, and the chat list ordered by chronoOrder. Chat rows
 * are click-to-open and expose a hover detail panel; the panel itself (shared,
 * cursor-tracked) is owned by display/index.js, which passes in `wireChatHover`.
 *
 * Clicking a chat row opens the chat detail popup (display/chatDetailModal.js)
 * — a centered dialog showing the chat's blurb, comprehensive summary, merged
 * quotes, and a 3-per-row image grid. (This replaced an older inline accordion.)
 * The little goto button on each row still opens the chat in SillyTavern.
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
import { coverBg, escapeHtml, escapeAttr, prettyChatName, coverImage, migrateChatCover, logWarn } from './util.js';
import { extension_settings } from '../../../../../extensions.js';
import { openChatDetail } from './chatDetailModal.js';
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

/**
 * Does this chat have "detail" content worth a dot + click popup?
 * Blurb deliberately does NOT count — it's already shown in the row and in the
 * hover preview. Only stored images, manual quotes, or a SimpleSummarizer entry
 * (summary text and/or summary quotes) earn the dot.
 * @param {object} chat - the chat entry
 * @param {{hasText:boolean,hasQuotes:boolean}|undefined} presence - summary presence for this chat
 */
function chatHasDetails(chat, presence) {
    if (chat.images?.length) return true;
    if (chat.quotes?.some(q => q?.source === 'manual' && q.text?.trim())) return true;
    if (presence?.hasText || presence?.hasQuotes) return true;
    return false;
}

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

export function renderStorylinePage(host, { storyline, onBack, onOpenChat, wireChatHover, wordCounts = {}, summaryPresence = {} }) {
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
            // Idempotent seed of images[] from the legacy single image, then
            // read the representative cover from the array (single source of truth).
            migrateChatCover(c);
            const cover = coverImage(c);
            const thumb = cover
                ? `<div class="sm-page-chat-thumb">${coverBg(cover.thumb || cover.src, 'fa-comment')}</div>`
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
            // Dot + click popup only when the chat actually has details
            // (summary / quotes / images). Blurb alone does not qualify.
            const hasDetails = chatHasDetails(c, summaryPresence[c.file_name]);
            const dotHtml = hasDetails
                ? `<span class="sm-chat-has-details" title="Has summary, quotes, or images"></span>`
                : '';
            return `
                <div class="sm-page-chat-wrapper" data-chat-idx="${i}" data-has-details="${hasDetails ? '1' : '0'}">
                    <div class="sm-page-chat${hasDetails ? ' sm-chat-clickable' : ''}">
                        <div class="sm-page-chat-order">${order}</div>
                        ${thumb}
                        <div class="sm-page-chat-body">
                            <div class="sm-page-chat-name"><span class="sm-page-chat-name-text">${escapeHtml(prettyChatName(c.file_name))}</span>${dotHtml}</div>
                            ${blurbHtml}
                        </div>
                        ${chrono}
                        <button class="sm-page-chat-goto" title="Open in SillyTavern">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </button>
                    </div>
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

    // Wire each chat row: row click opens the detail popup, goto opens the chat in ST.
    host.querySelectorAll('.sm-page-chat-wrapper[data-chat-idx]').forEach(wrapper => {
        const idx = parseInt(wrapper.dataset.chatIdx, 10);
        const chat = chats[idx];
        if (!chat) return;

        const row = wrapper.querySelector('.sm-page-chat');
        const gotoBtn = wrapper.querySelector('.sm-page-chat-goto');

        // Goto button → open chat in ST. (Always available, even on rows
        // with no detail content.)
        gotoBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            onOpenChat?.(chat);
        });

        // Row click → open the chat detail popup, but ONLY for rows that have
        // details (summary / quotes / images). Rows without stay non-clickable
        // — the goto button and hover preview still work.
        if (wrapper.dataset.hasDetails === '1') {
            row?.addEventListener('click', (e) => {
                if (e.target.closest('.sm-page-chat-goto')) return;
                openChatDetail(chat, { onOpenChat });
            });
        }

        // Hover preview is universal — every row gets the cursor-tracked card.
        wireChatHover?.(row, chat);
    });

    // Wire playlist play/pause button.
    if (linked) {
        wirePlaylistButton(linked.name);
    }
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

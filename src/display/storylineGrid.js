/**
 * display/storylineGrid.js — storyline card grid + hover tooltips + search.
 *
 * Renders the grid header (book title/meta + search box) and a responsive card
 * grid. Cards show cover, chat-count badge, title, and character/persona tags;
 * a hover tooltip exposes the timespan + full description. The search box filters
 * the visible cards live (matches title, tags, and description).
 *
 * Export: renderStorylineGrid(host, {
 *     headerTitle, headerMeta, storylines, onOpenStoryline
 * })
 *   - storylines: array of storyline objects to show as cards
 *   - onOpenStoryline(storylineId): called when a card is clicked
 */
import { coverBg, escapeHtml, escapeAttr } from './util.js';

// Build the inline tag pills shown ON the card (character + persona only,
// matching the mock — full tag set appears on the storyline page).
function cardTagsHtml(tags = {}) {
    const pills = [];
    (tags.character || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-character">${escapeHtml(t)}</span>`));
    (tags.persona || []).forEach(t => pills.push(`<span class="sm-dtag sm-dtag-persona">${escapeHtml(t)}</span>`));
    return pills.join('');
}

// Compose a timespan label for the tooltip from a storyline's chats / future
// timespan field. For now we derive nothing fancy — storylines don't carry a
// timespan field yet, so we show the chat count as a fallback context line.
function timespanLabel(sl) {
    if (sl.timespan?.label) return escapeHtml(sl.timespan.label);
    const n = sl.chats?.length || 0;
    return `${n} chat${n === 1 ? '' : 's'}`;
}

// A single searchable haystack string per storyline.
function searchHaystack(sl) {
    const t = sl.tags || {};
    return [
        sl.title,
        sl.description,
        ...(t.character || []), ...(t.persona || []),
        ...(t.npc || []).map(n => n?.name || n), ...(t.freeform || []),
    ].join(' ').toLowerCase();
}

export function renderStorylineGrid(host, { headerTitle, headerMeta, storylines = [], onOpenStoryline }) {
    host.innerHTML = `
        <div class="sm-grid-header">
            <div>
                <div class="sm-grid-book-title">${escapeHtml(headerTitle)}</div>
                <div class="sm-grid-book-meta">${escapeHtml(headerMeta)}</div>
            </div>
            <div class="sm-display-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="Search storylines, tags…" />
            </div>
        </div>
        <div class="sm-grid">
            <div class="sm-grid-cards"></div>
        </div>
    `;

    const cardsHost = host.querySelector('.sm-grid-cards');
    const searchInput = host.querySelector('.sm-display-search input');

    const renderCards = (list) => {
        if (!list.length) {
            cardsHost.innerHTML = `<div class="sm-muted" style="padding:20px 2px">No storylines match.</div>`;
            return;
        }
        cardsHost.innerHTML = list.map(sl => {
            const count = sl.chats?.length || 0;
            const desc = sl.description?.trim();
            const descHtml = desc
                ? `<div class="sm-grid-tooltip-desc">${escapeHtml(desc)}</div>`
                : `<div class="sm-grid-tooltip-desc sm-muted">No description yet.</div>`;
            return `
                <div class="sm-grid-card" data-sl-id="${escapeAttr(sl.id)}">
                    <div class="sm-grid-cover">
                        ${coverBg(sl.coverThumb || sl.coverImage, 'fa-book-open')}
                        <div class="sm-grid-count"><i class="fa-solid fa-comment"></i> ${count}</div>
                    </div>
                    <div class="sm-grid-info">
                        <div class="sm-grid-title">${escapeHtml(sl.title)}</div>
                        <div class="sm-grid-tags">${cardTagsHtml(sl.tags)}</div>
                    </div>
                    <div class="sm-grid-tooltip">
                        <div class="sm-grid-tooltip-title">${escapeHtml(sl.title)}</div>
                        <div class="sm-grid-tooltip-timespan">${timespanLabel(sl)}</div>
                        ${descHtml}
                    </div>
                </div>`;
        }).join('');

        cardsHost.querySelectorAll('.sm-grid-card').forEach(card => {
            card.addEventListener('click', () => onOpenStoryline?.(card.dataset.slId));
        });
    };

    renderCards(storylines);

    // Live filter.
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) { renderCards(storylines); return; }
        renderCards(storylines.filter(sl => searchHaystack(sl).includes(q)));
    });
}

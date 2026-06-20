/**
 * display/bookShelf.js — left column of book covers.
 *
 * Renders an "All storylines" pseudo-book at the top, then one cover per book.
 * The scroll arrows nudge the (overflow-hidden) list; books are clickable and
 * carry a hover tooltip with the title. Active book gets the accent border.
 *
 * Export: renderBookShelf(host, { books, activeBookId, onSelectBook })
 *   - books: array of book objects (already ordered by the caller)
 *   - activeBookId: id of the selected book, or null for the "All" view
 *   - onSelectBook(bookId|null): called on click
 */
import { coverBg, escapeHtml, escapeAttr } from './util.js';

export function renderBookShelf(host, { books = [], activeBookId = null, onSelectBook }) {
    const allActive = activeBookId == null ? 'sm-shelf-active' : '';

    const booksHtml = books.map(b => {
        const active = b.id === activeBookId ? 'sm-shelf-active' : '';
        return `
            <div class="sm-shelf-book ${active}" data-book-id="${escapeAttr(b.id)}">
                ${coverBg(b.coverThumb || b.coverImage, 'fa-layer-group')}
                <div class="sm-shelf-tooltip">${escapeHtml(b.title)}</div>
            </div>`;
    }).join('');

    host.innerHTML = `
        <button class="sm-shelf-arrow sm-shelf-up" title="Scroll up">▲</button>
        <div class="sm-shelf-list">
            <div class="sm-shelf-all ${allActive}" data-book-id="">
                <i class="fa-solid fa-grip"></i>
                <span>All</span>
            </div>
            ${booksHtml}
        </div>
        <button class="sm-shelf-arrow sm-shelf-down" title="Scroll down">▼</button>
    `;

    const list = host.querySelector('.sm-shelf-list');

    // Click → select (empty data-book-id means the "All" pseudo-book).
    host.querySelectorAll('[data-book-id]').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.bookId || null;
            onSelectBook?.(id);
        });
    });

    // Scroll arrows nudge the list. Disable them when there's nothing to scroll.
    const up = host.querySelector('.sm-shelf-up');
    const down = host.querySelector('.sm-shelf-down');
    const STEP = 100;
    const syncArrows = () => {
        const overflow = list.scrollHeight > list.clientHeight + 1;
        up.disabled = !overflow || list.scrollTop <= 0;
        down.disabled = !overflow || list.scrollTop >= list.scrollHeight - list.clientHeight - 1;
    };
    up.addEventListener('click', () => { list.scrollBy({ top: -STEP, behavior: 'smooth' }); });
    down.addEventListener('click', () => { list.scrollBy({ top: STEP, behavior: 'smooth' }); });
    list.addEventListener('scroll', syncArrows);
    // Defer initial sync until layout settles.
    requestAnimationFrame(syncArrows);
}

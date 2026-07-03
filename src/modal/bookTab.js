/**
 * modal/bookTab.js — Book create/edit (Phase 2)
 *
 * Books are the only place Books are born. A book collects storylines in a curated
 * order (storylineIds[]) and carries title, description, cover, freeform tags, and a
 * timespan (auto | manual). Assignment goes through assignStorylineToBook() so the
 * storyline.bookId back-reference and the book's ordered list stay in sync.
 *
 * Two views (same pattern as storylineTab): LIST and EDIT.
 *
 * Export: render(container, ctx)  // ctx = { rerender, switchTab, close }
 */
import {
    getBooks, getBook, createBook, updateBook, deleteBook,
    getStorylines, assignStorylineToBook,
} from '../storage.js';
import { renderImagePicker } from '../components/imagePicker.js';
import { renderSTTagPicker } from '../components/stTagPicker.js';
import {
    generateBookDescription, canGenerateBook,
} from '../descriptionGen.js';
import { escapeHtml, escapeAttr, logError } from '../display/util.js';

let editingId = null;
let draft = null;

export async function render(container, ctx) {
    if (editingId !== null || draft) {
        await renderEditView(container, ctx);
    } else {
        await renderListView(container, ctx);
    }
}

// ============================================================
// LIST VIEW
// ============================================================

async function renderListView(container, ctx) {
    const books = Object.values(await getBooks());
    books.sort((a, b) => (b.created || 0) - (a.created || 0));

    container.innerHTML = `
        <div class="sm-tab-header">
            <div>
                <span class="sm-tab-title">Books</span>
                <span class="sm-tab-subtitle">${books.length || 'no'} book${books.length === 1 ? '' : 's'}</span>
            </div>
            <div class="sm-tab-actions">
                <button class="sm-btn sm-btn-accent" id="sm-bk-new">
                    <i class="fa-solid fa-plus"></i> New Book
                </button>
            </div>
        </div>
        ${books.length ? `
            <div class="sm-card-list">${books.map(bookCardHtml).join('')}</div>
        ` : `
            <div class="sm-empty-state">
                <i class="fa-solid fa-layer-group"></i>
                <p>No books yet</p>
                <span class="sm-empty-hint">Books group storylines into a collection.</span>
            </div>
        `}
    `;

    container.querySelector('#sm-bk-new')?.addEventListener('click', () => {
        startNewDraft();
        render(container, ctx);
    });

    container.querySelectorAll('.sm-card[data-id]').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.sm-card-edit')?.addEventListener('click', () => {
            editingId = id; draft = null; render(container, ctx);
        });
        card.querySelector('.sm-card-delete')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const bk = await getBook(id);
            if (confirm(`Delete book "${bk?.title || id}"? Member storylines are kept (just un-booked).`)) {
                await deleteBook(id);
                render(container, ctx);
            }
        });
    });
}

function bookCardHtml(bk) {
    const count = bk.storylineIds?.length || 0;
    const thumb = bk.coverThumb || bk.coverImage;
    const cover = thumb
        ? `<img src="${escapeAttr(thumb)}" alt="" class="sm-card-thumb" loading="lazy" />`
        : `<div class="sm-card-thumb sm-card-thumb-empty"><i class="fa-solid fa-layer-group"></i></div>`;
    return `
        <div class="sm-card" data-id="${escapeAttr(bk.id)}">
            ${cover}
            <div class="sm-card-body">
                <div class="sm-card-title">${escapeHtml(bk.title)}</div>
                <div class="sm-card-meta">${count} storyline${count === 1 ? '' : 's'}</div>
            </div>
            <div class="sm-card-actions">
                <button class="sm-btn-icon sm-card-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="sm-btn-icon sm-card-delete sm-btn-danger-text" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `;
}

// ============================================================
// DRAFT lifecycle
// ============================================================

function startNewDraft() {
    editingId = null;
    draft = {
        id: null,
        title: '',
        description: '',
        coverImage: null,
        coverThumb: null,
        storylineIds: [],
        timespan: { mode: 'auto', label: '', start: null, end: null },
        freeformTags: [],
        stTags: [],
    };
}

async function loadDraft(id) {
    const bk = await getBook(id);
    if (!bk) { editingId = null; draft = null; return; }
    draft = {
        id: bk.id,
        title: bk.title || '',
        description: bk.description || '',
        coverImage: bk.coverImage || null,
        coverThumb: bk.coverThumb || null,
        storylineIds: [...(bk.storylineIds || [])],
        timespan: { ...(bk.timespan || { mode: 'auto', label: '', start: null, end: null }) },
        freeformTags: [...(bk.freeformTags || [])],
        stTags: [...(bk.stTags || [])],
    };
}

function exitEdit() { editingId = null; draft = null; }

// ============================================================
// EDIT VIEW
// ============================================================

async function renderEditView(container, ctx) {
    if (editingId && !draft) await loadDraft(editingId);
    if (!draft) { await renderListView(container, ctx); return; }

    const isNew = !draft.id;

    container.innerHTML = `
        <div class="sm-tab-header">
            <div>
                <button class="sm-btn sm-btn-ghost" id="sm-bk-back">
                    <i class="fa-solid fa-arrow-left"></i> Back
                </button>
                <span class="sm-tab-title">${isNew ? 'New Book' : 'Edit Book'}</span>
            </div>
            <div class="sm-tab-actions">
                ${!isNew ? `<button class="sm-btn sm-btn-ghost sm-btn-danger-text" id="sm-bk-delete">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>` : ''}
                <button class="sm-btn sm-btn-accent" id="sm-bk-save">
                    <i class="fa-solid fa-floppy-disk"></i> Save
                </button>
            </div>
        </div>

        <div class="sm-form">
            <div class="sm-field">
                <label class="sm-field-label">Title</label>
                <input type="text" class="sm-input" id="sm-bk-title"
                       value="${escapeAttr(draft.title)}" placeholder="Book title" />
            </div>
            <div class="sm-field">
                <label class="sm-field-label">Description
                    <button type="button" class="sm-gen-btn" id="sm-bk-desc-gen" title="Generate from storyline descriptions">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                    </button>
                </label>
                <textarea class="sm-textarea" id="sm-bk-desc"
                          placeholder="What does this book collect?">${escapeHtml(draft.description)}</textarea>
                <div class="sm-gen-status" id="sm-bk-desc-status"></div>
            </div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-book-open"></i> Storylines</div>
            <div id="sm-bk-storylines"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-clock"></i> Timespan</div>
            <div id="sm-bk-timespan"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-tags"></i> ST Tags</div>
            <div class="sm-field-hint">Link this book to character-card tags from SillyTavern.</div>
            <div id="sm-bk-sttags"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-image"></i> Cover Image</div>
            <div id="sm-bk-cover"></div>
        </div>
    `;

    await renderStorylineSection(container);
    renderTimespanSection(container);
    mountSTTags(container);
    mountCover(container);
    wireEditControls(container, ctx);
}

function mountCover(container) {
    const host = container.querySelector('#sm-bk-cover');
    if (host) renderImagePicker(
        host,
        { url: draft.coverImage, thumb: draft.coverThumb },
        (v) => { draft.coverImage = v.url; draft.coverThumb = v.thumb; },
    );
}

function mountSTTags(container) {
    const host = container.querySelector('#sm-bk-sttags');
    if (host) renderSTTagPicker(
        host,
        draft.stTags,
        (ids) => { draft.stTags = ids; },
    );
}

// ============================================================
// Storyline assignment (ordered multi-select)
// ============================================================

async function renderStorylineSection(container) {
    const host = container.querySelector('#sm-bk-storylines');
    if (!host) return;

    const all = await getStorylines();
    const allList = Object.values(all);

    if (!allList.length) {
        host.innerHTML = `<div class="sm-empty">No storylines exist yet — create some first.</div>`;
        return;
    }

    // Selected, in curated order; then the unselected pool.
    const selected = draft.storylineIds.map(id => all[id]).filter(Boolean);
    const selectedIds = new Set(draft.storylineIds);
    const available = allList.filter(sl => !selectedIds.has(sl.id));

    host.innerHTML = `
        <div class="sm-book-selected">
            <div class="sm-field-label">In this book (drag order via arrows)</div>
            ${selected.length ? selected.map((sl, i) => `
                <div class="sm-book-sl-row" data-id="${escapeAttr(sl.id)}">
                    <span class="sm-book-sl-order">${i + 1}</span>
                    <span class="sm-book-sl-title">${escapeHtml(sl.title)}</span>
                    <span class="sm-book-sl-meta">${escapeHtml(sl.character?.displayName || '—')}</span>
                    <span class="sm-book-sl-controls">
                        <button class="sm-btn-icon sm-book-up" title="Move up" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
                        <button class="sm-btn-icon sm-book-down" title="Move down" ${i === selected.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
                        <button class="sm-btn-icon sm-book-remove sm-btn-danger-text" title="Remove"><i class="fa-solid fa-xmark"></i></button>
                    </span>
                </div>
            `).join('') : `<div class="sm-empty">No storylines assigned yet.</div>`}
        </div>
        <div class="sm-book-available">
            <div class="sm-field-label">Available</div>
            ${available.length ? available.map(sl => `
                <div class="sm-book-sl-row sm-book-sl-avail" data-id="${escapeAttr(sl.id)}">
                    <button class="sm-btn-icon sm-book-add" title="Add to book"><i class="fa-solid fa-plus"></i></button>
                    <span class="sm-book-sl-title">${escapeHtml(sl.title)}</span>
                    <span class="sm-book-sl-meta">${escapeHtml(sl.character?.displayName || '—')}</span>
                </div>
            `).join('') : `<div class="sm-empty">All storylines are in this book.</div>`}
        </div>
    `;

    wireStorylineSection(host, container);
}

function wireStorylineSection(host, container) {
    const refresh = () => renderStorylineSection(container);

    host.querySelectorAll('.sm-book-add').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.sm-book-sl-row').dataset.id;
            if (!draft.storylineIds.includes(id)) draft.storylineIds.push(id);
            refresh();
        });
    });

    host.querySelectorAll('.sm-book-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.sm-book-sl-row').dataset.id;
            draft.storylineIds = draft.storylineIds.filter(x => x !== id);
            refresh();
        });
    });

    host.querySelectorAll('.sm-book-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.sm-book-sl-row').dataset.id;
            const i = draft.storylineIds.indexOf(id);
            if (i > 0) {
                [draft.storylineIds[i - 1], draft.storylineIds[i]] =
                    [draft.storylineIds[i], draft.storylineIds[i - 1]];
                refresh();
            }
        });
    });

    host.querySelectorAll('.sm-book-down').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.sm-book-sl-row').dataset.id;
            const i = draft.storylineIds.indexOf(id);
            if (i < draft.storylineIds.length - 1) {
                [draft.storylineIds[i + 1], draft.storylineIds[i]] =
                    [draft.storylineIds[i], draft.storylineIds[i + 1]];
                refresh();
            }
        });
    });
}

// ============================================================
// Timespan (auto | manual)
// ============================================================

function renderTimespanSection(container) {
    const host = container.querySelector('#sm-bk-timespan');
    if (!host) return;
    const mode = draft.timespan.mode === 'manual' ? 'manual' : 'auto';

    host.innerHTML = `
        <div class="sm-radio-group">
            <label class="sm-radio">
                <input type="radio" name="sm-bk-ts" value="auto" ${mode === 'auto' ? 'checked' : ''} />
                <span>Auto <span class="sm-setting-desc">— derived from member storylines' chronology</span></span>
            </label>
            <label class="sm-radio">
                <input type="radio" name="sm-bk-ts" value="manual" ${mode === 'manual' ? 'checked' : ''} />
                <span>Manual <span class="sm-setting-desc">— type your own label</span></span>
            </label>
        </div>
        <div class="sm-field" id="sm-bk-ts-manual" ${mode === 'manual' ? '' : 'hidden'}>
            <input type="text" class="sm-input" id="sm-bk-ts-label"
                   value="${escapeAttr(draft.timespan.label || '')}"
                   placeholder="e.g. The First Age – The Sundering" />
        </div>
    `;

    host.querySelectorAll('input[name="sm-bk-ts"]').forEach(radio => {
        radio.addEventListener('change', () => {
            draft.timespan.mode = radio.value;
            host.querySelector('#sm-bk-ts-manual').hidden = radio.value !== 'manual';
        });
    });
    host.querySelector('#sm-bk-ts-label')?.addEventListener('input', (e) => {
        draft.timespan.label = e.target.value;
    });
}

// ============================================================
// Edit-control wiring
// ============================================================

function wireEditControls(container, ctx) {
    container.querySelector('#sm-bk-back')?.addEventListener('click', () => {
        exitEdit(); render(container, ctx);
    });
    container.querySelector('#sm-bk-title')?.addEventListener('input', (e) => {
        draft.title = e.target.value;
    });
    container.querySelector('#sm-bk-desc')?.addEventListener('input', (e) => {
        draft.description = e.target.value;
    });
    wireDescGen(container);
    container.querySelector('#sm-bk-save')?.addEventListener('click', () => saveDraft(container, ctx));
    container.querySelector('#sm-bk-delete')?.addEventListener('click', () => deleteDraft(container, ctx));
}

// ============================================================
// Description generation
// ============================================================

async function wireDescGen(container) {
    const btn = container.querySelector('#sm-bk-desc-gen');
    const status = container.querySelector('#sm-bk-desc-status');
    const textarea = container.querySelector('#sm-bk-desc');
    if (!btn || !textarea) return;

    const setStatus = (msg, kind = '') => {
        if (!status) return;
        status.textContent = msg || '';
        status.className = 'sm-gen-status' + (kind ? ` sm-gen-${kind}` : '');
    };

    // Resolve the book's member storylines from the current draft order.
    const all = await getStorylines();
    const members = (draft.storylineIds || []).map(id => all[id]).filter(Boolean);

    const avail = canGenerateBook(members);
    if (!avail.available) {
        btn.disabled = true;
        btn.title = members.length
            ? 'Member storylines have no descriptions yet — describe at least one first'
            : 'Add storylines with descriptions to this book first';
    } else {
        btn.disabled = false;
        btn.title = 'Generate from member storyline descriptions';
    }

    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        setStatus('Generating…', 'busy');
        try {
            // Re-resolve members at click time (order/selection may have changed).
            const fresh = await getStorylines();
            const current = (draft.storylineIds || []).map(id => fresh[id]).filter(Boolean);
            const result = await generateBookDescription(draft, current);
            if (result.ok) {
                textarea.value = result.text;
                draft.description = result.text;
                draft.descriptionGenerated = true;
                setStatus('Generated from storyline descriptions. Review and edit.', 'ok');
            } else {
                setStatus(result.reason || 'Generation unavailable.', 'err');
            }
        } catch (e) {
            logError('book desc gen failed:', e);
            setStatus('Generation failed — see console.', 'err');
        } finally {
            btn.disabled = false;
        }
    });
}

// ============================================================
// Save / Delete
// ============================================================

async function saveDraft(container, ctx) {
    if (!draft.title.trim()) {
        alert('Please give the book a title.');
        return;
    }

    const payload = {
        title: draft.title.trim(),
        description: draft.description,
        coverImage: draft.coverImage,
        coverThumb: draft.coverThumb,
        timespan: draft.timespan,
        freeformTags: draft.freeformTags,
        stTags: draft.stTags,
        // storylineIds is reconciled below via assignStorylineToBook so the
        // storyline.bookId back-references stay consistent.
    };

    let bookId = draft.id;
    if (bookId) {
        await updateBook(bookId, payload);
    } else {
        const created = await createBook({ ...payload, storylineIds: [] });
        bookId = created.id;
    }

    // Reconcile membership. Detach storylines removed from the draft, attach the
    // draft set. assignStorylineToBook handles the previous-book cleanup + ordering.
    const book = await getBook(bookId);
    const prevIds = new Set(book?.storylineIds || []);
    const nextIds = new Set(draft.storylineIds);

    for (const id of prevIds) {
        if (!nextIds.has(id)) await assignStorylineToBook(id, null);
    }
    // Assign in draft order so the book's storylineIds ends up correctly ordered.
    for (const id of draft.storylineIds) {
        await assignStorylineToBook(id, bookId);
    }
    // assignStorylineToBook appends; enforce the exact curated order explicitly.
    await updateBook(bookId, { storylineIds: [...draft.storylineIds] });

    exitEdit();
    render(container, ctx);
}

async function deleteDraft(container, ctx) {
    if (!draft?.id) return;
    if (!confirm(`Delete book "${draft.title}"? Member storylines are kept (just un-booked).`)) return;
    await deleteBook(draft.id);
    exitEdit();
    render(container, ctx);
}

/**
 * modal/storylineTab.js — Storyline create/edit (Phase 2)
 *
 * Two views inside one tab:
 *   LIST — all storylines, grouped nothing-fancy, with New / edit / delete.
 *   EDIT — the full create/edit form: title, description, character (single),
 *          personas (multi), tags (tagPicker), chat assignment with conflict
 *          handling, chronology (drag-order + labels), cover image (imagePicker).
 *
 * The Storylines tab is the GENERAL editor — it can assign ANY chat from ANY
 * character (the in-chat sidebar is the active-card quick surface). Chat
 * assignment respects the ≤1-owner rule via assignChatToStoryline()'s conflict
 * descriptor: { ok:false, conflict:{ storylineId, title } } → warn + offer move.
 *
 * Export: render(container, ctx)  // ctx = { rerender, switchTab, close }
 */
import {
    getStorylines, getStoryline, createStoryline, updateStoryline, deleteStoryline,
    assignChatToStoryline, removeChatFromStoryline,
} from '../storage.js';
import {
    getAllCharacters, getAllPersonas, getChatsForCharacter,
} from '../stContext.js';
import { extension_settings } from '../../../../../extensions.js';
import { renderTagPicker } from '../components/tagPicker.js';
import { renderImagePicker, uploadImage } from '../components/imagePicker.js';
import { renderChronology } from '../components/chronology.js';
import { isSummarizerAvailable, getQuotesForChat } from '../summarizerBridge.js';
import { getSetting } from '../settings.js';
import {
    generateStorylineDescription, canGenerateStoryline,
    generateChatBlurb,
} from '../descriptionGen.js';
import { escapeHtml, escapeAttr, logError } from '../display/util.js';

// View state is module-local: which storyline is open for editing (null = list).
let editingId = null;
// A working draft while editing, so unsaved edits don't mutate the store until Save.
let draft = null;

// ============================================================
// Dynamic Audio Redux bridge (optional cross-extension)
// ============================================================

function isDarAvailable() {
    return !!extension_settings.audio?.playlists;
}

function getDarPlaylistNames() {
    const pl = extension_settings.audio?.playlists;
    if (!pl) return [];
    return Object.keys(pl);
}

function getDarPlaylistMeta(name) {
    const pl = extension_settings.audio?.playlists?.[name];
    if (!pl) return null;
    return {
        type: pl.type || 'manual',
        coverImage: pl.coverImage || null,
        coverThumb: pl.coverThumb || null,
    };
}

// ============================================================
// Entry
// ============================================================

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

// Searchable haystack per storyline (mirrors Display grid pattern).
function slSearchHaystack(sl) {
    const t = sl.tags || {};
    return [
        sl.title,
        sl.description,
        sl.character?.displayName,
        sl.character?.name,
        ...(t.character || []), ...(t.persona || []),
        ...(t.npc || []).map(n => n?.name || n), ...(t.freeform || []),
    ].join(' ').toLowerCase();
}

async function renderListView(container, ctx) {
    const storylines = Object.values(await getStorylines());
    storylines.sort((a, b) => (b.created || 0) - (a.created || 0));

    const showSearch = storylines.length > 4;

    container.innerHTML = `
        <div class="sm-tab-header">
            <div>
                <span class="sm-tab-title">Storylines</span>
                <span class="sm-tab-subtitle">${storylines.length || 'no'} storyline${storylines.length === 1 ? '' : 's'}</span>
            </div>
            <div class="sm-tab-actions">
                <button class="sm-btn sm-btn-accent" id="sm-sl-new">
                    <i class="fa-solid fa-plus"></i> New Storyline
                </button>
            </div>
        </div>
        ${showSearch ? `
            <div class="sm-list-search" id="sm-sl-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" class="sm-input" placeholder="Search storylines, tags…" />
            </div>
        ` : ''}
        <div id="sm-sl-card-list">
        ${storylines.length ? `
            <div class="sm-card-list">
                ${storylines.map(slCardHtml).join('')}
            </div>
        ` : `
            <div class="sm-empty-state">
                <i class="fa-solid fa-book-open"></i>
                <p>No storylines yet</p>
                <span class="sm-empty-hint">Create one to start cataloguing chats.</span>
            </div>
        `}
        </div>
    `;

    container.querySelector('#sm-sl-new')?.addEventListener('click', () => {
        startNewDraft();
        render(container, ctx);
    });

    wireCardActions(container, ctx);

    // Live search filter.
    const searchInput = container.querySelector('#sm-sl-search input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            const host = container.querySelector('#sm-sl-card-list');
            if (!host) return;

            const filtered = q
                ? storylines.filter(sl => slSearchHaystack(sl).includes(q))
                : storylines;

            if (!filtered.length) {
                host.innerHTML = `<div class="sm-empty" style="padding:16px 0">No storylines match.</div>`;
            } else {
                host.innerHTML = `<div class="sm-card-list">${filtered.map(slCardHtml).join('')}</div>`;
                wireCardActions(container, ctx);
            }
        });
    }
}

function wireCardActions(container, ctx) {
    container.querySelectorAll('.sm-card[data-id]').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.sm-card-edit')?.addEventListener('click', () => {
            editingId = id;
            draft = null;
            render(container, ctx);
        });
        card.querySelector('.sm-card-delete')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const sl = await getStoryline(id);
            if (confirm(`Delete storyline "${sl?.title || id}"? Chats become unowned; this can't be undone.`)) {
                await deleteStoryline(id);
                render(container, ctx);
            }
        });
    });
}

function slCardHtml(sl) {
    const chatCount = sl.chats?.length || 0;
    const thumb = sl.coverThumb || sl.coverImage;
    const cover = thumb
        ? `<img src="${escapeAttr(thumb)}" alt="" class="sm-card-thumb" loading="lazy" />`
        : `<div class="sm-card-thumb sm-card-thumb-empty"><i class="fa-solid fa-book"></i></div>`;
    return `
        <div class="sm-card" data-id="${escapeAttr(sl.id)}">
            ${cover}
            <div class="sm-card-body">
                <div class="sm-card-title">${escapeHtml(sl.title)}</div>
                <div class="sm-card-meta">
                    ${escapeHtml(sl.character?.displayName || '—')} · ${chatCount} chat${chatCount === 1 ? '' : 's'}
                </div>
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

/** Begin a blank draft (defaults to active character if one is selected). */
function startNewDraft() {
    editingId = null;
    const chars = getAllCharacters();
    draft = {
        id: null,
        title: '',
        description: '',
        coverImage: null,
        coverThumb: null,
        heroImage: null,
        heroThumb: null,
        character: { name: '', avatar: '', displayName: '' },
        mainPersonas: [],
        tags: { character: [], persona: [], npc: [], freeform: [] },
        chats: [],
        bookId: null,
        darPlaylist: null,
        _allChars: chars,
    };
}

/** Load an existing storyline into a draft for editing. */
async function loadDraft(id) {
    const sl = await getStoryline(id);
    if (!sl) { editingId = null; draft = null; return; }
    // Deep-ish clone so edits stay local until Save.
    draft = {
        id: sl.id,
        title: sl.title || '',
        description: sl.description || '',
        coverImage: sl.coverImage || null,
        coverThumb: sl.coverThumb || null,
        heroImage: sl.heroImage || null,
        heroThumb: sl.heroThumb || null,
        character: { ...(sl.character || { name: '', avatar: '', displayName: '' }) },
        mainPersonas: (sl.mainPersonas || []).map(p => ({ ...p })),
        tags: {
            character: [...(sl.tags?.character || [])],
            persona: [...(sl.tags?.persona || [])],
            npc: (sl.tags?.npc || []).map(n => ({ ...n })),
            freeform: [...(sl.tags?.freeform || [])],
        },
        chats: (sl.chats || []).map(c => ({
            ...c,
            images: Array.isArray(c.images) ? c.images.map(img => ({ ...img })) : [],
            quotes: Array.isArray(c.quotes) ? c.quotes.map(q => ({ ...q })) : [],
        })),
        bookId: sl.bookId || null,
        darPlaylist: sl.darPlaylist || null,
        _allChars: getAllCharacters(),
    };
}

function exitEdit() {
    editingId = null;
    draft = null;
}

// ============================================================
// EDIT VIEW
// ============================================================

async function renderEditView(container, ctx) {
    // If we arrived via an existing id without a draft, hydrate it now.
    if (editingId && !draft) await loadDraft(editingId);
    if (!draft) { await renderListView(container, ctx); return; }

    const isNew = !draft.id;

    container.innerHTML = `
        <div class="sm-tab-header">
            <div>
                <button class="sm-btn sm-btn-ghost" id="sm-sl-back">
                    <i class="fa-solid fa-arrow-left"></i> Back
                </button>
                <span class="sm-tab-title">${isNew ? 'New Storyline' : 'Edit Storyline'}</span>
            </div>
            <div class="sm-tab-actions">
                ${!isNew ? `<button class="sm-btn sm-btn-ghost sm-btn-danger-text" id="sm-sl-delete">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>` : ''}
                <button class="sm-btn sm-btn-accent" id="sm-sl-save">
                    <i class="fa-solid fa-floppy-disk"></i> Save
                </button>
            </div>
        </div>

        <div class="sm-form">
            <div class="sm-field">
                <label class="sm-field-label">Title</label>
                <input type="text" class="sm-input" id="sm-sl-title"
                       value="${escapeAttr(draft.title)}" placeholder="Storyline title" />
            </div>

            <div class="sm-field">
                <label class="sm-field-label">Description
                    <button type="button" class="sm-gen-btn" id="sm-sl-desc-gen" title="Generate from chat summaries">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                    </button>
                </label>
                <textarea class="sm-textarea" id="sm-sl-desc"
                          placeholder="What is this storyline about?">${escapeHtml(draft.description)}</textarea>
                <div class="sm-gen-status" id="sm-sl-desc-status"></div>
            </div>

            <div class="sm-field">
                <label class="sm-field-label">Character</label>
                <select class="sm-select" id="sm-sl-char">
                    <option value="">— select character —</option>
                    ${draft._allChars.map(c => `
                        <option value="${escapeAttr(c.avatar)}" ${c.avatar === draft.character.avatar ? 'selected' : ''}>
                            ${escapeHtml(c.displayName)}
                        </option>`).join('')}
                </select>
            </div>

            <div class="sm-field">
                <label class="sm-field-label">Main Personas</label>
                <div id="sm-sl-personas"></div>
            </div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-tags"></i> Tags</div>
            <div id="sm-sl-tags"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-comments"></i> Chats</div>
            <div id="sm-sl-chats"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-clock-rotate-left"></i> Chronology</div>
            <div id="sm-sl-chrono"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-layer-group"></i> Chat Details</div>
            <div class="sm-field-hint">Assign gallery images and quotes to individual chats. These appear in the "See more" expander on the Display view.</div>
            <div id="sm-sl-chat-details"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-image"></i> Cover Image</div>
            <div id="sm-sl-cover"></div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-panorama"></i> Hero Image (optional)</div>
            <div class="sm-field-hint">Wide banner shown atop the storyline page in the Display. Falls back to the cover if unset.</div>
            <div id="sm-sl-hero"></div>
            ${isDarAvailable() ? `
            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-music"></i> Linked Playlist</div>
            <div class="sm-field-hint">Link a Dynamic Audio playlist — shown in the Display view with playback.</div>
            <div id="sm-sl-playlist"></div>
            ` : ''}
        </div>
    `;

    // Mount sub-components + wire form controls.
    mountPersonaPicker(container);
    mountTagPicker(container);
    mountCover(container);
    mountHero(container);
    mountPlaylistPicker(container);
    renderChronoSection(container);
    renderChatDetailsSection(container);
    await renderChatSection(container, ctx);
    wireEditControls(container, ctx);
}

// ============================================================
// Main Personas — searchable multi-add (chips for chosen only)
// ============================================================

const personaLabel = (p) => (p.title ? `${p.name} (${p.title})` : p.name);

function mountPersonaPicker(container) {
    const host = container.querySelector('#sm-sl-personas');
    if (host) renderPersonaPicker(host);
}

function renderPersonaPicker(host) {
    const all = getAllPersonas();
    const dlId = `sm-persona-dl-${Math.random().toString(36).slice(2, 8)}`;

    const chips = draft.mainPersonas.length
        ? draft.mainPersonas.map((p, i) => `
            <span class="sm-tag-pill sm-tag-persona" data-index="${i}">
                <span class="sm-tag-pill-text">${escapeHtml(p.displayName || personaLabel(p))}</span>
                <i class="fa-solid fa-xmark sm-persona-remove" title="Remove"></i>
            </span>`).join('')
        : `<span class="sm-tag-empty">none</span>`;

    host.innerHTML = `
        <div class="sm-persona-picker sm-tag-section sm-tag-persona">
            <div class="sm-tag-pills">${chips}</div>
            <div class="sm-tag-add">
                <input type="text" class="sm-input sm-persona-input" list="${dlId}"
                       placeholder="Add persona…" />
                <datalist id="${dlId}">
                    ${all.map(p => `<option value="${escapeHtml(personaLabel(p))}"></option>`).join('')}
                </datalist>
            </div>
        </div>
    `;

    // Remove a chosen persona.
    host.querySelectorAll('.sm-persona-remove').forEach(el => {
        el.addEventListener('click', () => {
            const pill = el.closest('[data-index]');
            const idx = parseInt(pill.dataset.index, 10);
            draft.mainPersonas.splice(idx, 1);
            renderPersonaPicker(host);
        });
    });

    // Add via Enter — only commits known personas (matched by label or name).
    const input = host.querySelector('.sm-persona-input');
    input?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = input.value.trim();
        if (!val) return;
        const needle = val.toLowerCase();
        const match = all.find(p => personaLabel(p).toLowerCase() === needle)
                   || all.find(p => p.name.toLowerCase() === needle);
        if (!match) { input.value = ''; return; }
        if (draft.mainPersonas.some(mp => mp.avatar === match.avatar)) { input.value = ''; return; }
        draft.mainPersonas.push({
            name: match.name,
            avatar: match.avatar,
            title: match.title || '',
            displayName: personaLabel(match),
        });
        renderPersonaPicker(host);
    });
}

// ============================================================
// Sub-component mounts (operate on the draft)
// ============================================================

function mountTagPicker(container) {
    const host = container.querySelector('#sm-sl-tags');
    if (host) renderTagPicker(host, draft.tags, (tags) => { draft.tags = tags; });
}

function mountCover(container) {
    const host = container.querySelector('#sm-sl-cover');
    if (host) renderImagePicker(
        host,
        { url: draft.coverImage, thumb: draft.coverThumb },
        (v) => { draft.coverImage = v.url; draft.coverThumb = v.thumb; },
    );
}

function mountHero(container) {
    const host = container.querySelector('#sm-sl-hero');
    if (host) renderImagePicker(
        host,
        { url: draft.heroImage, thumb: draft.heroThumb },
        (v) => { draft.heroImage = v.url; draft.heroThumb = v.thumb; },
    );
}

function mountPlaylistPicker(container) {
    const host = container.querySelector('#sm-sl-playlist');
    if (!host || !isDarAvailable()) return;
    renderPlaylistPicker(host);
}

function renderPlaylistPicker(host) {
    const names = getDarPlaylistNames();
    const current = draft.darPlaylist || '';

    host.innerHTML = `
        <div class="sm-field">
            <select class="sm-select" id="sm-sl-dar-playlist">
                <option value="">— none —</option>
                ${names.map(n => {
                    const meta = getDarPlaylistMeta(n);
                    const label = meta ? `${escapeHtml(n)} (${meta.type})` : escapeHtml(n);
                    return `<option value="${escapeAttr(n)}" ${n === current ? 'selected' : ''}>${label}</option>`;
                }).join('')}
            </select>
            <div id="sm-sl-dar-preview"></div>
        </div>
    `;

    updatePlaylistPreview(host, current);

    host.querySelector('#sm-sl-dar-playlist')?.addEventListener('change', (e) => {
        draft.darPlaylist = e.target.value || null;
        updatePlaylistPreview(host, draft.darPlaylist);
    });
}

function updatePlaylistPreview(host, name) {
    const preview = host.querySelector('#sm-sl-dar-preview');
    if (!preview) return;
    if (!name) { preview.innerHTML = ''; return; }

    const meta = getDarPlaylistMeta(name);
    const url = meta?.coverThumb || meta?.coverImage;
    preview.innerHTML = url
        ? `<div class="sm-dar-preview"><img src="${escapeAttr(url)}" alt="" /></div>`
        : `<div class="sm-dar-preview sm-dar-preview-empty"><i class="fa-solid fa-music"></i></div>`;
}

function renderChronoSection(container) {
    const host = container.querySelector('#sm-sl-chrono');
    if (!host) return;
    renderChronology(
        host,
        draft.chats,
        (orderedFileNames) => {
            // Rewrite chronoOrder to match the new visual order, then re-render.
            orderedFileNames.forEach((fn, i) => {
                const chat = draft.chats.find(c => c.file_name === fn);
                if (chat) chat.chronoOrder = i;
            });
            renderChronoSection(container);
        },
        (fileName, label) => {
            const chat = draft.chats.find(c => c.file_name === fileName);
            if (chat) chat.chronoLabel = label || null;
        },
        (fileName, value) => {
            const chat = draft.chats.find(c => c.file_name === fileName);
            if (chat) { chat.image = value.url; chat.imageThumb = value.thumb; }
        },
        {
            onBlurbChange: (fileName, blurb) => {
                const chat = draft.chats.find(c => c.file_name === fileName);
                if (chat) chat.blurb = blurb;
            },
            onBlurbGenerate: async (fileName, statusEl, inputEl, btn) => {
                const chat = draft.chats.find(c => c.file_name === fileName);
                if (!chat) return;

                const setStatus = (msg, kind = '') => {
                    if (!statusEl) return;
                    statusEl.textContent = msg || '';
                    statusEl.className = 'sm-gen-status sm-chrono-blurb-status'
                        + (kind ? ` sm-gen-${kind}` : '');
                };

                btn.disabled = true;
                setStatus('Generating…', 'busy');
                try {
                    const result = await generateChatBlurb(draft, chat);
                    if (result.ok) {
                        if (inputEl) inputEl.value = result.text;
                        chat.blurb = result.text;
                        setStatus('Generated — review and edit as needed.', 'ok');
                    } else {
                        setStatus(result.reason || 'Generation unavailable.', 'err');
                    }
                } catch (e) {
                    logError('chat blurb gen failed:', e);
                    setStatus('Generation failed — see console.', 'err');
                } finally {
                    btn.disabled = false;
                }
            },
        },
    );
}

// ============================================================
// Chat Details — per-chat images + quotes editor
// ============================================================

function renderChatDetailsSection(container) {
    const host = container.querySelector('#sm-sl-chat-details');
    if (!host) return;

    if (!draft.chats.length) {
        host.innerHTML = `<div class="sm-empty">Add chats above first, then configure their gallery images and quotes here.</div>`;
        return;
    }

    const sorted = [...draft.chats].sort((a, b) => (a.chronoOrder || 0) - (b.chronoOrder || 0));

    host.innerHTML = sorted.map(c => {
        const imgCount = (c.images || []).length;
        const quoteCount = (c.quotes || []).filter(q => q.source === 'manual').length;
        const badge = (imgCount || quoteCount)
            ? `<span class="sm-cd-badge">${imgCount ? `${imgCount} img` : ''}${imgCount && quoteCount ? ', ' : ''}${quoteCount ? `${quoteCount} quote${quoteCount > 1 ? 's' : ''}` : ''}</span>`
            : '';
        return `
            <div class="sm-cd-row" data-file="${escapeAttr(c.file_name)}">
                <div class="sm-cd-header">
                    <i class="fa-solid fa-chevron-right sm-cd-arrow"></i>
                    <span class="sm-cd-chat-name">${escapeHtml(prettyName(c.file_name))}</span>
                    ${badge}
                </div>
                <div class="sm-cd-body" hidden></div>
            </div>`;
    }).join('');

    // Wire each row's toggle.
    host.querySelectorAll('.sm-cd-row').forEach(row => {
        const fn = row.dataset.file;
        const chat = draft.chats.find(c => c.file_name === fn);
        if (!chat) return;

        const header = row.querySelector('.sm-cd-header');
        const body = row.querySelector('.sm-cd-body');
        const arrow = row.querySelector('.sm-cd-arrow');
        let populated = false;

        header?.addEventListener('click', () => {
            const open = !body.hidden;
            body.hidden = open;
            arrow.classList.toggle('sm-cd-arrow-open', !open);
            if (!open && !populated) {
                renderChatDetailBody(body, chat, container);
                populated = true;
            }
        });
    });
}

/**
 * Render the editable body for a single chat's images + quotes.
 */
function renderChatDetailBody(body, chat, container) {
    if (!chat.images) chat.images = [];
    if (!chat.quotes) chat.quotes = [];

    const manualQuotes = chat.quotes.filter(q => q.source === 'manual');

    body.innerHTML = `
        <div class="sm-cd-section">
            <div class="sm-cd-section-label">Gallery Images</div>
            <div class="sm-cd-images-list"></div>
            <label class="sm-btn sm-btn-ghost sm-cd-add-img-btn">
                <i class="fa-solid fa-plus"></i> Add Image
                <input type="file" accept="image/*" hidden multiple />
            </label>
        </div>
        <div class="sm-cd-section">
            <div class="sm-cd-section-label">Manual Quotes</div>
            <div class="sm-cd-quotes-list"></div>
            <button class="sm-btn sm-btn-ghost sm-cd-add-quote-btn">
                <i class="fa-solid fa-plus"></i> Add Quote
            </button>
            <button class="sm-btn sm-btn-ghost sm-cd-pull-quotes-btn" title="Pull quotes from SimpleSummarizer comprehensive summary">
                <i class="fa-solid fa-download"></i> Pull from Summary
            </button>
        </div>
    `;

    // Render existing images list.
    renderImagesList(body.querySelector('.sm-cd-images-list'), chat, container);

    // Render existing manual quotes.
    renderQuotesList(body.querySelector('.sm-cd-quotes-list'), chat, container);

    // Wire add-image upload.
    const fileInput = body.querySelector('.sm-cd-add-img-btn input');
    fileInput?.addEventListener('change', async () => {
        const files = fileInput.files;
        if (!files?.length) return;
        for (const file of files) {
            try {
                const result = await uploadChatImage(file);
                chat.images.push(result);
            } catch (e) {
                logError('chat image upload failed:', e);
            }
        }
        renderImagesList(body.querySelector('.sm-cd-images-list'), chat, container);
        renderChatDetailsSection(container); // refresh badges
    });

    // Wire add-quote.
    body.querySelector('.sm-cd-add-quote-btn')?.addEventListener('click', () => {
        chat.quotes.push({ text: '', speaker: '', context: '', source: 'manual' });
        renderQuotesList(body.querySelector('.sm-cd-quotes-list'), chat, container);
    });

    // Wire pull-from-summary.
    const pullBtn = body.querySelector('.sm-cd-pull-quotes-btn');
    pullBtn?.addEventListener('click', async () => {
        pullBtn.disabled = true;
        pullBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pulling…';
        try {
            const available = await isSummarizerAvailable();
            if (!available) {
                alert('SimpleSummarizer archive not found. Is SimpleSummarizer installed with comprehensive summaries generated?');
                return;
            }
            const pulled = await getQuotesForChat(chat.file_name);
            if (!pulled.length) {
                alert('No quotes found in the comprehensive summary for this chat.');
                return;
            }
            // Add as manual quotes (so they persist), avoiding duplicates.
            const existingTexts = new Set(chat.quotes.map(q => q.text.trim().toLowerCase()));
            let added = 0;
            for (const q of pulled) {
                if (!existingTexts.has(q.text.trim().toLowerCase())) {
                    chat.quotes.push({ ...q, source: 'manual' });
                    existingTexts.add(q.text.trim().toLowerCase());
                    added++;
                }
            }
            if (added) {
                renderQuotesList(body.querySelector('.sm-cd-quotes-list'), chat, container);
                renderChatDetailsSection(container);
            }
            alert(`Pulled ${added} new quote${added === 1 ? '' : 's'}. ${pulled.length - added} duplicate${pulled.length - added === 1 ? '' : 's'} skipped.`);
        } catch (e) {
            logError('quote pull failed:', e);
            alert('Failed to pull quotes — see console.');
        } finally {
            pullBtn.disabled = false;
            pullBtn.innerHTML = '<i class="fa-solid fa-download"></i> Pull from Summary';
        }
    });
}

/**
 * Render the list of gallery images for a chat (simple path list with remove).
 */
function renderImagesList(host, chat, container) {
    if (!host) return;
    if (!chat.images.length) {
        host.innerHTML = `<div class="sm-cd-empty">No images assigned.</div>`;
        return;
    }

    host.innerHTML = chat.images.map((img, i) => {
        const name = img.src?.split('/').pop() || 'image';
        return `
            <div class="sm-cd-image-item" data-idx="${i}">
                <img src="${escapeAttr(img.thumb || img.src)}" class="sm-cd-image-mini" alt="" />
                <span class="sm-cd-image-name" title="${escapeAttr(img.src)}">${escapeHtml(name)}</span>
                <input type="text" class="sm-input sm-cd-image-caption" placeholder="Caption (optional)"
                       value="${escapeAttr(img.caption || '')}" />
                <button class="sm-btn-icon sm-cd-remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
    }).join('');

    // Wire remove + caption.
    host.querySelectorAll('.sm-cd-image-item').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        el.querySelector('.sm-cd-remove')?.addEventListener('click', () => {
            chat.images.splice(idx, 1);
            renderImagesList(host, chat, container);
            renderChatDetailsSection(container);
        });
        el.querySelector('.sm-cd-image-caption')?.addEventListener('input', (e) => {
            chat.images[idx].caption = e.target.value;
        });
    });
}

/**
 * Render manual quotes for a chat (editable text inputs).
 */
function renderQuotesList(host, chat, container) {
    if (!host) return;
    const manual = chat.quotes.filter(q => q.source === 'manual');
    if (!manual.length) {
        host.innerHTML = `<div class="sm-cd-empty">No manual quotes.</div>`;
        return;
    }

    host.innerHTML = manual.map((q, i) => {
        // Find the real index in chat.quotes for this manual quote.
        const realIdx = chat.quotes.indexOf(q);
        return `
            <div class="sm-cd-quote-item" data-idx="${realIdx}">
                <textarea class="sm-textarea sm-cd-quote-text" placeholder="Quote text">${escapeHtml(q.text)}</textarea>
                <input type="text" class="sm-input sm-cd-quote-speaker" placeholder="Speaker"
                       value="${escapeAttr(q.speaker || '')}" />
                <button class="sm-btn-icon sm-cd-remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
    }).join('');

    host.querySelectorAll('.sm-cd-quote-item').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        el.querySelector('.sm-cd-remove')?.addEventListener('click', () => {
            chat.quotes.splice(idx, 1);
            renderQuotesList(host, chat, container);
            renderChatDetailsSection(container);
        });
        el.querySelector('.sm-cd-quote-text')?.addEventListener('input', (e) => {
            chat.quotes[idx].text = e.target.value;
        });
        el.querySelector('.sm-cd-quote-speaker')?.addEventListener('input', (e) => {
            chat.quotes[idx].speaker = e.target.value;
        });
    });
}

/**
 * Upload a single image for a chat gallery.
 *
 * Delegates to imagePicker's shared uploadImage so chat-gallery images get the
 * same stepped-downscale JPEG thumbnail as covers/heroes (previously this used a
 * stripped copy that skipped thumbnailing, leaving every gallery tile to load the
 * full-size image). Maps imagePicker's { url, thumb } onto the chat-image shape
 * { src, thumb, caption } that the gallery list + Display expect.
 */
async function uploadChatImage(file) {
    const { url, thumb } = await uploadImage(file);
    return { src: url, thumb, caption: '' };
}

/**
 * Derive the character/persona tag lists from the structured identity fields.
 * These tags are no longer hand-editable (the tagPicker only handles NPCs +
 * freeform now), so we rebuild them on every save — this keeps them in sync and
 * avoids stale entries when the primary character or a main persona is removed.
 * NPC and freeform tags are left exactly as the user set them.
 */
function syncAutoTags() {
    draft.tags.character = draft.character?.name ? [draft.character.name] : [];
    draft.tags.persona = draft.mainPersonas.map(p => p.name).filter(Boolean);
}

// ============================================================
// Chat assignment section
// ============================================================

async function renderChatSection(container, ctx) {
    const host = container.querySelector('#sm-sl-chats');
    if (!host) return;

    const avatar = draft.character?.avatar;
    if (!avatar) {
        host.innerHTML = `<div class="sm-empty">Select a character above to list its chats.</div>`;
        return;
    }

    host.innerHTML = `<div class="sm-empty">Loading chats…</div>`;
    const chatFiles = await getChatsForCharacter(avatar, { simple: true });

    if (!chatFiles.length) {
        host.innerHTML = `<div class="sm-empty">No chat files found for this character.</div>`;
        return;
    }

    // Ownership map: which chats already belong to OTHER storylines (live store).
    const allStorylines = Object.values(await getStorylines());
    const ownerOf = (fn) => allStorylines.find(sl =>
        sl.id !== draft.id && (sl.chats || []).some(c => c.file_name === fn));

    const inDraft = (fn) => draft.chats.some(c => c.file_name === fn);

    host.innerHTML = `
        <div class="sm-chat-assign-list">
            ${chatFiles.map(cf => {
                const fn = cf.file_name;
                const owner = ownerOf(fn);
                const checked = inDraft(fn);
                return `
                    <label class="sm-chat-assign-row ${owner ? 'sm-chat-owned' : ''}">
                        <input type="checkbox" class="sm-chat-assign-cb"
                               data-file="${escapeAttr(fn)}"
                               data-owner-id="${owner ? escapeAttr(owner.id) : ''}"
                               data-owner-title="${owner ? escapeAttr(owner.title) : ''}"
                               ${checked ? 'checked' : ''} />
                        <span class="sm-chat-assign-name" title="${escapeAttr(fn)}">
                            ${escapeHtml(prettyName(fn))}
                        </span>
                        ${owner ? `<span class="sm-chat-owner-badge" title="Owned by another storyline">
                            <i class="fa-solid fa-link"></i> ${escapeHtml(owner.title)}
                        </span>` : ''}
                    </label>
                `;
            }).join('')}
        </div>
    `;

    wireChatSection(host, container, chatFiles);
}

function wireChatSection(host, container, chatFiles) {
    host.querySelectorAll('.sm-chat-assign-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const fn = cb.dataset.file;
            const meta = chatFiles.find(c => c.file_name === fn) || {};

            if (cb.checked) {
                // Warn if this chat belongs to another storyline (move-on-save).
                if (cb.dataset.ownerId && getSettingWarn()) {
                    const ok = confirm(
                        `"${prettyName(fn)}" is already in "${cb.dataset.ownerTitle}".\n\n` +
                        `Move it to this storyline on save?`);
                    if (!ok) { cb.checked = false; return; }
                }
                if (!draft.chats.some(c => c.file_name === fn)) {
                    const maxOrder = draft.chats.reduce((m, c) => Math.max(m, c.chronoOrder || 0), -1);
                    draft.chats.push({
                        file_name: fn,
                        character: draft.character.name,
                        avatar: draft.character.avatar,
                        image: null, blurb: '',
                        chronoOrder: maxOrder + 1,
                        chronoLabel: null, hasSummary: false,
                        images: [], quotes: [],
                    });
                }
            } else {
                draft.chats = draft.chats.filter(c => c.file_name !== fn);
            }
            // Chat list changed — invalidate the cached gen availability.
            draft._genAvailCache = null;
            // Chronology + Chat Details depend on draft.chats — refresh both.
            renderChronoSection(container);
            renderChatDetailsSection(container);
        });
    });
}

// ============================================================
// Edit-control wiring
// ============================================================

function wireEditControls(container, ctx) {
    container.querySelector('#sm-sl-back')?.addEventListener('click', () => {
        exitEdit();
        render(container, ctx);
    });

    container.querySelector('#sm-sl-title')?.addEventListener('input', (e) => {
        draft.title = e.target.value;
    });

    container.querySelector('#sm-sl-desc')?.addEventListener('input', (e) => {
        draft.description = e.target.value;
    });

    wireDescGen(container);

    // Character select — updates identity; re-renders so the chat list reflects it.
    container.querySelector('#sm-sl-char')?.addEventListener('change', async (e) => {
        const avatar = e.target.value;
        const match = draft._allChars.find(c => c.avatar === avatar);
        draft.character = match
            ? { name: match.name, avatar: match.avatar, displayName: match.displayName }
            : { name: '', avatar: '', displayName: '' };
        await renderChatSection(container, ctx);
    });

    container.querySelector('#sm-sl-save')?.addEventListener('click', () => saveDraft(container, ctx));
    container.querySelector('#sm-sl-delete')?.addEventListener('click', () => deleteDraft(container, ctx));
}

// ============================================================
// Description generation
// ============================================================

async function wireDescGen(container) {
    const btn = container.querySelector('#sm-sl-desc-gen');
    const status = container.querySelector('#sm-sl-desc-status');
    const textarea = container.querySelector('#sm-sl-desc');
    if (!btn || !textarea) return;

    const setStatus = (msg, kind = '') => {
        if (!status) return;
        status.textContent = msg || '';
        status.className = 'sm-gen-status' + (kind ? ` sm-gen-${kind}` : '');
    };

    // Cache the availability check on the draft so re-renders of the edit
    // view (e.g. after changing a title) don't re-run expensive network
    // calls for every chat. Invalidated when draft.chats changes (see
    // wireChatSection where _genAvailCache is cleared).
    if (!draft._genAvailCache) {
        draft._genAvailCache = await canGenerateStoryline(draft);
    }
    const avail = draft._genAvailCache;
    if (!avail.available) {
        btn.disabled = true;
        btn.title = (draft.chats || []).length
            ? 'No chat summaries or readable messages to generate from'
            : 'Add chats to this storyline first';
    } else {
        btn.disabled = false;
        btn.title = avail.source === 'summary'
            ? 'Generate from comprehensive chat summaries'
            : 'Generate from sampled chat messages (no summaries found)';
    }

    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        setStatus('Generating…', 'busy');
        try {
            const result = await generateStorylineDescription(draft);
            if (result.ok) {
                textarea.value = result.text;
                draft.description = result.text;
                draft.descriptionGenerated = true;
                const note = result.source === 'messages'
                    ? 'Generated from sampled messages (no summaries found). Review and edit.'
                    : result.source === 'mixed'
                        ? 'Generated from summaries + message samples. Review and edit.'
                        : 'Generated from chat summaries. Review and edit.';
                setStatus(note, 'ok');
            } else {
                setStatus(result.reason || 'Generation unavailable.', 'err');
            }
        } catch (e) {
            logError('storyline desc gen failed:', e);
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
        alert('Please give the storyline a title.');
        return;
    }
    syncAutoTags();

    // The metadata payload (everything except chats, which go through the
    // ownership-aware assignment path so the ≤1-owner rule is enforced).
    const payload = {
        title: draft.title.trim(),
        description: draft.description,
        coverImage: draft.coverImage,
        coverThumb: draft.coverThumb,
        heroImage: draft.heroImage,
        heroThumb: draft.heroThumb,
        character: draft.character,
        mainPersonas: draft.mainPersonas,
        tags: draft.tags,
        bookId: draft.bookId,
        darPlaylist: draft.darPlaylist,
    };

    let storylineId = draft.id;
    if (storylineId) {
        await updateStoryline(storylineId, payload);
    } else {
        // Create empty-of-chats first; chats are assigned below.
        const created = await createStoryline({ ...payload, chats: [] });
        storylineId = created.id;
    }

    // Reconcile chats. Remove any that were unchecked, then assign the draft set
    // (move=true because the inline confirm already got user consent on conflicts).
    const current = (await getStoryline(storylineId))?.chats || [];
    const draftFiles = new Set(draft.chats.map(c => c.file_name));
    for (const c of current) {
        if (!draftFiles.has(c.file_name)) await removeChatFromStoryline(c.file_name);
    }
    for (const c of draft.chats) {
        await assignChatToStoryline(c.file_name, storylineId, {
            character: c.character,
            avatar: c.avatar,
            image: c.image,
            imageThumb: c.imageThumb,
            blurb: c.blurb,
            chronoOrder: c.chronoOrder,
            chronoLabel: c.chronoLabel,
            hasSummary: c.hasSummary,
            images: c.images || [],
            quotes: (c.quotes || []).filter(q => q.source === 'manual'),
        }, true);
    }

    exitEdit();
    render(container, ctx);
}

async function deleteDraft(container, ctx) {
    if (!draft?.id) return;
    if (!confirm(`Delete storyline "${draft.title}"? Chats become unowned; this can't be undone.`)) return;
    await deleteStoryline(draft.id);
    exitEdit();
    render(container, ctx);
}

// ============================================================
// Util
// ============================================================

function getSettingWarn() {
    return getSetting('warnOnChatMove') !== false;
}

function prettyName(fileName) {
    return String(fileName).replace(/\.jsonl$/i, '');
}

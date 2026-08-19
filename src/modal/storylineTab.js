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
    getAllGroups, getChatsForGroup,
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
        card.querySelector('.sm-card-ebook')?.addEventListener('click', async (event) => {
            event.stopPropagation();
            try {
                const editor = await import('../ebook/editor/index.js');
                const opened = await editor.openEbookEditor(id, { returnTarget: { type: 'management' } });
                if (opened) ctx.close?.();
            } catch (error) {
                logError('Failed to open ebook editor:', error);
            }
        });
        card.querySelector('.sm-card-edit')?.addEventListener('click', () => {
            editingId = id;
            draft = null;
            render(container, ctx);
        });
        card.querySelector('.sm-card-delete')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const sl = await getStoryline(id);
            const ebookWarning = sl?.ebook?.file ? ' Its ebook will also be permanently deleted.' : '';
            if (confirm(`Delete storyline "${sl?.title || id}"? Chats become unowned.${ebookWarning} This can't be undone.`)) {
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
                    ${escapeHtml(primaryLabel(sl))} · ${chatCount} chat${chatCount === 1 ? '' : 's'}
                </div>
            </div>
            <div class="sm-card-actions">
                <button class="sm-btn-icon sm-card-ebook" title="${sl.ebook?.file ? 'Edit ebook' : 'Create ebook'}" aria-label="${sl.ebook?.file ? 'Edit ebook' : 'Create ebook'}">
                    <i class="fa-solid ${sl.ebook?.file ? 'fa-book-open-reader' : 'fa-book-medical'}"></i>
                </button>
                <button class="sm-btn-icon sm-card-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="sm-btn-icon sm-card-delete sm-btn-danger-text" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `;
}

// ============================================================
// DRAFT lifecycle
// ============================================================

/** Stable dedupe key for a cast participant (character avatar or group id). */
function partKey(p) {
    return (p?.type === 'group') ? `g:${p.groupId}` : `c:${p?.avatar}`;
}

/** Short label for a storyline's primary anchor (group name or character). */
function primaryLabel(sl) {
    if (sl?.primary?.type === 'group') return sl.primary.name || 'Group';
    const chars = (sl?.participants || []).filter(p => (p.type ?? 'character') === 'character');
    const base = sl?.primary?.displayName || sl?.character?.displayName || sl?.character?.name || '';
    if (base && chars.length > 1) return `${base} +${chars.length - 1}`;
    return base || '—';
}

/**
 * Rebuild the editor's "additional cast" list from a stored storyline: every
 * participant (character OR group) except the primary, which is shown
 * separately. Tolerant of un-migrated data.
 */
function reconstructCast(sl) {
    const primary = sl?.primary
        || (sl?.character?.avatar ? { type: 'character', avatar: sl.character.avatar } : null);
    const seen = new Set(primary ? [partKey(primary)] : []);
    const out = [];
    for (const p of (sl?.participants || [])) {
        const type = p.type ?? 'character';
        const key = partKey({ ...p, type });
        if (seen.has(key)) continue;
        if (type === 'group') {
            if (!p.groupId) continue;
            seen.add(key);
            out.push({ type: 'group', groupId: p.groupId, name: p.name || '' });
        } else {
            if (!p.avatar) continue;
            seen.add(key);
            out.push({ type: 'character', name: p.name || '', avatar: p.avatar, displayName: p.displayName || p.name || '' });
        }
    }
    return out;
}

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
        // Authoritative primary anchor. Null → derive a character primary from
        // `character` on save. A group primary (from the sidebar) is kept here.
        primary: null,
        // Additional cast beyond the primary. Entries are {type:'character',...}
        // or {type:'group', groupId, name}.
        cast: [],
        mainPersonas: [],
        tags: { character: [], persona: [], npc: [], freeform: [] },
        chats: [],
        bookId: null,
        darPlaylist: null,
        _allChars: chars,
        _allGroups: getAllGroups(),
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
        primary: sl.primary ? { ...sl.primary } : null,
        cast: reconstructCast(sl),
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
        _allGroups: getAllGroups(),
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
                <label class="sm-field-label">${draft.primary?.type === 'group' ? 'Primary (Group)' : 'Primary Character'}</label>
                ${draft.primary?.type === 'group' ? `
                    <div class="sm-primary-group">
                        <i class="fa-solid fa-users"></i> ${escapeHtml(draft.primary.name || 'Group')}
                    </div>
                    <div class="sm-field-hint">This storyline is anchored to a group. Its group chats are listed below; you can also add characters as additional cast.</div>
                ` : `
                    <select class="sm-select" id="sm-sl-char">
                        <option value="">— select character —</option>
                        ${draft._allChars.map(c => `
                            <option value="${escapeAttr(c.avatar)}" ${c.avatar === draft.character.avatar ? 'selected' : ''}>
                                ${escapeHtml(c.displayName)}
                            </option>`).join('')}
                    </select>
                    <div class="sm-field-hint">The cover/title anchor. Add more characters or groups below for a multi-character storyline.</div>
                `}
            </div>

            <div class="sm-field">
                <label class="sm-field-label">Additional Cast</label>
                <div id="sm-sl-cast"></div>
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
    mountCastPicker(container, ctx);
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
// Additional Cast — searchable multi-add (characters beyond the primary)
// ============================================================

function mountCastPicker(container, ctx) {
    const host = container.querySelector('#sm-sl-cast');
    if (host) renderCastPicker(host, container, ctx);
}

const GROUP_SUFFIX = ' (group)';

function renderCastPicker(host, container, ctx) {
    const allChars = draft._allChars || getAllCharacters();
    const allGroups = draft._allGroups || getAllGroups();
    const dlId = `sm-cast-dl-${Math.random().toString(36).slice(2, 8)}`;

    // Exclusions: the primary + everything already in the cast.
    const exclAvatars = new Set([
        draft.primary?.type === 'character' ? draft.primary.avatar : draft.character?.avatar,
        ...draft.cast.filter(c => c.type === 'character').map(c => c.avatar),
    ].filter(Boolean));
    const exclGroups = new Set([
        draft.primary?.type === 'group' ? draft.primary.groupId : null,
        ...draft.cast.filter(c => c.type === 'group').map(c => c.groupId),
    ].filter(Boolean));

    const selChars = allChars.filter(c => !exclAvatars.has(c.avatar));
    const selGroups = allGroups.filter(g => !exclGroups.has(g.groupId));

    const chips = draft.cast.length
        ? draft.cast.map((c, i) => {
            const isGroup = c.type === 'group';
            const label = isGroup ? c.name : (c.displayName || c.name);
            return `
                <span class="sm-tag-pill ${isGroup ? 'sm-tag-freeform' : 'sm-tag-character'}" data-index="${i}">
                    ${isGroup ? '<i class="fa-solid fa-users sm-cast-type-icon"></i> ' : ''}<span class="sm-tag-pill-text">${escapeHtml(label)}</span>
                    <i class="fa-solid fa-xmark sm-cast-remove" title="Remove"></i>
                </span>`;
        }).join('')
        : `<span class="sm-tag-empty">none</span>`;

    host.innerHTML = `
        <div class="sm-cast-picker sm-tag-section sm-tag-character">
            <div class="sm-tag-pills">${chips}</div>
            <div class="sm-tag-add">
                <input type="text" class="sm-input sm-cast-input" list="${dlId}"
                       placeholder="Add character or group…" />
                <datalist id="${dlId}">
                    ${selChars.map(c => `<option value="${escapeAttr(c.displayName)}"></option>`).join('')}
                    ${selGroups.map(g => `<option value="${escapeAttr(g.name + GROUP_SUFFIX)}"></option>`).join('')}
                </datalist>
            </div>
        </div>
    `;

    // Remove a cast member → refresh picker + chat list (available chats shrink).
    host.querySelectorAll('.sm-cast-remove').forEach(el => {
        el.addEventListener('click', async () => {
            const pill = el.closest('[data-index]');
            const idx = parseInt(pill.dataset.index, 10);
            draft.cast.splice(idx, 1);
            renderCastPicker(host, container, ctx);
            await renderChatSection(container, ctx);
        });
    });

    // Add via Enter — matches a character (by displayName/name) or, if the value
    // carries the group suffix (or matches a group name), a group.
    const input = host.querySelector('.sm-cast-input');
    input?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const raw = input.value.trim();
        if (!raw) return;
        const isGroupPick = raw.toLowerCase().endsWith(GROUP_SUFFIX);
        const val = isGroupPick ? raw.slice(0, -GROUP_SUFFIX.length).trim() : raw;
        const needle = val.toLowerCase();

        if (!isGroupPick) {
            const match = allChars.find(c => (c.displayName || '').toLowerCase() === needle)
                       || allChars.find(c => (c.name || '').toLowerCase() === needle);
            if (match) {
                input.value = '';
                if (exclAvatars.has(match.avatar)) return;
                draft.cast.push({ type: 'character', name: match.name, avatar: match.avatar, displayName: match.displayName || match.name });
                renderCastPicker(host, container, ctx);
                await renderChatSection(container, ctx);
                return;
            }
        }
        const gmatch = allGroups.find(g => (g.name || '').toLowerCase() === needle);
        if (gmatch) {
            input.value = '';
            if (exclGroups.has(gmatch.groupId)) return;
            draft.cast.push({ type: 'group', groupId: gmatch.groupId, name: gmatch.name });
            renderCastPicker(host, container, ctx);
            await renderChatSection(container, ctx);
            return;
        }
        input.value = '';
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
 * Update ONLY the collapsed-row badge ("3 img, 2 quotes") for a single chat,
 * in place. Used after edits inside an open row so the counts stay live WITHOUT
 * rebuilding the whole section (which would collapse every open row and reset
 * their populated flags — the cause of the "folds back up mid-edit" bug).
 */
function updateChatRowBadge(container, chat) {
    const host = container.querySelector('#sm-sl-chat-details');
    const row = host?.querySelector(`.sm-cd-row[data-file="${cssAttrEscape(chat.file_name)}"]`);
    if (!row) return;

    const header = row.querySelector('.sm-cd-header');
    if (!header) return;

    const imgCount = (chat.images || []).length;
    const quoteCount = (chat.quotes || []).filter(q => q.source === 'manual').length;

    let badge = header.querySelector('.sm-cd-badge');
    if (!imgCount && !quoteCount) {
        badge?.remove();
        return;
    }
    const text = `${imgCount ? `${imgCount} img` : ''}${imgCount && quoteCount ? ', ' : ''}${quoteCount ? `${quoteCount} quote${quoteCount > 1 ? 's' : ''}` : ''}`;
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sm-cd-badge';
        header.appendChild(badge);
    }
    badge.textContent = text;
}

/** Escape a string for use inside a CSS attribute selector [x="..."]. */
function cssAttrEscape(s) {
    return String(s ?? '').replace(/["\\]/g, '\\$&');
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
        updateChatRowBadge(container, chat); // refresh badge in place
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
                updateChatRowBadge(container, chat);
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
 * Render the list of gallery images for a chat.
 *
 * Each row is drag-reorderable (native HTML5 DnD, same pattern as chronology.js)
 * and carries a cover "star" toggle. Starring sets isCover=true on that image and
 * clears it on every other — one cover max. The star is independent of visual
 * order: reordering never changes the cover, and starring never reorders. If no
 * image is starred, coverImage() falls back to images[0] (see display/util.js).
 */
function renderImagesList(host, chat, container) {
    if (!host) return;
    if (!chat.images.length) {
        host.innerHTML = `<div class="sm-cd-empty">No images assigned.</div>`;
        return;
    }

    host.innerHTML = chat.images.map((img, i) => {
        const name = img.src?.split('/').pop() || 'image';
        const isCover = !!img.isCover;
        return `
            <div class="sm-cd-image-item${isCover ? ' sm-cd-image-cover' : ''}" data-idx="${i}" draggable="true">
                <i class="fa-solid fa-grip-vertical sm-cd-image-handle" title="Drag to reorder"></i>
                <button class="sm-btn-icon sm-cd-star${isCover ? ' is-cover' : ''}"
                        title="${isCover ? 'Cover image' : 'Set as cover'}">
                    <i class="fa-${isCover ? 'solid' : 'regular'} fa-star"></i>
                </button>
                <img src="${escapeAttr(img.thumb || img.src)}" class="sm-cd-image-mini" alt="" />
                <span class="sm-cd-image-name" title="${escapeAttr(img.src)}">${escapeHtml(name)}</span>
                <input type="text" class="sm-input sm-cd-image-caption" placeholder="Caption (optional)"
                       value="${escapeAttr(img.caption || '')}" />
                <button class="sm-btn-icon sm-cd-remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
    }).join('');

    // Wire remove + caption + cover star.
    host.querySelectorAll('.sm-cd-image-item').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        el.querySelector('.sm-cd-remove')?.addEventListener('click', () => {
            chat.images.splice(idx, 1);
            renderImagesList(host, chat, container);
            updateChatRowBadge(container, chat);
        });
        el.querySelector('.sm-cd-image-caption')?.addEventListener('input', (e) => {
            chat.images[idx].caption = e.target.value;
        });
        el.querySelector('.sm-cd-star')?.addEventListener('click', () => {
            // One cover max, and no toggle-off: clicking any star clears every
            // other image's flag and sets this one. Clicking the already-active
            // star is a harmless no-op re-affirm. There's always a deliberate
            // cover once chosen; unstarred state only exists before the first pick.
            chat.images.forEach(im => { delete im.isCover; });
            chat.images[idx].isCover = true;
            renderImagesList(host, chat, container);
            // Cover choice doesn't change the badge counts and the modal row has
            // no thumbnail, so no section-level refresh is needed here. (The
            // Display reads the cover via coverImage() on its own next render.)
        });
    });

    wireImageReorder(host, chat, container);
}

/**
 * Native HTML5 drag-drop reordering for the gallery image list. Mirrors the
 * chronology.js pattern: dragstart tags the source index, drop splices the
 * source into the target position and re-renders. Reordering mutates
 * chat.images[] order only — it never touches the isCover flag.
 */
function wireImageReorder(host, chat, container) {
    let dragIdx = null;

    host.querySelectorAll('.sm-cd-image-item').forEach(el => {
        el.addEventListener('dragstart', (e) => {
            dragIdx = parseInt(el.dataset.idx, 10);
            el.classList.add('sm-cd-image-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('sm-cd-image-dragging');
            host.querySelectorAll('.sm-cd-image-item').forEach(r =>
                r.classList.remove('sm-cd-image-over'));
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('sm-cd-image-over');
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('sm-cd-image-over');
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('sm-cd-image-over');
            const targetIdx = parseInt(el.dataset.idx, 10);
            if (dragIdx == null || dragIdx === targetIdx) return;
            chat.images.splice(targetIdx, 0, chat.images.splice(dragIdx, 1)[0]);
            dragIdx = null;
            renderImagesList(host, chat, container);
            // Reorder changes neither counts nor cover, so no section refresh.
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
            updateChatRowBadge(container, chat);
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
    // Character tags cover the character cast (primary + additional), deduped.
    // Group members are not character tags.
    const names = [];
    if (draft.character?.name) names.push(draft.character.name);
    for (const c of draft.cast) {
        if (c.type === 'group') continue;
        if (c.name && !names.includes(c.name)) names.push(c.name);
    }
    draft.tags.character = names;
    draft.tags.persona = draft.mainPersonas.map(p => p.name).filter(Boolean);
}

/** Build the persisted cast (primary + additional participants) from the draft.
 *  Handles a group primary (from the sidebar) and mixed character/group cast. */
function buildCastPayload() {
    let primary;
    if (draft.primary?.type === 'group' && draft.primary.groupId) {
        primary = { type: 'group', groupId: draft.primary.groupId, name: draft.primary.name || '' };
    } else if (draft.character?.avatar) {
        primary = {
            type: 'character',
            name: draft.character.name,
            avatar: draft.character.avatar,
            displayName: draft.character.displayName || draft.character.name,
        };
    } else {
        primary = { type: 'character', avatar: '', name: '', displayName: '' };
    }

    const participants = [];
    const seen = new Set();
    const add = (p) => { const k = partKey(p); if (seen.has(k)) return; seen.add(k); participants.push(p); };
    const primaryHasId = primary.type === 'group' ? !!primary.groupId : !!primary.avatar;
    if (primaryHasId) add(primary);
    for (const c of draft.cast) {
        if (c.type === 'group') {
            if (c.groupId) add({ type: 'group', groupId: c.groupId, name: c.name || '' });
        } else if (c.avatar) {
            add({ type: 'character', name: c.name || '', avatar: c.avatar, displayName: c.displayName || c.name || '' });
        }
    }
    return { primary, participants };
}

// ============================================================
// Chat assignment section
// ============================================================

/** The cast to enumerate chats for, split by kind. Primary first within each. */
function castMembers() {
    const chars = [];
    const groups = [];
    const seenC = new Set();
    const seenG = new Set();
    if (draft.primary?.type === 'group') {
        if (draft.primary.groupId) { groups.push({ groupId: draft.primary.groupId, name: draft.primary.name || '' }); seenG.add(draft.primary.groupId); }
    } else if (draft.character?.avatar) {
        chars.push(draft.character); seenC.add(draft.character.avatar);
    }
    for (const c of draft.cast) {
        if (c.type === 'group') {
            if (c.groupId && !seenG.has(c.groupId)) { groups.push({ groupId: c.groupId, name: c.name || '' }); seenG.add(c.groupId); }
        } else if (c.avatar && !seenC.has(c.avatar)) {
            chars.push(c); seenC.add(c.avatar);
        }
    }
    return { chars, groups };
}

/** Composite membership check within the draft (file + source + owner). */
function chatInDraft(fn, ref) {
    const source = ref.source || 'character';
    return draft.chats.some(c => {
        if (c.file_name !== fn || (c.source || 'character') !== source) return false;
        return source === 'group'
            ? (c.groupId || '') === (ref.groupId || '')
            : (c.avatar || '') === (ref.avatar || '');
    });
}

/** Find another storyline that already owns this chat (composite match). */
function ownerForChat(allStorylines, fn, ref) {
    const source = ref.source || 'character';
    return allStorylines.find(sl => sl.id !== draft.id && (sl.chats || []).some(c => {
        if (c.file_name !== fn || (c.source || 'character') !== source) return false;
        return source === 'group'
            ? (!c.groupId || !ref.groupId || c.groupId === ref.groupId)
            : (!c.avatar || !ref.avatar || c.avatar === ref.avatar);
    }));
}

/** Render one cast member's block of assignable chat rows. */
function renderMemberBlock({ headerIcon, headerLabel, multi, files, allStorylines, refFor, emptyLabel }) {
    const header = multi
        ? `<div class="sm-chat-cast-header"><i class="fa-solid ${headerIcon}"></i> ${escapeHtml(headerLabel)}</div>`
        : '';
    const rows = files.length
        ? files.map(cf => {
            const fn = cf.file_name;
            const ref = refFor(fn);
            const owner = ownerForChat(allStorylines, fn, ref);
            const checked = chatInDraft(fn, ref);
            return `
                <label class="sm-chat-assign-row ${owner ? 'sm-chat-owned' : ''}">
                    <input type="checkbox" class="sm-chat-assign-cb"
                           data-file="${escapeAttr(fn)}"
                           data-source="${escapeAttr(ref.source)}"
                           data-avatar="${escapeAttr(ref.avatar || '')}"
                           data-groupid="${escapeAttr(ref.groupId || '')}"
                           data-name="${escapeAttr(ref.name || '')}"
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
        }).join('')
        : `<div class="sm-empty">${escapeHtml(emptyLabel)}</div>`;
    return `${header}${rows}`;
}

async function renderChatSection(container, ctx) {
    const host = container.querySelector('#sm-sl-chats');
    if (!host) return;

    const { chars, groups } = castMembers();
    if (!chars.length && !groups.length) {
        host.innerHTML = `<div class="sm-empty">Add at least one character or group above to list its chats.</div>`;
        return;
    }

    host.innerHTML = `<div class="sm-empty">Loading chats…</div>`;

    // Fetch every member's chat files in parallel (characters + groups).
    const [charData, groupData] = await Promise.all([
        Promise.all(chars.map(async (ch) => ({ member: ch, files: await getChatsForCharacter(ch.avatar, { simple: true }) }))),
        Promise.all(groups.map(async (g) => ({ member: g, files: await getChatsForGroup(g.groupId) }))),
    ]);

    const allStorylines = Object.values(await getStorylines());
    const multi = (chars.length + groups.length) > 1;

    const charSections = charData.map(({ member, files }) => renderMemberBlock({
        headerIcon: 'fa-user',
        headerLabel: member.displayName || member.name,
        multi, files, allStorylines,
        emptyLabel: 'No chat files found for this character.',
        refFor: () => ({ source: 'character', avatar: member.avatar, name: member.name }),
    }));
    const groupSections = groupData.map(({ member, files }) => renderMemberBlock({
        headerIcon: 'fa-users',
        headerLabel: member.name,
        multi, files, allStorylines,
        emptyLabel: 'No chat files found for this group.',
        refFor: () => ({ source: 'group', groupId: member.groupId, name: member.name }),
    }));

    host.innerHTML = `<div class="sm-chat-assign-list">${[...charSections, ...groupSections].join('')}</div>`;

    wireChatSection(host, container);
}

function wireChatSection(host, container) {
    host.querySelectorAll('.sm-chat-assign-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const fn = cb.dataset.file;
            const ref = {
                source: cb.dataset.source || 'character',
                avatar: cb.dataset.avatar || '',
                groupId: cb.dataset.groupid || '',
                name: cb.dataset.name || '',
            };

            if (cb.checked) {
                // Warn if this chat belongs to another storyline (move-on-save).
                if (cb.dataset.ownerId && getSettingWarn()) {
                    const ok = confirm(
                        `"${prettyName(fn)}" is already in "${cb.dataset.ownerTitle}".\n\n` +
                        `Move it to this storyline on save?`);
                    if (!ok) { cb.checked = false; return; }
                }
                if (!chatInDraft(fn, ref)) {
                    const maxOrder = draft.chats.reduce((m, c) => Math.max(m, c.chronoOrder || 0), -1);
                    draft.chats.push({
                        file_name: fn,
                        source: ref.source,
                        groupId: ref.groupId,
                        character: ref.name,
                        avatar: ref.avatar,
                        image: null, blurb: '',
                        chronoOrder: maxOrder + 1,
                        chronoLabel: null, hasSummary: false,
                        images: [], quotes: [],
                    });
                }
            } else {
                draft.chats = draft.chats.filter(c => !(
                    c.file_name === fn
                    && (c.source || 'character') === ref.source
                    && (ref.source === 'group'
                        ? (c.groupId || '') === ref.groupId
                        : (c.avatar || '') === ref.avatar)));
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

    // Primary character select — updates identity; refreshes the cast picker
    // (its exclusion list changed) and the chat list (available chats changed).
    container.querySelector('#sm-sl-char')?.addEventListener('change', async (e) => {
        const avatar = e.target.value;
        const match = draft._allChars.find(c => c.avatar === avatar);
        draft.character = match
            ? { name: match.name, avatar: match.avatar, displayName: match.displayName }
            : { name: '', avatar: '', displayName: '' };
        // A character can't be both primary and additional cast.
        if (avatar) draft.cast = draft.cast.filter(c => c.avatar !== avatar);
        mountCastPicker(container, ctx);
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
    // Cast is passed explicitly (primary + participants) so updateStoryline does
    // NOT re-derive it from `character` and clobber the additional cast.
    const { primary, participants } = buildCastPayload();
    const payload = {
        title: draft.title.trim(),
        description: draft.description,
        coverImage: draft.coverImage,
        coverThumb: draft.coverThumb,
        heroImage: draft.heroImage,
        heroThumb: draft.heroThumb,
        character: draft.character,
        primary,
        participants,
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
    // Keyed by a composite (source|owner|file) so same-named files from different
    // cast members / groups are reconciled independently.
    const chatKey = (c) => `${c.source || 'character'}|${c.source === 'group' ? (c.groupId || '') : (c.avatar || '')}|${c.file_name}`;
    const current = (await getStoryline(storylineId))?.chats || [];
    const draftKeys = new Set(draft.chats.map(chatKey));
    for (const c of current) {
        if (!draftKeys.has(chatKey(c))) {
            await removeChatFromStoryline(c.file_name, undefined,
                { source: c.source || 'character', avatar: c.avatar, groupId: c.groupId });
        }
    }
    for (const c of draft.chats) {
        await assignChatToStoryline(c.file_name, storylineId, {
            source: c.source || 'character',
            groupId: c.groupId || '',
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
    const liveStoryline = await getStoryline(draft.id);
    const ebookWarning = liveStoryline?.ebook?.file ? ' Its ebook will also be permanently deleted.' : '';
    if (!confirm(`Delete storyline "${draft.title}"? Chats become unowned.${ebookWarning} This can't be undone.`)) return;
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

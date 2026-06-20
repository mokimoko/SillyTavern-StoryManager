/**
 * sidebar/index.js — in-chat left sidebar (Phase 2)
 *
 * A quick-work surface that slides in from the LEFT (mirroring WL's right sidebar,
 * a touch wider). Scoped to the ACTIVE character: lists its chat files with
 * multi-select checkboxes, lets you quick-assign the selection to one of that
 * character's storylines (or a brand-new one) without opening the full modal, and
 * lists the card's existing storylines for one-click editing in the modal.
 *
 * Pin state is backed by the sidebarPinned setting. Unpinned, an outside click or
 * Escape closes it; pinned, it stays until toggled.
 *
 * Exports: openSidebar(), closeSidebar()
 */
import { getSetting, setSetting } from '../settings.js';
import {
    getCurrentCharacter, getChatsForCharacter,
    getCurrentGroup, getChatsForGroup,
} from '../stContext.js';
import {
    getStorylinesForCharacter, getStorylinesForGroup, getStorylines,
    createStoryline, assignChatToStoryline,
} from '../storage.js';
import { openModal } from '../modal/index.js';
import { openDisplay } from '../display/index.js';
import { escapeHtml, escapeAttr, logWarn } from '../display/util.js';

/** Respect the entryPoint setting when expanding from sidebar. */
function openEntryPoint(tab) {
    if (getSetting('entryPoint') === 'display') openDisplay();
    else openModal(tab);
}

const SIDEBAR_ID = 'sm-sidebar-panel';
let isOpen = false;
let outsideClickHandler = null;
let eventsRegistered = false;

// ============================================================
// ST event listeners — keep sidebar fresh on character/chat switch
// ============================================================

function registerSTEvents() {
    if (eventsRegistered) return;
    eventsRegistered = true;

    // eventSource is the global ST event bus. We listen for any event that
    // means "the active character or chat changed" and re-render if open.
    try {
        const { eventSource, event_types } = window.SillyTavern?.getContext?.() ?? {};
        const bus = eventSource ?? window.eventSource;
        if (!bus || typeof bus.on !== 'function') return;

        const WATCH = [
            // Fired when the user switches to a different chat file.
            event_types?.CHAT_CHANGED ?? 'chatChanged',
            // Fired when a character is selected / page loads.
            event_types?.CHARACTER_PAGE_LOADED ?? 'characterPageLoaded',
            // Group chat entered.
            event_types?.GROUP_UPDATED ?? 'groupUpdated',
        ];

        const onSwitch = () => {
            if (isOpen) renderContents();
        };

        for (const evt of WATCH) {
            if (evt) bus.on(evt, onSwitch);
        }
    } catch (e) {
        logWarn('Could not register ST events for sidebar:', e);
    }
}

// ============================================================
// Open / Close
// ============================================================

export function openSidebar() {
    registerSTEvents();   // no-op after first call
    ensureDOM();
    isOpen = true;
    const panel = document.getElementById(SIDEBAR_ID);
    panel?.classList.add('sm-sb-visible');
    renderContents();

    // Outside-click close (only when not pinned).
    if (!outsideClickHandler) {
        outsideClickHandler = (e) => {
            if (!isOpen || getSetting('sidebarPinned')) return;
            const panel = document.getElementById(SIDEBAR_ID);
            if (panel && !panel.contains(e.target)) closeSidebar();
        };
        // Defer so the opening click doesn't immediately close it.
        setTimeout(() => document.addEventListener('mousedown', outsideClickHandler), 0);
    }
}

export function closeSidebar() {
    isOpen = false;
    document.getElementById(SIDEBAR_ID)?.classList.remove('sm-sb-visible');
}

function toggleSidebar() {
    if (isOpen) closeSidebar(); else openSidebar();
}

// ============================================================
// DOM
// ============================================================

function ensureDOM() {
    if (document.getElementById(SIDEBAR_ID)) return;

    const panel = document.createElement('div');
    panel.id = SIDEBAR_ID;
    panel.className = 'sm-sb-panel';
    panel.innerHTML = `
        <div class="sm-sb-header">
            <div class="sm-sb-title"><i class="fa-solid fa-book"></i> Story Manager</div>
            <div class="sm-sb-header-actions">
                <button class="sm-sb-pin" id="sm-sb-pin" title="Pin sidebar">
                    <i class="fa-solid fa-thumbtack"></i>
                </button>
                <button class="sm-sb-modal-btn" id="sm-sb-modal" title="Open full modal">
                    <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                </button>
                <button class="sm-sb-close" id="sm-sb-close" title="Close">✕</button>
            </div>
        </div>
        <div class="sm-sb-body" id="sm-sb-body"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#sm-sb-close')?.addEventListener('click', closeSidebar);
    panel.querySelector('#sm-sb-modal')?.addEventListener('click', () => {
        closeSidebar();
        openEntryPoint('storylines');
    });
    panel.querySelector('#sm-sb-pin')?.addEventListener('click', () => {
        const next = !getSetting('sidebarPinned');
        setSetting('sidebarPinned', next);
        updatePinUI();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen && !getSetting('sidebarPinned')) closeSidebar();
    });

    updatePinUI();
}

function updatePinUI() {
    const btn = document.getElementById('sm-sb-pin');
    if (btn) btn.classList.toggle('sm-sb-pinned', !!getSetting('sidebarPinned'));
}

// ============================================================
// Body render
// ============================================================

async function renderContents() {
    const body = document.getElementById('sm-sb-body');
    if (!body) return;

    // Group chats have no single active character — render the group surface.
    const group = getCurrentGroup();
    if (group) { await renderGroupContents(body, group); return; }

    const character = getCurrentCharacter();
    if (!character) {
        body.innerHTML = `
            <div class="sm-empty-state">
                <i class="fa-solid fa-user-slash"></i>
                <p>No character or group selected</p>
                <span class="sm-empty-hint">Open a chat to manage its storylines.</span>
            </div>`;
        return;
    }

    body.innerHTML = `<div class="sm-empty">Loading…</div>`;

    const [chatFiles, storylines] = await Promise.all([
        getChatsForCharacter(character.avatar, { simple: true }),
        getStorylinesForCharacter(character.avatar),
    ]);

    // Which chats are already owned (by any storyline of this card), for badges.
    const ownerByFile = {};
    for (const sl of storylines) {
        for (const c of (sl.chats || [])) ownerByFile[c.file_name] = sl;
    }

    body.innerHTML = `
        <div class="sm-sb-section">
            <div class="sm-sb-current">
                <span class="sm-sb-current-label">Current card</span>
                <span class="sm-sb-current-name">${escapeHtml(character.displayName)}</span>
            </div>
        </div>

        <div class="sm-sb-section">
            <div class="sm-field-label">Chats <span class="sm-sb-count">${chatFiles.length}</span></div>
            <div class="sm-sb-chatlist" id="sm-sb-chatlist">
                ${chatFiles.length ? chatFiles.map(cf => chatRowHtml(cf, ownerByFile[cf.file_name])).join('')
                    : `<div class="sm-empty">No chats for this card.</div>`}
            </div>
        </div>

        <div class="sm-sb-section sm-sb-assign" id="sm-sb-assign" hidden>
            <div class="sm-field-label">Assign selected →</div>
            <select class="sm-select" id="sm-sb-target">
                <option value="">— choose storyline —</option>
                ${storylines.map(sl => `<option value="${escapeAttr(sl.id)}">${escapeHtml(sl.title)}</option>`).join('')}
                <option value="__new__">+ New storyline…</option>
            </select>
            <button class="sm-btn sm-btn-accent sm-sb-assign-go" id="sm-sb-assign-go">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> Assign
            </button>
        </div>

        <div class="sm-sb-section">
            <div class="sm-field-label">This card's storylines <span class="sm-sb-count">${storylines.length}</span></div>
            <div class="sm-sb-sllist">
                ${storylines.length ? storylines.map(slRowHtml).join('')
                    : `<div class="sm-empty">None yet.</div>`}
            </div>
        </div>
    `;

    wireBody(body, character, chatFiles);
}

function chatRowHtml(cf, owner) {
    const fn = cf.file_name;
    return `
        <label class="sm-sb-chat-row ${owner ? 'sm-sb-chat-owned' : ''}">
            <input type="checkbox" class="sm-sb-chat-cb" data-file="${escapeAttr(fn)}" />
            <span class="sm-sb-chat-name" title="${escapeAttr(fn)}">${escapeHtml(prettyName(fn))}</span>
            ${owner ? `<span class="sm-sb-chat-owner" title="In ${escapeAttr(owner.title)}"><i class="fa-solid fa-link"></i></span>` : ''}
        </label>
    `;
}

function slRowHtml(sl) {
    const count = sl.chats?.length || 0;
    return `
        <div class="sm-sb-sl-row" data-id="${escapeAttr(sl.id)}">
            <i class="fa-solid fa-book-open"></i>
            <span class="sm-sb-sl-title">${escapeHtml(sl.title)}</span>
            <span class="sm-sb-sl-count">${count}</span>
        </div>
    `;
}

// ============================================================
// Body wiring
// ============================================================

function wireBody(body, character, chatFiles) {
    const assignPanel = body.querySelector('#sm-sb-assign');
    const checkboxes = () => [...body.querySelectorAll('.sm-sb-chat-cb')];
    const selected = () => checkboxes().filter(cb => cb.checked).map(cb => cb.dataset.file);

    // Show/hide the assign panel based on whether anything's selected.
    body.querySelectorAll('.sm-sb-chat-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            if (assignPanel) assignPanel.hidden = selected().length === 0;
        });
    });

    // Open a storyline in the full modal.
    body.querySelectorAll('.sm-sb-sl-row').forEach(row => {
        row.addEventListener('click', () => {
            closeSidebar();
            openEntryPoint('storylines');
        });
    });

    // Assign selection.
    body.querySelector('#sm-sb-assign-go')?.addEventListener('click', async () => {
        const files = selected();
        if (!files.length) return;
        const target = body.querySelector('#sm-sb-target')?.value;
        if (!target) { alert('Pick a storyline (or create a new one).'); return; }

        await assignSelection(files, target, character, chatFiles);
        renderContents();
    });
}

/**
 * Assign a set of chat files to a storyline (existing id or "__new__").
 * Uses move=true since the sidebar is the quick surface — the link badge already
 * signals prior ownership, and the global warnOnChatMove setting gates the prompt.
 */
async function assignSelection(files, target, character, chatFiles) {
    let storylineId = target;

    if (target === '__new__') {
        const title = prompt('New storyline title:', '');
        if (title === null) return;
        const created = await createStoryline({
            title: title.trim() || 'Untitled Storyline',
            character: { name: character.name, avatar: character.avatar, displayName: character.displayName },
            tags: { character: character.name ? [character.name] : [], persona: [], npc: [], freeform: [] },
        });
        storylineId = created.id;
    }

    const warn = getSetting('warnOnChatMove') !== false;
    for (const fn of files) {
        const meta = chatFiles.find(c => c.file_name === fn) || {};
        // First attempt without move to surface a conflict descriptor.
        let res = await assignChatToStoryline(fn, storylineId, {
            character: character.name, avatar: character.avatar,
        }, false);
        if (res && res.ok === false && res.conflict) {
            const ok = !warn || confirm(
                `"${prettyName(fn)}" is already in "${res.conflict.title}". Move it here?`);
            if (ok) {
                await assignChatToStoryline(fn, storylineId, {
                    character: character.name, avatar: character.avatar,
                }, true);
            }
        }
    }
}

// ============================================================
// Group mode
// ============================================================

async function renderGroupContents(body, group) {
    body.innerHTML = `<div class="sm-empty">Loading…</div>`;

    const [chatFiles, tagged] = await Promise.all([
        getChatsForGroup(group.groupId),
        getStorylinesForGroup(group.groupId),
    ]);

    // "Related" = storylines whose cast includes a MEMBER of this group but that
    // aren't tagged to the group itself (the two-section view). Computed once.
    const taggedIds = new Set(tagged.map(sl => sl.id));
    const members = new Set(group.members || []);
    const allStorylines = Object.values(await getStorylines());
    const related = allStorylines.filter(sl => {
        if (taggedIds.has(sl.id)) return false;
        return (sl.participants || []).some(p =>
            (p.type ?? 'character') === 'character' && p.avatar && members.has(p.avatar));
    });

    // Which of this group's chats already belong to a storyline (group-source,
    // same group), for the owned badges.
    const ownerByFile = {};
    for (const sl of allStorylines) {
        for (const c of (sl.chats || [])) {
            if ((c.source || 'character') === 'group' && c.groupId === group.groupId) {
                ownerByFile[c.file_name] = sl;
            }
        }
    }

    body.innerHTML = `
        <div class="sm-sb-section">
            <div class="sm-sb-current">
                <span class="sm-sb-current-label">Current group</span>
                <span class="sm-sb-current-name"><i class="fa-solid fa-users"></i> ${escapeHtml(group.name)}</span>
            </div>
        </div>

        <div class="sm-sb-section">
            <div class="sm-field-label">Chats <span class="sm-sb-count">${chatFiles.length}</span></div>
            <div class="sm-sb-chatlist" id="sm-sb-chatlist">
                ${chatFiles.length ? chatFiles.map(cf => chatRowHtml(cf, ownerByFile[cf.file_name])).join('')
                    : `<div class="sm-empty">No chats for this group.</div>`}
            </div>
        </div>

        <div class="sm-sb-section sm-sb-assign" id="sm-sb-assign" hidden>
            <div class="sm-field-label">Assign selected →</div>
            <select class="sm-select" id="sm-sb-target">
                <option value="">— choose storyline —</option>
                ${tagged.map(sl => `<option value="${escapeAttr(sl.id)}">${escapeHtml(sl.title)}</option>`).join('')}
                <option value="__new__">+ New storyline…</option>
            </select>
            <button class="sm-btn sm-btn-accent sm-sb-assign-go" id="sm-sb-assign-go">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> Assign
            </button>
        </div>

        <div class="sm-sb-section">
            <div class="sm-field-label">This group's storylines <span class="sm-sb-count">${tagged.length}</span></div>
            <div class="sm-sb-sllist">
                ${tagged.length ? tagged.map(slRowHtml).join('')
                    : `<div class="sm-empty">None yet.</div>`}
            </div>
        </div>

        ${related.length ? `
        <div class="sm-sb-section">
            <div class="sm-field-label">Related <span class="sm-sb-count">${related.length}</span></div>
            <div class="sm-field-hint">Shares a character with this group.</div>
            <div class="sm-sb-sllist">
                ${related.map(slRowHtml).join('')}
            </div>
        </div>` : ''}
    `;

    wireGroupBody(body, group);
}

function wireGroupBody(body, group) {
    const assignPanel = body.querySelector('#sm-sb-assign');
    const checkboxes = () => [...body.querySelectorAll('.sm-sb-chat-cb')];
    const selected = () => checkboxes().filter(cb => cb.checked).map(cb => cb.dataset.file);

    body.querySelectorAll('.sm-sb-chat-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            if (assignPanel) assignPanel.hidden = selected().length === 0;
        });
    });

    body.querySelectorAll('.sm-sb-sl-row').forEach(row => {
        row.addEventListener('click', () => {
            closeSidebar();
            openEntryPoint('storylines');
        });
    });

    body.querySelector('#sm-sb-assign-go')?.addEventListener('click', async () => {
        const files = selected();
        if (!files.length) return;
        const target = body.querySelector('#sm-sb-target')?.value;
        if (!target) { alert('Pick a storyline (or create a new one).'); return; }
        await assignGroupSelection(files, target, group);
        renderContents();
    });
}

/**
 * Assign selected group chats to a storyline. A brand-new storyline gets the
 * group itself as its primary (so group-exclusive users get a storyline with no
 * solo character). Chats are recorded with source:'group' + the group id.
 */
async function assignGroupSelection(files, target, group) {
    let storylineId = target;

    if (target === '__new__') {
        const title = prompt('New storyline title:', group.name || '');
        if (title === null) return;
        const primary = { type: 'group', groupId: group.groupId, name: group.name };
        const created = await createStoryline({
            title: title.trim() || 'Untitled Storyline',
            primary,
            participants: [primary],
            tags: { character: [], persona: [], npc: [], freeform: group.name ? [group.name] : [] },
        });
        storylineId = created.id;
    }

    const warn = getSetting('warnOnChatMove') !== false;
    for (const fn of files) {
        const chatData = { source: 'group', groupId: group.groupId, character: group.name };
        const res = await assignChatToStoryline(fn, storylineId, chatData, false);
        if (res && res.ok === false && res.conflict) {
            const ok = !warn || confirm(
                `"${prettyName(fn)}" is already in "${res.conflict.title}". Move it here?`);
            if (ok) await assignChatToStoryline(fn, storylineId, chatData, true);
        }
    }
}

// ============================================================
// Util
// ============================================================

function prettyName(fileName) {
    return String(fileName).replace(/\.jsonl$/i, '');
}

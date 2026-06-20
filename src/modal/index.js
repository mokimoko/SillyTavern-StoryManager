/**
 * modal/index.js — StoryManager management modal shell (Phase 2)
 *
 * Pattern (mirrors SimpleSummarizer / Chat Design):
 *   - Persistent DOM, created once via ensureModalDOM(), reused across open/close.
 *   - Left 56px icon-only sidebar nav driven by the TABS array.
 *   - Right content area; renderContent() dispatches to per-tab render(container).
 *   - Header carries a [Display ⇄] toggle that hands off to the Phase 4 display.
 *   - Overlay click + Escape close. CSS prefix: sm-
 *
 * Tab modules (storylineTab, bookTab, settingsTab) each export render(container, ctx).
 * They are imported lazily-tolerant: if a tab is still a stub, the shell shows a
 * placeholder rather than throwing, so the shell is usable before the tabs land.
 */
import { openDisplay } from '../display/index.js';

// Tab renderers. During Phase 2 build-out some of these may still be stubs;
// each is expected to export `render(container, ctx)`.
import * as storylineTab from './storylineTab.js';
import * as bookTab from './bookTab.js';
import * as settingsTab from './settingsTab.js';

// ============================================================
// State
// ============================================================

let isOpen = false;
let activeTab = 'storylines';

const MODAL_ID = 'sm-modal';
const OVERLAY_ID = 'sm-overlay';

const TABS = [
    { id: 'storylines', icon: 'fa-book-open',  label: 'Storylines', module: storylineTab },
    { id: 'books',      icon: 'fa-layer-group', label: 'Books',      module: bookTab },
    { id: 'settings',   icon: 'fa-gear',        label: 'Settings',   module: settingsTab },
];

// ============================================================
// Open / Close
// ============================================================

export function openModal(tab = null) {
    if (tab && TABS.some(t => t.id === tab)) activeTab = tab;

    if (isOpen) {
        renderContent();
        return;
    }

    isOpen = true;
    ensureModalDOM();
    renderContent();

    requestAnimationFrame(() => {
        document.getElementById(OVERLAY_ID)?.classList.add('sm-visible');
        document.getElementById(MODAL_ID)?.classList.add('sm-visible');
    });
}

export function closeModal() {
    if (!isOpen) return;
    document.getElementById(OVERLAY_ID)?.classList.remove('sm-visible');
    document.getElementById(MODAL_ID)?.classList.remove('sm-visible');
    isOpen = false;
}

export function isModalOpen() {
    return isOpen;
}

// ============================================================
// DOM Creation
// ============================================================

function ensureModalDOM() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'sm-overlay';
    overlay.addEventListener('click', closeModal);
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'sm-modal';
    modal.innerHTML = `
        <div class="sm-header">
            <div class="sm-title"><i class="fa-solid fa-book"></i> Story Manager</div>
            <div class="sm-header-actions">
                <button class="sm-display-toggle" id="sm-display-toggle" title="Switch to the display gallery">
                    <i class="fa-solid fa-images"></i><span>Display</span><i class="fa-solid fa-right-left"></i>
                </button>
                <div class="sm-close" id="sm-close">✕</div>
            </div>
        </div>
        <div class="sm-body">
            <div class="sm-sidebar" id="sm-sidebar"></div>
            <div class="sm-content" id="sm-content"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#sm-close')?.addEventListener('click', closeModal);
    modal.querySelector('#sm-display-toggle')?.addEventListener('click', () => {
        // Hand off management → display (Phase 4). Close the modal first so the
        // two views never overlap; the display is the configured entry surface.
        closeModal();
        openDisplay();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closeModal();
    });
}

// ============================================================
// Sidebar
// ============================================================

function renderSidebar() {
    const sidebar = document.getElementById('sm-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = TABS.map(t => `
        <div class="sm-nav-item ${t.id === activeTab ? 'sm-nav-active' : ''}"
             data-tab="${t.id}" title="${t.label}">
            <i class="fa-solid ${t.icon}"></i>
        </div>
    `).join('');

    sidebar.querySelectorAll('.sm-nav-item').forEach(el => {
        el.addEventListener('click', () => {
            activeTab = el.dataset.tab;
            renderContent();
        });
    });
}

// ============================================================
// Content dispatch
// ============================================================

function renderContent() {
    renderSidebar();
    const content = document.getElementById('sm-content');
    if (!content) return;

    const tab = TABS.find(t => t.id === activeTab) || TABS[0];
    const render = tab.module && typeof tab.module.render === 'function'
        ? tab.module.render
        : null;

    if (!render) {
        // Tab module is still a Phase 2 stub — show a placeholder instead of crashing.
        content.innerHTML = `
            <div class="sm-empty-state">
                <i class="fa-solid fa-screwdriver-wrench"></i>
                <p>${tab.label} — coming in Phase 2</p>
                <span class="sm-empty-hint">This tab's UI hasn't been built yet.</span>
            </div>`;
        return;
    }

    try {
        // Tabs receive a small ctx so they can request a re-render or tab switch.
        render(content, {
            rerender: renderContent,
            switchTab: (id) => { activeTab = id; renderContent(); },
            close: closeModal,
        });
    } catch (e) {
        console.error(`[StoryManager] Failed to render "${tab.id}" tab:`, e);
        content.innerHTML = `
            <div class="sm-empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Something went wrong rendering ${tab.label}.</p>
                <span class="sm-empty-hint">${e.message}</span>
            </div>`;
    }
}

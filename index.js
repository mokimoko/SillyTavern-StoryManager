/**
 * SillyTavern-StoryManager — Standalone Extension
 *
 * An archival librarian for your chats: Books → Storylines → Chats.
 * Catalogues and presents your library. Does NOT touch worldbooks, prompts,
 * or verse state (that's VerseManager's job). Works fully standalone; all
 * hooks into Summarizer / UIBedazzler / VerseManager are feature-detected.
 *
 * Phase 1: foundation — storage, ST bridges, settings, public API, wand entry.
 * Management UI (Phase 2) and the Display (Phase 4) arrive later.
 */
import { initFileStore } from './src/fileStore.js';
import { initWordCountCapture } from './src/wordCountCapture.js';
import { initSettings, getSetting, isEnabled } from './src/settings.js';
import {
    getBooks, getBook, createBook, updateBook, deleteBook,
    getStorylines, getStoryline, createStoryline, updateStoryline, deleteStoryline,
    assignStorylineToBook, getStorylinesForCharacter, getStorylinesInBook,
    getStorylineForChat, assignChatToStoryline, removeChatFromStoryline,
} from './src/storage.js';
import {
    getCurrentCharacter, getAllCharacters, getAllPersonas,
    getChatsForCharacter, openChat, hasSummarizer, getSummaryForChat,
} from './src/stContext.js';
import { openModal, closeModal } from './src/modal/index.js';
import { openDisplay, closeDisplay } from './src/display/index.js';
import { openSidebar, closeSidebar } from './src/sidebar/index.js';
import { log, logWarn } from './src/display/util.js';

const EXTENSION_DIR = 'SillyTavern-StoryManager';
let initialized = false;

// ============================================================
// CSS loading
// ============================================================

function loadStylesheets() {
    const sheets = ['sidebar.css', 'modal.css', 'display.css'];
    // Cache-bust with a per-load timestamp. Without a changing query string the
    // browser reuses the cached copy at the identical URL, so CSS edits wouldn't
    // show on a normal refresh. Date.now() forces a fresh fetch each load.
    const bust = Date.now();
    for (const sheet of sheets) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/scripts/extensions/third-party/${EXTENSION_DIR}/${sheet}?v=${bust}`;
        document.head.appendChild(link);
    }
}

// ============================================================
// Entry point — respects the entryPoint setting (Display-first default)
// ============================================================

function openStoryManager() {
    if (getSetting('entryPoint') === 'modal') openModal();
    else openDisplay();
}

// ============================================================
// Wand-menu entry button
// ============================================================

function setupInputButton() {
    const menu = document.getElementById('extensionsMenu')
        || document.querySelector('#data_bank_wand_container')
        || document.querySelector('.extensions_block');
    if (!menu) return;

    const btn = document.createElement('div');
    btn.id = 'story-manager-input-btn';
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.title = 'Story Manager';
    btn.tabIndex = 0;
    btn.innerHTML = '<i class="fa-solid fa-book"></i> Story Manager';
    btn.addEventListener('click', openStoryManager);
    menu.appendChild(btn);

    // Secondary entry: the in-chat sidebar (quick assign surface).
    const sbBtn = document.createElement('div');
    sbBtn.id = 'story-manager-sidebar-btn';
    sbBtn.className = 'list-group-item flex-container flexGap5 interactable';
    sbBtn.title = 'Story Manager — quick sidebar';
    sbBtn.tabIndex = 0;
    sbBtn.innerHTML = '<i class="fa-solid fa-bars-staggered"></i> Story Sidebar';
    sbBtn.addEventListener('click', openSidebar);
    menu.appendChild(sbBtn);

    // When UIBedazzler's side-button strip is present it provides its own
    // Story Manager trigger (→ openSidebar), so our wand-menu entries are
    // redundant. UIBedazzler hides them by text-matching "story manager",
    // which catches the primary entry but NOT "Story Sidebar". Suppress both
    // ourselves once the strip exists. The strip is built on APP_READY (~300ms
    // after load), so poll briefly rather than assuming it's already there.
    suppressWandEntriesIfBedazzled(btn, sbBtn);
}

/**
 * Hide our wand-menu entries while UIBedazzler's side-button strip is active.
 * Feature-detected off the strip container (#bd-side-buttons) so there's no
 * hard dependency on UIBedazzler. Reverts automatically if the strip is later
 * torn down (e.g. the user disables side buttons mid-session).
 */
function suppressWandEntriesIfBedazzled(...entries) {
    const STRIP_ID = 'bd-side-buttons';

    const sync = () => {
        const stripActive = !!document.getElementById(STRIP_ID);
        for (const el of entries) {
            if (!el) continue;
            el.style.display = stripActive ? 'none' : '';
        }
    };

    // Initial settle: the strip appears ~300ms post-APP_READY. Poll a handful
    // of times, then keep watching the body for add/remove of the strip.
    let ticks = 0;
    const iv = setInterval(() => {
        sync();
        if (++ticks >= 12) clearInterval(iv); // ~3s of coverage
    }, 250);

    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true });
}

// ============================================================
// Slash commands
// ============================================================

async function registerSlashCommands() {
    try {
        const { SlashCommand } = await import('../../../slash-commands/SlashCommand.js');
        const { SlashCommandParser } = await import('../../../slash-commands/SlashCommandParser.js');

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'storymanager',
            callback: () => { openDisplay(); return ''; },
            helpString: 'Open the Story Manager display gallery',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'storymanager-modal',
            callback: () => { openModal(); return ''; },
            helpString: 'Open the Story Manager management modal',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'storymanager-sidebar',
            callback: () => { openSidebar(); return ''; },
            helpString: 'Open the Story Manager in-chat sidebar',
        }));
    } catch (e) {
        logWarn('Slash command registration skipped:', e.message);
    }
}

// ============================================================
// Public API
// ============================================================

function exposePublicAPI() {
    window.StoryManager = {
        isInstalled: true,

        // Primary entry point — respects the entryPoint setting.
        // This is the stable method external integrations (e.g. UIBedazzler) call.
        open: openStoryManager,

        // UI entry points
        openModal,
        closeModal,
        openDisplay,
        closeDisplay,
        openSidebar,
        closeSidebar,

        // Book accessors
        getBooks,
        getBook,
        createBook,
        updateBook,
        deleteBook,

        // Storyline accessors
        getStorylines,
        getStoryline,
        createStoryline,
        updateStoryline,
        deleteStoryline,
        getStorylinesForCharacter,
        getStorylinesInBook,
        assignStorylineToBook,

        // Chat ownership
        getStorylineForChat,
        assignChatToStoryline,
        removeChatFromStoryline,

        // ST bridges (handy for cross-extension use)
        getChatsForCharacter,

        // Settings
        getSetting,
        isEnabled,
    };
}

// ============================================================
// UIBedazzler side-button integration
// ============================================================
// UIBedazzler has no public registration API — its BUTTON_REGISTRY is a
// closed, hard-coded array (see UIBedazzler/src/sideButtons.js). It DETECTS
// extensions rather than accepting registrations: each entry feature-detects
// a known global and calls its open method. StoryManager's side button is
// therefore added directly to UIBedazzler's registry, keyed on:
//     detect:  () => window.StoryManager
//     trigger: () => window.StoryManager?.open()
// Nothing to register from this side; exposing window.StoryManager.open()
// (done in exposePublicAPI) is the entire contract. The wand-menu entry is
// the fallback when UIBedazzler isn't installed.

// ============================================================
// Init
// ============================================================

jQuery(async () => {
    if (initialized) return;

    initFileStore();
    initWordCountCapture();
    initSettings();

    loadStylesheets();
    setupInputButton();
    await registerSlashCommands();
    exposePublicAPI();

    initialized = true;
    log('Phase 1 foundation loaded.');
});

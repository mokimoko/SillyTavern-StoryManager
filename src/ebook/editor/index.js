/** Full-screen ebook creation and editing workspace. */

import { getStoryline } from '../../storage.js';
import { logError } from '../../display/util.js';
import { deleteRecoveryDraft, loadRecoveryDraft, saveRecoveryDraft } from '../draftStore.js';
import { createEbookDocument, normalizeEbookDocument } from '../model.js';
import { deleteEbook, loadEbook, saveEbook } from '../store.js';
import { notify, showChoiceDialog } from '../ui.js';
import { createChapterActions } from './chapterActions.js';
import { renderStylePanel } from './stylePanel.js';
import { renderTextEditor, resetTextEditorSession } from './textEditor.js';
import { renderEditorNavigation } from './navigation.js';

const EDITOR_ID = 'sm-ebook-editor';
const DRAFT_DELAY = 1200;

let isOpen = false;
let storyline = null;
let documentState = null;
let activeView = { type: 'raw', id: null };
let existedAtOpen = false;
let dirty = false;
let returnTarget = { type: 'management' };
let draftTimer = null;
let draftIdleHandle = null;

const chapterActions = createChapterActions({
    getDocument: () => documentState,
    getActiveView: () => activeView,
    setActiveView: nextView => { activeView = nextView; },
    onDirty: markDirty,
    renderEditor,
    renderNavigation,
});

export async function openEbookEditor(storylineId, options = {}) {
    const nextStoryline = await getStoryline(storylineId);
    if (!nextStoryline) {
        notify('That storyline could not be found.', 'error');
        return false;
    }
    ensureDOM();
    resetTextEditorSession();
    storyline = nextStoryline;
    returnTarget = options.returnTarget || { type: 'management' };

    let saved = null;
    try {
        saved = await loadEbook(storylineId);
    } catch (error) {
        logError('Failed to load ebook:', error);
        notify(error.message || 'The ebook could not be loaded.', 'error');
        return false;
    }
    existedAtOpen = !!saved;
    const savedTimestamp = Number(saved?.updatedAt || 0);
    documentState = normalizeEbookDocument(saved || createEbookDocument(storyline), storyline);
    dirty = false;

    const recovery = await loadRecoveryDraft(storylineId);
    if (recovery?.document && Number(recovery.savedAt) > savedTimestamp) {
        const choice = await showChoiceDialog({
            title: 'Recover unsaved work?',
            message: 'A newer editing draft was found from an interrupted session.',
            choices: [
                { id: 'recover', label: 'Recover Draft', primary: true },
                { id: 'discard', label: 'Use Last Saved Version' },
            ],
        });
        if (choice === 'recover') {
            documentState = normalizeEbookDocument(recovery.document, storyline);
            dirty = true;
            notify('Recovered the unsaved ebook draft.', 'success');
        } else {
            await deleteRecoveryDraft(storylineId);
        }
    } else if (recovery) {
        await deleteRecoveryDraft(storylineId);
    }

    activeView = { type: 'raw', id: null };
    isOpen = true;
    const root = document.getElementById(EDITOR_ID);
    root.classList.add('sm-eb-visible');
    root.setAttribute('aria-hidden', 'false');
    renderEditor();
    return true;
}

export function closeEbookEditor() {
    isOpen = false;
    cancelScheduledDraftSave();
    resetTextEditorSession();
    const root = document.getElementById(EDITOR_ID);
    root?.classList.remove('sm-eb-visible');
    root?.setAttribute('aria-hidden', 'true');
    root?.querySelector('#sm-eb-editor-nav')?.replaceChildren();
    root?.querySelector('#sm-eb-editor-workspace')?.replaceChildren();
    document.querySelectorAll('.sm-eb-popover, .sm-eb-context-menu').forEach(menu => menu.remove());
    storyline = null;
    documentState = null;
    activeView = { type: 'raw', id: null };
    existedAtOpen = false;
    dirty = false;
    returnTarget = { type: 'management' };
}

export function isEbookEditorOpen() {
    return isOpen;
}

function ensureDOM() {
    if (document.getElementById(EDITOR_ID)) return;
    const root = document.createElement('section');
    root.id = EDITOR_ID;
    root.className = 'sm-eb-editor';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <header class="sm-eb-editor-header">
            <div class="sm-eb-editor-brand">
                <span class="sm-eb-editor-monogram">SM</span>
                <div>
                    <span class="sm-eb-editor-overline">Story Manager · Editions</span>
                    <h1 id="sm-eb-editor-title">Ebook Studio</h1>
                </div>
            </div>
            <div class="sm-eb-editor-state" id="sm-eb-editor-state"></div>
            <div class="sm-eb-editor-actions">
                <button type="button" class="sm-eb-action-danger" id="sm-eb-delete" hidden>
                    <i class="fa-solid fa-trash"></i><span>Delete Ebook</span>
                </button>
                <button type="button" id="sm-eb-discard"><i class="fa-solid fa-rotate-left"></i><span>Discard</span></button>
                <button type="button" class="sm-eb-action-save" id="sm-eb-save">
                    <i class="fa-solid fa-bookmark"></i><span>Create Ebook</span>
                </button>
                <button type="button" class="sm-eb-action-close" id="sm-eb-close" title="Close editor">×</button>
            </div>
        </header>
        <div class="sm-eb-editor-body">
            <aside class="sm-eb-editor-nav" id="sm-eb-editor-nav"></aside>
            <main class="sm-eb-editor-workspace" id="sm-eb-editor-workspace"></main>
        </div>`;
    document.body.appendChild(root);

    root.querySelector('#sm-eb-save').addEventListener('click', saveAndReturn);
    root.querySelector('#sm-eb-discard').addEventListener('click', discardAndReturn);
    root.querySelector('#sm-eb-close').addEventListener('click', requestClose);
    root.querySelector('#sm-eb-delete').addEventListener('click', deleteCurrentEbook);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen && !document.querySelector('.sm-eb-dialog-overlay')) {
            event.preventDefault();
            requestClose();
        }
    });
    document.addEventListener('pointerdown', event => {
        if (!isOpen || event.target.closest('.sm-eb-popover, .sm-eb-context-menu')) return;
        document.querySelectorAll('.sm-eb-popover, .sm-eb-context-menu').forEach(menu => menu.remove());
    });
}

function renderEditor() {
    if (!storyline || !documentState) return;
    const title = document.getElementById('sm-eb-editor-title');
    if (title) title.textContent = storyline.title || 'Untitled Storyline';
    const saveLabel = document.querySelector('#sm-eb-save span');
    if (saveLabel) saveLabel.textContent = existedAtOpen ? 'Save Ebook' : 'Create Ebook';
    const deleteButton = document.getElementById('sm-eb-delete');
    if (deleteButton) deleteButton.hidden = !existedAtOpen;
    updateDirtyIndicator();
    renderNavigation();
    renderWorkspace();
}

function updateDirtyIndicator() {
    const host = document.getElementById('sm-eb-editor-state');
    if (!host) return;
    host.innerHTML = dirty
        ? '<span class="sm-eb-unsaved-dot"></span> Unsaved changes'
        : '<i class="fa-solid fa-check"></i> Up to date';
    host.classList.toggle('sm-eb-editor-state-dirty', dirty);
}

function renderNavigation() {
    const nav = document.getElementById('sm-eb-editor-nav');
    if (!nav) return;
    renderEditorNavigation(nav, {
        document: documentState,
        activeView,
        onSelectView: nextView => {
            activeView = nextView;
            renderNavigation();
            renderWorkspace();
        },
        onAddChapter: chapterActions.addChapter,
        onRenameChapter: chapterActions.renameChapter,
        onRemoveChapter: chapterActions.removeChapter,
        onReorderChapter: chapterActions.reorderChapter,
    });
}

function renderWorkspace() {
    const host = document.getElementById('sm-eb-editor-workspace');
    if (!host) return;
    if (activeView.type === 'style') {
        renderStylePanel(host, {
            document: documentState,
            storyline,
            onChange: markDirty,
        });
        return;
    }
    const chapter = activeView.type === 'chapter'
        ? documentState.chapters.find(item => item.id === activeView.id)
        : null;
    if (activeView.type === 'chapter' && !chapter) {
        activeView = { type: 'raw', id: null };
        renderEditor();
        return;
    }
    renderTextEditor(host, {
        document: documentState,
        storyline,
        chapter,
        mode: chapter ? 'chapter' : 'raw',
        onChange: markDirty,
        onStructureChange: () => {
            markDirty();
            renderNavigation();
        },
        onCreateChapter: chapterActions.createFromEditor,
    });
}

function markDirty() {
    if (!documentState) return;
    documentState.updatedAt = Date.now();
    dirty = true;
    updateDirtyIndicator();
    cancelScheduledDraftSave();
    const pendingDocument = documentState;
    draftTimer = setTimeout(() => {
        draftTimer = null;
        const save = () => {
            draftIdleHandle = null;
            if (isOpen && documentState === pendingDocument) void saveRecoveryDraft(pendingDocument);
        };
        if (globalThis.requestIdleCallback) {
            draftIdleHandle = globalThis.requestIdleCallback(save, { timeout: 900 });
        } else {
            save();
        }
    }, DRAFT_DELAY);
}

function cancelScheduledDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (draftIdleHandle !== null && globalThis.cancelIdleCallback) {
        globalThis.cancelIdleCallback(draftIdleHandle);
    }
    draftIdleHandle = null;
}

async function saveAndReturn() {
    if (!documentState) return;
    const button = document.getElementById('sm-eb-save');
    button.disabled = true;
    button.classList.add('sm-eb-button-busy');
    try {
        documentState = await saveEbook(documentState);
        existedAtOpen = true;
        dirty = false;
        cancelScheduledDraftSave();
        await deleteRecoveryDraft(documentState.storylineId);
        notify('Ebook saved.', 'success');
        const origin = captureReturnContext();
        closeEbookEditor();
        await returnToOrigin(origin);
    } catch (error) {
        logError('Failed to save ebook:', error);
        notify(error.message || 'The ebook could not be saved.', 'error');
    } finally {
        button.disabled = false;
        button.classList.remove('sm-eb-button-busy');
    }
}

async function discardAndReturn() {
    if (dirty) {
        const choice = await showChoiceDialog({
            title: 'Discard your changes?',
            message: 'The last saved ebook will remain unchanged.',
            choices: [
                { id: 'cancel', label: 'Continue Editing' },
                { id: 'discard', label: 'Discard Changes', danger: true },
            ],
        });
        if (choice !== 'discard') return;
    }
    const origin = captureReturnContext();
    await deleteRecoveryDraft(storyline.id);
    closeEbookEditor();
    await returnToOrigin(origin);
}

async function requestClose() {
    if (!dirty) {
        const origin = captureReturnContext();
        closeEbookEditor();
        await returnToOrigin(origin);
        return;
    }
    const choice = await showChoiceDialog({
        title: 'Unsaved changes',
        message: 'Save this edition before returning to Story Manager?',
        choices: [
            { id: 'continue', label: 'Continue Editing' },
            { id: 'discard', label: 'Discard', danger: true },
            { id: 'save', label: existedAtOpen ? 'Save Ebook' : 'Create Ebook', primary: true },
        ],
    });
    if (choice === 'save') await saveAndReturn();
    if (choice === 'discard') {
        const origin = captureReturnContext();
        await deleteRecoveryDraft(storyline.id);
        closeEbookEditor();
        await returnToOrigin(origin);
    }
}

async function deleteCurrentEbook() {
    if (!existedAtOpen) return;
    const choice = await showChoiceDialog({
        title: 'Delete this ebook?',
        message: 'The storyline and its chats will remain. The edited manuscript will be permanently removed.',
        choices: [
            { id: 'cancel', label: 'Keep Ebook' },
            { id: 'delete', label: 'Delete Ebook', danger: true },
        ],
    });
    if (choice !== 'delete') return;
    try {
        await deleteEbook(storyline.id);
        await deleteRecoveryDraft(storyline.id);
        notify('Ebook deleted.', 'success');
        const origin = captureReturnContext();
        closeEbookEditor();
        await returnToOrigin(origin);
    } catch (error) {
        notify(error.message || 'The ebook could not be deleted.', 'error');
    }
}

function captureReturnContext() {
    return {
        target: returnTarget,
        storylineId: storyline?.id || null,
    };
}

async function returnToOrigin({ target, storylineId } = {}) {
    if (target?.type === 'display') {
        const display = await import('../../display/index.js');
        await display.openDisplay({
            bookId: target.bookId || null,
            storylineId,
        });
        return;
    }
    const modal = await import('../../modal/index.js');
    modal.openModal('storylines');
}

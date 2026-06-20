/** Raws/chapter Markdown surface, imports, transforms, images, and assignment. */

import { escapeAttr, escapeHtml } from '../../display/util.js';
import { countWords } from '../model.js';
import {
    applyMarkdownWrap,
    stripSpeakerLabels,
} from '../markdown.js';
import { notify } from '../ui.js';
import { canRestoreMove, createMoveUndoSnapshot } from './moveUndo.js';
import {
    closeEditorMenus,
    openChatImporter,
    openImagePicker,
    openXmlCleaner,
    positionEditorPopover,
} from './sourceMenus.js';

let moveUndo = null;
let wordCountTimer = null;
let wordCountIdle = null;

const WORD_COUNT_DELAY = 180;

export function resetTextEditorSession() {
    moveUndo = null;
    cancelScheduledWordCount();
    closeEditorMenus();
}

export function renderTextEditor(host, options) {
    const { document, storyline, chapter, mode } = options;
    const isRaw = mode === 'raw';
    const text = isRaw ? document.rawText : chapter.content;
    refreshMoveUndo(options);
    host.innerHTML = `
        <div class="sm-eb-text-workspace">
            <div class="sm-eb-workspace-intro sm-eb-text-intro">
                <div>
                    <span class="sm-eb-workspace-eyebrow">${isRaw ? 'Source room' : 'Manuscript chapter'}</span>
                    <h2>${escapeHtml(isRaw ? 'Raws' : chapter.title)}</h2>
                    <p>${isRaw
                        ? 'Import chats, clean the text, and move finished selections into chapters.'
                        : 'Edit the chapter directly in Markdown. New assignments from Raws append here.'}</p>
                </div>
                <div class="sm-eb-word-stat"><strong id="sm-eb-current-words">${countWords(text).toLocaleString()}</strong><span>words</span></div>
            </div>
            <div class="sm-eb-toolbar" id="sm-eb-toolbar">
                ${isRaw ? `
                    <div class="sm-eb-tool-group sm-eb-tool-source">
                        <button type="button" data-tool="import" title="Add chats to Raws"><i class="fa-solid fa-file-import"></i><span>Add chats</span></button>
                        <button type="button" data-tool="names" title="Remove known speaker labels"><i class="fa-solid fa-user-minus"></i><span>Names</span></button>
                        <button type="button" data-tool="xml" title="Remove XML wrappers or blocks"><i class="fa-solid fa-code"></i><span>XML</span></button>
                    </div>` : ''}
                <div class="sm-eb-tool-group sm-eb-tool-markdown">
                    <button type="button" data-md="bold" title="Bold (Ctrl+B)"><i class="fa-solid fa-bold"></i></button>
                    <button type="button" data-md="italic" title="Italic (Ctrl+I)"><i class="fa-solid fa-italic"></i></button>
                    <button type="button" data-md="strike" title="Strikethrough"><i class="fa-solid fa-strikethrough"></i></button>
                    <button type="button" data-md="heading" title="Heading"><i class="fa-solid fa-heading"></i></button>
                    <button type="button" data-md="quote" title="Block quote"><i class="fa-solid fa-quote-left"></i></button>
                    <button type="button" data-md="link" title="Link (Ctrl+K)"><i class="fa-solid fa-link"></i></button>
                    <button type="button" data-md="separator" title="Separator"><i class="fa-solid fa-minus"></i></button>
                    <button type="button" data-tool="image" title="Insert a storyline image"><i class="fa-regular fa-image"></i></button>
                </div>
                ${isRaw ? `
                    <div class="sm-eb-tool-group sm-eb-tool-assign">
                        <button type="button" data-tool="undo-move" title="Undo the last chapter assignment" ${moveUndo ? '' : 'hidden'}><i class="fa-solid fa-rotate-left"></i></button>
                        <button type="button" class="sm-eb-assign-button" data-tool="assign" disabled>
                            <i class="fa-solid fa-arrow-right-long"></i><span>Assign to Chapter</span>
                        </button>
                    </div>` : ''}
            </div>
            <div class="sm-eb-editor-paper">
                <div class="sm-eb-paper-margin"><span>${isRaw ? 'RAW' : String(document.chapters.indexOf(chapter) + 1).padStart(2, '0')}</span></div>
                <textarea id="sm-eb-markdown-area" spellcheck="true" aria-label="${escapeAttr(isRaw ? 'Raw imported roleplay text' : chapter.title)}"
                    placeholder="${escapeAttr(isRaw ? 'Choose Add chats to import roleplay text…' : 'Begin this chapter…')}">${escapeHtml(text)}</textarea>
            </div>
        </div>`;

    const textarea = host.querySelector('#sm-eb-markdown-area');
    const toolbar = host.querySelector('#sm-eb-toolbar');
    const applyText = (next, selectionStart = null, selectionEnd = null) => {
        replaceTextarea(textarea, next, options, host, selectionStart, selectionEnd);
    };
    textarea.addEventListener('input', () => {
        setDocumentText(options, textarea.value);
        refreshMoveUndo(options, host);
        scheduleWordStat(host, textarea);
        updateAssignState(toolbar, textarea);
        options.onChange();
    });
    ['select', 'keyup', 'mouseup'].forEach(eventName => {
        textarea.addEventListener(eventName, () => updateAssignState(toolbar, textarea));
    });
    textarea.addEventListener('keydown', event => handleKeyboardShortcut(event, textarea, options, host));
    textarea.addEventListener('contextmenu', event => {
        if (!isRaw || textarea.selectionStart === textarea.selectionEnd) return;
        event.preventDefault();
        openAssignMenu(host, textarea, options, { x: event.clientX, y: event.clientY, context: true });
    });

    toolbar.querySelector('[data-tool="import"]')?.addEventListener('click', buttonEvent => openChatImporter(host, buttonEvent.currentTarget, textarea, options, applyText));
    toolbar.querySelector('[data-tool="names"]')?.addEventListener('click', () => stripNames(textarea, options, host));
    toolbar.querySelector('[data-tool="xml"]')?.addEventListener('click', event => openXmlCleaner(host, event.currentTarget, textarea, options, applyText));
    toolbar.querySelector('[data-tool="image"]')?.addEventListener('click', event => openImagePicker(host, event.currentTarget, textarea, options, applyText));
    const assignButton = toolbar.querySelector('[data-tool="assign"]');
    assignButton?.addEventListener('pointerdown', event => {
        // Keep the textarea focused so its selected passage remains visibly marked.
        event.preventDefault();
    });
    assignButton?.addEventListener('click', event => openAssignMenu(host, textarea, options, { anchor: event.currentTarget }));
    toolbar.querySelector('[data-tool="undo-move"]')?.addEventListener('click', () => undoLastMove(textarea, options, host));
    toolbar.querySelectorAll('[data-md]').forEach(button => {
        button.addEventListener('click', () => applyMarkdownCommand(button.dataset.md, textarea, options, host));
    });
    updateAssignState(toolbar, textarea);
}

function setDocumentText(options, value) {
    if (options.mode === 'raw') options.document.rawText = value;
    else options.chapter.content = value;
}

function updateWordStat(host, value) {
    const stat = host.querySelector('#sm-eb-current-words');
    if (stat) stat.textContent = countWords(value).toLocaleString();
}

function cancelScheduledWordCount() {
    clearTimeout(wordCountTimer);
    wordCountTimer = null;
    if (wordCountIdle !== null && globalThis.cancelIdleCallback) {
        globalThis.cancelIdleCallback(wordCountIdle);
    }
    wordCountIdle = null;
}

function scheduleWordStat(host, textarea) {
    cancelScheduledWordCount();
    wordCountTimer = setTimeout(() => {
        wordCountTimer = null;
        const count = () => {
            wordCountIdle = null;
            if (host.isConnected && textarea.isConnected) updateWordStat(host, textarea.value);
        };
        if (globalThis.requestIdleCallback) {
            wordCountIdle = globalThis.requestIdleCallback(count, { timeout: 350 });
        } else {
            count();
        }
    }, WORD_COUNT_DELAY);
}

function updateAssignState(toolbar, textarea) {
    const button = toolbar?.querySelector('[data-tool="assign"]');
    if (button) button.disabled = textarea.selectionStart === textarea.selectionEnd;
}

function refreshMoveUndo(options, host = null) {
    if (!moveUndo) return;
    const chapter = options.document.chapters.find(item => item.id === moveUndo.chapterId);
    if (canRestoreMove(moveUndo, options.document.rawText, chapter)) return;
    moveUndo = null;
    const undoButton = host?.querySelector('[data-tool="undo-move"]');
    if (undoButton) undoButton.hidden = true;
}

function replaceTextarea(textarea, next, options, host, selectionStart = null, selectionEnd = null) {
    textarea.value = next;
    setDocumentText(options, next);
    refreshMoveUndo(options, host);
    scheduleWordStat(host, textarea);
    options.onChange();
    if (selectionStart !== null) {
        textarea.focus();
        textarea.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
    }
    updateAssignState(host.querySelector('#sm-eb-toolbar'), textarea);
}

function applyMarkdownCommand(command, textarea, options, host) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    let result;
    if (command === 'bold') result = applyMarkdownWrap(text, start, end, '**', '**', 'bold text');
    if (command === 'italic') result = applyMarkdownWrap(text, start, end, '*', '*', 'italic text');
    if (command === 'strike') result = applyMarkdownWrap(text, start, end, '~~', '~~', 'struck text');
    if (command === 'link') result = applyMarkdownWrap(text, start, end, '[', '](https://)', 'link text');
    if (command === 'heading') {
        const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        result = { text: text.slice(0, lineStart) + '## ' + text.slice(lineStart), selectionStart: start + 3, selectionEnd: end + 3 };
    }
    if (command === 'quote') {
        const selected = text.slice(start, end) || 'quoted text';
        const replacement = selected.split('\n').map(line => `> ${line}`).join('\n');
        result = { text: text.slice(0, start) + replacement + text.slice(end), selectionStart: start + 2, selectionEnd: start + replacement.length };
    }
    if (command === 'separator') {
        const replacement = '\n\n---\n\n';
        result = { text: text.slice(0, start) + replacement + text.slice(end), selectionStart: start + replacement.length, selectionEnd: start + replacement.length };
    }
    if (!result) return;
    replaceTextarea(textarea, result.text, options, host, result.selectionStart, result.selectionEnd);
}

function handleKeyboardShortcut(event, textarea, options, host) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const commands = { b: 'bold', i: 'italic', k: 'link' };
    if (!commands[key]) return;
    event.preventDefault();
    applyMarkdownCommand(commands[key], textarea, options, host);
}

function allKnownSpeakers(document, storyline) {
    const speakers = new Set();
    for (const source of document.sources || []) {
        for (const name of source.speakers || []) speakers.add(name);
    }
    if (storyline.character?.name) speakers.add(storyline.character.name);
    if (storyline.character?.displayName) speakers.add(storyline.character.displayName);
    for (const persona of storyline.mainPersonas || []) {
        if (persona?.name) speakers.add(persona.name);
        else if (typeof persona === 'string') speakers.add(persona);
    }
    return [...speakers];
}

function transformRange(textarea, transform) {
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
    const start = hasSelection ? textarea.selectionStart : 0;
    const end = hasSelection ? textarea.selectionEnd : textarea.value.length;
    const nextPart = transform(textarea.value.slice(start, end));
    return {
        text: textarea.value.slice(0, start) + nextPart + textarea.value.slice(end),
        start,
        end: start + nextPart.length,
    };
}

function stripNames(textarea, options, host) {
    const result = transformRange(textarea, part => stripSpeakerLabels(part, allKnownSpeakers(options.document, options.storyline)));
    if (result.text === textarea.value) {
        notify('No known speaker labels were found.', 'info');
        return;
    }
    replaceTextarea(textarea, result.text, options, host, result.start, result.end);
    notify('Speaker labels removed.', 'success');
}

function openAssignMenu(host, textarea, options, position = {}) {
    if (textarea.selectionStart === textarea.selectionEnd) return;
    closeEditorMenus();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    const menu = document.createElement('div');
    menu.className = position.context ? 'sm-eb-context-menu' : 'sm-eb-popover sm-eb-assign-popover';
    menu.innerHTML = `
        <div class="sm-eb-assign-menu-title">Assign selection to</div>
        ${(options.document.chapters || []).map((chapter, index) => `
            <button type="button" data-chapter-id="${escapeAttr(chapter.id)}"><small>${String(index + 1).padStart(2, '0')}</small><span>${escapeHtml(chapter.title)}</span></button>`).join('')}
        <button type="button" class="sm-eb-assign-new" data-new-chapter><i class="fa-solid fa-plus"></i><span>Create New Chapter…</span></button>`;
    document.body.appendChild(menu);
    if (position.context) {
        menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 292, position.x))}px`;
        menu.style.top = `${Math.max(12, Math.min(window.innerHeight - 332, position.y))}px`;
    } else {
        positionEditorPopover(menu, position.anchor);
    }
    menu.querySelectorAll('[data-chapter-id]').forEach(button => {
        button.addEventListener('click', () => {
            const chapter = options.document.chapters.find(item => item.id === button.dataset.chapterId);
            if (chapter) moveSelectionToChapter(textarea, start, end, chapter, options, host);
            menu.remove();
        });
    });
    menu.querySelector('[data-new-chapter]').addEventListener('click', async () => {
        const chapter = await options.onCreateChapter();
        if (chapter) moveSelectionToChapter(textarea, start, end, chapter, options, host);
        menu.remove();
    });
}

function moveSelectionToChapter(textarea, start, end, chapter, options, host) {
    const selected = textarea.value.slice(start, end);
    if (!selected) return;
    const rawBefore = textarea.value;
    const chapterBefore = chapter.content;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const nextRaw = (before + after).replace(/\n{3,}/g, '\n\n');
    chapter.content = `${chapter.content.trimEnd()}${chapter.content.trim() ? '\n\n' : ''}${selected.trim()}`;
    moveUndo = createMoveUndoSnapshot({
        rawBefore,
        rawAfter: nextRaw,
        chapterId: chapter.id,
        chapterBefore,
        chapterAfter: chapter.content,
    });
    replaceTextarea(textarea, nextRaw, options, host, start, start);
    options.onStructureChange();
    const undoButton = host.querySelector('[data-tool="undo-move"]');
    if (undoButton) undoButton.hidden = false;
    notify(`Moved the selection to “${chapter.title}”.`, 'success');
}

function undoLastMove(textarea, options, host) {
    if (!moveUndo) return;
    const chapter = options.document.chapters.find(item => item.id === moveUndo.chapterId);
    const canRestore = canRestoreMove(moveUndo, textarea.value, chapter);
    if (!canRestore) {
        moveUndo = null;
        const undoButton = host.querySelector('[data-tool="undo-move"]');
        if (undoButton) undoButton.hidden = true;
        notify('Undo expired because Raws or the destination chapter changed.', 'warning');
        return;
    }
    chapter.content = moveUndo.chapterBefore;
    const nextRaw = moveUndo.rawBefore;
    moveUndo = null;
    replaceTextarea(textarea, nextRaw, options, host, nextRaw.length, nextRaw.length);
    options.onStructureChange();
    const undoButton = host.querySelector('[data-tool="undo-move"]');
    if (undoButton) undoButton.hidden = true;
    notify('Restored the last chapter assignment.', 'success');
}

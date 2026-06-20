/** Chat import, XML cleanup, and storyline image menus for the editor. */

import { getChatMessages } from '../../stContext.js';
import { escapeAttr, escapeHtml, logError } from '../../display/util.js';
import { hashText, makeImageAsset } from '../model.js';
import { findXmlTags, imageMarker, removeXmlMarkup } from '../markdown.js';
import { notify, showChoiceDialog } from '../ui.js';
import { filterImportableMessages, formatImportedMessages } from './importMessages.js';

export function closeEditorMenus() {
    document.querySelectorAll('.sm-eb-popover, .sm-eb-context-menu').forEach(menu => menu.remove());
}

export function positionEditorPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(16, Math.min(window.innerWidth - 380, rect.left))}px`;
    popover.style.top = `${Math.max(12, Math.min(window.innerHeight - 420, rect.bottom + 8))}px`;
}

export function openChatImporter(host, anchor, textarea, options, applyText) {
    closeEditorMenus();
    const chats = [...(options.storyline.chats || [])].sort((a, b) => (a.chronoOrder || 0) - (b.chronoOrder || 0));
    const imported = new Map((options.document.sources || []).map(source => [source.fileName, source]));
    const popover = document.createElement('div');
    popover.className = 'sm-eb-popover sm-eb-import-popover';
    popover.innerHTML = `
        <div class="sm-eb-popover-head"><div><strong>Add chats to Raws</strong><small>Imported in storyline order</small></div><button type="button" data-close>×</button></div>
        <div class="sm-eb-import-list">
            ${chats.length ? chats.map((chat, index) => `
                <label class="sm-eb-import-row${imported.has(chat.file_name) ? ' sm-eb-imported' : ''}">
                    <input type="checkbox" value="${escapeAttr(chat.file_name)}" ${imported.has(chat.file_name) ? '' : 'checked'}>
                    <span class="sm-eb-import-order">${String(index + 1).padStart(2, '0')}</span>
                    <span><strong>${escapeHtml(String(chat.file_name || '').replace(/\.jsonl$/i, ''))}</strong><small>${imported.has(chat.file_name) ? 'Already imported · select to reimport' : 'Ready to import'}</small></span>
                    ${imported.has(chat.file_name) ? '<i class="fa-solid fa-check"></i>' : ''}
                </label>`).join('') : '<div class="sm-eb-popover-empty">This storyline has no chats.</div>'}
        </div>
        <div class="sm-eb-import-options">
            <label class="sm-eb-check-row sm-eb-import-names"><input type="checkbox" data-include-names checked><span>Include speaker names</span></label>
            <label class="sm-eb-check-row"><input type="checkbox" data-include-system><span>Include system messages</span></label>
        </div>
        <div class="sm-eb-popover-actions"><button type="button" data-close>Cancel</button><button type="button" class="sm-eb-button-primary" data-import ${chats.length ? '' : 'disabled'}><i class="fa-solid fa-plus"></i> Add Selected</button></div>`;
    document.body.appendChild(popover);
    positionEditorPopover(popover, anchor);
    popover.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => popover.remove()));
    popover.querySelector('[data-import]')?.addEventListener('click', async event => {
        const selectedNames = new Set([...popover.querySelectorAll('.sm-eb-import-row input:checked')].map(input => input.value));
        if (!selectedNames.size) {
            notify('Choose at least one chat.', 'info');
            return;
        }
        const reimports = [...selectedNames].filter(name => imported.has(name));
        if (reimports.length) {
            const choice = await showChoiceDialog({
                title: 'Reimport selected chats?',
                message: 'Their text will be appended again. Text already moved into chapters will not be replaced.',
                choices: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'reimport', label: 'Append Again', primary: true },
                ],
            });
            if (choice !== 'reimport') return;
        }
        const button = event.currentTarget;
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Importing';
        const includeNames = popover.querySelector('[data-include-names]').checked;
        const includeSystemMessages = popover.querySelector('[data-include-system]').checked;
        const appendedParts = [];
        const sourceUpdates = [];
        try {
            for (const chat of chats.filter(item => selectedNames.has(item.file_name))) {
                const messages = await getChatMessages(chat.avatar || options.storyline.character?.avatar, chat.file_name);
                if (!messages.length) continue;
                const importedMessages = filterImportableMessages(messages, includeSystemMessages);
                const speakers = [...new Set(importedMessages.map(message => String(message.name || '').trim()).filter(Boolean))];
                const content = formatImportedMessages(messages, { includeNames, includeSystemMessages });
                if (!content) continue;
                appendedParts.push(content);
                sourceUpdates.push({
                    fileName: chat.file_name,
                    importedAt: Date.now(),
                    hash: hashText(content),
                    messageCount: importedMessages.length,
                    speakers,
                });
            }
            if (!appendedParts.length) {
                notify('No readable messages were found in the selected chats.', 'warning');
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-plus"></i> Add Selected';
                return;
            }
            const nextSources = [...options.document.sources];
            for (const source of sourceUpdates) {
                const existingIndex = nextSources.findIndex(item => item.fileName === source.fileName);
                if (existingIndex >= 0) nextSources[existingIndex] = source;
                else nextSources.push(source);
            }
            const appended = appendedParts.join('\n\n');
            const next = `${textarea.value.trimEnd()}${textarea.value.trim() ? '\n\n' : ''}${appended}`;
            const previousSources = options.document.sources;
            options.document.sources = nextSources;
            try {
                applyText(next, next.length, next.length);
            } catch (error) {
                options.document.sources = previousSources;
                throw error;
            }
            options.onStructureChange();
            notify(`Added ${sourceUpdates.length} chat${sourceUpdates.length === 1 ? '' : 's'} to Raws.`, 'success');
            popover.remove();
        } catch (error) {
            logError('Chat import failed:', error);
            notify('A chat could not be imported.', 'error');
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-plus"></i> Add Selected';
        }
    });
}

export function openXmlCleaner(host, anchor, textarea, options, applyText) {
    closeEditorMenus();
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
    const sample = hasSelection ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : textarea.value;
    const tags = findXmlTags(sample);
    if (!tags.length) {
        notify('No XML-style tags were found.', 'info');
        return;
    }
    const popover = document.createElement('div');
    popover.className = 'sm-eb-popover sm-eb-xml-popover';
    popover.innerHTML = `
        <div class="sm-eb-popover-head"><div><strong>XML cleanup</strong><small>${hasSelection ? 'Applies to the selection' : 'Applies to all Raws'}</small></div><button type="button" data-close>×</button></div>
        <div class="sm-eb-xml-tags">${tags.map(tag => `<label><input type="checkbox" value="${escapeAttr(tag)}" checked><code>&lt;${escapeHtml(tag)}&gt;</code></label>`).join('')}</div>
        <p class="sm-eb-popover-note">Keep contents removes only the wrappers. Remove blocks deletes the tags and everything inside them.</p>
        <div class="sm-eb-popover-actions sm-eb-xml-actions"><button type="button" data-mode="wrappers">Keep Contents</button><button type="button" class="sm-eb-button-primary" data-mode="blocks">Remove Blocks</button></div>`;
    document.body.appendChild(popover);
    positionEditorPopover(popover, anchor);
    popover.querySelector('[data-close]').addEventListener('click', () => popover.remove());
    popover.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
        const selectedTags = [...popover.querySelectorAll('input:checked')].map(input => input.value);
        if (!selectedTags.length) return;
        const result = transformRange(textarea, part => removeXmlMarkup(part, selectedTags, button.dataset.mode === 'blocks'));
        applyText(result.text, result.start, result.end);
        notify(button.dataset.mode === 'blocks' ? 'Selected XML blocks removed.' : 'Selected XML wrappers removed.', 'success');
        popover.remove();
    }));
}

export function openImagePicker(host, anchor, textarea, options, applyText) {
    closeEditorMenus();
    const images = collectStorylineImages(options.storyline);
    if (!images.length) {
        notify('No chat images are assigned to this storyline.', 'info');
        return;
    }
    const popover = document.createElement('div');
    popover.className = 'sm-eb-popover sm-eb-image-popover';
    popover.innerHTML = `
        <div class="sm-eb-popover-head"><div><strong>Insert image</strong><small>${images.length} storyline image${images.length === 1 ? '' : 's'}</small></div><button type="button" data-close>×</button></div>
        <div class="sm-eb-image-placement"><label>Placement</label><select><option value="inline">Inline</option><option value="center" selected>Centered</option><option value="wide">Wide</option></select></div>
        <div class="sm-eb-image-grid">${images.map((image, index) => `
            <button type="button" data-image-index="${index}" title="${escapeAttr(image.caption || image.chatName)}">
                <img src="${escapeAttr(image.thumb || image.src)}" alt=""><span>${escapeHtml(image.caption || image.chatName)}</span>
            </button>`).join('')}</div>`;
    document.body.appendChild(popover);
    positionEditorPopover(popover, anchor);
    popover.querySelector('[data-close]').addEventListener('click', () => popover.remove());
    popover.querySelectorAll('[data-image-index]').forEach(button => button.addEventListener('click', () => {
        const image = images[Number(button.dataset.imageIndex)];
        let asset = options.document.assets.find(item => item.src === image.src);
        if (!asset) {
            asset = makeImageAsset(image);
            options.document.assets.push(asset);
        }
        const marker = imageMarker(asset.id, popover.querySelector('select').value);
        const start = textarea.selectionStart;
        const next = textarea.value.slice(0, start) + `\n\n${marker}\n\n` + textarea.value.slice(textarea.selectionEnd);
        const caret = start + marker.length + 4;
        applyText(next, caret, caret);
        popover.remove();
    }));
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

function collectStorylineImages(storyline) {
    const seen = new Set();
    const results = [];
    const chats = [...(storyline.chats || [])].sort((a, b) => (a.chronoOrder || 0) - (b.chronoOrder || 0));
    for (const chat of chats) {
        const images = chat.images?.length ? chat.images : (chat.image ? [{ src: chat.image, thumb: chat.imageThumb, caption: '' }] : []);
        for (const image of images) {
            if (!image?.src || seen.has(image.src)) continue;
            seen.add(image.src);
            results.push({ ...image, chatName: String(chat.file_name || '').replace(/\.jsonl$/i, '') });
        }
    }
    return results;
}

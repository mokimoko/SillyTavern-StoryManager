/** Chapter creation, naming, deletion, and ordering for the editor. */

import { createChapter } from '../model.js';
import { showChoiceDialog, showTextPrompt } from '../ui.js';

export function createChapterActions(options) {
    async function addChapter() {
        const document = options.getDocument();
        if (!document) return;
        const name = await showTextPrompt({
            title: 'Create a chapter',
            placeholder: `Chapter ${document.chapters.length + 1}`,
            confirmLabel: 'Create Chapter',
        });
        if (!name) return;
        const chapter = createChapter(name);
        document.chapters.push(chapter);
        options.setActiveView({ type: 'chapter', id: chapter.id });
        options.onDirty();
        options.renderEditor();
    }

    async function createFromEditor(name = '') {
        const document = options.getDocument();
        if (!document) return null;
        let title = String(name || '').trim();
        if (!title) {
            title = await showTextPrompt({
                title: 'Create and assign',
                message: 'The selected text will be moved into this chapter.',
                placeholder: `Chapter ${document.chapters.length + 1}`,
                confirmLabel: 'Create Chapter',
            });
        }
        if (!title) return null;
        const chapter = createChapter(title);
        document.chapters.push(chapter);
        options.onDirty();
        return chapter;
    }

    async function renameChapter(id) {
        const document = options.getDocument();
        const chapter = document?.chapters.find(item => item.id === id);
        if (!chapter) return;
        const title = await showTextPrompt({ title: 'Rename chapter', value: chapter.title });
        if (!title || title === chapter.title) return;
        chapter.title = title;
        options.onDirty();
        options.renderEditor();
    }

    async function removeChapter(id) {
        const document = options.getDocument();
        const chapter = document?.chapters.find(item => item.id === id);
        if (!chapter) return;
        const choice = await showChoiceDialog({
            title: 'Delete this chapter?',
            message: chapter.content.trim()
                ? `“${chapter.title}” contains text. Deleting it cannot be undone after you leave this editor.`
                : `Remove “${chapter.title}”?`,
            choices: [
                { id: 'cancel', label: 'Keep Chapter' },
                { id: 'delete', label: 'Delete Chapter', danger: true },
            ],
        });
        if (choice !== 'delete') return;
        document.chapters = document.chapters.filter(item => item.id !== id);
        if (options.getActiveView()?.id === id) options.setActiveView({ type: 'raw', id: null });
        options.onDirty();
        options.renderEditor();
    }

    function reorderChapter(sourceId, targetId) {
        if (!sourceId || sourceId === targetId) return;
        const document = options.getDocument();
        if (!document) return;
        const from = document.chapters.findIndex(item => item.id === sourceId);
        const to = document.chapters.findIndex(item => item.id === targetId);
        if (from < 0 || to < 0) return;
        const [chapter] = document.chapters.splice(from, 1);
        document.chapters.splice(to, 0, chapter);
        options.onDirty();
        options.renderNavigation();
    }

    return { addChapter, createFromEditor, renameChapter, removeChapter, reorderChapter };
}

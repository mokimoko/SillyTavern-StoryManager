/** Chapter and workspace navigation for the ebook editor. */

import { escapeAttr, escapeHtml } from '../../display/util.js';
import { countWords } from '../model.js';

let draggedChapterId = null;

export function renderEditorNavigation(host, options) {
    const { document, activeView } = options;
    host.innerHTML = `
        <div class="sm-eb-nav-top">
            ${navLink(activeView, 'raw', null, 'fa-align-left', 'Raws', countWords(document.rawText))}
            ${navLink(activeView, 'style', null, 'fa-feather-pointed', 'Style', null)}
        </div>
        <div class="sm-eb-nav-section-head">
            <span>Chapters</span>
            <button type="button" id="sm-eb-add-chapter" title="Add chapter"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="sm-eb-chapter-list" id="sm-eb-chapter-list">
            ${document.chapters.length
                ? document.chapters.map((chapter, index) => chapterNavItem(chapter, index, activeView)).join('')
                : `<div class="sm-eb-chapter-empty"><i class="fa-regular fa-file-lines"></i><span>No chapters yet</span></div>`}
        </div>
        <div class="sm-eb-nav-footer">
            <span>${document.chapters.length} chapter${document.chapters.length === 1 ? '' : 's'}</span>
            <span>${document.chapters.reduce((sum, item) => sum + countWords(item.content), 0).toLocaleString()} words</span>
        </div>`;

    host.querySelectorAll('.sm-eb-nav-link[data-view]').forEach(link => {
        link.addEventListener('click', () => {
            options.onSelectView?.({ type: link.dataset.view, id: link.dataset.id || null });
        });
    });
    host.querySelector('#sm-eb-add-chapter')?.addEventListener('click', () => options.onAddChapter?.());
    wireChapterRows(host, options);
}

function navLink(activeView, type, id, icon, label, words) {
    const active = activeView.type === type && (!id || activeView.id === id);
    return `
        <button type="button" class="sm-eb-nav-link${active ? ' sm-eb-nav-link-active' : ''}"
            data-view="${escapeAttr(type)}" ${id ? `data-id="${escapeAttr(id)}"` : ''}>
            <i class="fa-solid ${escapeAttr(icon)}"></i>
            <span>${escapeHtml(label)}</span>
            ${Number.isFinite(words) ? `<small>${Number(words).toLocaleString()}</small>` : ''}
        </button>`;
}

function chapterNavItem(chapter, index, activeView) {
    const active = activeView.type === 'chapter' && activeView.id === chapter.id;
    return `
        <div class="sm-eb-chapter-nav${active ? ' sm-eb-chapter-nav-active' : ''}"
            data-chapter-id="${escapeAttr(chapter.id)}" draggable="true">
            <span class="sm-eb-chapter-drag" title="Drag to reorder"><i class="fa-solid fa-grip-lines"></i></span>
            <button type="button" class="sm-eb-chapter-open">
                <small>${String(index + 1).padStart(2, '0')}</small>
                <span>${escapeHtml(chapter.title)}</span>
                <em>${countWords(chapter.content).toLocaleString()}</em>
            </button>
            <div class="sm-eb-chapter-actions">
                <button type="button" class="sm-eb-chapter-rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="sm-eb-chapter-delete" title="Delete"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`;
}

function wireChapterRows(host, options) {
    host.querySelectorAll('.sm-eb-chapter-nav').forEach(row => {
        const id = row.dataset.chapterId;
        row.querySelector('.sm-eb-chapter-open')?.addEventListener('click', () => {
            options.onSelectView?.({ type: 'chapter', id });
        });
        row.querySelector('.sm-eb-chapter-rename')?.addEventListener('click', () => options.onRenameChapter?.(id));
        row.querySelector('.sm-eb-chapter-delete')?.addEventListener('click', () => options.onRemoveChapter?.(id));
        row.addEventListener('dragstart', event => {
            draggedChapterId = id;
            row.classList.add('sm-eb-chapter-dragging');
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
            draggedChapterId = null;
            row.classList.remove('sm-eb-chapter-dragging');
        });
        row.addEventListener('dragover', event => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        row.addEventListener('drop', event => {
            event.preventDefault();
            options.onReorderChapter?.(draggedChapterId, id);
        });
    });
}

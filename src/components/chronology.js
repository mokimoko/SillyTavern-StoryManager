/**
 * components/chronology.js — in-universe chat ordering for a storyline
 *
 * Renders the storyline's chats as a vertically draggable list. Each row shows the
 * chat file name, a drag handle, a freeform chronoLabel input ("Spring, Year 412",
 * "Third Cycle", "2 days later"), and a blurb field (with optional LLM generation).
 *
 * The component sorts a working copy by chronoOrder for display. Drag-reordering
 * rewrites chronoOrder to match the new visual order (0..n-1) and calls onReorder
 * with the reordered file-name list. Editing a label calls onLabelChange.
 *
 * The row is ALL-TEXT: a chat's image(s) are managed in the modal's Chat Details
 * gallery editor, not here. The representative "cover" is derived from that gallery
 * (see display/util.js coverImage()), so there is no per-chat image control here.
 *
 * Export: renderChronology(container, chats, onReorder, onLabelChange, opts)
 *   - chats: the storyline.chats array (makeChatEntry shape)
 *   - onReorder(orderedFileNames: string[])
 *   - onLabelChange(fileName: string, label: string)
 *   - opts.onBlurbChange(fileName: string, blurb: string)
 *   - opts.onBlurbGenerate(fileName: string, statusEl: HTMLElement, inputEl: HTMLElement) — async
 *
 * Native HTML5 drag-and-drop (no external lib), consistent with the no-dependency
 * approach elsewhere in the extension.
 */
import { escapeHtml, escapeAttr } from '../display/util.js';

// ============================================================
// Render
// ============================================================

export function renderChronology(container, chats, onReorder, onLabelChange, opts = {}) {
    const sorted = [...(chats || [])].sort(
        (a, b) => (a.chronoOrder ?? 0) - (b.chronoOrder ?? 0),
    );

    if (!sorted.length) {
        container.innerHTML = `
            <div class="sm-empty">No chats assigned yet — assign chats to set their order.</div>`;
        return;
    }

    container.innerHTML = `
        <div class="sm-chrono-list">
            ${sorted.map((c, i) => itemHtml(c, i)).join('')}
        </div>
    `;

    wire(container, sorted, onReorder, onLabelChange, opts);
}

function itemHtml(chat, index) {
    const order = index + 1;
    return `
        <div class="sm-chrono-item" data-file="${escapeAttr(chat.file_name)}">
            <div class="sm-chrono-row" draggable="true"
                 data-file="${escapeAttr(chat.file_name)}" data-index="${index}">
                <i class="fa-solid fa-grip-vertical sm-chrono-handle" title="Drag to reorder"></i>
                <span class="sm-chrono-order">${order}</span>
                <div class="sm-chrono-main">
                    <div class="sm-chrono-file" title="${escapeAttr(chat.file_name)}">
                        ${escapeHtml(prettyName(chat.file_name))}
                    </div>
                    <input type="text" class="sm-input sm-chrono-label"
                           value="${escapeAttr(chat.chronoLabel || '')}"
                           placeholder="in-universe time (e.g. Spring, Year 412)" />
                    <div class="sm-chrono-blurb-row">
                        <input type="text" class="sm-input sm-chrono-blurb"
                               data-file="${escapeAttr(chat.file_name)}"
                               value="${escapeAttr(chat.blurb || '')}"
                               placeholder="blurb — a short line about this chat" />
                        <button type="button" class="sm-gen-btn sm-chrono-blurb-gen"
                                data-file="${escapeAttr(chat.file_name)}"
                                title="Generate blurb from chat content">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                        </button>
                    </div>
                    <div class="sm-gen-status sm-chrono-blurb-status" data-file="${escapeAttr(chat.file_name)}"></div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Wiring — drag reorder + label edit
// ============================================================

function wire(container, sorted, onReorder, onLabelChange, opts = {}) {
    const listEl = container.querySelector('.sm-chrono-list');
    if (!listEl) return;

    let dragFile = null;

    listEl.querySelectorAll('.sm-chrono-row').forEach(row => {
        row.addEventListener('dragstart', (e) => {
            dragFile = row.dataset.file;
            row.classList.add('sm-chrono-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('sm-chrono-dragging');
            listEl.querySelectorAll('.sm-chrono-row').forEach(r =>
                r.classList.remove('sm-chrono-over'));
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('sm-chrono-over');
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('sm-chrono-over');
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('sm-chrono-over');
            const targetFile = row.dataset.file;
            if (!dragFile || dragFile === targetFile) return;

            // Compute the new visual order, then hand the file-name list back.
            const order = [...listEl.querySelectorAll('.sm-chrono-row')]
                .map(r => r.dataset.file);
            const from = order.indexOf(dragFile);
            const to = order.indexOf(targetFile);
            order.splice(to, 0, order.splice(from, 1)[0]);
            onReorder?.(order);
        });
    });

    // Label edits commit on blur (and on Enter via blur()).
    listEl.querySelectorAll('.sm-chrono-label').forEach(input => {
        const row = input.closest('.sm-chrono-row');
        const file = row.dataset.file;
        input.addEventListener('change', () => onLabelChange?.(file, input.value.trim()));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });
    });

    // Blurb edits commit on blur / Enter.
    listEl.querySelectorAll('.sm-chrono-blurb').forEach(input => {
        const file = input.dataset.file;
        input.addEventListener('change', () => opts.onBlurbChange?.(file, input.value.trim()));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });
    });

    // Blurb generate buttons.
    listEl.querySelectorAll('.sm-chrono-blurb-gen').forEach(btn => {
        const file = btn.dataset.file;
        const item = btn.closest('.sm-chrono-item');
        const statusEl = item?.querySelector(`.sm-chrono-blurb-status[data-file="${CSS.escape(file)}"]`);
        const inputEl = item?.querySelector(`.sm-chrono-blurb[data-file="${CSS.escape(file)}"]`);

        btn.addEventListener('click', async () => {
            if (btn.disabled || !opts.onBlurbGenerate) return;
            await opts.onBlurbGenerate(file, statusEl, inputEl, btn);
        });
    });
}

// ============================================================
// Util
// ============================================================

/** Strip the .jsonl extension for display; keep the rest as-is. */
function prettyName(fileName) {
    return String(fileName).replace(/\.jsonl$/i, '');
}

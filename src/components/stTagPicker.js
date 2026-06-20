/**
 * components/stTagPicker.js — ST character-card tag picker for Books
 *
 * Reads the live SillyTavern tags array and renders them as selectable
 * color-coded pills. Selected tag IDs are stored on the book as stTags[].
 * This links a book to the same tags used on character cards, enabling
 * cross-referencing between the ST tag system and StoryManager's library.
 *
 * Export: renderSTTagPicker(container, selectedIds, onChange)
 *   - selectedIds: string[] of ST tag IDs currently selected
 *   - onChange(ids): called with the updated array after every toggle
 */
import { getSTTags } from '../stContext.js';
import { escapeHtml, escapeAttr } from '../display/util.js';

// ============================================================
// Render
// ============================================================

export function renderSTTagPicker(container, selectedIds, onChange) {
    const allTags = getSTTags();
    const selected = new Set(selectedIds || []);

    if (!allTags.length) {
        container.innerHTML = `
            <div class="sm-sttag-picker">
                <div class="sm-tag-empty">No ST tags found — create tags on your character cards first.</div>
            </div>
        `;
        return;
    }

    // Split into selected-first, then alphabetical within each group.
    const sorted = [...allTags].sort((a, b) => {
        const aS = selected.has(a.id) ? 0 : 1;
        const bS = selected.has(b.id) ? 0 : 1;
        if (aS !== bS) return aS - bS;
        return a.name.localeCompare(b.name);
    });

    container.innerHTML = `
        <div class="sm-sttag-picker">
            <div class="sm-sttag-search">
                <input type="text" class="sm-input sm-sttag-filter"
                       placeholder="Filter tags…" />
            </div>
            <div class="sm-sttag-pills">
                ${sorted.map(tag => pillHtml(tag, selected.has(tag.id))).join('')}
            </div>
        </div>
    `;

    wireInteractions(container, selectedIds, onChange);
}

// ============================================================
// Pill HTML
// ============================================================

function pillHtml(tag, isSelected) {
    // Use the tag's own colors if set, otherwise fall back to a neutral default.
    const bg = tag.color || 'rgba(255,255,255,0.08)';
    const fg = tag.color2 || 'rgba(255,255,255,0.85)';
    const cls = isSelected ? 'sm-sttag-pill sm-sttag-selected' : 'sm-sttag-pill';
    return `
        <span class="${cls}" data-tag-id="${escapeAttr(tag.id)}"
              style="--sttag-bg: ${escapeAttr(bg)}; --sttag-fg: ${escapeAttr(fg)};"
              title="${escapeAttr(tag.name)}">
            ${isSelected ? '<i class="fa-solid fa-check sm-sttag-check"></i>' : ''}
            <span class="sm-sttag-label">${escapeHtml(tag.name)}</span>
        </span>
    `;
}

// ============================================================
// Interaction wiring
// ============================================================

function wireInteractions(container, selectedIds, onChange) {
    // Toggle a tag on/off.
    container.querySelectorAll('.sm-sttag-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const id = pill.dataset.tagId;
            const idx = selectedIds.indexOf(id);
            if (idx !== -1) {
                selectedIds.splice(idx, 1);
            } else {
                selectedIds.push(id);
            }
            renderSTTagPicker(container, selectedIds, onChange);
            onChange?.(selectedIds);
        });
    });

    // Live filter input.
    const filterInput = container.querySelector('.sm-sttag-filter');
    if (filterInput) {
        filterInput.addEventListener('input', () => {
            const q = filterInput.value.trim().toLowerCase();
            container.querySelectorAll('.sm-sttag-pill').forEach(pill => {
                const label = pill.querySelector('.sm-sttag-label')?.textContent?.toLowerCase() || '';
                pill.style.display = (!q || label.includes(q)) ? '' : 'none';
            });
        });
        // Preserve focus after re-render by re-focusing if it was active.
        if (document.activeElement?.classList?.contains('sm-sttag-filter')) {
            filterInput.focus();
        }
    }
}

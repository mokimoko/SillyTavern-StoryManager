/**
 * components/tagPicker.js — 4-type tag editor for StoryManager storylines
 *
 * Tag shape (matches makeStoryline().tags):
 *   {
 *     character: string[],                       // picked from getAllCharacters()
 *     persona:   string[],                       // picked from getAllPersonas()
 *     npc:       [{ name, avatar:null }],        // FREEFORM ONLY (no card picker)
 *     freeform:  string[]                        // plain text
 *   }
 *
 * Each type renders as a distinct, color-coded section. character/persona offer a
 * searchable dropdown of known identities; npc/freeform are plain text-add inputs.
 *
 * Export: renderTagPicker(container, tags, onChange)
 *   - tags is mutated in place AND passed to onChange(tags) after every edit so the
 *     caller can persist. The component re-renders itself on each change.
 */
// NPCs and freeform tags only. Character & persona tags are derived automatically
// from the storyline's primary character + main personas (see storylineTab's
// syncAutoTags), so they are no longer hand-edited here.
import { escapeHtml } from '../display/util.js';
const TYPES = [
    { key: 'npc',       label: 'NPCs',  icon: 'fa-users',   cls: 'sm-tag-npc',      mode: 'free', object: true },
    { key: 'freeform',  label: 'Tags',  icon: 'fa-hashtag', cls: 'sm-tag-freeform', mode: 'free' },
];

// ============================================================
// Normalization — npc entries are objects, the rest are strings
// ============================================================

function ensureShape(tags) {
    tags.character = Array.isArray(tags.character) ? tags.character : [];
    tags.persona = Array.isArray(tags.persona) ? tags.persona : [];
    tags.npc = Array.isArray(tags.npc) ? tags.npc : [];
    tags.freeform = Array.isArray(tags.freeform) ? tags.freeform : [];
    return tags;
}

/** Display label for a tag value (npc objects → their name). */
function labelOf(type, value) {
    if (type.object) return value?.name ?? '';
    return value;
}

/** Does `value` already exist in `list` for this type? (case-insensitive) */
function exists(type, list, value) {
    const needle = (type.object ? value.name : value).trim().toLowerCase();
    return list.some(v => labelOf(type, v).trim().toLowerCase() === needle);
}

// ============================================================
// Render
// ============================================================

export function renderTagPicker(container, tags, onChange) {
    ensureShape(tags);

    container.innerHTML = `
        <div class="sm-tagpicker">
            ${TYPES.map(type => renderSection(type, tags)).join('')}
        </div>
    `;

    wireSections(container, tags, onChange);
}

function renderSection(type, tags) {
    const list = tags[type.key];
    const pills = list.map((v, i) => `
        <span class="sm-tag-pill ${type.cls}" data-type="${type.key}" data-index="${i}">
            <span class="sm-tag-pill-text">${escapeHtml(labelOf(type, v))}</span>
            <i class="fa-solid fa-xmark sm-tag-remove" title="Remove"></i>
        </span>
    `).join('');

    return `
        <div class="sm-tag-section" data-type="${type.key}">
            <div class="sm-tag-section-label">
                <i class="fa-solid ${type.icon}"></i> ${type.label}
            </div>
            <div class="sm-tag-pills">${pills || `<span class="sm-tag-empty">none</span>`}</div>
            <div class="sm-tag-add">
                <input type="text" class="sm-input sm-tag-input"
                       data-type="${type.key}" placeholder="Add ${type.label.toLowerCase()}…" />
            </div>
        </div>
    `;
}

// ============================================================
// Wiring
// ============================================================

function wireSections(container, tags, onChange) {
    const commit = () => {
        // Re-render in place, then hand the mutated tags back to the caller.
        renderTagPicker(container, tags, onChange);
        onChange?.(tags);
    };

    // Remove a pill.
    container.querySelectorAll('.sm-tag-remove').forEach(el => {
        el.addEventListener('click', () => {
            const pill = el.closest('.sm-tag-pill');
            const key = pill.dataset.type;
            const index = parseInt(pill.dataset.index, 10);
            tags[key].splice(index, 1);
            commit();
        });
    });

    // Add via Enter on a type's input.
    container.querySelectorAll('.sm-tag-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const key = input.dataset.type;
            const type = TYPES.find(t => t.key === key);
            const raw = input.value.trim();
            if (!raw) return;

            const value = type.object ? { name: raw, avatar: null } : raw;
            if (!exists(type, tags[key], value)) {
                tags[key].push(value);
                commit();
            } else {
                input.value = '';
            }
        });
    });
}

/** Style and front-matter controls with a live edition preview. */

import { escapeAttr, escapeHtml } from '../../display/util.js';
import { ebookAccentId, formatEbookPageNumber } from '../model.js';

const CHAPTER_STYLES = Object.freeze([
    ['classic', 'Classic Rule'],
    ['minimal', 'Quiet Type'],
    ['folio', 'Grand Folio'],
    ['margin', 'Margin Line'],
    ['frame', 'Title Plate'],
]);

const ACCENT_OPTIONS = Object.freeze({
    dark: Object.freeze([
        ['antique-gold', 'Antique Gold'],
        ['moon-silver', 'Moon Silver'],
        ['rose-copper', 'Rose Copper'],
        ['sage', 'Moonlit Sage'],
        ['dust-blue', 'Dust Blue'],
    ]),
    light: Object.freeze([
        ['vellum-bronze', 'Vellum Bronze'],
        ['terracotta', 'Terracotta'],
        ['forest', 'Forest Ink'],
        ['ink-blue', 'Oxford Blue'],
        ['muted-plum', 'Muted Plum'],
    ]),
});

export function renderStylePanel(host, { document, storyline, onChange }) {
    const style = document.style;
    const front = document.frontMatter;
    host.innerHTML = `
        <div class="sm-eb-style-workspace">
            <div class="sm-eb-workspace-intro">
                <span class="sm-eb-workspace-eyebrow">Edition design</span>
                <h2>Style the reading experience</h2>
                <p>These choices affect the finished reader, never your Markdown manuscript.</p>
            </div>
            <div class="sm-eb-style-layout">
                <div class="sm-eb-style-controls">
                    <section class="sm-eb-style-card">
                        <div class="sm-eb-style-card-title"><span>01</span><div><h3>Page</h3><p>Paper, headings, and numbering</p></div></div>
                        <div class="sm-eb-field">
                            <label>Reader theme</label>
                            <div class="sm-eb-segmented" data-setting="theme">
                                ${segment('dark', 'Moonlit', style.theme === 'dark', 'fa-moon')}
                                ${segment('light', 'Ivory', style.theme === 'light', 'fa-sun')}
                            </div>
                        </div>
                        <div class="sm-eb-field-row">
                            ${selectField('chapterStyle', 'Chapter heading', style.chapterStyle, CHAPTER_STYLES)}
                            ${selectField('dropCap', 'Opening letter', style.dropCap, [
                                ['none', 'None'], ['classic', 'Classic Drop Cap'], ['boxed', 'Boxed Initial'],
                            ])}
                        </div>
                        ${selectField(
                            style.theme === 'light' ? 'lightAccent' : 'darkAccent',
                            'Accent color',
                            style.theme === 'light' ? style.lightAccent : style.darkAccent,
                            ACCENT_OPTIONS[style.theme === 'light' ? 'light' : 'dark'],
                        )}
                        <label class="sm-eb-switch-row">
                            <span><strong>Page numbers</strong><small>Shown only on manuscript pages</small></span>
                            <input type="checkbox" data-setting="pageNumbers" ${style.pageNumbers ? 'checked' : ''}>
                            <i></i>
                        </label>
                        <div class="sm-eb-field-row sm-eb-page-number-options${style.pageNumbers ? '' : ' sm-eb-control-disabled'}">
                            ${selectField('pageNumberPosition', 'Position', style.pageNumberPosition, [
                                ['center', 'Centered'], ['right', 'Outer Edge'],
                            ])}
                            ${selectField('pageNumberStyle', 'Design', style.pageNumberStyle, [
                                ['plain', 'Plain'], ['diamond', 'Diamond'], ['rule', 'Fine Rule'],
                                ['center-dots', 'Center Dots'], ['bracketed', 'Bracketed'], ['roman', 'Roman Numeral'],
                            ])}
                        </div>
                    </section>

                    <section class="sm-eb-style-card">
                        <div class="sm-eb-style-card-title"><span>02</span><div><h3>Front matter</h3><p>The quiet pages before Chapter One</p></div></div>
                        <label class="sm-eb-switch-row">
                            <span><strong>Title page</strong><small>Uses the storyline title</small></span>
                            <input type="checkbox" data-front="titlePage" ${front.titlePage ? 'checked' : ''}>
                            <i></i>
                        </label>
                        <div class="sm-eb-nested-fields${front.titlePage ? '' : ' sm-eb-control-disabled'}" data-front-section="titlePage">
                            <label class="sm-eb-switch-row sm-eb-switch-row-compact">
                                <span><strong>Edition line</strong><small>Optional imprint above the title</small></span>
                                <input type="checkbox" data-front="includeEditionLabel" ${front.includeEditionLabel ? 'checked' : ''}>
                                <i></i>
                            </label>
                            <div class="sm-eb-field${front.includeEditionLabel ? '' : ' sm-eb-control-disabled'}" data-front-section="includeEditionLabel">
                                <label>Edition line text</label>
                                <input type="text" data-front="editionLabel" value="${escapeAttr(front.editionLabel)}" placeholder="A StoryManager Edition">
                            </div>
                            <label class="sm-eb-switch-row sm-eb-switch-row-compact">
                                <span><strong>Include author</strong></span>
                                <input type="checkbox" data-front="includeAuthor" ${front.includeAuthor ? 'checked' : ''}>
                                <i></i>
                            </label>
                            <div class="sm-eb-field${front.includeAuthor ? '' : ' sm-eb-control-disabled'}" data-front-section="includeAuthor">
                                <label>Author name</label>
                                <input type="text" data-front="author" value="${escapeAttr(front.author)}" placeholder="Your name or pen name">
                            </div>
                        </div>
                        <label class="sm-eb-switch-row">
                            <span><strong>Epigraph</strong><small>A line, quotation, or short poem</small></span>
                            <input type="checkbox" data-front="epigraph" ${front.epigraph ? 'checked' : ''}>
                            <i></i>
                        </label>
                        <div class="sm-eb-nested-fields${front.epigraph ? '' : ' sm-eb-control-disabled'}" data-front-section="epigraph">
                            <div class="sm-eb-field">
                                <label>Epigraph text</label>
                                <textarea data-front="epigraphText" rows="4" placeholder="Type the epigraph…">${escapeHtml(front.epigraphText)}</textarea>
                            </div>
                            <label class="sm-eb-check-row">
                                <input type="checkbox" data-front="epigraphIsQuote" ${front.epigraphIsQuote ? 'checked' : ''}>
                                <span>Treat this as a quote or poem</span>
                            </label>
                            <div class="sm-eb-field${front.epigraphIsQuote ? '' : ' sm-eb-control-disabled'}" data-front-section="epigraphIsQuote">
                                <label>Attribution</label>
                                <input type="text" data-front="epigraphAttribution" value="${escapeAttr(front.epigraphAttribution)}" placeholder="— Author or source">
                            </div>
                        </div>
                    </section>
                </div>
                <aside class="sm-eb-style-preview" id="sm-eb-style-preview"></aside>
            </div>
        </div>`;

    host.querySelectorAll('.sm-eb-segmented button').forEach(button => {
        button.addEventListener('click', () => {
            const setting = button.closest('[data-setting]').dataset.setting;
            document.style[setting] = button.dataset.value;
            onChange();
            rerenderKeepingScroll(host, { document, storyline, onChange });
        });
    });
    host.querySelectorAll('select[data-setting], input[data-setting]').forEach(control => {
        control.addEventListener('change', () => {
            document.style[control.dataset.setting] = control.type === 'checkbox' ? control.checked : control.value;
            onChange();
            rerenderKeepingScroll(host, { document, storyline, onChange });
        });
    });
    host.querySelectorAll('input[data-front], textarea[data-front]').forEach(control => {
        const eventName = ['text', 'textarea'].includes(control.type) || control.tagName === 'TEXTAREA' ? 'input' : 'change';
        control.addEventListener(eventName, () => {
            document.frontMatter[control.dataset.front] = control.type === 'checkbox' ? control.checked : control.value;
            onChange();
            syncFrontMatterControls(host, document.frontMatter);
            updatePreview(host, document, storyline);
        });
    });
    syncFrontMatterControls(host, front);
    updatePreview(host, document, storyline);
}

function syncFrontMatterControls(host, front) {
    host.querySelectorAll('[data-front-section]').forEach(section => {
        section.classList.toggle('sm-eb-control-disabled', !front[section.dataset.frontSection]);
    });
}

function rerenderKeepingScroll(host, options) {
    const scroller = host.closest('.sm-eb-editor-workspace');
    const scrollTop = scroller?.scrollTop || 0;
    renderStylePanel(host, options);
    if (scroller) scroller.scrollTop = scrollTop;
}

function segment(value, label, active, icon) {
    return `<button type="button" data-value="${escapeAttr(value)}" class="${active ? 'sm-eb-segment-active' : ''}">
        <i class="fa-solid ${escapeAttr(icon)}"></i>${escapeHtml(label)}
    </button>`;
}

function selectField(key, label, value, options) {
    return `<div class="sm-eb-field">
        <label>${escapeHtml(label)}</label>
        <select data-setting="${escapeAttr(key)}">
            ${options.map(([optionValue, optionLabel]) => `<option value="${escapeAttr(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}
        </select>
    </div>`;
}

function updatePreview(host, document, storyline) {
    const preview = host.querySelector('#sm-eb-style-preview');
    if (!preview) return;
    const style = document.style;
    const front = document.frontMatter;
    const specimenPageNumber = formatEbookPageNumber(12, style.pageNumberStyle);
    preview.innerHTML = `
        <div class="sm-eb-preview-caption"><span>Live specimen</span><small>${style.theme === 'light' ? 'Ivory' : 'Moonlit'} edition</small></div>
        <div class="sm-eb-preview-page sm-eb-preview-${escapeAttr(style.theme)} sm-eb-preview-heading-${escapeAttr(style.chapterStyle)}" data-accent="${escapeAttr(ebookAccentId(style))}">
            <div class="sm-eb-preview-grain"></div>
            <div class="sm-eb-preview-heading">
                <span class="sm-eb-preview-chapter-number" aria-hidden="true">1</span>
                <small>Chapter One</small>
                <h3>${escapeHtml(document.chapters[0]?.title || 'A Door Left Open')}</h3>
                <i></i>
            </div>
            <p class="sm-eb-preview-prose sm-eb-preview-drop-${escapeAttr(style.dropCap)}">${escapeHtml(previewSentence(front, storyline))}</p>
            ${style.pageNumbers ? `<div class="sm-eb-preview-number sm-eb-preview-number-${escapeAttr(style.pageNumberPosition)} sm-eb-preview-number-${escapeAttr(style.pageNumberStyle)}">${escapeHtml(specimenPageNumber)}</div>` : ''}
        </div>
        <p class="sm-eb-preview-note">The reader repaginates automatically for the available screen size.</p>`;
}

function previewSentence(front, storyline) {
    if (front.epigraph && front.epigraphText.trim()) return front.epigraphText.trim();
    return `${storyline?.title || 'This story'} begins again here, preserved in the words that first gave it life.`;
}

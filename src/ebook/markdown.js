/** Markdown editing and safe reader rendering helpers. */

import { escapeAttr, escapeHtml } from '../display/util.js';
import { EBOOK_CHAPTER_STYLES } from './model.js';

export const IMAGE_MARKER_REGEX = /\[storymanager-image:([a-zA-Z0-9_-]+)\|(inline|center|wide)\]/g;

let converter = null;

function getConverter() {
    if (converter) return converter;
    if (globalThis.showdown?.Converter) {
        converter = new globalThis.showdown.Converter({
            simpleLineBreaks: false,
            strikethrough: true,
            tables: true,
            literalMidWordUnderscores: true,
            disableForced4SpacesIndentedSublists: true,
        });
    }
    return converter;
}

function escapeRawHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function imageFigure(asset, alignment) {
    if (!asset?.src) return '';
    const caption = String(asset.caption || '').trim();
    return `<figure class="sm-eb-figure sm-eb-figure-${escapeAttr(alignment)}">
        <img src="${escapeAttr(asset.src)}" alt="${escapeAttr(caption)}" loading="eager">
        ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}
    </figure>`;
}

function sanitizeRenderedHtml(html) {
    if (globalThis.DOMPurify?.sanitize) {
        return globalThis.DOMPurify.sanitize(html, {
            ADD_ATTR: ['class', 'loading'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
        });
    }

    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();
            if (name.startsWith('on') || name === 'style') node.removeAttribute(attribute.name);
            if ((name === 'href' || name === 'src') && !/^(?:https?:|\/|#|data:image\/)/i.test(value)) {
                node.removeAttribute(attribute.name);
            }
        }
    });
    return template.innerHTML;
}

export function imageMarker(assetId, alignment = 'center') {
    const safeId = String(assetId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const safeAlignment = ['inline', 'center', 'wide'].includes(alignment) ? alignment : 'center';
    return safeId ? `[storymanager-image:${safeId}|${safeAlignment}]` : '';
}

export function renderMarkdown(markdown = '', assets = []) {
    const assetMap = new Map((assets || []).map(asset => [String(asset.id), asset]));
    const placeholders = [];
    let source = String(markdown || '').replace(IMAGE_MARKER_REGEX, (_match, id, alignment) => {
        const asset = assetMap.get(String(id));
        if (!asset) return '';
        const token = `SMEBOOKIMAGEPLACEHOLDER${placeholders.length}END`;
        placeholders.push({ token, html: imageFigure(asset, alignment) });
        return `\n\n${token}\n\n`;
    });
    source = escapeRawHtml(source);
    const md = getConverter();
    let html = md ? md.makeHtml(source) : escapeHtml(source).replace(/\n/g, '<br>');
    for (const placeholder of placeholders) {
        const paragraphToken = `<p>${placeholder.token}</p>`;
        html = html.replace(paragraphToken, placeholder.html).replace(placeholder.token, placeholder.html);
    }
    return sanitizeRenderedHtml(html);
}

export function renderChapterHtml(document, chapter, index) {
    const style = document?.style || {};
    const headingStyle = EBOOK_CHAPTER_STYLES.includes(style.chapterStyle)
        ? style.chapterStyle
        : 'classic';
    return `
        <article class="sm-eb-chapter sm-eb-chapter-${headingStyle}">
            <header class="sm-eb-chapter-heading">
                <span class="sm-eb-chapter-number" aria-hidden="true">${index + 1}</span>
                <span class="sm-eb-chapter-kicker">Chapter ${index + 1}</span>
                <h1>${escapeHtml(chapter?.title || `Chapter ${index + 1}`)}</h1>
                <span class="sm-eb-chapter-mark" aria-hidden="true"></span>
            </header>
            <div class="sm-eb-prose sm-eb-dropcap-${escapeAttr(style.dropCap || 'none')}">
                ${renderMarkdown(chapter?.content || '', document?.assets || [])}
            </div>
        </article>`;
}

export function stripSpeakerLabels(text, speakers = []) {
    const names = [...new Set((speakers || []).map(String).map(s => s.trim()).filter(Boolean))];
    if (!names.length) return String(text || '');
    const escaped = names
        .sort((a, b) => b.length - a.length)
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`^(${escaped.join('|')}):[ \\t]*`, 'gmi');
    return String(text || '').replace(pattern, '');
}

export function findXmlTags(text = '') {
    const tags = new Set();
    const regex = /<([A-Za-z][\w:.-]*)\b[^>]*>/g;
    for (const match of String(text || '').matchAll(regex)) tags.add(match[1]);
    return [...tags].sort((a, b) => a.localeCompare(b));
}

export function removeXmlMarkup(text, tags = [], removeBlocks = false) {
    let result = String(text || '');
    for (const rawTag of tags) {
        const tag = String(rawTag || '').trim();
        if (!tag) continue;
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (removeBlocks) {
            const block = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}\\s*>`, 'gi');
            result = result.replace(block, '');
        } else {
            const wrappers = new RegExp(`<\\/?${escaped}\\b[^>]*>`, 'gi');
            result = result.replace(wrappers, '');
        }
    }
    return result.replace(/\n{3,}/g, '\n\n');
}

export function applyMarkdownWrap(text, start, end, prefix, suffix = prefix, placeholder = 'text') {
    const source = String(text || '');
    const safeStart = Math.max(0, Math.min(source.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(source.length, Number(end) || safeStart));
    const selected = source.slice(safeStart, safeEnd) || placeholder;
    const replacement = `${prefix}${selected}${suffix}`;
    return {
        text: source.slice(0, safeStart) + replacement + source.slice(safeEnd),
        selectionStart: safeStart + prefix.length,
        selectionEnd: safeStart + prefix.length + selected.length,
    };
}

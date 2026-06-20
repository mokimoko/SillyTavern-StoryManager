/** CSS-column pagination plan for the two-page reader. */

import { renderChapterHtml } from '../markdown.js';

export const PAGE_COLUMN_GAP = 12;
const IMAGE_PRELOAD_BUDGET_MS = 5000;

function paginationAbortError() {
    const error = new Error('Pagination cancelled.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw paginationAbortError();
}

function imageSourcesFromHtml(chapters = []) {
    const sources = new Set();
    const decoder = document.createElement('textarea');
    const pattern = /<img\b[^>]*\bsrc=(['"])(.*?)\1/gi;
    for (const html of chapters) {
        for (const match of String(html || '').matchAll(pattern)) {
            decoder.innerHTML = match[2];
            const source = decoder.value.trim();
            if (source) sources.add(source);
        }
    }
    return [...sources];
}

/** Warm all unique images under one book-wide deadline. */
async function preloadImages(sources, signal) {
    throwIfAborted(signal);
    if (!sources.length || !globalThis.Image) return;
    await new Promise((resolve, reject) => {
        let remaining = sources.length;
        let finished = false;
        const cleanups = [];
        const finish = error => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            cleanups.splice(0).forEach(cleanup => cleanup());
            if (error) reject(error);
            else resolve();
        };
        const settleOne = () => {
            remaining--;
            if (remaining <= 0) finish();
        };
        const onAbort = () => finish(paginationAbortError());
        const timer = setTimeout(() => finish(), IMAGE_PRELOAD_BUDGET_MS);
        signal?.addEventListener('abort', onAbort, { once: true });

        for (const source of sources) {
            const image = new globalThis.Image();
            let settled = false;
            const settle = () => {
                if (settled || finished) return;
                settled = true;
                image.removeEventListener('load', settle);
                image.removeEventListener('error', settle);
                settleOne();
            };
            cleanups.push(() => {
                image.removeEventListener('load', settle);
                image.removeEventListener('error', settle);
            });
            image.addEventListener('load', settle);
            image.addEventListener('error', settle);
            image.src = source;
            if (image.complete) settle();
        }
    });
    throwIfAborted(signal);
}

async function measureChapter(viewportTemplate, html, signal) {
    throwIfAborted(signal);
    const width = Math.max(240, Math.round(viewportTemplate.clientWidth));
    const height = Math.max(320, Math.round(viewportTemplate.clientHeight));
    const viewport = document.createElement('div');
    viewport.className = 'sm-eb-page-viewport sm-eb-measure-viewport';
    viewport.style.width = `${width}px`;
    viewport.style.height = `${height}px`;
    const flow = document.createElement('div');
    flow.className = 'sm-eb-page-flow';
    flow.style.width = `${width}px`;
    flow.style.height = `${height}px`;
    flow.style.columnWidth = `${width}px`;
    flow.style.columnGap = `${PAGE_COLUMN_GAP}px`;
    flow.innerHTML = html;
    viewport.appendChild(flow);
    // Keep the ruler inside the reader so its typography and custom properties
    // exactly match the visible pages.
    const measurementOwner = viewportTemplate.closest('.sm-eb-reader') || document.body;
    measurementOwner.appendChild(viewport);
    try {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        throwIfAborted(signal);
        const stride = width + PAGE_COLUMN_GAP;
        const count = Math.max(1, Math.ceil((flow.scrollWidth + PAGE_COLUMN_GAP - 1) / stride));
        return { html, count };
    } finally {
        viewport.remove();
    }
}

function addFrontPage(pages, descriptor) {
    if (pages.length % 2 === 1) pages.push({ type: 'blank' });
    pages.push(descriptor);
    // Each front-matter page owns a full two-panel view.
    pages.push({ type: 'blank' });
}

export async function buildPagePlan(document, viewportTemplate, options = {}) {
    const signal = options.signal;
    const pages = [];
    const layouts = [];
    const front = document.frontMatter || {};

    if (front.titlePage) addFrontPage(pages, { type: 'title' });
    if (front.epigraph && String(front.epigraphText || '').trim()) {
        addFrontPage(pages, { type: 'epigraph' });
    }

    let manuscriptPageNumber = 1;
    const chapters = document.chapters || [];
    const renderedChapters = chapters.map((chapter, index) => renderChapterHtml(document, chapter, index));
    await preloadImages(imageSourcesFromHtml(renderedChapters), signal);
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
        throwIfAborted(signal);
        const html = renderedChapters[chapterIndex];
        const layout = await measureChapter(viewportTemplate, html, signal);
        // The opening reverse shifts even page indexes onto the right panel.
        // Keep every chapter aligned to one of those fresh right panels.
        if (pages.length % 2 === 1) pages.push({ type: 'blank' });
        const layoutIndex = layouts.length;
        layouts.push(layout);
        for (let localPage = 0; localPage < layout.count; localPage++) {
            pages.push({
                type: 'content',
                chapterIndex,
                layoutIndex,
                localPage,
                number: manuscriptPageNumber++,
            });
        }
        options.onProgress?.({ completed: chapterIndex + 1, total: chapters.length });
    }

    // Front-matter helpers keep a companion blank panel so each section remains
    // visually self-contained in the flat two-panel reader.
    return { pages, layouts, manuscriptPages: manuscriptPageNumber - 1 };
}

export function descriptorForSpread(plan, spreadIndex, side, singlePage = false) {
    if (singlePage) {
        if (side === 'left') return { type: 'blank' };
        return spreadIndex === 0
            ? { type: 'cover' }
            : plan.pages[spreadIndex - 1] || { type: 'empty' };
    }
    if (spreadIndex === 0) return side === 'left' ? { type: 'cover' } : { type: 'toc' };
    const virtualIndex = ((spreadIndex - 1) * 2) + (side === 'right' ? 1 : 0);
    if (virtualIndex === 0) return { type: 'blank' };
    const pageIndex = virtualIndex - 1;
    return plan.pages[pageIndex] || { type: 'empty' };
}

export function maxSpreadForPlan(plan, singlePage = false) {
    const length = plan?.pages?.length || 0;
    if (singlePage) return length;
    return length ? Math.ceil((length + 1) / 2) : 0;
}

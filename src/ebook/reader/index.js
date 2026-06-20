/** Full-screen StoryManager ebook reader with responsive single/spread layouts. */

import { getStoryline } from '../../storage.js';
import { escapeAttr, escapeHtml, logError } from '../../display/util.js';
import { ebookAccentId, formatEbookPageNumber } from '../model.js';
import { loadEbook } from '../store.js';
import { notify } from '../ui.js';
import { PAGE_COLUMN_GAP, buildPagePlan, descriptorForSpread, maxSpreadForPlan } from './paginate.js';
import {
    captureReaderPosition,
    normalizeReaderViewMode,
    pageIndexesForSpread,
    resolveSinglePage,
    restoreReaderPosition,
} from './viewMode.js';

const READER_ID = 'sm-ebook-reader';
const VIEW_MODE_STORAGE_KEY = 'storyManager.ebookReader.viewMode';
const NARROW_READER_QUERY = '(max-width: 760px)';

let isOpen = false;
let storyline = null;
let ebook = null;
let pagePlan = null;
let spreadIndex = 0;
let returnTarget = null;
let resizeTimer = null;
let paginationToken = 0;
let singlePage = false;
let viewMode = 'auto';
let pendingPosition = null;
let paginationController = null;
let pagePlanKey = '';
let readerRequestToken = 0;
let lateImageTimer = null;
let pageTurnAnimation = null;

export async function openEbookReader(storylineId, options = {}) {
    const requestToken = ++readerRequestToken;
    ensureDOM();
    try {
        const [nextStoryline, nextEbook] = await Promise.all([
            getStoryline(storylineId),
            loadEbook(storylineId),
        ]);
        if (requestToken !== readerRequestToken) return false;
        if (!nextStoryline || !nextEbook) {
            notify('This storyline does not have a saved ebook.', 'warning');
            return false;
        }
        storyline = nextStoryline;
        ebook = nextEbook;
        returnTarget = options.returnTarget || null;
        spreadIndex = 0;
        pagePlan = null;
        pagePlanKey = '';
        pendingPosition = null;
        viewMode = loadViewMode();
        singlePage = resolveSinglePage(viewMode, isNarrowViewport());
        isOpen = true;
        const root = document.getElementById(READER_ID);
        root.classList.add('sm-eb-visible');
        root.classList.toggle('sm-eb-reader-light', ebook.style?.theme === 'light');
        root.classList.toggle('sm-eb-reader-dark', ebook.style?.theme !== 'light');
        root.classList.toggle('sm-eb-reader-single', singlePage);
        root.dataset.accent = ebookAccentId(ebook.style);
        root.setAttribute('aria-hidden', 'false');
        updateViewModeControl();
        showLoading();
        await paginateReader();
        return requestToken === readerRequestToken && isOpen;
    } catch (error) {
        if (requestToken !== readerRequestToken || error?.name === 'AbortError') return false;
        logError('Failed to open ebook reader:', error);
        notify(error.message || 'The ebook could not be opened.', 'error');
        closeEbookReader();
        return false;
    }
}

export function closeEbookReader() {
    readerRequestToken++;
    isOpen = false;
    clearTimeout(resizeTimer);
    resizeTimer = null;
    clearTimeout(lateImageTimer);
    lateImageTimer = null;
    pageTurnAnimation?.cancel();
    pageTurnAnimation = null;
    paginationController?.abort();
    paginationController = null;
    paginationToken++;
    const root = document.getElementById(READER_ID);
    root?.classList.remove('sm-eb-visible');
    root?.setAttribute('aria-hidden', 'true');
    if (root) delete root.dataset.accent;
    root?.querySelector('#sm-eb-reader-left')?.replaceChildren();
    root?.querySelector('#sm-eb-reader-right')?.replaceChildren();
    storyline = null;
    ebook = null;
    pagePlan = null;
    pagePlanKey = '';
    spreadIndex = 0;
    pendingPosition = null;
    returnTarget = null;
}

export function isEbookReaderOpen() {
    return isOpen;
}

function ensureDOM() {
    if (document.getElementById(READER_ID)) return;
    const root = document.createElement('section');
    root.id = READER_ID;
    root.className = 'sm-eb-reader sm-eb-reader-dark';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="sm-eb-reader-ambience"></div>
        <button type="button" class="sm-eb-reader-exit" id="sm-eb-reader-exit" aria-label="Close ebook" title="Return to Story Manager">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="sm-eb-reader-turn sm-eb-reader-turn-left" id="sm-eb-reader-prev" aria-label="Previous pages"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="sm-eb-reader-stage" id="sm-eb-reader-stage">
            <div class="sm-eb-reader-book">
                <div class="sm-eb-reader-gutter"></div>
                <section class="sm-eb-reader-leaf sm-eb-reader-leaf-left" id="sm-eb-reader-left"></section>
                <section class="sm-eb-reader-leaf sm-eb-reader-leaf-right" id="sm-eb-reader-right">
                    <div class="sm-eb-page-viewport" id="sm-eb-reader-measure-template"></div>
                </section>
            </div>
        </div>
        <button type="button" class="sm-eb-reader-turn sm-eb-reader-turn-right" id="sm-eb-reader-next" aria-label="Next pages"><i class="fa-solid fa-chevron-right"></i></button>
        <div class="sm-eb-reader-controls">
            <div class="sm-eb-reader-dock">
                <label class="sm-eb-reader-chapter-jump">
                    <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
                    <select id="sm-eb-reader-chapter-jump" aria-label="Jump to chapter">
                        <option value="cover">Table of Contents</option>
                    </select>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </label>
                <label class="sm-eb-reader-layout" title="Reader layout">
                    <i class="fa-solid fa-table-columns" aria-hidden="true"></i>
                    <select id="sm-eb-reader-layout" aria-label="Reader layout">
                        <option value="auto">Auto</option>
                        <option value="single">One page</option>
                        <option value="spread">Two pages</option>
                    </select>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </label>
                <span class="sm-eb-reader-progress" id="sm-eb-reader-progress">Preparing</span>
            </div>
        </div>`;
    document.body.appendChild(root);
    root.querySelector('#sm-eb-reader-exit').addEventListener('click', exitReader);
    root.querySelector('#sm-eb-reader-prev').addEventListener('click', previousSpread);
    root.querySelector('#sm-eb-reader-next').addEventListener('click', nextSpread);
    root.querySelector('#sm-eb-reader-chapter-jump').addEventListener('change', event => jumpToChapter(event.target.value));
    root.querySelector('#sm-eb-reader-layout').addEventListener('change', event => changeViewMode(event.target.value));
    document.addEventListener('keydown', event => {
        if (!isOpen || document.querySelector('.sm-eb-dialog-overlay')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            exitReader();
            return;
        }
        if (event.target instanceof Element
            && event.target.closest('button, select, input, textarea, a, [contenteditable="true"]')) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previousSpread();
        }
        if (event.key === 'ArrowRight' || event.key === ' ') {
            event.preventDefault();
            nextSpread();
        }
    });
    window.addEventListener('resize', () => {
        if (!isOpen) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const position = captureReaderPosition(pagePlan, spreadIndex, singlePage);
            const nextSinglePage = resolveSinglePage(viewMode, isNarrowViewport());
            if (nextSinglePage !== singlePage) {
                singlePage = nextSinglePage;
                document.getElementById(READER_ID)?.classList.toggle('sm-eb-reader-single', singlePage);
            }
            pendingPosition = position;
            updateViewModeControl();
            void paginateReader().catch(handlePaginationFailure);
        }, 250);
    });
}

function showLoading() {
    const left = document.getElementById('sm-eb-reader-left');
    const right = document.getElementById('sm-eb-reader-right');
    left.innerHTML = coverLeafHtml();
    right.innerHTML = '<div class="sm-eb-reader-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Setting the type…</span></div>';
    updateControls();
}

async function paginateReader() {
    if (!isOpen || !ebook) return;
    paginationController?.abort();
    const controller = new AbortController();
    paginationController = controller;
    const token = ++paginationToken;
    try {
        const right = document.getElementById('sm-eb-reader-right');
        // Install a real-sized empty viewport to use as the pagination ruler.
        right.innerHTML = '<div class="sm-eb-page-shell"><div class="sm-eb-page-viewport" id="sm-eb-reader-measure-template"></div></div>';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (controller.signal.aborted) return;
        const template = document.getElementById('sm-eb-reader-measure-template');
        if (!template) throw new Error('The reader pagination ruler is unavailable.');
        const nextKey = `${Math.round(template.clientWidth)}x${Math.round(template.clientHeight)}:${ebook.updatedAt || 0}`;
        if (pagePlan && pagePlanKey === nextKey) {
            restorePendingPosition();
            populateChapterJump();
            renderSpread();
            return;
        }
        const nextPlan = await buildPagePlan(ebook, template, {
            signal: controller.signal,
            onProgress: progress => {
                if (token === paginationToken) updatePaginationProgress(progress);
            },
        });
        if (!isOpen || token !== paginationToken || controller.signal.aborted) return;
        pagePlan = nextPlan;
        pagePlanKey = nextKey;
        if (!restorePendingPosition()) {
            spreadIndex = Math.min(spreadIndex, maxSpreadForPlan(pagePlan, singlePage));
        }
        document.getElementById('sm-eb-reader-left')?.replaceChildren();
        document.getElementById('sm-eb-reader-right')?.replaceChildren();
        populateChapterJump();
        renderSpread();
    } catch (error) {
        if (error?.name !== 'AbortError') throw error;
    } finally {
        if (paginationController === controller) paginationController = null;
    }
}

function updatePaginationProgress({ completed, total }) {
    if (!total) return;
    const progress = document.getElementById('sm-eb-reader-progress');
    if (progress) progress.textContent = `Setting type ${completed}/${total}`;
}

function handlePaginationFailure(error) {
    if (error?.name === 'AbortError' || !isOpen) return;
    logError('Failed to repaginate ebook reader:', error);
    notify('The reader could not resize this edition.', 'error');
    if (pagePlan) renderSpread();
    else showLoading();
}

function renderSpread() {
    if (!pagePlan) return;
    const book = document.querySelector('#sm-eb-reader-stage .sm-eb-reader-book');
    const left = document.getElementById('sm-eb-reader-left');
    const right = document.getElementById('sm-eb-reader-right');
    renderLeaf(left, descriptorForSpread(pagePlan, spreadIndex, 'left', singlePage), 'left');
    renderLeaf(right, descriptorForSpread(pagePlan, spreadIndex, 'right', singlePage), 'right');
    updateControls();
    animatePageTurn(book);
}

function isNarrowViewport() {
    return window.matchMedia(NARROW_READER_QUERY).matches;
}

function loadViewMode() {
    try {
        return normalizeReaderViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY));
    } catch {
        return 'auto';
    }
}

function saveViewMode() {
    try {
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
        // The reader still works when browser storage is unavailable.
    }
}

function changeViewMode(value) {
    const nextMode = normalizeReaderViewMode(value);
    const position = captureReaderPosition(pagePlan, spreadIndex, singlePage);
    viewMode = nextMode;
    saveViewMode();
    singlePage = resolveSinglePage(viewMode, isNarrowViewport());
    pendingPosition = position;
    document.getElementById(READER_ID)?.classList.toggle('sm-eb-reader-single', singlePage);
    updateViewModeControl();
    void paginateReader().catch(handlePaginationFailure);
}

function updateViewModeControl() {
    const root = document.getElementById(READER_ID);
    const select = document.getElementById('sm-eb-reader-layout');
    const label = select?.closest('.sm-eb-reader-layout');
    const narrowFallback = viewMode === 'spread' && isNarrowViewport();
    if (select) select.value = viewMode;
    if (root) {
        root.dataset.viewMode = viewMode;
        root.toggleAttribute('data-layout-fallback', narrowFallback);
    }
    if (label) {
        label.title = narrowFallback
            ? 'Two-page view will return when the window is wide enough'
            : 'Reader layout';
    }
}

function restorePendingPosition() {
    if (!pendingPosition || !pagePlan) return false;
    spreadIndex = restoreReaderPosition(pagePlan, pendingPosition, singlePage);
    pendingPosition = null;
    return true;
}

function renderLeaf(host, descriptor, side) {
    host.className = `sm-eb-reader-leaf sm-eb-reader-leaf-${side} sm-eb-leaf-${descriptor.type}`;
    if (descriptor.type === 'content') {
        renderContentLeaf(host, descriptor);
        return;
    }
    delete host.dataset.ebookLayoutKey;
    if (descriptor.type === 'cover') {
        host.innerHTML = coverLeafHtml();
        return;
    }
    if (descriptor.type === 'toc') {
        host.innerHTML = chapterIndexHtml();
        host.querySelectorAll('[data-reader-chapter]').forEach(button => {
            button.addEventListener('click', () => jumpToChapter(button.dataset.readerChapter));
        });
        return;
    }
    if (descriptor.type === 'title') {
        const front = ebook.frontMatter || {};
        const editionLabel = String(front.editionLabel || '').trim();
        host.innerHTML = pageShell(`
            <div class="sm-eb-front-page sm-eb-title-page">
                <span class="sm-eb-title-flourish"></span>
                ${front.includeEditionLabel && editionLabel ? `<small>${escapeHtml(editionLabel)}</small>` : ''}
                <h1>${escapeHtml(storyline.title || ebook.title)}</h1>
                ${front.includeAuthor && front.author ? `<p>by ${escapeHtml(front.author)}</p>` : ''}
                <i></i>
            </div>`);
        return;
    }
    if (descriptor.type === 'epigraph') {
        const front = ebook.frontMatter || {};
        host.innerHTML = pageShell(`
            <div class="sm-eb-front-page sm-eb-epigraph-page${front.epigraphIsQuote ? ' sm-eb-epigraph-quote' : ''}">
                <blockquote>${escapeHtml(front.epigraphText || '').replace(/\n/g, '<br>')}</blockquote>
                ${front.epigraphIsQuote && front.epigraphAttribution ? `<cite>${escapeHtml(front.epigraphAttribution)}</cite>` : ''}
            </div>`);
        return;
    }
    if (descriptor.type === 'empty') {
        host.innerHTML = pageShell('<div class="sm-eb-end-page"><i class="fa-solid fa-feather-pointed"></i><span>End of edition</span></div>');
        return;
    }
    host.innerHTML = pageShell('');
}

function renderContentLeaf(host, descriptor) {
    const layout = pagePlan.layouts[descriptor.layoutIndex];
    const layoutKey = `${pagePlanKey}:${descriptor.layoutIndex}`;
    let shell = host.querySelector('.sm-eb-page-shell');
    let viewport = shell?.querySelector('.sm-eb-page-viewport');
    let flow = viewport?.querySelector('.sm-eb-page-flow');

    if (!shell || !viewport || !flow || host.dataset.ebookLayoutKey !== layoutKey) {
        host.innerHTML = pageShell('');
        shell = host.querySelector('.sm-eb-page-shell');
        viewport = shell.querySelector('.sm-eb-page-viewport');
        flow = document.createElement('div');
        flow.className = 'sm-eb-page-flow';
        flow.innerHTML = layout.html;
        viewport.appendChild(flow);
        host.dataset.ebookLayoutKey = layoutKey;
        watchLateImages(flow);
    }

    syncPageNumber(shell, descriptor);
    const width = viewport.clientWidth;
    flow.style.width = `${width}px`;
    flow.style.height = `${viewport.clientHeight}px`;
    flow.style.columnWidth = `${width}px`;
    flow.style.columnGap = `${PAGE_COLUMN_GAP}px`;
    flow.style.transform = `translateX(-${descriptor.localPage * (width + PAGE_COLUMN_GAP)}px)`;
}

function syncPageNumber(shell, descriptor) {
    const style = ebook?.style || {};
    const number = style.pageNumbers ? descriptor.number : null;
    let element = shell.querySelector('.sm-eb-page-number');
    if (!number) {
        element?.remove();
        return;
    }
    if (!element) {
        element = document.createElement('div');
        shell.appendChild(element);
    }
    element.className = `sm-eb-page-number sm-eb-page-number-${style.pageNumberPosition || 'center'} sm-eb-page-number-${style.pageNumberStyle || 'plain'}`;
    element.textContent = formatEbookPageNumber(number, style.pageNumberStyle);
}

function watchLateImages(flow) {
    flow.querySelectorAll('img').forEach(image => {
        if (image.complete) return;
        image.addEventListener('load', scheduleLateImageRepagination, { once: true });
    });
}

function scheduleLateImageRepagination() {
    if (!isOpen) return;
    clearTimeout(lateImageTimer);
    lateImageTimer = setTimeout(() => {
        lateImageTimer = null;
        if (!isOpen) return;
        pagePlanKey = '';
        void paginateReader().catch(handlePaginationFailure);
    }, 180);
}

function animatePageTurn(book) {
    if (!book || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !book.animate) return;
    pageTurnAnimation?.cancel();
    const animation = book.animate(
        [{ opacity: 0.78 }, { opacity: 1 }],
        { duration: 170, easing: 'cubic-bezier(0.2, 0.7, 0.25, 1)' },
    );
    pageTurnAnimation = animation;
    const clear = () => {
        if (pageTurnAnimation === animation) pageTurnAnimation = null;
    };
    animation.addEventListener('finish', clear, { once: true });
    animation.addEventListener('cancel', clear, { once: true });
}

function pageShell(content = '', descriptor = null) {
    const style = ebook?.style || {};
    const number = descriptor?.type === 'content' && style.pageNumbers ? descriptor.number : null;
    const numberClass = `sm-eb-page-number-${style.pageNumberPosition || 'center'} sm-eb-page-number-${style.pageNumberStyle || 'plain'}`;
    const numberLabel = number ? formatEbookPageNumber(number, style.pageNumberStyle) : '';
    return `<div class="sm-eb-page-shell">
        <div class="sm-eb-page-viewport">${content}</div>
        ${number ? `<div class="sm-eb-page-number ${escapeAttr(numberClass)}">${escapeHtml(numberLabel)}</div>` : ''}
    </div>`;
}

function coverLeafHtml() {
    const cover = storyline?.coverImage;
    return `<div class="sm-eb-reader-cover${cover ? '' : ' sm-eb-reader-cover-empty'}">
        ${cover ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(storyline.title || '')}">` : `
            <div class="sm-eb-reader-cover-placeholder">
                <i class="fa-solid fa-book-open"></i>
                <span>${escapeHtml(storyline?.title || 'Untitled Storyline')}</span>
            </div>`}
        <div class="sm-eb-reader-cover-sheen"></div>
    </div>`;
}

function chapterIndexHtml() {
    const chapters = ebook?.chapters || [];
    return `<nav class="sm-eb-cover-index" aria-label="Chapter index">
        <header>
            <span>Contents</span>
            <h2>Chapters</h2>
        </header>
        <div class="sm-eb-cover-index-list">
            ${chapters.length ? chapters.map((chapter, index) => `
                <button type="button" data-reader-chapter="${index}" title="Open ${escapeAttr(chapter.title || `Chapter ${index + 1}`)}">
                    <small>${String(index + 1).padStart(2, '0')}</small>
                    <span>${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</span>
                    <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>
                </button>`).join('') : '<div class="sm-eb-cover-index-empty">No chapters yet</div>'}
        </div>
    </nav>`;
}

function previousSpread() {
    if (!pagePlan || spreadIndex <= 0) return;
    spreadIndex--;
    renderSpread();
}

function nextSpread() {
    if (!pagePlan || spreadIndex >= maxSpreadForPlan(pagePlan, singlePage)) return;
    spreadIndex++;
    renderSpread();
}

function populateChapterJump() {
    const select = document.getElementById('sm-eb-reader-chapter-jump');
    if (!select) return;
    select.innerHTML = `<option value="cover">Table of Contents</option>${(ebook?.chapters || []).map((chapter, index) => (
        `<option value="${index}">Chapter ${index + 1} · ${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</option>`
    )).join('')}`;
}

function jumpToChapter(value) {
    if (!pagePlan) return;
    if (value === 'cover') {
        spreadIndex = 0;
        renderSpread();
        return;
    }
    const chapterIndex = Number(value);
    if (!Number.isInteger(chapterIndex)) return;
    const pageIndex = pagePlan.pages.findIndex(page => page.type === 'content' && page.chapterIndex === chapterIndex);
    if (pageIndex < 0) return;
    spreadIndex = singlePage ? pageIndex + 1 : Math.floor((pageIndex + 1) / 2) + 1;
    renderSpread();
}

function activeChapterIndex() {
    if (!pagePlan) return null;
    const pageIndexes = pageIndexesForSpread(spreadIndex, singlePage);
    for (const pageIndex of pageIndexes) {
        const descriptor = pagePlan.pages[pageIndex];
        if (descriptor?.type === 'content') return descriptor.chapterIndex;
    }
    return null;
}

function updateControls() {
    const max = pagePlan ? maxSpreadForPlan(pagePlan, singlePage) : 0;
    const previous = document.getElementById('sm-eb-reader-prev');
    const next = document.getElementById('sm-eb-reader-next');
    if (previous) previous.disabled = !pagePlan || spreadIndex <= 0;
    if (next) next.disabled = !pagePlan || spreadIndex >= max;
    const progress = document.getElementById('sm-eb-reader-progress');
    if (progress) {
        progress.textContent = pagePlan
            ? `${spreadIndex + 1} of ${max + 1}`
            : 'Preparing';
    }
    const chapterJump = document.getElementById('sm-eb-reader-chapter-jump');
    const chapterIndex = activeChapterIndex();
    if (chapterJump && (spreadIndex === 0 || chapterIndex !== null)) {
        chapterJump.value = spreadIndex === 0 ? 'cover' : String(chapterIndex);
    }
}

async function exitReader() {
    const target = returnTarget;
    const id = storyline?.id;
    closeEbookReader();
    if (target?.type === 'display') {
        const display = await import('../../display/index.js');
        await display.openDisplay({ bookId: target.bookId || null, storylineId: id });
    }
}

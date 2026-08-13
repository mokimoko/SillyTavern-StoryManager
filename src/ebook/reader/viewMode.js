/** Reader view-mode resolution and position mapping shared by UI and tests. */

export const READER_VIEW_MODES = Object.freeze(['auto', 'single', 'spread']);

export function normalizeReaderViewMode(value) {
    return READER_VIEW_MODES.includes(value) ? value : 'auto';
}

export function resolveSinglePage(mode, narrowViewport) {
    const normalized = normalizeReaderViewMode(mode);
    if (normalized === 'single') return true;
    if (normalized === 'spread') return !!narrowViewport;
    return !!narrowViewport;
}

export function pageIndexesForSpread(spreadIndex, singlePage) {
    const spread = Math.max(0, Number(spreadIndex) || 0);
    if (spread === 0) return [];
    if (singlePage) return [spread - 1];
    return [((spread - 1) * 2) - 1, (spread - 1) * 2].filter(index => index >= 0);
}

export function spreadIndexForPage(pageIndex, singlePage) {
    const page = Math.max(0, Number(pageIndex) || 0);
    return singlePage ? page + 1 : Math.floor((page + 1) / 2) + 1;
}

export function captureReaderPosition(plan, spreadIndex, singlePage) {
    if (!plan || spreadIndex <= 0) return { type: 'cover' };
    const indexes = pageIndexesForSpread(spreadIndex, singlePage);
    for (const pageIndex of indexes) {
        const page = plan.pages?.[pageIndex];
        if (!page || page.type === 'blank') continue;
        if (page.type !== 'content') return { type: page.type };
        const layoutCount = plan.layouts?.[page.layoutIndex]?.count || 1;
        return {
            type: 'content',
            chapterIndex: page.chapterIndex,
            progress: layoutCount > 1 ? page.localPage / (layoutCount - 1) : 0,
        };
    }
    return { type: 'cover' };
}

export function restoreReaderPosition(plan, position, singlePage) {
    if (!plan || !position || position.type === 'cover') return 0;
    if (position.type === 'content') {
        const matches = [];
        for (let index = 0; index < (plan.pages || []).length; index++) {
            const page = plan.pages[index];
            if (page?.type === 'content' && page.chapterIndex === position.chapterIndex) matches.push(index);
        }
        if (!matches.length) return 0;
        const progress = Math.max(0, Math.min(1, Number(position.progress) || 0));
        const matchIndex = Math.round(progress * (matches.length - 1));
        return spreadIndexForPage(matches[matchIndex], singlePage);
    }
    const pageIndex = (plan.pages || []).findIndex(page => page?.type === position.type);
    return pageIndex >= 0 ? spreadIndexForPage(pageIndex, singlePage) : 0;
}

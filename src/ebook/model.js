/** Canonical, versioned document model shared by the ebook editor and reader. */

export const EBOOK_TYPE = 'storymanager-ebook';
export const EBOOK_VERSION = 2;

export const EBOOK_CHAPTER_STYLES = Object.freeze([
    'classic',
    'minimal',
    'folio',
    'margin',
    'frame',
]);

export const EBOOK_PAGE_NUMBER_STYLES = Object.freeze([
    'plain',
    'diamond',
    'rule',
    'center-dots',
    'bracketed',
    'roman',
]);

export const EBOOK_ACCENT_STYLES = Object.freeze({
    dark: Object.freeze([
        'antique-gold',
        'moon-silver',
        'rose-copper',
        'sage',
        'dust-blue',
    ]),
    light: Object.freeze([
        'vellum-bronze',
        'terracotta',
        'forest',
        'ink-blue',
        'muted-plum',
    ]),
});

export const DEFAULT_EBOOK_STYLE = Object.freeze({
    theme: 'dark',
    chapterStyle: 'classic',
    darkAccent: 'antique-gold',
    lightAccent: 'vellum-bronze',
    pageNumbers: true,
    pageNumberPosition: 'center',
    pageNumberStyle: 'plain',
    dropCap: 'none',
});

export const DEFAULT_FRONT_MATTER = Object.freeze({
    titlePage: false,
    includeEditionLabel: false,
    editionLabel: 'A StoryManager Edition',
    includeAuthor: false,
    author: '',
    epigraph: false,
    epigraphText: '',
    epigraphIsQuote: false,
    epigraphAttribution: '',
});

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createChapter(title = 'New Chapter') {
    return {
        id: makeId('chapter'),
        title: String(title || '').trim() || 'New Chapter',
        content: '',
    };
}

export function createEbookDocument(storyline) {
    const now = Date.now();
    return {
        type: EBOOK_TYPE,
        version: EBOOK_VERSION,
        storylineId: String(storyline?.id || ''),
        title: String(storyline?.title || 'Untitled Storyline'),
        createdAt: now,
        updatedAt: now,
        rawText: '',
        sources: [],
        chapters: [],
        assets: [],
        style: { ...DEFAULT_EBOOK_STYLE },
        frontMatter: { ...DEFAULT_FRONT_MATTER },
    };
}

export function normalizeEbookDocument(value, storyline = null) {
    const source = value && typeof value === 'object' ? value : {};
    const fallback = createEbookDocument(storyline || { id: source.storylineId, title: source.title });
    const sourceStyle = source.style && typeof source.style === 'object' ? source.style : {};
    const theme = sourceStyle.theme === 'light' ? 'light' : DEFAULT_EBOOK_STYLE.theme;
    const chapterStyle = EBOOK_CHAPTER_STYLES.includes(sourceStyle.chapterStyle)
        ? sourceStyle.chapterStyle
        : DEFAULT_EBOOK_STYLE.chapterStyle;
    const pageNumberStyle = EBOOK_PAGE_NUMBER_STYLES.includes(sourceStyle.pageNumberStyle)
        ? sourceStyle.pageNumberStyle
        : DEFAULT_EBOOK_STYLE.pageNumberStyle;
    const darkAccent = EBOOK_ACCENT_STYLES.dark.includes(sourceStyle.darkAccent)
        ? sourceStyle.darkAccent
        : DEFAULT_EBOOK_STYLE.darkAccent;
    const lightAccent = EBOOK_ACCENT_STYLES.light.includes(sourceStyle.lightAccent)
        ? sourceStyle.lightAccent
        : DEFAULT_EBOOK_STYLE.lightAccent;
    const chapters = Array.isArray(source.chapters)
        ? source.chapters.map((chapter, index) => ({
            id: String(chapter?.id || makeId('chapter')),
            title: String(chapter?.title || `Chapter ${index + 1}`).trim() || `Chapter ${index + 1}`,
            content: typeof chapter?.content === 'string' ? chapter.content : '',
        }))
        : [];
    const sources = Array.isArray(source.sources)
        ? source.sources.map(item => ({
            fileName: String(item?.fileName || ''),
            importedAt: Number(item?.importedAt) || 0,
            hash: String(item?.hash || ''),
            messageCount: Math.max(0, Number(item?.messageCount) || 0),
            speakers: Array.isArray(item?.speakers)
                ? [...new Set(item.speakers.map(String).map(s => s.trim()).filter(Boolean))]
                : [],
        })).filter(item => item.fileName)
        : [];
    const assets = Array.isArray(source.assets)
        ? source.assets.map(item => ({
            id: String(item?.id || makeId('image')),
            src: String(item?.src || ''),
            thumb: String(item?.thumb || ''),
            caption: String(item?.caption || ''),
        })).filter(item => item.src)
        : [];

    return {
        ...fallback,
        type: EBOOK_TYPE,
        version: EBOOK_VERSION,
        storylineId: String(source.storylineId || storyline?.id || ''),
        title: String(source.title || storyline?.title || fallback.title),
        createdAt: Number(source.createdAt) || fallback.createdAt,
        updatedAt: Number(source.updatedAt) || fallback.updatedAt,
        rawText: typeof source.rawText === 'string' ? source.rawText : '',
        sources,
        chapters,
        assets,
        style: {
            ...DEFAULT_EBOOK_STYLE,
            ...sourceStyle,
            theme,
            chapterStyle,
            pageNumberStyle,
            darkAccent,
            lightAccent,
        },
        frontMatter: {
            ...DEFAULT_FRONT_MATTER,
            ...(source.frontMatter && typeof source.frontMatter === 'object' ? source.frontMatter : {}),
        },
    };
}

export function ebookAccentId(style = {}) {
    const theme = style.theme === 'light' ? 'light' : 'dark';
    const setting = theme === 'light' ? 'lightAccent' : 'darkAccent';
    const fallback = theme === 'light' ? DEFAULT_EBOOK_STYLE.lightAccent : DEFAULT_EBOOK_STYLE.darkAccent;
    const accent = EBOOK_ACCENT_STYLES[theme].includes(style[setting]) ? style[setting] : fallback;
    return `${theme}-${accent}`;
}

export function formatEbookPageNumber(value, style = 'plain') {
    const number = Number(value);
    if (style !== 'roman' || !Number.isInteger(number) || number < 1 || number > 3999) {
        return String(value ?? '');
    }

    const numerals = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
        [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let remaining = number;
    let result = '';
    for (const [amount, numeral] of numerals) {
        while (remaining >= amount) {
            result += numeral;
            remaining -= amount;
        }
    }
    return result;
}

export function countWords(text = '') {
    const normalized = String(text || '').trim();
    return normalized ? normalized.split(/\s+/u).filter(Boolean).length : 0;
}

export function countDocumentWords(document) {
    return (document?.chapters || []).reduce((total, chapter) => total + countWords(chapter.content), 0);
}

/** Small stable content fingerprint used to identify accidental chat reimports. */
export function hashText(text = '') {
    let hash = 0x811c9dc5;
    const input = String(text || '');
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeImageAsset(image = {}) {
    return {
        id: makeId('image'),
        src: String(image.src || ''),
        thumb: String(image.thumb || ''),
        caption: String(image.caption || ''),
    };
}

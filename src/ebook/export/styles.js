/** Portable EPUB typography derived from Story Manager's reader styles. */

const ACCENTS = Object.freeze({
    'dark-antique-gold': '#c1a77d',
    'dark-moon-silver': '#aeb9c8',
    'dark-rose-copper': '#c78e84',
    'dark-sage': '#91ad96',
    'dark-dust-blue': '#88a6c5',
    'light-vellum-bronze': '#76604b',
    'light-terracotta': '#8d4d40',
    'light-forest': '#536b58',
    'light-ink-blue': '#52677d',
    'light-muted-plum': '#765b70',
});

export function epubAccentColor(accentId) {
    return ACCENTS[accentId] || ACCENTS['dark-antique-gold'];
}

export function buildEpubStyles({ theme = 'dark', accentId = '', fontFaces = '' } = {}) {
    const dark = theme !== 'light';
    const page = dark ? '#262426' : '#ece3d5';
    const ink = dark ? '#e9e3d9' : '#4f4740';
    const accent = epubAccentColor(accentId);

    const css = `${fontFaces ? `${fontFaces.trim()}\n\n` : ''}:root {
    color-scheme: ${dark ? 'dark' : 'light'};
    --page: ${page};
    --ink: ${ink};
    --accent: ${accent};
}

html, body { margin: 0; padding: 0; }
body {
    color: var(--ink);
    background: var(--page);
    font-family: "Cormorant Garamond", "Iowan Old Style", Baskerville, Georgia, serif;
    font-size: 1em;
    line-height: 1.68;
}
a { color: var(--accent); text-decoration-thickness: 0.06em; text-underline-offset: 0.15em; }
img { max-width: 100%; }

.cover-page, .front-page {
    min-height: 90vh;
    text-align: center;
}
.cover-page { margin: 0; padding: 0; }
.cover-page img { display: block; width: 100%; height: auto; margin: 0 auto; }
.front-page { padding: 18% 10%; }
.front-page .edition {
    color: var(--accent);
    font-family: sans-serif;
    font-size: 0.65em;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
}
.front-page h1 { margin: 1em auto 0.55em; font-size: 2.8em; font-weight: 500; line-height: 1.05; }
.front-page .author { margin: 0; font-size: 1.15em; font-style: italic; }
.flourish { display: block; width: 3em; height: 0.08em; margin: 0 auto 2em; background: var(--accent); }
.epigraph { margin: 24% 8% 0; font-size: 1.35em; font-style: italic; line-height: 1.55; }
.epigraph cite {
    display: block;
    margin-top: 2em;
    color: var(--accent);
    font-family: sans-serif;
    font-size: 0.55em;
    font-style: normal;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.chapter { color: var(--ink); }
.chapter-heading { position: relative; margin: 0 0 2.6em; text-align: center; break-inside: avoid; }
.chapter-number { display: none; }
.chapter-kicker {
    display: block;
    color: var(--accent);
    font-family: sans-serif;
    font-size: 0.62em;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
}
.chapter-heading h1 { margin: 0.4em 0 0.5em; font-size: 2.5em; font-weight: 500; line-height: 1.05; }
.chapter-mark { display: block; width: 3em; height: 0.08em; margin: 0 auto; background: var(--accent); opacity: 0.7; }
.chapter-minimal .chapter-heading { text-align: left; }
.chapter-minimal .chapter-mark { margin-left: 0; }
.chapter-folio .chapter-heading { padding-top: 2.8em; }
.chapter-folio .chapter-number {
    position: absolute;
    top: -0.35em;
    left: 0;
    right: 0;
    display: block;
    color: var(--accent);
    font-size: 7em;
    line-height: 1;
    opacity: 0.11;
}
.chapter-folio .chapter-mark { width: 1.2em; }
.chapter-margin .chapter-heading { padding: 0.45em 0 0.45em 1.35em; border-left: 0.13em solid var(--accent); text-align: left; }
.chapter-margin .chapter-heading h1 { margin-bottom: 0; }
.chapter-margin .chapter-mark { display: none; }
.chapter-frame .chapter-heading { padding: 2em 1.75em; border: 0.08em solid var(--accent); }
.chapter-frame .chapter-mark { display: none; }

.prose { widows: 3; orphans: 3; }
.prose p { margin: 0 0 0.85em; text-align: justify; }
.prose h1, .prose h2, .prose h3, .prose h4 {
    margin: 1.35em 0 0.55em;
    color: var(--ink);
    font-family: inherit;
    font-weight: 600;
    line-height: 1.15;
    break-after: avoid;
}
.prose blockquote { margin: 1.2em 7%; padding-left: 1.1em; border-left: 0.08em solid var(--accent); font-style: italic; }
.prose hr { width: 36%; height: 0.08em; margin: 2em auto; border: 0; background: var(--accent); opacity: 0.7; }
.dropcap-classic > p:first-of-type::first-letter {
    float: left;
    margin: 0.08em 0.1em 0 0;
    color: var(--accent);
    font-size: 4.3em;
    line-height: 0.7;
}
.dropcap-boxed > p:first-of-type::first-letter {
    float: left;
    margin: 0.11em 0.18em 0 0;
    padding: 0.06em 0.15em;
    border: 0.08em solid var(--accent);
    color: var(--accent);
    font-size: 2.8em;
    line-height: 0.86;
}
.figure { margin: 1.25em auto; text-align: center; break-inside: avoid; }
.figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.figure-inline { width: 48%; margin-left: 1.2em; float: right; }
.figure-center { width: 76%; }
.figure-wide { width: 100%; }
.figure figcaption { margin-top: 0.7em; font-size: 0.72em; font-style: italic; opacity: 0.7; }
`;
    // Direct values keep the design intact in older readers without CSS custom-property support.
    return css
        .replaceAll('var(--page)', page)
        .replaceAll('var(--ink)', ink)
        .replaceAll('var(--accent)', accent);
}

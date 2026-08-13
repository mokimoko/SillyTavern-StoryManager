/** Build and download a self-contained, reflowable EPUB 3 edition. */

import { escapeAttr, escapeHtml } from '../../display/util.js';
import { renderMarkdown } from '../markdown.js';
import { ebookAccentId } from '../model.js';
import { collectGoogleFontResources, collectImageResources } from './resources.js';
import { buildEpubStyles } from './styles.js';
import { createStoredZip } from './zip.js';

const EPUB_MIMETYPE = 'application/epub+zip';
const XHTML_MEDIA_TYPE = 'application/xhtml+xml';

function safeFileName(title) {
    const cleaned = String(title || 'ebook')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');
    return `${(cleaned || 'ebook').slice(0, 120)}.epub`;
}

function publicationId(ebook) {
    const seed = String(ebook?.storylineId || '').trim();
    if (seed) return `urn:storymanager:${seed}`;
    if (globalThis.crypto?.randomUUID) return `urn:uuid:${globalThis.crypto.randomUUID()}`;
    return `urn:storymanager:${Date.now().toString(36)}`;
}

function xhtmlDocument(title, body, bodyClass = '') {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body${bodyClass ? ` class="${escapeAttr(bodyClass)}"` : ''}>
${body}
</body>
</html>`;
}

function normalizeXhtmlFragment(html) {
    return String(html || '')
        .replace(/<(br|hr)(\b[^>]*)>/gi, (_match, tag, attributes) => (
            `<${tag}${attributes.trimEnd().endsWith('/') ? attributes : `${attributes} /`}>`
        ))
        .replace(/<img(\b[^>]*)>/gi, (_match, attributes) => (
            `<img${attributes.trimEnd().endsWith('/') ? attributes : `${attributes} /`}>`
        ));
}

function renderPortableMarkdown(markdown, assets, assetPaths) {
    const markerBase = 'https://storymanager.invalid/image/';
    const portableAssets = (assets || []).map(asset => ({
        ...asset,
        src: `${markerBase}${encodeURIComponent(asset.id)}`,
    }));
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(markdown, portableAssets);
    template.content.querySelectorAll('.sm-eb-figure').forEach(figure => {
        const image = figure.querySelector('img');
        const source = image?.getAttribute('src') || '';
        const encodedId = source.startsWith(markerBase) ? source.slice(markerBase.length) : '';
        const assetPath = assetPaths.get(decodeURIComponent(encodedId));
        if (!image || !assetPath) {
            figure.remove();
            return;
        }
        image.setAttribute('src', assetPath);
        image.removeAttribute('loading');
        figure.className = [...figure.classList]
            .map(name => name.replace(/^sm-eb-figure/, 'figure'))
            .join(' ');
    });
    return normalizeXhtmlFragment(template.innerHTML);
}

function chapterDocument(ebook, chapter, index, assetPaths) {
    const style = ebook.style || {};
    const number = index + 1;
    const chapterStyle = style.chapterStyle || 'classic';
    const dropCap = style.dropCap || 'none';
    const content = renderPortableMarkdown(chapter?.content || '', ebook.assets || [], assetPaths);
    const body = `<section class="chapter chapter-${escapeAttr(chapterStyle)}" epub:type="chapter">
    <header class="chapter-heading">
        <span class="chapter-number" aria-hidden="true">${number}</span>
        <span class="chapter-kicker">Chapter ${number}</span>
        <h1>${escapeHtml(chapter?.title || `Chapter ${number}`)}</h1>
        <span class="chapter-mark" aria-hidden="true"></span>
    </header>
    <div class="prose dropcap-${escapeAttr(dropCap)}">
${content}
    </div>
</section>`;
    return xhtmlDocument(chapter?.title || `Chapter ${number}`, body);
}

function coverDocument(storyline, coverPath) {
    const title = storyline?.title || 'Untitled Storyline';
    const content = coverPath
        ? `<section class="cover-page" epub:type="cover"><img src="${escapeAttr(coverPath)}" alt="${escapeAttr(title)}" /></section>`
        : `<section class="front-page" epub:type="cover"><span class="flourish"></span><h1>${escapeHtml(title)}</h1></section>`;
    return xhtmlDocument(title, content);
}

function titleDocument(storyline, ebook) {
    const front = ebook.frontMatter || {};
    const title = storyline?.title || ebook.title || 'Untitled Storyline';
    const content = `<section class="front-page" epub:type="titlepage">
    <span class="flourish"></span>
    ${front.includeEditionLabel && String(front.editionLabel || '').trim() ? `<div class="edition">${escapeHtml(front.editionLabel)}</div>` : ''}
    <h1>${escapeHtml(title)}</h1>
    ${front.includeAuthor && String(front.author || '').trim() ? `<p class="author">by ${escapeHtml(front.author)}</p>` : ''}
</section>`;
    return xhtmlDocument(title, content);
}

function epigraphDocument(ebook) {
    const front = ebook.frontMatter || {};
    const quote = escapeHtml(front.epigraphText || '').replace(/\n/g, '<br />');
    const attribution = front.epigraphIsQuote && String(front.epigraphAttribution || '').trim()
        ? `<cite>${escapeHtml(front.epigraphAttribution)}</cite>`
        : '';
    return xhtmlDocument('Epigraph', `<section class="front-page" epub:type="epigraph"><blockquote class="epigraph">${quote}${attribution}</blockquote></section>`);
}

function navDocument(storyline, ebook, includeTitle, includeEpigraph) {
    const chapters = ebook.chapters || [];
    const toc = chapters.length
        ? chapters.map((chapter, index) => `            <li><a href="chapter-${String(index + 1).padStart(3, '0')}.xhtml">${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</a></li>`).join('\n')
        : '            <li><a href="cover.xhtml">Cover</a></li>';
    const startHref = includeTitle ? 'title.xhtml' : (includeEpigraph ? 'epigraph.xhtml' : (chapters.length ? 'chapter-001.xhtml' : 'cover.xhtml'));
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(storyline?.title || ebook.title || 'Contents')}</title></head>
<body>
    <nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${toc}
    </ol></nav>
    <nav epub:type="landmarks" hidden="hidden"><ol>
        <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
        <li><a epub:type="bodymatter" href="${startHref}">Start reading</a></li>
    </ol></nav>
</body>
</html>`;
}

function ncxDocument(storyline, ebook, uid) {
    const chapters = ebook.chapters || [];
    const points = chapters.map((chapter, index) => `        <navPoint id="chapter-${index + 1}" playOrder="${index + 1}">
            <navLabel><text>${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</text></navLabel>
            <content src="text/chapter-${String(index + 1).padStart(3, '0')}.xhtml" />
        </navPoint>`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head><meta name="dtb:uid" content="${escapeAttr(uid)}" /></head>
    <docTitle><text>${escapeHtml(storyline?.title || ebook.title || 'Untitled Storyline')}</text></docTitle>
    <navMap>
${points || '        <navPoint id="cover" playOrder="1"><navLabel><text>Cover</text></navLabel><content src="text/cover.xhtml" /></navPoint>'}
    </navMap>
</ncx>`;
}

function packageDocument({ storyline, ebook, uid, modified, resources, includeTitle, includeEpigraph }) {
    const title = storyline?.title || ebook.title || 'Untitled Storyline';
    const front = ebook.frontMatter || {};
    const author = front.includeAuthor && String(front.author || '').trim() ? String(front.author).trim() : '';
    const chapterItems = (ebook.chapters || []).map((_, index) => {
        const number = String(index + 1).padStart(3, '0');
        return `        <item id="chapter-${number}" href="text/chapter-${number}.xhtml" media-type="${XHTML_MEDIA_TYPE}" />`;
    }).join('\n');
    const resourceItems = resources.map(resource => `        <item id="${escapeAttr(resource.id)}" href="${escapeAttr(resource.href)}" media-type="${escapeAttr(resource.mediaType)}"${resource.properties ? ` properties="${escapeAttr(resource.properties)}"` : ''} />`).join('\n');
    const coverImage = resources.find(resource => resource.properties === 'cover-image');
    const spine = [
        '        <itemref idref="cover-page" linear="no" />',
        includeTitle ? '        <itemref idref="title-page" />' : '',
        includeEpigraph ? '        <itemref idref="epigraph" />' : '',
        ...(ebook.chapters || []).map((_, index) => `        <itemref idref="chapter-${String(index + 1).padStart(3, '0')}" />`),
    ].filter(Boolean).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="publication-id">${escapeHtml(uid)}</dc:identifier>
        <dc:title>${escapeHtml(title)}</dc:title>
        <dc:language>en</dc:language>
        ${author ? `<dc:creator>${escapeHtml(author)}</dc:creator>` : ''}
        <meta property="dcterms:modified">${escapeHtml(modified)}</meta>
        <meta property="rendition:layout">reflowable</meta>
        ${coverImage ? `<meta name="cover" content="${escapeAttr(coverImage.id)}" />` : ''}
    </metadata>
    <manifest>
        <item id="nav" href="nav.xhtml" media-type="${XHTML_MEDIA_TYPE}" properties="nav" />
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
        <item id="book-css" href="styles/book.css" media-type="text/css" />
        <item id="cover-page" href="text/cover.xhtml" media-type="${XHTML_MEDIA_TYPE}" />
        ${includeTitle ? `<item id="title-page" href="text/title.xhtml" media-type="${XHTML_MEDIA_TYPE}" />` : ''}
        ${includeEpigraph ? `<item id="epigraph" href="text/epigraph.xhtml" media-type="${XHTML_MEDIA_TYPE}" />` : ''}
${chapterItems}
${resourceItems}
    </manifest>
    <spine toc="ncx">
${spine}
    </spine>
</package>`;
}

export async function buildEpub(storyline, ebook) {
    if (!storyline || !ebook) throw new Error('A saved Story Manager ebook is required.');
    const front = ebook.frontMatter || {};
    const includeTitle = !!front.titlePage;
    const includeEpigraph = !!front.epigraph && !!String(front.epigraphText || '').trim();
    const modifiedDate = new Date(ebook.updatedAt || Date.now());
    const modified = modifiedDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const uid = publicationId(ebook);

    const [images, fonts] = await Promise.all([
        collectImageResources(storyline, ebook),
        collectGoogleFontResources(),
    ]);
    const resources = [...images.resources, ...fonts.resources];
    const entries = [
        { name: 'mimetype', data: EPUB_MIMETYPE },
        { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
    <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>` },
        { name: 'EPUB/nav.xhtml', data: navDocument(storyline, ebook, includeTitle, includeEpigraph) },
        { name: 'EPUB/toc.ncx', data: ncxDocument(storyline, ebook, uid) },
        { name: 'EPUB/styles/book.css', data: buildEpubStyles({
            theme: ebook.style?.theme,
            accentId: ebookAccentId(ebook.style),
            fontFaces: fonts.css,
        }) },
        { name: 'EPUB/text/cover.xhtml', data: coverDocument(storyline, images.coverPath) },
    ];
    if (includeTitle) entries.push({ name: 'EPUB/text/title.xhtml', data: titleDocument(storyline, ebook) });
    if (includeEpigraph) entries.push({ name: 'EPUB/text/epigraph.xhtml', data: epigraphDocument(ebook) });
    for (const [index, chapter] of (ebook.chapters || []).entries()) {
        entries.push({
            name: `EPUB/text/chapter-${String(index + 1).padStart(3, '0')}.xhtml`,
            data: chapterDocument(ebook, chapter, index, images.assetPaths),
        });
    }
    for (const resource of resources) entries.push({ name: `EPUB/${resource.href}`, data: resource.data });
    entries.splice(2, 0, {
        name: 'EPUB/package.opf',
        data: packageDocument({ storyline, ebook, uid, modified, resources, includeTitle, includeEpigraph }),
    });

    const bytes = await createStoredZip(entries, modifiedDate);
    return {
        blob: new Blob([bytes], { type: EPUB_MIMETYPE }),
        fileName: safeFileName(storyline.title || ebook.title),
        report: {
            chapterCount: (ebook.chapters || []).length,
            imageCount: images.resources.length,
            skippedImages: images.skipped,
            embeddedFont: fonts.complete,
        },
    };
}

export async function downloadEpub(storylineId) {
    const [{ getStoryline }, { loadEbook }] = await Promise.all([
        import('../../storage.js'),
        import('../store.js'),
    ]);
    const [storyline, ebook] = await Promise.all([getStoryline(storylineId), loadEbook(storylineId)]);
    if (!storyline || !ebook) throw new Error('This storyline does not have a saved ebook.');
    const result = await buildEpub(storyline, ebook);
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return result;
}

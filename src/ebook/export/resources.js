/** Fetch and localize ebook images and the Google reading font. */

const GOOGLE_FONT_CSS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';

const IMAGE_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
});

function sourceExtension(source) {
    const clean = String(source || '').split(/[?#]/, 1)[0].toLowerCase();
    const extension = clean.match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (extension === 'jpg' || extension === 'jpeg') return { mediaType: 'image/jpeg', extension: 'jpg' };
    if (['png', 'gif', 'webp'].includes(extension)) return { mediaType: `image/${extension}`, extension };
    if (extension === 'svg') return { mediaType: 'image/svg+xml', extension };
    return null;
}

function sniffImage(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mediaType: 'image/jpeg', extension: 'jpg' };
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mediaType: 'image/png', extension: 'png' };
    if (String.fromCharCode(...bytes.slice(0, 4)) === 'GIF8') return { mediaType: 'image/gif', extension: 'gif' };
    if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
        return { mediaType: 'image/webp', extension: 'webp' };
    }
    const prefix = new TextDecoder().decode(bytes.slice(0, 300)).trimStart();
    if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(prefix)) return { mediaType: 'image/svg+xml', extension: 'svg' };
    return null;
}

async function fetchImage(source) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const headerType = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    const knownHeader = IMAGE_EXTENSIONS[headerType]
        ? { mediaType: headerType, extension: IMAGE_EXTENSIONS[headerType] }
        : null;
    const format = knownHeader || sourceExtension(source) || sniffImage(bytes);
    if (!format) throw new Error('Unsupported ebook image format.');
    return { ...format, bytes };
}

function imagePlans(storyline, ebook) {
    const plans = new Map();
    const add = (source, assetId = null, cover = false) => {
        source = String(source || '').trim();
        if (!source) return;
        if (!plans.has(source)) plans.set(source, { source, assetIds: [], cover: false });
        const plan = plans.get(source);
        if (assetId) plan.assetIds.push(String(assetId));
        if (cover) plan.cover = true;
    };
    add(storyline?.coverImage, null, true);
    for (const asset of ebook?.assets || []) add(asset?.src, asset?.id, false);
    return [...plans.values()];
}

export async function collectImageResources(storyline, ebook) {
    const plans = imagePlans(storyline, ebook);
    const settled = await Promise.allSettled(plans.map(plan => fetchImage(plan.source)));
    const resources = [];
    const assetPaths = new Map();
    let coverPath = '';
    let skipped = 0;

    settled.forEach((result, index) => {
        const plan = plans[index];
        if (result.status !== 'fulfilled') {
            skipped++;
            return;
        }
        const format = result.value;
        const stem = plan.cover ? 'cover' : `image-${String(index + 1).padStart(3, '0')}`;
        const href = `images/${stem}.${format.extension}`;
        const resource = {
            id: `image-${index + 1}`,
            href,
            mediaType: format.mediaType,
            data: format.bytes,
            properties: plan.cover ? 'cover-image' : '',
        };
        resources.push(resource);
        if (plan.cover) coverPath = `../${href}`;
        for (const assetId of plan.assetIds) assetPaths.set(assetId, `../${href}`);
    });

    return { resources, assetPaths, coverPath, skipped };
}

function fontExtension(url, format) {
    const fromUrl = String(url).match(/\.(woff2?|ttf|otf)(?:[?#]|$)/i)?.[1]?.toLowerCase();
    if (fromUrl) return fromUrl;
    if (String(format).toLowerCase().includes('woff2')) return 'woff2';
    if (String(format).toLowerCase().includes('woff')) return 'woff';
    return 'woff2';
}

function fontMediaType(extension) {
    if (extension === 'woff') return 'font/woff';
    if (extension === 'ttf') return 'font/ttf';
    if (extension === 'otf') return 'font/otf';
    return 'font/woff2';
}

export async function collectGoogleFontResources() {
    try {
        const response = await fetch(GOOGLE_FONT_CSS);
        if (!response.ok) throw new Error(`Google Fonts stylesheet failed (${response.status}).`);
        const sourceCss = await response.text();
        const faces = sourceCss.match(/@font-face\s*\{[\s\S]*?\}/g) || [];
        const downloads = faces.map(async (face, index) => {
            const match = face.match(/url\((['"]?)(https?:\/\/[^)'"\s]+)\1\)\s*(?:format\((['"]?)([^)'"\s]+)\3\))?/i);
            if (!match) throw new Error('Google Fonts returned an unsupported source.');
            const url = match[2];
            const extension = fontExtension(url, match[4]);
            const fontResponse = await fetch(url);
            if (!fontResponse.ok) throw new Error(`Google font failed (${fontResponse.status}).`);
            const href = `fonts/cormorant-${String(index + 1).padStart(2, '0')}.${extension}`;
            return {
                css: face.replace(url, `../${href}`),
                resource: {
                    id: `font-${index + 1}`,
                    href,
                    mediaType: fontMediaType(extension),
                    data: new Uint8Array(await fontResponse.arrayBuffer()),
                },
            };
        });
        const settled = await Promise.allSettled(downloads);
        const loaded = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
        return {
            css: loaded.map(item => item.css).join('\n'),
            resources: loaded.map(item => item.resource),
            complete: loaded.length === faces.length && loaded.length > 0,
        };
    } catch {
        return { css: '', resources: [], complete: false };
    }
}

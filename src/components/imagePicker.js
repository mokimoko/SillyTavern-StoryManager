/**
 * components/imagePicker.js — cover / hero image picker for StoryManager
 *
 * Two sources (locked decision): upload a file, or paste an existing path/URL.
 * Uploads go through ST's /api/images/upload into a dedicated `storymanager`
 * sub-folder of user/images, preserving the original filename (lightly sanitised)
 * with a short timestamp suffix so the folder stays browsable and collision-free.
 * On upload we also generate a small JPEG thumbnail client-side and store it
 * alongside, so grids and cards can load the thumbnail instead of the full image.
 *
 * Value model: { url, thumb }
 *   - url   : served path of the full image (or a pasted path/URL), or null
 *   - thumb : served path of the generated thumbnail, or null (pasted URLs and
 *             already-small images have none → callers fall back to `url`)
 *
 * Export: renderImagePicker(container, current, onChange)
 *   - `current` accepts either a { url, thumb } object or a legacy plain string.
 *   - onChange({ url, thumb }) fires on upload, path-paste commit, or clear.
 */
import { getRequestHeaders } from '../../../../../../script.js';
import { escapeAttr, logWarn, logError } from '../display/util.js';

const UPLOAD_FOLDER = 'storymanager';
const THUMB_MAX = 640;       // longest edge (px) for generated thumbnails
const THUMB_QUALITY = 0.9;   // JPEG quality for thumbnails
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — guard against accidental raw drops

// ============================================================
// Value helpers
// ============================================================

/** Accept legacy strings or { url, thumb } objects → always { url, thumb }. */
function normalize(value) {
    if (!value) return { url: null, thumb: null };
    if (typeof value === 'string') return { url: value, thumb: null };
    return { url: value.url || null, thumb: value.thumb || null };
}

// ============================================================
// Upload + thumbnail
// ============================================================

/** Read a Blob/File into base64 (strips the data: prefix for the API body). */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(blob);
    });
}

/** POST base64 image data to ST's image store; resolves to the served path. */
async function postImage(base64, format, filename) {
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ image: base64, format, filename, ch_name: UPLOAD_FOLDER }),
    });
    if (!response.ok) {
        throw new Error(`Upload failed: ${await response.text()}`);
    }
    return (await response.json()).path;
}

/**
 * Derive a readable, browsable filename from the uploaded file: keep the original
 * name (so ChatGPT-style exports stay recognizable in the folder), lightly sanitise
 * it, and cap the length. A short base36 timestamp suffix (added by the caller) keeps
 * names unique without clobbering same-named uploads.
 */
function safeBaseName(file) {
    const raw = (file.name || 'image').replace(/\.[^.]+$/, '');
    const cleaned = raw.trim()
        .replace(/[^\w.-]+/g, '_')   // spaces / punctuation → underscore
        .replace(/_+/g, '_')
        .replace(/^[._-]+|[._-]+$/g, '');
    return (cleaned || 'image').slice(0, 60);
}

/**
 * High-quality downscale: halve the source step-by-step until within 2x of the
 * target, then a final smoothed draw. Stepped halving avoids the softness/aliasing a
 * single large reduction produces. White matte so transparent PNGs don't flatten to
 * black when encoded as JPEG.
 */
function downscaleStepped(img, targetW, targetH) {
    let src = img;
    let curW = img.width;
    let curH = img.height;
    while (curW > targetW * 2 && curH > targetH * 2) {
        const stepW = Math.max(targetW, Math.floor(curW / 2));
        const stepH = Math.max(targetH, Math.floor(curH / 2));
        const step = document.createElement('canvas');
        step.width = stepW;
        step.height = stepH;
        const sctx = step.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(src, 0, 0, stepW, stepH);
        src = step;
        curW = stepW;
        curH = stepH;
    }
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const cx = out.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, targetW, targetH);
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, targetW, targetH);
    return out;
}

/**
 * Downscale a File to a JPEG thumbnail (longest edge <= THUMB_MAX).
 * Resolves to a Blob, or null when there's no benefit (image already small) or the
 * source can't be decoded to a canvas — in which case callers reuse the full image.
 */
function makeThumbnailBlob(file) {
    return new Promise((resolve) => {
        const objUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const longest = Math.max(img.width, img.height);
            if (!longest || longest <= THUMB_MAX) { URL.revokeObjectURL(objUrl); resolve(null); return; }
            const scale = THUMB_MAX / longest;
            const targetW = Math.max(1, Math.round(img.width * scale));
            const targetH = Math.max(1, Math.round(img.height * scale));
            try {
                const canvas = downscaleStepped(img, targetW, targetH);
                URL.revokeObjectURL(objUrl);
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', THUMB_QUALITY);
            } catch (e) {
                URL.revokeObjectURL(objUrl);
                resolve(null);
            }
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
        img.src = objUrl;
    });
}

/**
 * Upload an image File -> { url, thumb }. The full image always uploads; the
 * thumbnail is best-effort (failure or a too-small source just yields thumb=null).
 *
 * Exported so other surfaces (e.g. the chat-gallery uploader in storylineTab)
 * reuse the same stepped-downscale + thumbnail pipeline instead of duplicating it.
 */
export async function uploadImage(file) {
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(`File too large (${sizeMB} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
    }
    const format = (file.type.split('/')[1] || 'png').toLowerCase();
    const base = `${safeBaseName(file)}_${Date.now().toString(36)}`;

    const url = await postImage(await blobToBase64(file), format, base);

    let thumb = null;
    try {
        const blob = await makeThumbnailBlob(file);
        if (blob) thumb = await postImage(await blobToBase64(blob), 'jpeg', `${base}_thumb`);
    } catch (e) {
        logWarn('thumbnail generation failed; using full image:', e);
    }

    return { url, thumb };
}

// ============================================================
// Render
// ============================================================

export function renderImagePicker(container, current, onChange) {
    const value = normalize(current);
    const url = value.url;

    container.innerHTML = `
        <div class="sm-imagepicker">
            <div class="sm-image-preview ${url ? '' : 'sm-image-empty'}">
                ${url
                    ? `<img src="${escapeAttr(url)}" alt="cover preview" />
                       <button class="sm-image-clear sm-btn-icon" title="Remove image">
                           <i class="fa-solid fa-xmark"></i>
                       </button>`
                    : `<i class="fa-solid fa-image"></i><span>No image</span>`}
            </div>
            <div class="sm-image-controls">
                <label class="sm-btn sm-btn-accent sm-image-upload-btn">
                    <i class="fa-solid fa-upload"></i> Upload
                    <input type="file" accept="image/*" class="sm-image-file" hidden />
                </label>
                <div class="sm-image-path">
                    <input type="text" class="sm-input sm-image-path-input"
                           placeholder="…or paste image path / URL" value="${escapeAttr(url || '')}" />
                    <button class="sm-btn sm-btn-ghost sm-image-path-apply" title="Use this path">
                        <i class="fa-solid fa-check"></i>
                    </button>
                </div>
                <div class="sm-image-status" hidden></div>
            </div>
        </div>
    `;

    wire(container, onChange);
}

// ============================================================
// Wiring
// ============================================================

function wire(container, onChange) {
    const status = container.querySelector('.sm-image-status');
    const fileInput = container.querySelector('.sm-image-file');
    const pathInput = container.querySelector('.sm-image-path-input');
    const pathApply = container.querySelector('.sm-image-path-apply');
    const clearBtn = container.querySelector('.sm-image-clear');

    const setStatus = (msg, isError = false) => {
        if (!status) return;
        status.hidden = !msg;
        status.textContent = msg || '';
        status.classList.toggle('sm-image-status-error', isError);
    };

    const commit = (next) => {
        onChange?.(next);
        // Re-render to refresh the preview/clear button against the new value.
        renderImagePicker(container, next, onChange);
    };

    // Upload flow (full image + best-effort thumbnail).
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        setStatus('Uploading…');
        try {
            commit(await uploadImage(file));
        } catch (e) {
            logError('image upload failed:', e);
            setStatus(e.message || 'Upload failed', true);
        }
    });

    // Paste-path apply (button or Enter) — no thumbnail for external/pasted paths.
    const applyPath = () => {
        const val = pathInput.value.trim();
        commit({ url: val || null, thumb: null });
    };
    pathApply?.addEventListener('click', applyPath);
    pathInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyPath(); }
    });

    // Clear.
    clearBtn?.addEventListener('click', () => commit({ url: null, thumb: null }));
}

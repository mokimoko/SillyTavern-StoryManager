/** Per-storyline ebook persistence through SillyTavern's user-file API. */

import { getRequestHeaders } from '../../../../../../script.js';
import { flushStore } from '../fileStore.js';
import { getStoryline, updateStoryline } from '../storage.js';
import { logError } from '../display/util.js';
import { encodeBase64Json, parseEbookJSON } from './codec.js';
import {
    EBOOK_VERSION,
    countDocumentWords,
    createEbookDocument,
    normalizeEbookDocument,
} from './model.js';

const FILE_PREFIX = 'archive_storymanager_ebook_';

export function ebookFileName(storylineId) {
    const safeId = String(storylineId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safeId) throw new Error('A storyline id is required.');
    return `${FILE_PREFIX}${safeId}.json`;
}

function ebookFileUrl(storylineId) {
    return `/user/files/${ebookFileName(storylineId)}`;
}

async function uploadDocument(document) {
    const name = ebookFileName(document.storylineId);
    const data = await encodeBase64Json(document);
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, data }),
    });
    if (!response.ok) throw new Error(`Ebook save failed: ${await response.text()}`);
    return (await response.json()).path || `user/files/${name}`;
}

export async function loadEbook(storylineId) {
    const storyline = await getStoryline(storylineId);
    if (!storyline) return null;
    const response = await fetch(ebookFileUrl(storylineId), {
        method: 'GET',
        headers: getRequestHeaders(),
        cache: 'no-store',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Ebook load failed: ${await response.text()}`);
    return normalizeEbookDocument(parseEbookJSON(await response.text()), storyline);
}

export async function loadOrCreateEbook(storylineId) {
    const storyline = await getStoryline(storylineId);
    if (!storyline) throw new Error('Storyline not found.');
    return (await loadEbook(storylineId)) || createEbookDocument(storyline);
}

export async function saveEbook(value) {
    const storyline = await getStoryline(value?.storylineId);
    if (!storyline) throw new Error('Storyline not found.');
    const document = normalizeEbookDocument(value, storyline);
    document.title = storyline.title || document.title;
    document.updatedAt = Date.now();
    const path = await uploadDocument(document);
    const words = countDocumentWords(document);
    await updateStoryline(storyline.id, {
        ebook: {
            version: EBOOK_VERSION,
            file: path,
            updatedAt: document.updatedAt,
            chapterCount: document.chapters.length,
            wordCount: words,
        },
    });
    await flushStore();
    return document;
}

export async function deleteEbookFile(storylineId) {
    const path = `user/files/${ebookFileName(storylineId)}`;
    try {
        const response = await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Ebook delete failed: ${await response.text()}`);
        }
        return response.ok;
    } catch (error) {
        logError('Failed to delete ebook file:', error);
        throw error;
    }
}

export async function deleteEbook(storylineId) {
    const storyline = await getStoryline(storylineId);
    if (!storyline) return false;
    await deleteEbookFile(storylineId);
    await updateStoryline(storylineId, { ebook: null });
    await flushStore();
    return true;
}

export function storylineHasEbook(storyline) {
    return !!storyline?.ebook?.file;
}

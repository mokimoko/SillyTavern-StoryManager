/** UTF-8 JSON encoding helpers for SillyTavern's base64 user-file API. */

export async function encodeBase64Json(data) {
    const json = JSON.stringify(data);
    if (globalThis.Blob && globalThis.FileReader) {
        return new Promise((resolve, reject) => {
            const reader = new globalThis.FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                const separator = result.indexOf(',');
                if (separator < 0) reject(new Error('Ebook encoding failed.'));
                else resolve(result.slice(separator + 1));
            };
            reader.onerror = () => reject(reader.error || new Error('Ebook encoding failed.'));
            reader.readAsDataURL(new globalThis.Blob([json], { type: 'application/json;charset=utf-8' }));
        });
    }

    const bytes = new TextEncoder().encode(json);
    let binary = '';
    const CHUNK = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    }
    return btoa(binary);
}

export function decodeBase64Text(text) {
    const binary = atob(String(text || '').trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export function parseEbookJSON(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        try {
            return JSON.parse(decodeBase64Text(text));
        } catch {
            throw error;
        }
    }
}

/** Minimal ZIP writer for self-contained EPUB downloads. Entries use STORE compression. */

const encoder = new TextEncoder();

let crcTable = null;

function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        crcTable[n] = value >>> 0;
    }
    return crcTable;
}

export function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date) {
    const value = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
    const year = Math.max(1980, value.getFullYear());
    return {
        time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    };
}

function concatBytes(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function header(size) {
    const bytes = new Uint8Array(size);
    return { bytes, view: new DataView(bytes.buffer) };
}

async function entryBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return encoder.encode(String(data ?? ''));
}

/** Build a standards-compliant, non-ZIP64 archive from [{ name, data }]. */
export async function createStoredZip(entries, modifiedAt = new Date()) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('A ZIP needs at least one entry.');
    if (entries.length > 0xffff) throw new Error('ZIP64 archives are not supported.');

    const timestamp = dosTimestamp(modifiedAt);
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const entry of entries) {
        const name = encoder.encode(String(entry?.name || '').replace(/\\/g, '/'));
        const data = await entryBytes(entry?.data);
        if (!name.length) throw new Error('ZIP entries require a name.');
        if (name.length > 0xffff || data.length > 0xffffffff) throw new Error('ZIP entry is too large.');

        const checksum = crc32(data);
        const local = header(30);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, 0x0800, true);
        local.view.setUint16(8, 0, true);
        local.view.setUint16(10, timestamp.time, true);
        local.view.setUint16(12, timestamp.date, true);
        local.view.setUint32(14, checksum, true);
        local.view.setUint32(18, data.length, true);
        local.view.setUint32(22, data.length, true);
        local.view.setUint16(26, name.length, true);
        local.view.setUint16(28, 0, true);
        localParts.push(local.bytes, name, data);

        const central = header(46);
        central.view.setUint32(0, 0x02014b50, true);
        central.view.setUint16(4, 20, true);
        central.view.setUint16(6, 20, true);
        central.view.setUint16(8, 0x0800, true);
        central.view.setUint16(10, 0, true);
        central.view.setUint16(12, timestamp.time, true);
        central.view.setUint16(14, timestamp.date, true);
        central.view.setUint32(16, checksum, true);
        central.view.setUint32(20, data.length, true);
        central.view.setUint32(24, data.length, true);
        central.view.setUint16(28, name.length, true);
        central.view.setUint16(30, 0, true);
        central.view.setUint16(32, 0, true);
        central.view.setUint16(34, 0, true);
        central.view.setUint16(36, 0, true);
        central.view.setUint32(38, 0, true);
        central.view.setUint32(42, localOffset, true);
        centralParts.push(central.bytes, name);

        localOffset += local.bytes.length + name.length + data.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = header(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(4, 0, true);
    end.view.setUint16(6, 0, true);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralDirectory.length, true);
    end.view.setUint32(16, localOffset, true);
    end.view.setUint16(20, 0, true);

    return concatBytes([...localParts, centralDirectory, end.bytes]);
}

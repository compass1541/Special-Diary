export const BACKUP_FORMAT = 'special-diary-backup';
export const BACKUP_VERSION = 1;

const MAX_ENTRIES = 10000;
const MAX_CONTENT_LENGTH = 50000;
const MAX_COMMENT_LENGTH = 100;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCalendarDateId(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function normalizeTimestamp(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeEntry(entry, index, now) {
    if (!isPlainObject(entry)) {
        throw new Error(`${index + 1}\uBC88\uC9F8 \uC77C\uAE30\uAC00 \uC62C\uBC14\uB978 \uAC1D\uCCB4 \uD615\uC2DD\uC774 \uC544\uB2D9\uB2C8\uB2E4.`);
    }
    if (typeof entry.id !== 'string' || !isCalendarDateId(entry.id)) {
        throw new Error(`${index + 1}\uBC88\uC9F8 \uC77C\uAE30\uC758 \uB0A0\uC9DC ID\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
    }
    if (typeof entry.date !== 'string' || !Number.isFinite(Date.parse(entry.date))) {
        throw new Error(`${entry.id} \uC77C\uAE30\uC758 \uB0A0\uC9DC \uAC12\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
    }
    if (typeof entry.content !== 'string') {
        throw new Error(`${entry.id} \uC77C\uAE30\uC758 \uB0B4\uC6A9\uC740 \uBB38\uC790\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.`);
    }
    if (entry.content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`${entry.id} \uC77C\uAE30 \uB0B4\uC6A9\uC740 50,000\uC790\uB97C \uB118\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
    }

    const dailyComment = entry.dailyComment ?? '';
    if (typeof dailyComment !== 'string') {
        throw new Error(`${entry.id} \uC77C\uAE30\uC758 \uD55C \uC904 \uC694\uC57D\uC740 \uBB38\uC790\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.`);
    }
    if (dailyComment.length > MAX_COMMENT_LENGTH) {
        throw new Error(`${entry.id} \uC77C\uAE30\uC758 \uD55C \uC904 \uC694\uC57D\uC740 100\uC790\uB97C \uB118\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
    }

    const createdAt = normalizeTimestamp(entry.createdAt, now);
    const updatedAt = normalizeTimestamp(entry.updatedAt, createdAt);

    return {
        id: entry.id,
        date: entry.date,
        content: entry.content,
        dailyComment,
        createdAt,
        updatedAt,
    };
}

function normalizeEntries(entries) {
    if (!Array.isArray(entries)) {
        throw new Error('\uC77C\uAE30 \uBAA9\uB85D\uC774 \uC5C6\uB294 \uBC31\uC5C5 \uD30C\uC77C\uC785\uB2C8\uB2E4.');
    }
    if (entries.length > MAX_ENTRIES) {
        throw new Error(`\uD55C \uBC88\uC5D0 ${MAX_ENTRIES.toLocaleString()}\uAC1C\uAE4C\uC9C0 \uAC00\uC838\uC62C \uC218 \uC788\uC2B5\uB2C8\uB2E4.`);
    }

    const now = Date.now();
    const ids = new Set();
    return entries.map((entry, index) => {
        const normalized = normalizeEntry(entry, index, now);
        if (ids.has(normalized.id)) {
            throw new Error(`\uC911\uBCF5\uB41C \uB0A0\uC9DC(${normalized.id})\uAC00 \uBC31\uC5C5 \uD30C\uC77C\uC5D0 \uC788\uC2B5\uB2C8\uB2E4.`);
        }
        ids.add(normalized.id);
        return normalized;
    });
}

export function createBackup(entries, exportedAt = new Date()) {
    return JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: exportedAt.toISOString(),
        entries: normalizeEntries(entries),
    }, null, 2);
}

export function parseBackup(jsonString) {
    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch {
        throw new Error('JSON \uD615\uC2DD\uC744 \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
    }

    if (Array.isArray(parsed)) {
        return normalizeEntries(parsed);
    }
    if (!isPlainObject(parsed)
        || parsed.format !== BACKUP_FORMAT
        || parsed.version !== BACKUP_VERSION) {
        throw new Error('\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBC31\uC5C5 \uD615\uC2DD\uC774\uAC70\uB098 \uBC84\uC804\uC785\uB2C8\uB2E4.');
    }

    return normalizeEntries(parsed.entries);
}

export function getImportSummary(importedEntries, existingEntries) {
    const existingIds = new Set(existingEntries.map((item) => item.id));
    const conflicts = importedEntries.filter((item) => existingIds.has(item.id)).length;
    return {
        total: importedEntries.length,
        conflicts,
        additions: importedEntries.length - conflicts,
    };
}

import { describe, expect, it } from 'vitest';
import { createBackup, getImportSummary, parseBackup } from './backup.js';

const entry = {
    id: '2026-08-24',
    date: '2026-08-23T15:00:00.000Z',
    content: '오늘의 기록',
    dailyComment: '차분한 하루',
    createdAt: 1787497200000,
    updatedAt: 1787497200000,
};

describe('diary backup format', () => {
    it('exports a versioned backup envelope', () => {
        const json = createBackup([entry], new Date('2026-08-24T00:00:00.000Z'));

        expect(JSON.parse(json)).toEqual({
            format: 'special-diary-backup',
            version: 1,
            exportedAt: '2026-08-24T00:00:00.000Z',
            entries: [entry],
        });
    });

    it('imports both versioned backups and legacy array backups', () => {
        expect(parseBackup(createBackup([entry]))).toEqual([entry]);
        expect(parseBackup(JSON.stringify([entry]))).toEqual([entry]);
    });

    it('rejects malformed, duplicate, or unsafe entries before writing anything', () => {
        expect(() => parseBackup(JSON.stringify({ entries: [entry] }))).toThrow('지원하지 않는 백업');
        expect(() => parseBackup(JSON.stringify([entry, entry]))).toThrow('중복된 날짜');
        expect(() => parseBackup(JSON.stringify([{ ...entry, id: '2026-02-30' }]))).toThrow('날짜 ID');
        expect(() => parseBackup(JSON.stringify([{ ...entry, content: 'x'.repeat(50001) }]))).toThrow('내용은 50,000자');
    });

    it('fills optional fields with safe defaults and drops unknown fields', () => {
        const [normalized] = parseBackup(JSON.stringify([{
            id: entry.id,
            date: entry.date,
            content: '기록',
            extra: 'ignore me',
        }]));

        expect(normalized).toEqual({
            id: entry.id,
            date: entry.date,
            content: '기록',
            dailyComment: '',
            createdAt: expect.any(Number),
            updatedAt: expect.any(Number),
        });
        expect(normalized).not.toHaveProperty('extra');
    });

    it('reports how many imported dates will overwrite existing entries', () => {
        expect(getImportSummary([entry, { ...entry, id: '2026-08-25' }], [entry])).toEqual({
            total: 2,
            conflicts: 1,
            additions: 1,
        });
    });
});

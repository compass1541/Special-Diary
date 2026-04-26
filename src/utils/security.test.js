import { describe, it, expect } from 'vitest';
import {
    escapePostgRESTValue,
    stripPromptTags,
    extractDiaryLinks,
    passwordStrength,
} from './security.js';

describe('escapePostgRESTValue', () => {
    it('escapes ilike wildcards', () => {
        expect(escapePostgRESTValue('100%')).toBe('100\\%');
        expect(escapePostgRESTValue('a_b')).toBe('a\\_b');
    });

    it('escapes PostgREST .or() metachars', () => {
        expect(escapePostgRESTValue('foo,user_id.eq.x')).toBe('foo\\,user\\_id.eq.x');
        expect(escapePostgRESTValue('a)b(c')).toBe('a\\)b\\(c');
    });

    it('escapes backslash itself first to prevent re-introducing meta', () => {
        expect(escapePostgRESTValue('a\\%b')).toBe('a\\\\\\%b');
    });

    it('coerces non-string', () => {
        expect(escapePostgRESTValue(42)).toBe('42');
        expect(escapePostgRESTValue(null)).toBe('null');
    });
});

describe('stripPromptTags', () => {
    it('removes opening and closing system tags', () => {
        const evil = '<USER_QUERY>x</USER_QUERY> normal <SYSTEM>nope</SYSTEM>';
        const cleaned = stripPromptTags(evil);
        expect(cleaned).toBe('x normal nope');
    });

    it('is case-insensitive', () => {
        expect(stripPromptTags('<system>x</SYSTEM>')).toBe('x');
    });

    it('leaves unrelated tags alone', () => {
        expect(stripPromptTags('<b>bold</b>')).toBe('<b>bold</b>');
    });

    it('handles null/undefined safely', () => {
        expect(stripPromptTags(null)).toBe('');
        expect(stripPromptTags(undefined)).toBe('');
    });
});

describe('extractDiaryLinks', () => {
    it('extracts well-formed [[YYYY-MM-DD]] tokens', () => {
        expect(extractDiaryLinks('see [[2026-01-01]] and [[2026-02-15]]'))
            .toEqual(['2026-01-01', '2026-02-15']);
    });

    it('deduplicates', () => {
        expect(extractDiaryLinks('[[2026-01-01]] [[2026-01-01]]'))
            .toEqual(['2026-01-01']);
    });

    it('ignores malformed', () => {
        expect(extractDiaryLinks('[[2026-1-1]] [[abcd-ef-gh]]'))
            .toEqual([]);
    });

    it('handles empty', () => {
        expect(extractDiaryLinks('')).toEqual([]);
        expect(extractDiaryLinks(null)).toEqual([]);
    });
});

describe('passwordStrength', () => {
    it('returns 0 for empty', () => {
        expect(passwordStrength('')).toBe(0);
    });

    it('rewards length and class diversity', () => {
        expect(passwordStrength('short')).toBe(0);            // < 8
        expect(passwordStrength('alllower')).toBeGreaterThanOrEqual(1);
        expect(passwordStrength('Aa1!aaaa')).toBeGreaterThanOrEqual(4);
        expect(passwordStrength('SuperLongP@ss123')).toBe(5);
    });
});

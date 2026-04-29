import { describe, it, expect } from 'vitest';
import {
    tokenize,
    computeStats,
    topKeywords,
    findKeywordPairs,
    assignClusters,
    clusterColor,
} from './keywords.js';

describe('tokenize', () => {
    it('extracts Korean and English tokens', () => {
        const t = tokenize('오늘 친구 만나서 happy 했다');
        expect(t).toContain('친구');
        expect(t).toContain('만나서');
        expect(t).toContain('happy');
    });

    it('drops stopwords', () => {
        expect(tokenize('나는 그리고 너무 좋다')).not.toContain('나는');
        expect(tokenize('나는 그리고 너무 좋다')).not.toContain('그리고');
    });

    it('drops 1-char tokens and pure digits', () => {
        expect(tokenize('a 1234 b')).toEqual([]);
    });

    it('handles empty / null', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize(null)).toEqual([]);
    });
});

describe('computeStats / topKeywords', () => {
    const entries = [
        { id: '2026-01-01', content: '운동 했다 운동 즐거웠다' },
        { id: '2026-01-02', content: '독서 깊은 내용 흥미' },
        { id: '2026-01-03', content: '운동 후 독서 좋다' },
    ];

    it('TF-IDF ranks repeated terms higher', () => {
        const stats = computeStats(entries);
        const top = topKeywords('2026-01-01', stats, 3);
        expect(top[0]).toBe('운동');
    });

    it('skips terms in >70% of docs once corpus has >=5 entries', () => {
        const docs = [];
        for (let i = 0; i < 6; i++) docs.push({ id: `d${i}`, content: '공통' });
        docs.push({ id: 'unique-doc', content: '공통 unique' });
        const stats = computeStats(docs);
        const top = topKeywords('unique-doc', stats, 2);
        expect(top).not.toContain('공통');
        expect(top).toContain('unique');
    });
});

describe('findKeywordPairs', () => {
    it('finds pairs sharing minShared keywords', () => {
        const entries = [
            { id: 'a', content: '운동 독서 영화 음악 산책' },
            { id: 'b', content: '운동 독서 영화 일기' },
            { id: 'c', content: '독서 일기' },
        ];
        const stats = computeStats(entries);
        const pairs = findKeywordPairs(stats, 2);
        const pairKeys = pairs.map(p => `${p.a}||${p.b}`);
        expect(pairKeys).toContain('a||b');
    });

    it('excludes pairs below threshold', () => {
        const entries = [
            { id: 'a', content: '운동 독서' },
            { id: 'b', content: '운동' },
        ];
        const stats = computeStats(entries);
        const pairs = findKeywordPairs(stats, 3);
        expect(pairs).toEqual([]);
    });
});

describe('assignClusters / clusterColor', () => {
    it('assigns same cluster to entries with same dominant keyword', () => {
        const entries = [
            { id: 'a', content: '운동 운동 운동 산책' },
            { id: 'b', content: '운동 운동 즐거움' },
            { id: 'c', content: '독서 깊은 책' },
        ];
        const stats = computeStats(entries);
        const clusters = assignClusters(entries, stats);
        expect(clusters.get('a')).toBe(clusters.get('b'));
        expect(clusters.get('a')).not.toBe(clusters.get('c'));
    });

    it('clusterColor is stable for same input', () => {
        expect(clusterColor('test')).toBe(clusterColor('test'));
    });

    it('clusterColor returns valid hsl', () => {
        expect(clusterColor('운동')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });

    it('misc cluster has reserved color', () => {
        expect(clusterColor('misc')).toMatch(/hsl\(220/);
    });
});

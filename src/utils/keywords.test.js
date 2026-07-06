import { describe, it, expect } from 'vitest';
import { tokenize, computeStats, topKeywords } from './keywords.js';

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

// findKeywordPairs / assignClusters / clusterColor는 그래프 2.0(키워드 허브)으로
// 대체되어 제거됨 — 클러스터·색상 로직과 테스트는 src/graph/data.js 쪽에 있다.

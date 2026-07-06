import { describe, it, expect } from 'vitest';
import { rankEntries } from './retrieval.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-01T12:00:00').getTime();

// 테스트 헬퍼: 오늘로부터 daysAgo일 전 엔트리
const E = (id, content, daysAgo = 0) => ({
    id,
    date: new Date(NOW - daysAgo * DAY).toISOString(),
    content,
    dailyComment: '',
});

describe('rankEntries', () => {
    it('질의 키워드가 등장하는 일기를 상위로 올린다', () => {
        const entries = [
            E('a', '고양이 병원에 다녀왔다. 고양이 상태가 걱정된다', 300),
            E('b', '회사 프로젝트 마감 준비', 1),
            E('c', '고양이 사료를 새로 샀다', 200),
        ];
        const ranked = rankEntries('고양이 건강 어땠지?', entries, { now: NOW });
        expect(ranked[0].id).toBe('a'); // 고양이 2회 등장
        expect(ranked[1].id).toBe('c');
        expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
    });

    it('키워드 점수가 같으면 최근 일기가 먼저 온다', () => {
        const entries = [
            E('old', '등산을 갔다', 400),
            E('new', '등산을 갔다', 2),
        ];
        const ranked = rankEntries('등산', entries, { now: NOW });
        expect(ranked[0].id).toBe('new');
    });

    it('키워드가 하나도 맞지 않으면 최근 순으로 반환한다', () => {
        const entries = [
            E('old', '독서 기록', 100),
            E('mid', '요리 연습', 50),
            E('new', '산책 일기', 1),
        ];
        const ranked = rankEntries('요즘 나 어때?', entries, { now: NOW });
        expect(ranked.map(r => r.id)).toEqual(['new', 'mid', 'old']);
    });

    it('limit을 지킨다', () => {
        const entries = Array.from({ length: 30 }, (_, i) => E(`e${i}`, `기록 ${i}번째 하루`, i));
        expect(rankEntries('아무거나', entries, { limit: 5, now: NOW })).toHaveLength(5);
    });

    it('빈 엔트리 배열이면 빈 배열', () => {
        expect(rankEntries('질문', [], { now: NOW })).toEqual([]);
    });
});

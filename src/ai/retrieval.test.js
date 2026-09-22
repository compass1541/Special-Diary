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

    it('날짜를 직접 물으면 오래된 해당 일기를 우선한다', () => {
        const entries = [{ id: '2025-01-01', date: '2025-01-01', content: '처음 만난 날' }, E('new', '일상', 1)];
        expect(rankEntries('2025-01-01에는 무슨 일이 있었어?', entries, { now: NOW })[0].id).toBe('2025-01-01');
    });

    it('이번 달 요약에는 다른 달의 키워드 일기를 섞지 않는다', () => {
        const entries = [E('old', '회사 회사 회사', 100), E('new', '등산', 0)];
        expect(rankEntries('이번 달 회사 생활은 어땠어?', entries, { now: NOW }).map(e => e.id)).toEqual(['new']);
    });

    it('지난달 기록이 없으면 다른 시기 기록을 대신 보내지 않는다', () => {
        expect(rankEntries('지난달 요약해줘', [E('new', '산책', 0)], { now: NOW })).toEqual([]);
    });

    it('31일에도 지난달은 올바른 달로 계산한다', () => {
        const entries = [
            { id: '2026-02-10', date: '2026-02-10', content: '지난달 기록' },
            { id: '2026-03-10', date: '2026-03-10', content: '이번달 기록' },
        ];
        const ranked = rankEntries('지난달 요약', entries, { now: new Date('2026-03-31T12:00:00').getTime() });
        expect(ranked.map(e => e.id)).toEqual(['2026-02-10']);
    });

    it('이번 달과 지난달 비교에는 두 달 모두 포함한다', () => {
        const entries = [E('june', '회사', 10), E('july', '휴식', 0), E('old', '회사', 100)];
        expect(rankEntries('지난달과 이번 달을 비교해줘', entries, { now: NOW }).map(e => e.id).sort()).toEqual(['july', 'june']);
    });

    it('명확한 새 주제는 이전 대화보다 우선한다', () => {
        const entries = [E('cat', '고양이 고양이 고양이', 1), E('work', '회사 프로젝트', 3)];
        const ranked = rankEntries('회사 프로젝트 이야기하자', entries, {
            now: NOW, history: [{ role: 'user', text: '고양이 건강 걱정돼' }], contextIds: ['cat'],
        });
        expect(ranked[0].id).toBe('work');
    });
});

import { describe, it, expect } from 'vitest';
import { buildGraphData, helixPositions, relatedEntries, paletteColor } from './data.js';
import { computeStats } from '../utils/keywords.js';

// 테스트 헬퍼: 날짜 ID와 본문으로 엔트리 생성
const E = (id, content) => ({
    id,
    date: new Date(`${id}T12:00:00`).toISOString(),
    content,
    dailyComment: '',
});

describe('buildGraphData', () => {
    it('빈 엔트리 → 빈 그래프', () => {
        const g = buildGraphData([]);
        expect(g.nodes).toEqual([]);
        expect(g.links).toEqual([]);
        expect(g.counts.entries).toBe(0);
        expect(g.counts.hubs).toBe(0);
    });

    it('명시적 [[링크]]를 만들고 자기참조·중복·없는 날짜는 무시한다', () => {
        const entries = [
            E('2026-01-01', '바다 사진 정리. [[2026-01-02]] 그리고 다시 [[2026-01-02]] [[2026-01-01]] [[2099-12-31]]'),
            E('2026-01-02', '바닷가 산책을 오래 했다'),
        ];
        const g = buildGraphData(entries);
        const explicit = g.links.filter(l => l.type === 'explicit');
        expect(explicit).toHaveLength(1);
        expect(explicit[0].source).toBe('2026-01-01');
        expect(explicit[0].target).toBe('2026-01-02');
        const a = g.nodes.find(n => n.id === '2026-01-01');
        const b = g.nodes.find(n => n.id === '2026-01-02');
        expect(a.explicitDeg).toBe(1);
        expect(b.explicitDeg).toBe(1);
    });

    it('2개 이상 일기가 공유하는 상위 키워드는 허브 노드로 승격된다', () => {
        const entries = [
            E('2026-01-01', '프로젝트 회의를 했다. 프로젝트 마감이 다가온다'),
            E('2026-01-02', '프로젝트 발표 준비. 프로젝트 자료 정리'),
            E('2026-01-03', '집에서 휴식하며 영화 감상'),
        ];
        const g = buildGraphData(entries);
        const hub = g.nodes.find(n => n.kind === 'keyword' && n.name === '프로젝트');
        expect(hub).toBeDefined();
        expect(hub.count).toBe(2);
        const kwLinks = g.links.filter(l => l.type === 'keyword' && l.target === hub.id);
        expect(kwLinks).toHaveLength(2);
        // 1개 일기에만 나온 단어는 허브가 아니다
        expect(g.nodes.find(n => n.kind === 'keyword' && n.name === '영화')).toBeUndefined();
    });

    it('maxHubs 옵션으로 허브 수를 제한한다', () => {
        const entries = [
            E('2026-01-01', '여행 바다 그림 운동 요리'),
            E('2026-01-02', '여행 바다 그림 운동 요리'),
            E('2026-01-03', '여행 바다 그림 운동 요리'),
        ];
        const g = buildGraphData(entries, { maxHubs: 2 });
        expect(g.counts.hubs).toBe(2);
    });

    it('시간순 링크는 30일 이하 간격만 연결한다', () => {
        const entries = [
            E('2026-01-01', '가나다라'),
            E('2026-01-05', '마바사아'),
            E('2026-03-01', '자차카타'),
        ];
        const g = buildGraphData(entries);
        const chrono = g.links.filter(l => l.type === 'chronology');
        expect(chrono).toHaveLength(1);
        expect(chrono[0].source).toBe('2026-01-01');
        expect(chrono[0].target).toBe('2026-01-05');
    });

    it('어떤 링크도 없는 노드는 고립으로 집계된다', () => {
        const entries = [
            E('2026-01-01', '무언가무언가'),
            E('2026-06-01', '다른내용다른내용'),
        ];
        const g = buildGraphData(entries);
        expect(g.counts.isolated).toBe(2);
    });

    it('지배 키워드가 달라도 공유 허브가 있으면 같은 클러스터로 묶인다', () => {
        // 각 엔트리의 1위 키워드(바다/산/도시)는 다르지만 모두 '여행'을 공유
        const entries = [
            E('2026-01-01', '바다 바다 여행'),
            E('2026-01-02', '산 산 여행'),
            E('2026-01-03', '도시 도시 여행'),
        ];
        const g = buildGraphData(entries);
        const travel = g.clusters.find(c => c.id === '여행');
        expect(travel).toBeDefined();
        expect(travel.size).toBe(3);
        for (const id of ['2026-01-01', '2026-01-02', '2026-01-03']) {
            expect(g.nodes.find(n => n.id === id).cluster).toBe('여행');
        }
    });

    it('클러스터 목록은 크기 내림차순이고 misc가 아닌 클러스터는 서로 다른 색을 가진다', () => {
        const entries = [
            E('2026-01-01', '그림 그림 그림 연습'),
            E('2026-01-02', '그림 그림 그림 스케치'),
            E('2026-01-03', '운동 운동 운동 달리기'),
        ];
        const g = buildGraphData(entries);
        expect(g.clusters.length).toBeGreaterThanOrEqual(2);
        expect(g.clusters[0].size).toBeGreaterThanOrEqual(g.clusters[1].size);
        const colors = g.clusters.filter(c => c.id !== 'misc').map(c => c.color);
        expect(new Set(colors).size).toBe(colors.length);
        // 엔트리 노드 색은 소속 클러스터 색과 일치
        const first = g.nodes.find(n => n.id === '2026-01-01');
        const firstCluster = g.clusters.find(c => c.id === first.cluster);
        expect(first.color).toBe(firstCluster.color);
    });
});

describe('helixPositions', () => {
    it('날짜순으로 y가 단조 증가하는 나선 좌표를 만든다', () => {
        const entries = [E('2026-02-01', 'b'), E('2026-01-01', 'a'), E('2026-03-01', 'c')];
        const g = buildGraphData(entries);
        const pos = helixPositions(g.nodes.filter(n => n.kind === 'entry'));
        const y1 = pos.get('2026-01-01').y;
        const y2 = pos.get('2026-02-01').y;
        const y3 = pos.get('2026-03-01').y;
        expect(y1).toBeLessThan(y2);
        expect(y2).toBeLessThan(y3);
        // 반지름 일정
        const r = (p) => Math.hypot(p.x, p.z);
        expect(r(pos.get('2026-01-01'))).toBeCloseTo(r(pos.get('2026-03-01')), 5);
    });

    it('엔트리 1개여도 좌표를 반환한다', () => {
        const pos = helixPositions([{ id: 'x', kind: 'entry', date: new Date().toISOString() }]);
        expect(pos.get('x')).toBeDefined();
    });
});

describe('relatedEntries', () => {
    it('공유 키워드가 많은 일기를 먼저 반환한다', () => {
        const entries = [
            E('2026-01-01', '바다 여행 사진 촬영'),
            E('2026-01-02', '바다 여행 사진 편집'),  // 3개 공유
            E('2026-01-03', '바다 낚시'),             // 1개 공유
            E('2026-01-04', '집 청소'),               // 0개 공유
        ];
        const stats = computeStats(entries);
        const related = relatedEntries('2026-01-01', entries, stats, 5);
        expect(related[0].id).toBe('2026-01-02');
        expect(related.map(r => r.id)).not.toContain('2026-01-04');
        expect(related.map(r => r.id)).not.toContain('2026-01-01');
        expect(related[0].shared).toContain('바다');
    });

    it('limit을 지킨다', () => {
        const entries = [
            E('2026-01-01', '별 하늘 관측'),
            E('2026-01-02', '별 하늘 사진'),
            E('2026-01-03', '별 하늘 일주'),
            E('2026-01-04', '별 하늘 은하'),
        ];
        const stats = computeStats(entries);
        expect(relatedEntries('2026-01-01', entries, stats, 2)).toHaveLength(2);
    });
});

describe('paletteColor', () => {
    it('인덱스마다 결정적이고 서로 다른 hue를 준다', () => {
        expect(paletteColor(0)).toBe(paletteColor(0));
        expect(paletteColor(0)).not.toBe(paletteColor(1));
        expect(paletteColor(1)).not.toBe(paletteColor(2));
    });
});

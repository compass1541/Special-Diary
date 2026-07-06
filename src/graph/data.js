/**
 * 그래프 데이터 빌더 — entries 배열을 3D 연결망용 {nodes, links, clusters, counts}로 변환.
 *
 * 구조 (2-모드 그래프):
 *   - 일기 노드(kind: 'entry')  — 클러스터 색, 연결도에 따라 크기 증가
 *   - 키워드 허브(kind: 'keyword') — 2개 이상 일기의 상위 키워드에 등장하는 단어.
 *     기존의 일기↔일기 키워드 쌍 링크(N²)를 일기↔허브 star 토폴로지로 대체해
 *     "왜 연결됐는가"가 화면 구조로 드러나게 한다.
 *
 * DOM/three.js 의존성 없는 순수 함수 (vitest 대상).
 */
import { computeStats, topKeywords } from '../utils/keywords.js';

const GOLDEN_ANGLE = 137.508; // 서로 최대한 떨어진 hue를 만드는 골든앵글
const LINK_REGEX = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;
const ONE_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const MISC_COLOR = 'hsl(220, 12%, 62%)';
export const HUB_COLOR = 'hsl(45, 95%, 68%)';

/** 클러스터 순위 → 결정적이고 서로 구분되는 HSL 색 */
export function paletteColor(index) {
    const hue = Math.round((index * GOLDEN_ANGLE) % 360);
    return `hsl(${hue}, 84%, 66%)`;
}

function displayName(date, withYear) {
    const d = new Date(date);
    const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
    return withYear ? `${String(d.getFullYear()).slice(2)}년 ${base}` : base;
}

/**
 * @param {Array} entries 일기 엔트리 배열
 * @param {object} options
 *   maxHubs              허브 노드 최대 개수 (연결 일기 수 내림차순으로 선별)
 *   hubKeywordsPerEntry  허브 후보로 볼 엔트리당 상위 키워드 수
 *   chronoMaxGapDays     시간순 인접 링크의 최대 간격(일)
 * @returns {{ nodes, links, clusters, counts, stats }}
 */
export function buildGraphData(entries, options = {}) {
    const {
        maxHubs = 40,
        hubKeywordsPerEntry = 8,
        chronoMaxGapDays = 30,
    } = options;

    if (!entries || entries.length === 0) {
        return {
            nodes: [], links: [],
            clusters: [],
            counts: { entries: 0, hubs: 0, explicit: 0, keyword: 0, chronology: 0, isolated: 0 },
            stats: computeStats([]),
        };
    }

    const stats = computeStats(entries);

    // 엔트리별 상위 키워드 — 허브 후보 + 클러스터 지정 + 사이드패널 표시에 재사용
    const topByEntry = new Map();
    for (const e of entries) {
        topByEntry.set(e.id, topKeywords(e.id, stats, hubKeywordsPerEntry));
    }

    // ---- 허브 후보 집계 (클러스터 지정과 허브 노드 생성에 공용)
    const hubCandidates = new Map(); // term -> entryId[]
    for (const [entryId, kws] of topByEntry) {
        for (const term of kws) {
            let arr = hubCandidates.get(term);
            if (!arr) { arr = []; hubCandidates.set(term, arr); }
            arr.push(entryId);
        }
    }

    // ---- 클러스터: 엔트리의 상위 키워드 중 "가장 큰 커뮤니티(허브)"에 소속.
    //      지배 키워드 단독 기준은 거의 모든 클러스터가 크기 1이 되는 문제가 있어,
    //      공유 키워드(허브) 기준으로 묶는다. 허브가 없으면 지배 키워드(단독 클러스터).
    const clusterOf = new Map();
    const clusterSize = new Map();
    for (const e of entries) {
        const kws = topByEntry.get(e.id) || [];
        let best = null;
        let bestCount = 1; // 2개 이상 공유될 때만 허브 클러스터로 인정
        for (const term of kws) {
            const count = hubCandidates.get(term)?.length || 0;
            if (count > bestCount) { best = term; bestCount = count; }
        }
        const cluster = best || kws[0] || 'misc';
        clusterOf.set(e.id, cluster);
        clusterSize.set(cluster, (clusterSize.get(cluster) || 0) + 1);
    }
    const clusterColorMap = new Map();
    let colorIdx = 0;
    const clusters = [...clusterSize.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id, size]) => {
            const color = id === 'misc' ? MISC_COLOR : paletteColor(colorIdx++);
            clusterColorMap.set(id, color);
            return { id, size, color };
        });

    // ---- 일기 노드
    const yearSpan = new Set(entries.map(e => new Date(e.date).getFullYear())).size > 1;
    const nodeMap = new Map();
    const entryNodes = entries.map(e => {
        const cluster = clusterOf.get(e.id);
        const node = {
            id: e.id,
            kind: 'entry',
            name: displayName(e.date, yearSpan),
            date: e.date,
            cluster,
            color: clusterColorMap.get(cluster),
            val: 2,
            explicitDeg: 0,
            keywordDeg: 0,
            preview: e.content ? e.content.slice(0, 200) : '내용 없음',
            fullContent: e.content || '',
            keywords: (topByEntry.get(e.id) || []).slice(0, 6),
        };
        nodeMap.set(e.id, node);
        return node;
    });

    const links = [];

    // ---- 명시 링크: [[YYYY-MM-DD]] (자기참조·중복·없는 날짜 무시)
    for (const e of entries) {
        if (!e.content) continue;
        const seen = new Set();
        for (const match of e.content.matchAll(LINK_REGEX)) {
            const target = match[1];
            if (target === e.id || seen.has(target) || !nodeMap.has(target)) continue;
            seen.add(target);
            links.push({ source: e.id, target, type: 'explicit' });
            nodeMap.get(e.id).explicitDeg += 1;
            nodeMap.get(target).explicitDeg += 1;
            nodeMap.get(e.id).val += 1;
            nodeMap.get(target).val += 1;
        }
    }

    // ---- 키워드 허브: 2개 이상 엔트리의 상위 키워드에 등장하는 단어를 노드로 승격
    const hubNodes = [...hubCandidates.entries()]
        .filter(([, ids]) => ids.length >= 2)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, maxHubs)
        .map(([term, ids]) => {
            const hub = {
                id: `kw:${term}`,
                kind: 'keyword',
                name: term,
                count: ids.length,
                color: HUB_COLOR,
                val: 2 + Math.min(ids.length * 0.8, 8),
            };
            for (const entryId of ids) {
                links.push({ source: entryId, target: hub.id, type: 'keyword' });
                nodeMap.get(entryId).keywordDeg += 1;
                nodeMap.get(entryId).val += 0.4;
            }
            return hub;
        });

    // ---- 시간순 인접 링크: 연속한 두 일기의 간격이 chronoMaxGapDays 이하일 때만
    const sortedByDate = [...entries].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    for (let i = 0; i < sortedByDate.length - 1; i++) {
        const a = sortedByDate[i];
        const b = sortedByDate[i + 1];
        const gapDays = Math.abs(new Date(b.date) - new Date(a.date)) / ONE_DAY;
        if (gapDays > chronoMaxGapDays) continue;
        links.push({ source: a.id, target: b.id, type: 'chronology', gapDays });
    }

    // ---- 집계
    const linkedIds = new Set();
    for (const l of links) { linkedIds.add(l.source); linkedIds.add(l.target); }
    const counts = {
        entries: entryNodes.length,
        hubs: hubNodes.length,
        explicit: links.filter(l => l.type === 'explicit').length,
        keyword: links.filter(l => l.type === 'keyword').length,
        chronology: links.filter(l => l.type === 'chronology').length,
        isolated: entryNodes.filter(n => !linkedIds.has(n.id)).length,
    };

    return { nodes: [...entryNodes, ...hubNodes], links, clusters, counts, stats };
}

/**
 * 시간 나선 레이아웃 — 일기 노드를 날짜순 헬릭스 위에 배치할 좌표를 계산.
 * y축이 시간축(과거 아래 → 최근 위). 허브 노드는 고정하지 않는다(force가 배치).
 *
 * @param {Array} entryNodes kind==='entry'인 노드 배열
 * @returns {Map<string, {x,y,z}>}
 */
export function helixPositions(entryNodes, options = {}) {
    const { radius = 160, perTurn = 8, minHeight = 280, step = 24 } = options;
    const sorted = [...entryNodes].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const n = sorted.length;
    const height = Math.max(minHeight, n * step);
    const angleStep = (Math.PI * 2) / perTurn;
    const positions = new Map();
    sorted.forEach((node, i) => {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const angle = i * angleStep;
        positions.set(node.id, {
            x: radius * Math.cos(angle),
            y: -height / 2 + t * height,
            z: radius * Math.sin(angle),
        });
    });
    return positions;
}

/**
 * 공유 키워드 기준 관련 일기 — 사이드패널 "관련 일기" 목록용.
 * score = Σ (공유 단어별 min(tfA, tfB) × idf)
 *
 * @returns {Array<{id, score, shared: string[]}>} score 내림차순, 자기 자신 제외
 */
export function relatedEntries(entryId, entries, stats, limit = 5) {
    const mine = stats.tf.get(entryId);
    if (!mine || mine.size === 0) return [];
    const totalDocs = stats.totalDocs || 1;

    const results = [];
    for (const e of entries) {
        if (e.id === entryId) continue;
        const theirs = stats.tf.get(e.id);
        if (!theirs) continue;
        let score = 0;
        const contributions = [];
        for (const [term, myCount] of mine) {
            const theirCount = theirs.get(term);
            if (!theirCount) continue;
            const docFreq = stats.df.get(term) || 1;
            const idf = Math.log(1 + totalDocs / docFreq);
            const c = Math.min(myCount, theirCount) * idf;
            score += c;
            contributions.push({ term, c });
        }
        if (score <= 0) continue;
        contributions.sort((a, b) => b.c - a.c);
        results.push({ id: e.id, score, shared: contributions.slice(0, 3).map(x => x.term) });
    }
    results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return results.slice(0, limit);
}

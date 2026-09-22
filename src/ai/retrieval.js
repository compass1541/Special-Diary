/**
 * 로컬 retrieval — AI 분신에게 보낼 관련 일기를 고르는 순수 함수.
 *
 * 전체 일기를 매번 Gemini로 보내는 대신, 질문과의 TF-IDF 가중 겹침 + 최근성으로
 * 상위 K개만 선별한다. 한국어 조사("등산을" vs "등산")를 흡수하기 위해
 * 접두 일치(양방향 startsWith)를 부분 점수로 인정한다.
 *
 * DOM/네트워크 의존성 없음 (vitest 대상).
 */
import { tokenize } from '../utils/keywords.js';

const ONE_DAY = 24 * 60 * 60 * 1000;
const PREFIX_WEIGHT = 0.7; // 접두 일치는 완전 일치보다 낮게

/** counts(Map term→tf)에서 질의 토큰 q와 일치하는 가중 tf 합 */
function matchCount(counts, q) {
    let n = counts.get(q) || 0;
    for (const [term, c] of counts) {
        if (term === q || term.length < 2 || q.length < 2) continue;
        if (term.startsWith(q) || q.startsWith(term)) n += c * PREFIX_WEIGHT;
    }
    return n;
}

/**
 * @param {string} query 사용자 질문
 * @param {Array} entries 일기 엔트리 배열
 * @param {object} options { limit, now, halfLifeDays, contextIds }
 * @returns {Array} 관련도 내림차순 엔트리 (score 필드 포함), 최대 limit개
 */
export function rankEntries(query, entries, options = {}) {
    const { limit = 12, now = Date.now(), halfLifeDays = 90, contextIds = [] } = options;
    if (!entries || entries.length === 0) return [];

    const dateQueries = [...String(query || '').matchAll(/\b(20\d{2})(?:[-/.]|년\s*)(\d{1,2})(?:[-/.]|월\s*)(\d{1,2})(?:일|\b)/g)];
    const monthQueries = String(query || '').match(/이번\s*달|이달|지난\s*달|저번\s*달|this\s+month|last\s+month/gi) || [];
    let filteredEntries = entries;
    if (dateQueries.length) {
        const dateIds = new Set(dateQueries.map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`));
        filteredEntries = entries.filter(e => dateIds.has(e.id) || dateIds.has(String(e.date || '').slice(0, 10)));
    } else if (monthQueries.length) {
        const today = new Date(now);
        const months = new Set(monthQueries.map(m => {
            // Start at day 1 so March 31 minus one month cannot overflow back into March.
            const target = new Date(today.getFullYear(), today.getMonth() - (/지난|저번|last/i.test(m) ? 1 : 0), 1);
            return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
        }));
        filteredEntries = entries.filter(e => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.id)) return months.has(e.id.slice(0, 7));
            const date = new Date(e.date);
            return months.has(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
        });
    }
    if (filteredEntries.length === 0) return [];

    const qTokens = [...new Set(tokenize(query))];

    // 엔트리별 토큰 카운트 (본문 + 한 줄 요약)
    const tokensByEntry = new Map();
    for (const e of filteredEntries) {
        const counts = new Map();
        for (const t of tokenize(`${e.content || ''} ${e.dailyComment || ''}`)) {
            counts.set(t, (counts.get(t) || 0) + 1);
        }
        tokensByEntry.set(e.id, counts);
    }

    // 질의 토큰별 문서 빈도(접두 일치 포함) → IDF
    const n = filteredEntries.length;
    const idfByToken = new Map();
    for (const q of qTokens) {
        let df = 0;
        for (const counts of tokensByEntry.values()) {
            if (matchCount(counts, q) > 0) df += 1;
        }
        if (df > 0) idfByToken.set(q, Math.log(1 + n / df));
    }

    // Carry forward specific references only for follow-ups without a new matching topic.
    const followUp = /그때|그날|그 일|그 사람|그것|그런|그러면|그럼|이어서|계속|좀 더|자세|왜 그렇게|어떻게 하면|어떻게 해야/.test(query);
    const useContext = followUp && idfByToken.size === 0 && !dateQueries.length && !monthQueries.length;

    const scored = filteredEntries.map(e => {
        const counts = tokensByEntry.get(e.id);
        let kwScore = 0;
        for (const [q, idf] of idfByToken) {
            const tf = matchCount(counts, q);
            if (tf > 0) kwScore += idf * (1 + Math.log(1 + tf));
        }
        const ageDays = Math.max(0, (now - new Date(e.date).getTime()) / ONE_DAY);
        const recency = Math.exp(-ageDays / halfLifeDays); // 0..1 지수 감쇠
        const contextIndex = contextIds.indexOf(e.id);
        const contextBonus = useContext && contextIndex >= 0 ? 2 + 1 / (contextIndex + 1) : 0;
        return { entry: e, score: kwScore + contextBonus + 0.5 * recency };
    });

    scored.sort((a, b) =>
        b.score - a.score ||
        new Date(b.entry.date).getTime() - new Date(a.entry.date).getTime()
    );
    return scored.slice(0, limit).map(s => ({ ...s.entry, score: s.score }));
}

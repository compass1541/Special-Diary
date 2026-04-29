/**
 * 일기 본문에서 의미있는 키워드 추출 + 클러스터 색상 할당.
 * 외부 의존성 없는 순수 함수.
 */

// 한국어/영어 기능어 스톱워드. 명사·내용어(사람·감정·활동 등)는 일기 클러스터링의 신호이므로 보존.
// TF-IDF의 docFreq 페널티가 흔한 단어를 자연스럽게 가라앉힌다.
const STOPWORDS = new Set([
    // Korean function words / fillers
    '있다','없다','하다','되다','하는','된다','했다','한다','한','된','되는','되어',
    '그리고','하지만','그러나','그래서','그래도','그러면','또는','그러니까','그런데','그러면서',
    '나는','내가','너는','네가','우리','그들','그것','이것','저것','이거','저거','그거',
    '너무','정말','진짜','매우','조금','약간','많이','대부분','거의','자주','가끔',
    '오늘','어제','내일','지금','아까','이제','금방','곧','나중','잠시','잠깐',
    '같은','같이','함께','혼자','다른','어떤','모든','어느','각각',
    '때문','때문에','동안','이유','경우','상황','부분','정도','종류',
    // English function words
    'about','with','this','that','have','they','from','were','been','their','would',
    'there','what','which','when','will','your','said','make','like','than','then',
    'them','these','some','only','also','where','very','just',
    'because','through','though','should','could','might','until',
    'after','before','above','below','still','always','never','sometimes',
]);

const TOKEN_RE = /[\w가-힣]+/g;

/**
 * 텍스트에서 토큰 추출 (스톱워드 / 1글자 제외).
 */
export function tokenize(text) {
    if (!text) return [];
    const tokens = String(text).toLowerCase().match(TOKEN_RE) || [];
    return tokens.filter(t => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * 엔트리들에 대해 키워드 빈도 + DF(document frequency) 계산.
 * 반환: { tf: Map<entryId, Map<term, count>>, df: Map<term, docCount>, totalDocs }
 */
export function computeStats(entries) {
    const tf = new Map();
    const df = new Map();
    for (const e of entries) {
        const tokens = tokenize(e.content || '');
        const counts = new Map();
        for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
        tf.set(e.id, counts);
        for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    return { tf, df, totalDocs: entries.length };
}

/**
 * 한 엔트리의 상위 키워드 N개를 TF-IDF로 정렬해 반환.
 * 너무 흔한 단어(코퍼스의 70% 이상에 등장)는 제외 — 단, 작은 코퍼스(<5)에서는 비활성.
 */
export function topKeywords(entryId, stats, limit = 5) {
    const counts = stats.tf.get(entryId);
    if (!counts) return [];
    const totalDocs = stats.totalDocs || 1;
    const applyDfFilter = totalDocs >= 5;
    const scored = [];
    for (const [term, count] of counts) {
        const docFreq = stats.df.get(term) || 1;
        if (applyDfFilter && docFreq / totalDocs > 0.7) continue;
        const idf = Math.log(1 + totalDocs / docFreq);
        scored.push({ term, score: count * idf });
    }
    scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    return scored.slice(0, limit).map(s => s.term);
}

/**
 * 같은 키워드를 공유하는 엔트리 쌍 찾기 (역인덱스, 너무 흔한 단어 제외).
 * 반환: 배열 [{ a, b, shared }, ...] (a < b)
 */
export function findKeywordPairs(stats, minShared = 3) {
    const applyDfFilter = stats.totalDocs >= 5;
    const inverted = new Map(); // term -> [entryId,...]
    for (const [entryId, counts] of stats.tf) {
        for (const term of counts.keys()) {
            const docFreq = stats.df.get(term) || 1;
            if (docFreq < 2) continue;
            if (applyDfFilter && docFreq / stats.totalDocs > 0.7) continue;
            let arr = inverted.get(term);
            if (!arr) { arr = []; inverted.set(term, arr); }
            arr.push(entryId);
        }
    }

    const pairCount = new Map();
    for (const ids of inverted.values()) {
        if (ids.length < 2 || ids.length > 50) continue;
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const a = ids[i], b = ids[j];
                const key = a < b ? `${a}||${b}` : `${b}||${a}`;
                pairCount.set(key, (pairCount.get(key) || 0) + 1);
            }
        }
    }

    const out = [];
    for (const [key, shared] of pairCount) {
        if (shared < minShared) continue;
        const [a, b] = key.split('||');
        out.push({ a, b, shared });
    }
    return out;
}

/**
 * 엔트리들에 클러스터 색상 ID 할당. "지배 키워드"가 같은 엔트리들이 같은 클러스터.
 * 키워드가 없으면 'misc' 클러스터.
 */
export function assignClusters(entries, stats) {
    const clusterById = new Map();
    for (const e of entries) {
        const top = topKeywords(e.id, stats, 1)[0];
        clusterById.set(e.id, top || 'misc');
    }
    return clusterById;
}

/**
 * 클러스터 ID → HSL 색상 (균일하게 분포된 hue).
 * 동일 입력은 항상 동일 색을 보장하기 위해 간단한 해시 사용.
 */
export function clusterColor(clusterId) {
    if (clusterId === 'misc') return 'hsl(220, 18%, 68%)';
    let h = 0;
    for (let i = 0; i < clusterId.length; i++) {
        h = (h * 31 + clusterId.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 90%, 72%)`;
}

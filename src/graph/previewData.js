export const PREVIEW_CONCEPTS = Object.freeze({
    journey: {
        title: '기억 속 여행',
        eyebrow: 'MEMORY JOURNEY',
        description: '감정의 성운 사이를 천천히 유영하며 연결된 기억이 빛으로 깨어나는 공간',
        accent: '#9ee8ff',
    },
    neon: {
        title: '네온 SF 게임',
        eyebrow: 'NEURAL GRID',
        description: '에너지 링크와 타깃 HUD로 기억을 탐색하는 고밀도 사이버 네트워크',
        accent: '#30f6ff',
    },
});

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

export function createPreviewGraph({ seed = 20260813, nodeCount = 24 } = {}) {
    const count = Math.max(4, Math.floor(nodeCount));
    const random = seededRandom(seed);
    const nodes = [];

    for (let index = 0; index < count; index += 1) {
        const cluster = index % 3;
        const angle = index * 2.399963 + cluster * 0.42;
        const radius = 3.2 + Math.sqrt(index + 1) * 1.35 + random() * 1.8;
        nodes.push({
            id: `memory-${index}`,
            cluster,
            importance: index === 0 ? 1 : 0.3 + random() * 0.7,
            x: Math.cos(angle) * radius + (cluster - 1) * 2.5,
            y: (random() - 0.5) * 8 + Math.sin(angle * 0.45) * 2,
            z: Math.sin(angle) * radius + (random() - 0.5) * 3,
        });
    }

    const links = [];
    const seen = new Set();
    const addLink = (source, target, strength) => {
        if (source === target) return;
        const key = [source, target].sort().join(':');
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ source, target, strength });
    };

    for (let index = 1; index < count; index += 1) {
        addLink(nodes[index].id, nodes[Math.max(0, index - 1 - (index % 3 === 0 ? 1 : 0))].id, 1);
        if (index >= 3) addLink(nodes[index].id, nodes[index - 3].id, 0.55);
        if (index >= 6 && random() > 0.38) {
            addLink(nodes[index].id, nodes[Math.floor(random() * (index - 2))].id, 0.28);
        }
    }

    return { nodes, links };
}

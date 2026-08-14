import { describe, expect, it } from 'vitest';
import { createPreviewGraph, PREVIEW_CONCEPTS } from './previewData.js';

describe('3D graph concept preview data', () => {
    it('defines the two requested preview concepts', () => {
        expect(Object.keys(PREVIEW_CONCEPTS)).toEqual(['journey', 'neon']);
        expect(PREVIEW_CONCEPTS.journey.title).toBe('기억 속 여행');
        expect(PREVIEW_CONCEPTS.neon.title).toBe('네온 SF 게임');
    });

    it('creates a deterministic, connected demo graph without dangling links', () => {
        const first = createPreviewGraph({ seed: 42, nodeCount: 18 });
        const second = createPreviewGraph({ seed: 42, nodeCount: 18 });

        expect(first).toEqual(second);
        expect(first.nodes).toHaveLength(18);
        expect(first.links.length).toBeGreaterThan(17);

        const nodeIds = new Set(first.nodes.map((node) => node.id));
        for (const link of first.links) {
            expect(nodeIds.has(link.source)).toBe(true);
            expect(nodeIds.has(link.target)).toBe(true);
            expect(link.source).not.toBe(link.target);
        }
    });
});

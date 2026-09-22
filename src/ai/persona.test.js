import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaChat } from './persona.js';
import { gemini } from '../gemini.js';

vi.mock('../gemini.js', () => ({ gemini: { personaChat: vi.fn(), buildProfile: vi.fn() } }));
vi.mock('../supabase.js', () => ({ supabaseStorage: { isLoggedIn: () => false } }));

beforeEach(() => { vi.clearAllMocks(); });

describe('PersonaChat context', () => {
    const entries = [
        { id: '2025-01-01', date: '2025-01-01', content: '고양이가 아파서 병원에 다녀왔다.' },
        ...Array.from({ length: 25 }, (_, i) => ({ id: `2026-09-${String(i + 1).padStart(2, '0')}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, content: '회사에서 프로젝트를 진행했다.' })),
    ];
    function chat() {
        const persona = new PersonaChat({ getEntries: () => entries });
        vi.spyOn(persona, 'readProfile').mockReturnValue(null);
        return persona;
    }

    it('keeps the diary behind a follow-up question in context', async () => {
        const persona = chat();
        gemini.personaChat.mockResolvedValueOnce('고양이 병원 때문에 걱정했지. [[2025-01-01]]').mockResolvedValue('걱정됐겠다.');
        await persona.ask('고양이 건강은 어땠어?');
        await persona.ask('그때 왜 그렇게 느꼈을까?');
        expect(gemini.personaChat.mock.calls[1][0].entries[0].id).toBe('2025-01-01');
    });

    it('carries a graph-selected diary into the next turn and clears it on reset', async () => {
        const persona = chat();
        gemini.personaChat.mockResolvedValue('그날을 함께 돌아보자.');
        await persona.ask('이 날은 어땠어?', { seedEntryId: '2025-01-01' });
        await persona.ask('좀 더 자세하게 알려줘');
        expect(gemini.personaChat.mock.calls[1][0].entries[0].id).toBe('2025-01-01');
        persona.reset();
        await persona.ask('요즘 나는 어때?');
        expect(gemini.personaChat.mock.calls[2][0].history).toEqual([]);
        expect(gemini.personaChat.mock.calls[2][0].entries.map(e => e.id)).not.toContain('2025-01-01');
    });

    it('sends 12 exchanges and marks an outdated profile as secondary context', async () => {
        const persona = chat();
        persona.history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${i}` }));
        persona.readProfile.mockReturnValue({ profile: { summary: '옛 요약' }, fingerprint: 'outdated' });
        gemini.personaChat.mockResolvedValue('최근에는 달라졌네.');
        await persona.ask('최근에는 어때?');
        const payload = gemini.personaChat.mock.calls[0][0];
        expect(payload.history).toHaveLength(24);
        expect(payload.context.profileStale).toBe(true);
        expect(payload.context.totalEntries).toBe(entries.length);
    });

    it('does not add failed exchanges to conversation history', async () => {
        const persona = chat();
        gemini.personaChat.mockRejectedValue(new Error('network failure'));
        await expect(persona.ask('안녕')).rejects.toThrow('network failure');
        expect(persona.history).toEqual([]);
    });

    it('does not pin a previous topic just because the new question contains 더', async () => {
        const persona = chat();
        gemini.personaChat.mockResolvedValue('고양이가 걱정됐지. [[2025-01-01]]');
        await persona.ask('고양이 건강은 어땠어?');
        await persona.ask('회사 프로젝트에 대해 더 알려줘');
        expect(gemini.personaChat.mock.calls[1][0].entries[0].id).not.toBe('2025-01-01');
    });

    it('does not pull old references into a month with no entries', async () => {
        const persona = chat();
        gemini.personaChat.mockResolvedValue('그날이 기억나.');
        await persona.ask('그날 어땠어?', { seedEntryId: '2025-01-01' });
        const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-05T12:00:00').getTime());
        try {
            await persona.ask('지난달에 대해 더 알려줘');
            expect(gemini.personaChat.mock.calls[1][0].entries).toEqual([]);
        } finally { now.mockRestore(); }
    });
});

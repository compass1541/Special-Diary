import assert from 'node:assert/strict';
import { buildChatRequest } from '../_shared/gemini.js';

Deno.test('ai-proxy authenticates and sends the same Gemini chat contract as the browser', async () => {
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    const env = {
        GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.8-flash',
        SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-anon',
    };
    const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
    let handler: (request: Request) => Promise<Response>;
    let authenticated = false;
    let upstreamCalls = 0;
    let sentBody: unknown;
    Object.defineProperty(Deno, 'serve', { value: (callback: typeof handler) => { handler = callback; }, configurable: true });
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('/auth/v1/user')) {
            return Response.json(authenticated ? { id: 'test-user' } : { message: 'Unauthorized' }, { status: authenticated ? 200 : 401 });
        }
        assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
        assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
        sentBody = JSON.parse(String(init?.body));
        upstreamCalls++;
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
            { thought: true, text: 'hidden' }, { text: '첫 문장. ' }, { text: '다음 문장.' },
        ] } }] });
    };
    try {
        await import('./index.ts');
        const payload = {
            action: 'chat', question: '그때는 어땠어?',
            history: Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: String(i) })),
            entries: [{ id: '2026-09-20', content: '가'.repeat(2000) + '중요한 기억' }],
            context: { today: '2026-09-22', totalEntries: 1, profileStale: true },
        };
        const request = () => new Request('https://example.supabase.co/functions/v1/ai-proxy', {
            method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        assert.equal((await handler!(request())).status, 401);
        assert.equal(upstreamCalls, 0);
        authenticated = true;
        const response = await handler!(request());
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { reply: '첫 문장. 다음 문장.' });
        assert.deepEqual(sentBody, buildChatRequest(payload));
        assert.equal(upstreamCalls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        Object.defineProperty(Deno, 'serve', { value: originalServe });
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
        }
    }
});

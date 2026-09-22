# Gemini 3.8 Flash and conversation quality

Goal: use `gemini-3.8-flash` on both existing AI paths and give the diary companion grounded continuity. Preserve authentication, rate limits, local diary storage and the existing UI. No deployment or database changes in this task.

Implementation (current task, one owner):
1. Reproduce context loss, four-exchange truncation and multipart response handling in Vitest.
2. Share the model, bounded chat payload, system instructions and native REST request between `src/gemini.js` and `supabase/functions/ai-proxy/index.ts` through `supabase/functions/_shared/gemini.js`. Set chat thinking to HIGH; separate diary evidence from instructions. Do not log keys or diary content. Reject incomplete output and omit thought parts.
3. Update `src/ai/retrieval.js` and `src/ai/persona.js`: 12 exchanges, follow-up diary references, explicit date/month filtering, stale-profile metadata. New topics take precedence; reset clears context.
4. Run focused tests, full suite, lint, production build and Edge Function validation. Try synthetic Gemini requests with existing credentials if usable. Document deployment requirements and unverified live behavior.

The existing local-key fallback remains opt-in; authentication/quota errors must not trigger it. Retain generateContent without storing conversations in the Interactions API. Supabase model secrets override the source default, so deployment must update that override too. Rollback is the previous source version and model setting. Personal diary data is not needed for testing.

Verification completed on 2026-09-22:
- Vitest: 73 passing tests, including conversation continuity, topic changes, date/month selection, normalization, multipart responses, incomplete-answer rejection and authentication fallback behavior.
- ESLint: passed, including the shared browser/Edge Function module.
- Production build: passed with the client Gemini key explicitly empty; no Gemini key pattern in the output.
- Deno type check and authenticated Edge Function integration test: passed (1 test). The mocked upstream request matches the shared browser request.
- Live model metadata lookup: HTTP 200 for models/gemini-3.8-flash, with generateContent supported. Two synthetic answer-generation attempts returned HTTP 503; real response quality remains unverified. No personal diary content was sent.
- No deployment performed. Existing server model overrides must be updated to gemini-3.8-flash and ai-proxy redeployed for production to use the new behavior.

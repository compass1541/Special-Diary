/**
 * PersonaChat — "또 다른 나" 분신의 상태 관리.
 *
 * 역할:
 *   - 대화 히스토리 유지 (세션 메모리, 최근 12교환만 모델에 전달)
 *   - 자기이해 프로필 캐시: localStorage에 사용자별 저장,
 *     지문(엔트리 수 + 최신 updatedAt)이 달라지면 stale로 표시
 *   - 질문마다 로컬 retrieval로 관련 일기 top-K만 골라 Gemini에 전달
 *
 * DOM 의존성 없음 — 렌더링은 chatView.js가 담당.
 */
import { rankEntries } from './retrieval.js';
import { gemini } from '../gemini.js';
import { supabaseStorage } from '../supabase.js';
import { HISTORY_WINDOW } from '../../supabase/functions/_shared/gemini.js';

const PROFILE_KEY_PREFIX = 'special-diary:profile:v1:';
const MAX_HISTORY = 40;      // 세션 내 보관 상한
const RETRIEVAL_LIMIT = 12;

export class PersonaChat {
    /** @param {{ getEntries: () => Promise<Array>|Array }} deps */
    constructor({ getEntries }) {
        this.getEntries = getEntries;
        this.history = []; // { role: 'user'|'assistant', text }
        this.contextIds = [];
    }

    _scope() {
        return supabaseStorage.isLoggedIn()
            ? (supabaseStorage.getCurrentUser()?.id || 'local')
            : 'local';
    }

    _profileKey() {
        return `${PROFILE_KEY_PREFIX}${this._scope()}`;
    }

    fingerprint(entries) {
        const latest = entries.reduce((max, e) => Math.max(max, e.updatedAt || 0), 0);
        return `${entries.length}:${latest}`;
    }

    /** @returns {{ profile, fingerprint, updatedAt }|null} */
    readProfile() {
        try {
            const raw = localStorage.getItem(this._profileKey());
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    isProfileStale(entries) {
        const cached = this.readProfile();
        if (!cached) return true;
        return cached.fingerprint !== this.fingerprint(entries);
    }

    /**
     * 프로필 확보 — 캐시가 없거나 force일 때만 Gemini 호출.
     * @returns {{ profile, updatedAt, fresh: boolean }}
     */
    async ensureProfile({ force = false } = {}) {
        const entries = await this.getEntries();
        const cached = this.readProfile();
        if (cached && !force) {
            return { profile: cached.profile, updatedAt: cached.updatedAt, fresh: false };
        }
        if (entries.length === 0) {
            throw new Error('프로필을 만들려면 일기가 최소 1개 필요합니다.');
        }

        // 최신순 60개 (내용 있는 것 우선)
        const withContent = entries.filter(e => (e.content || '').trim());
        const source = (withContent.length > 0 ? withContent : entries)
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 60);

        const profile = await gemini.buildProfile(source);
        const record = {
            profile,
            fingerprint: this.fingerprint(entries),
            updatedAt: Date.now(),
        };
        try {
            localStorage.setItem(this._profileKey(), JSON.stringify(record));
        } catch (e) {
            console.warn('프로필 캐시 저장 실패:', e);
        }
        return { profile, updatedAt: record.updatedAt, fresh: true };
    }

    /**
     * 분신에게 질문. retrieval로 고른 일기 + 프로필 + 최근 대화를 컨텍스트로 사용.
     * @param {string} question
     * @param {{ seedEntryId?: string }} options 특정 일기를 컨텍스트 맨 앞에 고정
     */
    async ask(question, { seedEntryId = null } = {}) {
        const entries = await this.getEntries();
        let retrieved = rankEntries(question, entries, {
            limit: RETRIEVAL_LIMIT,
            contextIds: this.contextIds,
        });

        if (seedEntryId) {
            const seed = entries.find(e => e.id === seedEntryId);
            if (seed) {
                retrieved = [seed, ...retrieved.filter(e => e.id !== seedEntryId)]
                    .slice(0, RETRIEVAL_LIMIT);
            }
        }

        const cachedProfile = this.readProfile();
        const profile = cachedProfile?.profile || null;
        const today = new Date(Date.now());
        const reply = await gemini.personaChat({
            question,
            history: this.history.slice(-HISTORY_WINDOW),
            entries: retrieved,
            profile,
            context: {
                today: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
                totalEntries: entries.length,
                profileStale: Boolean(cachedProfile && this.isProfileStale(entries)),
            },
        });

        this.history.push({ role: 'user', text: question }, { role: 'assistant', text: reply });
        const citedIds = [...reply.matchAll(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g)]
            .map(m => m[1]).filter(id => retrieved.some(e => e.id === id));
        this.contextIds = [...new Set(citedIds.length ? citedIds : retrieved.slice(0, 3).map(e => e.id))];
        if (this.history.length > MAX_HISTORY) {
            this.history = this.history.slice(-MAX_HISTORY);
        }
        return reply;
    }

    reset() {
        this.history = [];
        this.contextIds = [];
    }
}

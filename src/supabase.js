/**
 * Supabase Configuration and Client
 * 
 * Supabase를 사용한 일기 데이터 클라우드 동기화
 */
import { createClient } from '@supabase/supabase-js';

// 환경 변수에서 설정 로드
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase 클라이언트 초기화
let supabaseClient = null;

class SupabaseStorage {
    constructor() {
        this.isInitialized = false;
        this.user = null;
    }

    /**
     * Supabase 클라이언트 초기화
     */
    async init() {
        // 기본값(placeholders)인지 확인
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY ||
            SUPABASE_URL.includes('your-project') ||
            SUPABASE_ANON_KEY.includes('your-anon-key')) {
            console.warn('⚠️ Supabase 설정이 필요합니다. .env 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 설정하세요.');
            return false;
        }

        try {
            // Supabase 클라이언트 생성
            supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

            // 현재 세션 확인
            const { data: { session } } = await supabaseClient.auth.getSession();
            this.user = session?.user || null;

            // 인증 상태 변경 리스너
            supabaseClient.auth.onAuthStateChange((event, session) => {
                this.user = session?.user || null;
                console.log('Auth state changed:', event, this.user?.email);
            });

            this.isInitialized = true;
            console.log('✅ Supabase 클라이언트가 초기화되었습니다.');
            return true;
        } catch (error) {
            console.error('❌ Supabase 초기화 실패:', error);
            return false;
        }
    }

    /**
     * 현재 Supabase가 연결되어 있는지 확인
     */
    isConnected() {
        return this.isInitialized && supabaseClient !== null;
    }

    /**
     * 로그인 여부 확인
     */
    isLoggedIn() {
        return this.user !== null;
    }

    // ======================================
    // 인증 (Authentication)
    // ======================================

    /**
     * 이메일로 회원가입
     */
    async signUp(email, password) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });

        if (error) throw error;
        return data;
    }

    /**
     * 이메일로 로그인
     */
    async signIn(email, password) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;
        this.user = data.user;
        return data;
    }

    /**
     * 로그아웃
     */
    async signOut() {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');

        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        this.user = null;
    }

    /**
     * 현재 사용자 정보 가져오기
     */
    getCurrentUser() {
        return this.user;
    }

    // ======================================
    // 일기 데이터 CRUD
    // ======================================

    /**
     * 일기 저장 또는 업데이트 (upsert)
     */
    async saveEntry(entry) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        const now = new Date().toISOString();
        const entryData = {
            id: entry.id,  // 날짜 ID (YYYY-MM-DD)
            user_id: this.user.id,
            date: entry.date,
            content: entry.content || '',
            daily_comment: entry.dailyComment || '',
            updated_at: now,
            created_at: entry.createdAt || now
        };

        const { data, error } = await supabaseClient
            .from('diary_entries')
            .upsert(entryData, {
                onConflict: 'id,user_id',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (error) throw error;

        // 로컬 형식으로 변환하여 반환
        return this.toLocalFormat(data);
    }

    /**
     * 특정 날짜의 일기 가져오기
     */
    async getEntry(dateId) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        const { data, error } = await supabaseClient
            .from('diary_entries')
            .select('*')
            .eq('id', dateId)
            .eq('user_id', this.user.id)
            .maybeSingle();

        if (error) throw error;
        return data ? this.toLocalFormat(data) : null;
    }

    /**
     * 모든 일기 가져오기
     */
    async getAllEntries() {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        const { data, error } = await supabaseClient
            .from('diary_entries')
            .select('*')
            .eq('user_id', this.user.id)
            .order('date', { ascending: false });

        if (error) throw error;
        return (data || []).map(entry => this.toLocalFormat(entry));
    }

    /**
     * 일기 삭제
     */
    async deleteEntry(dateId) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        const { error } = await supabaseClient
            .from('diary_entries')
            .delete()
            .eq('id', dateId)
            .eq('user_id', this.user.id);

        if (error) throw error;
    }

    /**
     * 특정 월의 일기들 가져오기
     */
    async getEntriesForMonth(year, month) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        // 월 시작일과 종료일 계산
        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endDate = new Date(year, month + 1, 0); // 해당 월 마지막 날
        const endDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

        const { data, error } = await supabaseClient
            .from('diary_entries')
            .select('*')
            .eq('user_id', this.user.id)
            .gte('id', startDate)
            .lte('id', endDateStr)
            .order('date', { ascending: false });

        if (error) throw error;
        return (data || []).map(entry => this.toLocalFormat(entry));
    }

    /**
     * 일기가 있는 날짜들 가져오기 (달력 점 표시용)
     */
    async getDatesWithEntries() {
        const entries = await this.getAllEntries();
        return new Set(entries.map(entry => entry.id));
    }

    /**
     * 일기 검색
     */
    async searchEntries(query) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        const lowerQuery = query.toLowerCase();

        // 텍스트 검색 (Supabase의 기본 텍스트 필터 사용)
        // 실제 운영 환경에서는 Full Text Search 기능이나 임베딩 벡터 검색을 사용하는 것이 좋습니다.
        const { data, error } = await supabaseClient
            .from('diary_entries')
            .select('*')
            .eq('user_id', this.user.id)
            .or(`content.ilike.%${query}%,daily_comment.ilike.%${query}%`)
            .order('date', { ascending: false });

        if (error) throw error;
        return (data || []).map(entry => this.toLocalFormat(entry));
    }

    // ======================================
    // 데이터 동기화
    // ======================================

    /**
     * 로컬 데이터를 Supabase로 동기화
     */
    async syncFromLocal(localEntries) {
        if (!this.isConnected()) throw new Error('Supabase가 연결되지 않았습니다.');
        if (!this.user) throw new Error('로그인이 필요합니다.');

        let synced = 0;
        for (const entry of localEntries) {
            try {
                await this.saveEntry(entry);
                synced++;
            } catch (error) {
                console.error(`동기화 실패 (${entry.id}):`, error);
            }
        }
        return synced;
    }

    /**
     * Supabase 데이터를 로컬로 내보내기
     */
    async exportData() {
        const entries = await this.getAllEntries();
        return JSON.stringify(entries, null, 2);
    }

    // ======================================
    // 유틸리티
    // ======================================

    /**
     * Supabase 형식을 로컬 형식으로 변환
     */
    toLocalFormat(supabaseEntry) {
        return {
            id: supabaseEntry.id,
            date: supabaseEntry.date,
            content: supabaseEntry.content || '',
            dailyComment: supabaseEntry.daily_comment || '',
            createdAt: new Date(supabaseEntry.created_at).getTime(),
            updatedAt: new Date(supabaseEntry.updated_at).getTime()
        };
    }
}

// 싱글톤 인스턴스 export
export const supabaseStorage = new SupabaseStorage();

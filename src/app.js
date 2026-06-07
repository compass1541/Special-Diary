/**
 * Special Diary - Main Application
 */
import { storage } from './storage.js';
import { supabaseStorage } from './supabase.js';
import { gemini } from './gemini.js';
import { computeStats, topKeywords, findKeywordPairs, assignClusters, clusterColor } from './utils/keywords.js';

export class DiaryApp {
    constructor() {
        this.currentDate = new Date();
        this.selectedDate = null;
        this.calendarDate = new Date();
        this.datesWithEntries = new Set();
        this.entries = [];
        this.useSupabase = false; // Supabase 사용 여부

        // H5: 현재 편집 중인 항목을 서버에서 가져왔을 때의 updated_at 타임스탬프.
        //     autoSave/saveEntry가 이 값을 expectedUpdatedAt로 보내면 다른 기기에서 수정된 경우 충돌 감지.
        this.loadedEntryUpdatedAt = null;

        // Link autocomplete state
        this.autocompleteActive = false;
        this.autocompleteQuery = '';
        this.autocompleteIndex = -1;
        this.autocompleteResults = [];

        this.init();
    }

    async init() {
        // 로컬 스토리지 초기화
        await storage.ensureReady();

        // Supabase 초기화 시도
        await this.initSupabase();

        await this.loadEntries();
        this.bindEvents();
        this.renderCalendar();
        this.renderEntriesList();
        this.updateAuthUI();
    }

    async initSupabase() {
        try {
            const initialized = await supabaseStorage.init();
            if (initialized && supabaseStorage.isLoggedIn()) {
                this.useSupabase = true;
                console.log('✅ Supabase 로그인 상태 확인됨');
            }
        } catch (error) {
            console.warn('Supabase 초기화 실패, 로컬 저장소 사용:', error);
        }
    }

    // 현재 사용할 스토리지 반환
    getStorage() {
        return this.useSupabase ? supabaseStorage : storage;
    }

    async loadEntries() {
        const currentStorage = this.getStorage();
        this.entries = await currentStorage.getAllEntries();
        this.datesWithEntries = await currentStorage.getDatesWithEntries();
    }

    bindEvents() {
        // Calendar navigation
        document.getElementById('prevMonth').addEventListener('click', () => this.navigateMonth(-1));
        document.getElementById('nextMonth').addEventListener('click', () => this.navigateMonth(1));

        // New entry button
        document.getElementById('newEntryBtn').addEventListener('click', () => this.openTodayEntry());

        // Editor actions
        document.getElementById('closeEditorBtn').addEventListener('click', () => this.closeEditor());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveEntry());
        document.getElementById('deleteBtn').addEventListener('click', () => this.deleteEntry());
        document.getElementById('aiSuggestBtn').addEventListener('click', () => this.showAISuggestions());

        // AI Search Modal
        document.getElementById('openAiSearch').addEventListener('click', () => this.openAISearchModal());
        document.getElementById('closeAiSearch').addEventListener('click', () => this.closeAISearchModal());
        document.getElementById('aiSearchSubmit').addEventListener('click', () => this.performAISearch());
        document.getElementById('aiSearchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performAISearch();
        });

        // AI Suggestion Modal
        document.getElementById('closeAiSuggestion').addEventListener('click', () => this.closeAISuggestionModal());

        // Graph View Modal
        document.getElementById('openGraphView').addEventListener('click', () => this.openGraphViewModal());
        document.getElementById('closeGraphView').addEventListener('click', () => this.closeGraphViewModal());
        this._bindGraphControls();

        // Modal overlay clicks
        document.getElementById('aiSearchModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeAISearchModal();
        });
        document.getElementById('aiSuggestionModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeAISuggestionModal();
        });
        document.getElementById('graphViewModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeGraphViewModal();
        });

        // Auto-save on content change
        let saveTimeout;
        const diaryContent = document.getElementById('diaryContent');

        diaryContent.addEventListener('input', (e) => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => this.autoSave(), 2000);
            this.handleEditorInput(e); // 링크 자동완성 감지 및 링크된 항목 업데이트
            // H6: 즉시 드래프트 백업 (브라우저 크래시·저장 실패에도 유실 없음)
            if (this.selectedDate) {
                this.saveDraft(
                    this.formatDateId(this.selectedDate),
                    diaryContent.value,
                    document.getElementById('dailyComment').value
                );
            }
        });

        diaryContent.addEventListener('keydown', (e) => {
            this.handleEditorKeyDown(e); // 자동완성 네비게이션
        });

        document.getElementById('dailyComment').addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => this.autoSave(), 2000);
            if (this.selectedDate) {
                this.saveDraft(
                    this.formatDateId(this.selectedDate),
                    diaryContent.value,
                    document.getElementById('dailyComment').value
                );
            }
        });

        // Hide autocomplete on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#linkAutocompletePopup') && !e.target.closest('#diaryContent')) {
                this.closeAutocomplete();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveEntry();
            }
        });

        // Backup / Restore (M6)
        document.getElementById('exportBtn')?.addEventListener('click', () => this.handleExport());
        document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile')?.click());
        document.getElementById('importFile')?.addEventListener('change', (e) => this.handleImport(e));

        // Auth events
        this.bindAuthEvents();
    }

    // ========================================
    // M6: Backup / Restore
    // ========================================

    async handleExport() {
        try {
            const currentStorage = this.getStorage();
            const json = await currentStorage.exportData();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `special-diary-${stamp}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('일기를 JSON으로 내보냈습니다 📥');
        } catch (err) {
            console.error('Export failed:', err);
            this.showToast('내보내기 실패');
        }
    }

    async handleImport(e) {
        const file = e.target.files?.[0];
        e.target.value = ''; // 같은 파일 재선택 가능하게
        if (!file) return;
        if (!confirm('가져온 일기가 같은 날짜의 기존 일기를 덮어쓸 수 있습니다. 계속할까요?')) return;
        try {
            const text = await file.text();
            const entries = JSON.parse(text);
            if (!Array.isArray(entries)) throw new Error('올바른 백업 파일이 아닙니다');
            // 로컬 IndexedDB에 가져오고, 클라우드 모드면 그 후 동기화
            await storage.importData(JSON.stringify(entries));
            if (this.useSupabase) {
                const localEntries = await storage.getAllEntries();
                await supabaseStorage.syncFromLocal(localEntries);
            }
            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();
            this.showToast(`${entries.length}개의 일기를 가져왔습니다 📤`);
        } catch (err) {
            console.error('Import failed:', err);
            alert(`가져오기 실패: ${err.message || '알 수 없는 오류'}`);
        }
    }

    bindAuthEvents() {
        // Open auth modal
        document.getElementById('openAuthModal')?.addEventListener('click', () => this.openAuthModal());
        document.getElementById('closeAuthModal')?.addEventListener('click', () => this.closeAuthModal());

        // Auth modal overlay click
        document.getElementById('authModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeAuthModal();
        });

        // Logout
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.handleLogout());

        // Auth tabs
        document.getElementById('loginTab')?.addEventListener('click', () => this.switchAuthTab('login'));
        document.getElementById('signupTab')?.addEventListener('click', () => this.switchAuthTab('signup'));

        // Login form
        document.getElementById('loginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Signup form
        document.getElementById('signupForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });

        // Google Login
        document.getElementById('googleLoginBtn')?.addEventListener('click', () => this.handleGoogleLogin());

        // Sync buttons
        document.getElementById('syncYes')?.addEventListener('click', () => this.syncLocalToCloud());
        document.getElementById('syncNo')?.addEventListener('click', () => this.closeAuthModal());

        // Password strength indicator (H4)
        const signupPw = document.getElementById('signupPassword');
        const strengthEl = document.getElementById('passwordStrength');
        if (signupPw && strengthEl) {
            signupPw.addEventListener('input', () => {
                const pw = signupPw.value;
                if (!pw) { strengthEl.textContent = ''; return; }
                let score = 0;
                if (pw.length >= 8) score++;
                if (pw.length >= 12) score++;
                if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
                if (/\d/.test(pw)) score++;
                if (/[^A-Za-z0-9]/.test(pw)) score++;
                const labels = ['매우 약함', '약함', '보통', '양호', '강함', '매우 강함'];
                const colors = ['#ff453a', '#ff453a', '#ffd60a', '#ffd60a', '#30d158', '#30d158'];
                strengthEl.textContent = `강도: ${labels[score]}`;
                strengthEl.style.color = colors[score];
            });
        }
    }

    // ========================================
    // Auth UI
    // ========================================

    updateAuthUI() {
        const loggedOut = document.getElementById('authLoggedOut');
        const loggedIn = document.getElementById('authLoggedIn');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');

        if (this.useSupabase && supabaseStorage.isLoggedIn()) {
            const user = supabaseStorage.getCurrentUser();
            loggedOut.style.display = 'none';
            loggedIn.style.display = 'flex';
            userEmail.textContent = user?.email || 'Unknown';
            userAvatar.textContent = (user?.email || 'U')[0].toUpperCase();
        } else {
            loggedOut.style.display = 'flex';
            loggedIn.style.display = 'none';
        }
    }

    openAuthModal() {
        const m = document.getElementById('authModal');
        m.classList.add('active');
        m.setAttribute('aria-hidden', 'false');
        document.getElementById('loginEmail').focus();
        this.hideAuthError();
    }

    closeAuthModal() {
        const m = document.getElementById('authModal');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
        document.getElementById('loginForm').reset();
        document.getElementById('signupForm').reset();
        document.getElementById('syncOption').style.display = 'none';
        this.hideAuthError();
    }

    switchAuthTab(tab) {
        const loginTab = document.getElementById('loginTab');
        const signupTab = document.getElementById('signupTab');
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        const title = document.getElementById('authModalTitle');

        this.hideAuthError();

        if (tab === 'login') {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            loginForm.style.display = 'flex';
            signupForm.style.display = 'none';
            title.textContent = '로그인';
        } else {
            loginTab.classList.remove('active');
            signupTab.classList.add('active');
            loginForm.style.display = 'none';
            signupForm.style.display = 'flex';
            title.textContent = '회원가입';
        }
    }

    showAuthError(message) {
        const errorDiv = document.getElementById('authError');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    hideAuthError() {
        document.getElementById('authError').style.display = 'none';
    }

    async handleLogin() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const submitBtn = document.getElementById('loginSubmit');

        if (!email || !password) {
            this.showAuthError('이메일과 비밀번호를 입력하세요.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '로그인 중...';

        try {
            await supabaseStorage.signIn(email, password);
            this.useSupabase = true;

            // 로컬 데이터가 있으면 동기화 제안
            const localEntries = await storage.getAllEntries();
            if (localEntries.length > 0) {
                document.getElementById('syncOption').style.display = 'block';
                document.getElementById('loginForm').style.display = 'none';
            } else {
                await this.loadEntries();
                this.renderCalendar();
                this.renderEntriesList();
                this.closeAuthModal();
                this.showToast('로그인 성공! ☁️ 클라우드 동기화 활성화');
            }

            this.updateAuthUI();
        } catch (error) {
            console.error('Login error:', error);
            this.showAuthError(this.getAuthErrorMessage(error));
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '로그인';
        }
    }

    async handleGoogleLogin() {
        try {
            this.hideAuthError();
            await supabaseStorage.signInWithGoogle();
            // OAuth는 리다이렉트되므로 이후 로직은 페이지 로드 시 처리됨
        } catch (error) {
            console.error('Google login error:', error);
            this.showAuthError('구글 로그인 중 오류가 발생했습니다.');
        }
    }

    async handleSignup() {
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
        const submitBtn = document.getElementById('signupSubmit');

        if (!email || !password) {
            this.showAuthError('이메일과 비밀번호를 입력하세요.');
            return;
        }

        if (password !== passwordConfirm) {
            this.showAuthError('비밀번호가 일치하지 않습니다.');
            return;
        }

        if (password.length < 8) {
            this.showAuthError('비밀번호는 8자 이상이어야 합니다.');
            return;
        }

        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            this.showAuthError('비밀번호는 영문과 숫자를 모두 포함해야 합니다.');
            return;
        }

        if (/^(password|12345678|qwerty|letmein|welcome)/i.test(password)) {
            this.showAuthError('너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해주세요.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '가입 중...';

        try {
            await supabaseStorage.signUp(email, password);
            this.showToast('회원가입 성공! 이메일을 확인해주세요 📧');
            this.switchAuthTab('login');
        } catch (error) {
            console.error('Signup error:', error);
            this.showAuthError(this.getAuthErrorMessage(error));
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '회원가입';
        }
    }

    async handleLogout() {
        try {
            await supabaseStorage.signOut();
            this.useSupabase = false;
            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();
            this.updateAuthUI();
            this.showToast('로그아웃되었습니다');
        } catch (error) {
            console.error('Logout error:', error);
            this.showToast('로그아웃 중 오류가 발생했습니다');
        }
    }

    async syncLocalToCloud() {
        try {
            const localEntries = await storage.getAllEntries();
            const synced = await supabaseStorage.syncFromLocal(localEntries);

            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();
            this.closeAuthModal();

            this.showToast(`${synced}개의 일기가 클라우드로 동기화되었습니다 ☁️`);
        } catch (error) {
            console.error('Sync error:', error);
            this.showAuthError('동기화 중 오류가 발생했습니다.');
        }
    }

    getAuthErrorMessage(error) {
        const message = error?.message || '';

        if (message.includes('Invalid login credentials')) {
            return '이메일 또는 비밀번호가 올바르지 않습니다.';
        }
        if (message.includes('Email not confirmed')) {
            return '이메일 인증이 완료되지 않았습니다. 이메일을 확인해주세요.';
        }
        if (message.includes('User already registered')) {
            return '이미 가입된 이메일입니다.';
        }
        if (message.includes('Password should be')) {
            return '비밀번호는 6자 이상이어야 합니다.';
        }
        if (message.includes('Invalid email')) {
            return '올바른 이메일 형식이 아닙니다.';
        }

        return message || '오류가 발생했습니다. 다시 시도해주세요.';
    }

    // ========================================
    // Calendar
    // ========================================

    navigateMonth(delta) {
        this.calendarDate.setMonth(this.calendarDate.getMonth() + delta);
        this.renderCalendar();
    }

    renderCalendar() {
        const year = this.calendarDate.getFullYear();
        const month = this.calendarDate.getMonth();

        // Update title
        const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
        document.getElementById('calendarTitle').textContent = `${year}년 ${monthNames[month]}`;

        const grid = document.getElementById('calendarGrid');
        grid.replaceChildren();

        // Day headers
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        dayNames.forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-day-header';
            header.textContent = day;
            grid.appendChild(header);
        });

        // Get first day of month and total days
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // Previous month days
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = daysInPrevMonth - i;
            grid.appendChild(day);
        }

        // Current month days
        const today = new Date();
        const todayStr = this.formatDateId(today);

        for (let i = 1; i <= daysInMonth; i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day';
            day.textContent = i;

            const dateId = this.formatDateId(new Date(year, month, i));

            // Check if today
            if (dateId === todayStr) {
                day.classList.add('today');
            }

            // Check if selected
            if (this.selectedDate && dateId === this.formatDateId(this.selectedDate)) {
                day.classList.add('selected');
            }

            // Check if has entry
            if (this.datesWithEntries.has(dateId)) {
                day.classList.add('has-entry');
            }

            day.addEventListener('click', () => this.selectDate(new Date(year, month, i)));
            grid.appendChild(day);
        }

        // Next month days to fill the grid
        const totalCells = grid.children.length;
        const remainingCells = 42 - totalCells; // 6 rows × 7 days
        for (let i = 1; i <= remainingCells && i <= 14; i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = i;
            grid.appendChild(day);
        }
    }

    // ========================================
    // Entries List
    // ========================================

    renderEntriesList() {
        const list = document.getElementById('entriesList');
        list.replaceChildren();

        const recentEntries = this.entries.slice(0, 10);

        if (recentEntries.length === 0) {
            const empty = document.createElement('p');
            empty.style.cssText = 'color: var(--text-tertiary); font-size: 0.875rem; text-align: center; padding: 1rem;';
            empty.textContent = '아직 작성된 일기가 없습니다';
            list.appendChild(empty);
            return;
        }

        recentEntries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'entry-item';
            if (this.selectedDate && this.formatDateId(this.selectedDate) === entry.id) {
                item.classList.add('active');
            }

            const date = new Date(entry.date);
            const dateStr = this.formatDisplayDate(date);
            const timeStr = this.formatTime(entry.createdAt);
            const preview = (entry.content || '').substring(0, 50) + ((entry.content || '').length > 50 ? '...' : '');

            const header = document.createElement('div');
            header.className = 'entry-header';
            const dateEl = document.createElement('div');
            dateEl.className = 'entry-date';
            dateEl.textContent = dateStr;
            const timeEl = document.createElement('div');
            timeEl.className = 'entry-time';
            timeEl.textContent = timeStr;
            header.append(dateEl, timeEl);

            const previewEl = document.createElement('div');
            previewEl.className = 'entry-preview';
            previewEl.textContent = preview || '내용 없음';

            item.append(header, previewEl);

            if (entry.dailyComment) {
                const commentEl = document.createElement('div');
                commentEl.className = 'entry-comment';
                commentEl.textContent = `"${entry.dailyComment}"`;
                item.appendChild(commentEl);
            }

            item.addEventListener('click', () => this.selectDate(date));
            list.appendChild(item);
        });
    }

    // ========================================
    // Editor
    // ========================================

    async selectDate(date) {
        this.selectedDate = date;
        this.renderCalendar();
        this.renderEntriesList();

        // Show editor
        document.querySelector('.app-container').classList.add('editor-active');
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('editor').style.display = 'flex';

        // Update date display
        const day = date.getDate();
        const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const weekday = weekdays[date.getDay()];
        const fullDate = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;

        // Load entry content
        const dateId = this.formatDateId(date);
        const currentStorage = this.getStorage();
        const entry = await currentStorage.getEntry(dateId);

        // H5: 충돌 감지를 위해 로드 시점의 updated_at 기억
        this.loadedEntryUpdatedAt = entry?.updatedAt || null;

        document.querySelector('.date-day').textContent = day;
        document.querySelector('.date-weekday').textContent = weekday;
        document.querySelector('.date-full').textContent = fullDate;

        // 작성 시간 표시 (상세 View)
        const timeDisplay = document.getElementById('writtenTime');
        if (timeDisplay) {
            timeDisplay.textContent = entry ? `작성 시간: ${this.formatTime(entry.createdAt)}` : '';
        }

        // H6: localStorage 드래프트 우선 적용 (저장 실패/브라우저 크래시로 유실된 입력 복구)
        const draft = this.readDraft(dateId);
        if (draft && (draft.content !== (entry?.content || '') || draft.dailyComment !== (entry?.dailyComment || ''))) {
            const useDraft = confirm('저장되지 않은 임시 작성 내용이 있습니다. 복구할까요?');
            if (useDraft) {
                document.getElementById('diaryContent').value = draft.content || '';
                document.getElementById('dailyComment').value = draft.dailyComment || '';
            } else {
                this.clearDraft(dateId);
                document.getElementById('diaryContent').value = entry?.content || '';
                document.getElementById('dailyComment').value = entry?.dailyComment || '';
            }
        } else {
            document.getElementById('diaryContent').value = entry?.content || '';
            document.getElementById('dailyComment').value = entry?.dailyComment || '';
        }

        // Render linked entries
        this.renderLinkedEntries(document.getElementById('diaryContent').value);
    }

    // ========================================
    // H6: localStorage 드래프트 백업/복구
    // ========================================

    draftKey(dateId) { return `special-diary:draft:${dateId}`; }

    saveDraft(dateId, content, dailyComment) {
        try {
            localStorage.setItem(this.draftKey(dateId), JSON.stringify({
                content, dailyComment, savedAt: Date.now()
            }));
        } catch (e) {
            console.warn('드래프트 저장 실패:', e);
        }
    }

    readDraft(dateId) {
        try {
            const raw = localStorage.getItem(this.draftKey(dateId));
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    clearDraft(dateId) {
        try { localStorage.removeItem(this.draftKey(dateId)); } catch { /* noop */ }
    }

    closeEditor() {
        document.querySelector('.app-container').classList.remove('editor-active');
        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('editor').style.display = 'none';
        this.selectedDate = null;
        this.renderCalendar();
        this.renderEntriesList();
    }

    openTodayEntry() {
        this.calendarDate = new Date();
        this.renderCalendar();
        this.selectDate(new Date());
    }

    async saveEntry() {
        if (!this.selectedDate) return;

        const dateId = this.formatDateId(this.selectedDate);
        const content = document.getElementById('diaryContent').value;
        const dailyComment = document.getElementById('dailyComment').value;

        const entry = {
            id: dateId,
            date: this.selectedDate.toISOString(),
            content,
            dailyComment
        };

        try {
            const saved = await this.persistEntry(entry);
            this.loadedEntryUpdatedAt = saved?.updatedAt || Date.now();
            this.clearDraft(dateId);
            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();
            this.showToast('일기가 저장되었습니다 ✨');
        } catch (err) {
            await this.handleSaveError(err, entry);
        }
    }

    async autoSave() {
        if (!this.selectedDate) return;

        const dateId = this.formatDateId(this.selectedDate);
        const content = document.getElementById('diaryContent').value;
        const dailyComment = document.getElementById('dailyComment').value;

        // Only auto-save if there's content
        if (!content && !dailyComment) return;

        const entry = {
            id: dateId,
            date: this.selectedDate.toISOString(),
            content,
            dailyComment
        };

        try {
            const saved = await this.persistEntry(entry);
            this.loadedEntryUpdatedAt = saved?.updatedAt || Date.now();
            this.clearDraft(dateId);
            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();
        } catch (err) {
            await this.handleSaveError(err, entry, /* silent */ true);
        }
    }

    async persistEntry(entry) {
        const currentStorage = this.getStorage();
        if (this.useSupabase && currentStorage === supabaseStorage) {
            return await currentStorage.saveEntry(entry, {
                expectedUpdatedAt: this.loadedEntryUpdatedAt || undefined,
            });
        }
        return await currentStorage.saveEntry(entry);
    }

    async handleSaveError(err, entry, silent = false) {
        console.error('Save failed:', err);
        // 어떤 결과든 드래프트는 보존해 사용자가 잃지 않게 한다.
        this.saveDraft(entry.id, entry.content, entry.dailyComment);

        if (err && err.code === 'CONFLICT') {
            const overwrite = confirm('이 일기가 다른 기기에서 수정되었습니다.\n현재 내용으로 덮어쓰시겠습니까?\n(취소: 다른 기기 버전을 다시 불러옴)');
            if (overwrite) {
                try {
                    const saved = await supabaseStorage.saveEntry(entry, { force: true });
                    this.loadedEntryUpdatedAt = saved?.updatedAt || Date.now();
                    this.clearDraft(entry.id);
                    await this.loadEntries();
                    this.renderCalendar();
                    this.renderEntriesList();
                    this.showToast('덮어썼습니다 ✨');
                    return;
                } catch (e2) {
                    console.error('Force save failed:', e2);
                    this.showToast('덮어쓰기 실패. 드래프트는 보존됩니다.');
                    return;
                }
            } else {
                await this.selectDate(this.selectedDate);
                this.showToast('다른 기기 버전을 불러왔습니다');
                return;
            }
        }

        if (!silent) this.showToast('저장 실패. 드래프트는 보존됩니다.');
    }

    async deleteEntry() {
        if (!this.selectedDate) return;

        if (!confirm('이 일기를 삭제하시겠습니까?')) return;

        const dateId = this.formatDateId(this.selectedDate);
        const currentStorage = this.getStorage();
        await currentStorage.deleteEntry(dateId);
        await this.loadEntries();

        document.getElementById('diaryContent').value = '';
        document.getElementById('dailyComment').value = '';

        this.renderCalendar();
        this.renderEntriesList();

        this.showToast('일기가 삭제되었습니다');
    }

    // ========================================
    // Link System (Obsidian Style)
    // ========================================

    handleEditorInput(e) {
        const content = e.target.value;
        const cursorPosition = e.target.selectionStart;

        // Render linked entries
        this.renderLinkedEntries(content);

        // Check for trigger '[['
        const textBeforeCursor = content.substring(0, cursorPosition);
        const match = textBeforeCursor.match(/\[\[([^\]]*)$/);

        if (match) {
            this.autocompleteActive = true;
            this.autocompleteQuery = match[1].toLowerCase();
            this.showAutocompletePopup(e.target);
        } else {
            this.closeAutocomplete();
        }
    }

    handleEditorKeyDown(e) {
        if (!this.autocompleteActive) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigateAutocomplete(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigateAutocomplete(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.selectAutocompleteSuggestion();
        } else if (e.key === 'Escape') {
            this.closeAutocomplete();
        }
    }

    showAutocompletePopup(textarea) {
        const popup = document.getElementById('linkAutocompletePopup');
        const list = document.getElementById('linkAutocompleteList');

        // Filter entries based on query (by date or content)
        this.autocompleteResults = this.entries.filter(entry => {
            // Don't link to current entry
            if (this.selectedDate && this.formatDateId(this.selectedDate) === entry.id) {
                return false;
            }
            const dateStr = this.formatDisplayDate(new Date(entry.date)).toLowerCase();
            const idMatch = entry.id.toLowerCase().includes(this.autocompleteQuery);
            const contentMatch = (entry.content || '').toLowerCase().includes(this.autocompleteQuery);
            const dateMatch = dateStr.includes(this.autocompleteQuery);
            return idMatch || contentMatch || dateMatch;
        }).slice(0, 5); // Limit to 5 results

        if (this.autocompleteResults.length === 0) {
            this.closeAutocomplete();
            return;
        }

        // Reset index if needed
        if (this.autocompleteIndex >= this.autocompleteResults.length) {
            this.autocompleteIndex = 0;
        } else if (this.autocompleteIndex < 0) {
            this.autocompleteIndex = 0;
        }

        // Render results
        list.replaceChildren();
        this.autocompleteResults.forEach((entry, index) => {
            const date = new Date(entry.date);
            const dateStr = this.formatDisplayDate(date);
            const preview = (entry.content || '').substring(0, 30) + ((entry.content || '').length > 30 ? '...' : '');

            const item = document.createElement('div');
            item.className = `link-autocomplete-item ${index === this.autocompleteIndex ? 'active' : ''}`;
            const itemDate = document.createElement('div');
            itemDate.className = 'link-item-date';
            itemDate.textContent = dateStr;
            const itemPreview = document.createElement('div');
            itemPreview.className = 'link-item-preview';
            itemPreview.textContent = preview || '내용 없음';
            item.append(itemDate, itemPreview);

            item.addEventListener('mouseenter', () => {
                this.autocompleteIndex = index;
                this.updateAutocompleteSelection();
            });

            item.addEventListener('click', () => {
                this.autocompleteIndex = index;
                this.selectAutocompleteSuggestion();
            });

            list.appendChild(item);
        });

        // Position popup near cursor (basic implementation)
        // A robust implementation would require measuring text node coordinates
        // For simplicity, we place it near the top of the editor based on scroll
        const rect = textarea.getBoundingClientRect();
        popup.style.top = `${rect.top + 30}px`;
        popup.style.left = `${rect.left + 20}px`;
        popup.style.display = 'block';
    }

    navigateAutocomplete(delta) {
        this.autocompleteIndex += delta;
        if (this.autocompleteIndex < 0) {
            this.autocompleteIndex = this.autocompleteResults.length - 1;
        } else if (this.autocompleteIndex >= this.autocompleteResults.length) {
            this.autocompleteIndex = 0;
        }
        this.updateAutocompleteSelection();
    }

    updateAutocompleteSelection() {
        const items = document.querySelectorAll('.link-autocomplete-item');
        items.forEach((item, idx) => {
            if (idx === this.autocompleteIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    selectAutocompleteSuggestion() {
        if (this.autocompleteIndex < 0 || this.autocompleteIndex >= this.autocompleteResults.length) return;

        const selectedEntry = this.autocompleteResults[this.autocompleteIndex];
        const textarea = document.getElementById('diaryContent');
        const content = textarea.value;
        const cursorPosition = textarea.selectionStart;

        // Find the start of the trigger '[['
        const textBeforeCursor = content.substring(0, cursorPosition);
        const matchIndex = textBeforeCursor.lastIndexOf('[[');

        if (matchIndex !== -1) {
            const dateId = selectedEntry.id;
            const newContent = content.substring(0, matchIndex) + `[[${dateId}]] ` + content.substring(cursorPosition);

            textarea.value = newContent;

            // Move cursor after the inserted link
            const newCursorPos = matchIndex + `[[${dateId}]] `.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);

            this.renderLinkedEntries(newContent);
            this.autoSave();
        }

        this.closeAutocomplete();
        textarea.focus();
    }

    closeAutocomplete() {
        this.autocompleteActive = false;
        this.autocompleteQuery = '';
        this.autocompleteIndex = -1;
        document.getElementById('linkAutocompletePopup').style.display = 'none';
    }

    renderLinkedEntries(content) {
        if (!content) content = '';
        const section = document.getElementById('linkedEntriesSection');
        const listContainer = document.getElementById('linkedEntriesList');

        // Find all links matching [[YYYY-MM-DD]]
        const linkRegex = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;
        const matches = [...content.matchAll(linkRegex)];
        const linkedDateIds = [...new Set(matches.map(m => m[1]))]; // Unique IDs

        if (linkedDateIds.length === 0) {
            section.style.display = 'none';
            return;
        }

        listContainer.replaceChildren();
        let hasValidLinks = false;

        const SVG_NS = 'http://www.w3.org/2000/svg';
        const buildCalendarIcon = () => {
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('aria-hidden', 'true');
            const shapes = [
                ['rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }],
                ['line', { x1: '16', y1: '2', x2: '16', y2: '6' }],
                ['line', { x1: '8', y1: '2', x2: '8', y2: '6' }],
                ['line', { x1: '3', y1: '10', x2: '21', y2: '10' }],
            ];
            for (const [tag, attrs] of shapes) {
                const el = document.createElementNS(SVG_NS, tag);
                for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                svg.appendChild(el);
            }
            return svg;
        };

        linkedDateIds.forEach(dateId => {
            const entry = this.entries.find(e => e.id === dateId);
            if (entry) {
                hasValidLinks = true;
                const pill = document.createElement('div');
                pill.className = 'linked-entry-pill';

                const date = new Date(entry.date);
                pill.appendChild(buildCalendarIcon());
                const span = document.createElement('span');
                span.textContent = this.formatDisplayDate(date);
                pill.appendChild(span);

                pill.addEventListener('click', () => {
                    this.selectDate(date);
                });

                listContainer.appendChild(pill);
            }
        });

        if (hasValidLinks) {
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
    }

    // ========================================
    // AI Features
    // ========================================

    openAISearchModal() {
        const m = document.getElementById('aiSearchModal');
        m.classList.add('active');
        m.setAttribute('aria-hidden', 'false');
        document.getElementById('aiSearchInput').focus();
    }

    closeAISearchModal() {
        const m = document.getElementById('aiSearchModal');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
        document.getElementById('aiSearchInput').value = '';
        document.getElementById('aiSearchResults').replaceChildren();
    }

    async performAISearch() {
        const query = document.getElementById('aiSearchInput').value.trim();
        if (!query) return;

        const resultsContainer = document.getElementById('aiSearchResults');
        resultsContainer.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'ai-loading';
        loading.textContent = 'AI가 일기를 검색하고 있습니다...';
        resultsContainer.appendChild(loading);

        try {
            const searchResult = await gemini.searchDiaries(query, this.entries);

            if (searchResult.results && searchResult.results.length > 0) {
                resultsContainer.replaceChildren();

                if (searchResult.summary) {
                    const summaryDiv = document.createElement('div');
                    summaryDiv.style.cssText = 'padding: 12px; background: var(--accent-subtle); border-radius: 8px; margin-bottom: 16px; font-size: 0.875rem; color: var(--text-secondary);';
                    summaryDiv.textContent = searchResult.summary;
                    resultsContainer.appendChild(summaryDiv);
                }

                for (const result of searchResult.results) {
                    const entry = this.entries.find(e => e.id === result.id);
                    if (!entry) continue;

                    const date = new Date(entry.date);
                    const dateStr = this.formatDisplayDate(date);

                    const item = document.createElement('div');
                    item.className = 'search-result-item';

                    const dateEl = document.createElement('div');
                    dateEl.className = 'search-result-date';
                    dateEl.textContent = dateStr;

                    const contentEl = document.createElement('div');
                    contentEl.className = 'search-result-content';
                    contentEl.textContent = (entry.content || '').substring(0, 150) + '...';

                    const reasonEl = document.createElement('div');
                    reasonEl.style.cssText = 'font-size: 0.8125rem; color: var(--accent); margin-top: 8px;';
                    reasonEl.textContent = `💡 ${result.reason || ''}`;

                    item.append(dateEl, contentEl, reasonEl);

                    item.addEventListener('click', () => {
                        this.closeAISearchModal();
                        this.selectDate(date);
                    });

                    resultsContainer.appendChild(item);
                }
            } else {
                resultsContainer.replaceChildren();
                const wrap = document.createElement('div');
                wrap.style.cssText = 'text-align: center; padding: 32px; color: var(--text-secondary);';
                const p = document.createElement('p');
                p.textContent = searchResult.message || '관련된 일기를 찾지 못했습니다.';
                wrap.appendChild(p);
                resultsContainer.appendChild(wrap);
            }
        } catch (error) {
            console.error('AI search error:', error);
            resultsContainer.replaceChildren();
            const wrap = document.createElement('div');
            wrap.style.cssText = 'text-align: center; padding: 32px; color: var(--danger);';
            const p = document.createElement('p');
            p.textContent = '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
            wrap.appendChild(p);
            resultsContainer.appendChild(wrap);
        }
    }

    async showAISuggestions() {
        const modal = document.getElementById('aiSuggestionModal');
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');

        const contentDiv = document.getElementById('aiSuggestionContent');
        contentDiv.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'ai-loading';
        loading.textContent = 'AI가 제안을 생성하고 있습니다...';
        contentDiv.appendChild(loading);

        try {
            const currentContent = document.getElementById('diaryContent').value;
            const suggestions = await gemini.getSuggestions(currentContent, this.entries);

            const lines = (suggestions || '').split('\n').filter(line => line.trim());
            contentDiv.replaceChildren();

            if (lines.length === 0) {
                const empty = document.createElement('p');
                empty.textContent = '제안을 생성할 수 없습니다.';
                contentDiv.appendChild(empty);
            } else {
                for (const line of lines) {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.textContent = line;
                    contentDiv.appendChild(div);
                }
            }
        } catch (error) {
            console.error('AI suggestion error:', error);
            contentDiv.replaceChildren();
            const wrap = document.createElement('div');
            wrap.style.color = 'var(--danger)';
            const p = document.createElement('p');
            p.textContent = '제안을 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
            wrap.appendChild(p);
            contentDiv.appendChild(wrap);
        }
    }

    closeAISuggestionModal() {
        const m = document.getElementById('aiSuggestionModal');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
    }

    // ========================================
    // Utility Functions
    // ========================================

    formatDateId(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatDisplayDate(date) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const weekday = weekdays[date.getDay()];
        return `${month}월 ${day}일 (${weekday})`;
    }

    formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');

        toastMessage.textContent = message;
        toast.classList.add('active');

        setTimeout(() => {
            toast.classList.remove('active');
        }, 3000);
    }

    // ========================================
    // Graph View (3D Network)
    // ========================================

    openGraphViewModal() {
        const m = document.getElementById('graphViewModal');
        m.classList.add('active');
        m.setAttribute('aria-hidden', 'false');
        // Reset side panel
        document.getElementById('graphSidepanelEmpty').style.display = '';
        document.getElementById('graphSidepanelDetail').style.display = 'none';
        this.graphSelectedId = null;
        this.graphFilter = 'all';
        this.graphSearchQuery = '';
        document.querySelectorAll('.graph-filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === 'all');
        });
        const searchInput = document.getElementById('graphSearch');
        if (searchInput) searchInput.value = '';
        // Render after the modal layout settles (so canvas gets correct dimensions)
        setTimeout(() => this.renderGraphView(), 50);
    }

    closeGraphViewModal() {
        const m = document.getElementById('graphViewModal');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
        if (this.graph) {
            // 3d-force-graph: pause animation and free WebGL resources
            try { this.graph._destructor(); } catch { /* noop */ }
            this.graph = null;
        }
        if (this.graphResizeObserver) {
            try { this.graphResizeObserver.disconnect(); } catch { /* noop */ }
            this.graphResizeObserver = null;
        }
        this.graphData = null;
        this.graphStats = null;
    }

    async renderGraphView() {
        const graphContainer = document.getElementById('3d-graph');
        const loadingEl = document.getElementById('graphLoading');
        const statsEl = document.getElementById('graphStats');
        graphContainer.replaceChildren();

        if (this.entries.length === 0) {
            loadingEl.classList.add('hidden');
            const empty = document.createElement('div');
            empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);';
            empty.textContent = '일기가 없습니다.';
            graphContainer.appendChild(empty);
            statsEl.replaceChildren();
            return;
        }

        // Lazy-load 3D engine — keeps initial bundle small
        loadingEl.classList.remove('hidden');
        loadingEl.textContent = '3D 엔진 로딩 중...';
        let ForceGraph3D, SpriteText;
        try {
            const [graphMod, spriteMod] = await Promise.all([
                import('3d-force-graph'),
                import('three-spritetext'),
            ]);
            ForceGraph3D = graphMod.default;
            SpriteText = spriteMod.default;
        } catch (err) {
            console.error('3D 그래프 엔진 로드 실패:', err);
            loadingEl.textContent = '3D 엔진 로드 실패. 네트워크를 확인하세요.';
            return;
        }

        // Build graph data
        const stats = computeStats(this.entries);
        const clusters = assignClusters(this.entries, stats);
        const nodeMap = new Map();
        const nodes = this.entries.map(entry => {
            const cluster = clusters.get(entry.id);
            const node = {
                id: entry.id,
                name: this.formatDisplayDate(new Date(entry.date)),
                cluster,
                color: clusterColor(cluster),
                val: 2,
                explicitDeg: 0,
                implicitDeg: 0,
                preview: entry.content ? entry.content.slice(0, 200) : '내용 없음',
                fullContent: entry.content || '',
                date: entry.date,
                keywords: topKeywords(entry.id, stats, 6),
            };
            nodeMap.set(entry.id, node);
            return node;
        });

        const links = [];
        const linkRegex = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;
        for (const entry of this.entries) {
            if (!entry.content) continue;
            const seen = new Set();
            for (const match of entry.content.matchAll(linkRegex)) {
                const target = match[1];
                if (target === entry.id || seen.has(target) || !nodeMap.has(target)) continue;
                seen.add(target);
                links.push({ source: entry.id, target, type: 'explicit' });
                nodeMap.get(entry.id).explicitDeg += 1;
                nodeMap.get(target).explicitDeg += 1;
                nodeMap.get(entry.id).val += 1;
                nodeMap.get(target).val += 1;
            }
        }

        for (const { a, b, shared } of findKeywordPairs(stats, 3)) {
            if (!nodeMap.has(a) || !nodeMap.has(b)) continue;
            links.push({ source: a, target: b, type: 'implicit', shared });
            nodeMap.get(a).implicitDeg += 1;
            nodeMap.get(b).implicitDeg += 1;
            nodeMap.get(a).val += 0.3;
            nodeMap.get(b).val += 0.3;
        }

        // 시간순 인접 링크 — 어떤 일기도 완전 고립되지 않게 한다.
        // 연속한 두 일기의 간격이 30일 이하일 때만 연결 (긴 공백을 가로지르지 않음).
        const sortedByDate = [...this.entries].sort((a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const ONE_DAY = 24 * 60 * 60 * 1000;
        for (let i = 0; i < sortedByDate.length - 1; i++) {
            const a = sortedByDate[i];
            const b = sortedByDate[i + 1];
            const gapDays = Math.abs(new Date(b.date) - new Date(a.date)) / ONE_DAY;
            if (gapDays > 30) continue;
            links.push({ source: a.id, target: b.id, type: 'chronology', gapDays });
        }

        // 진짜 고립 카운트 (시간순 링크가 추가됐어도 처음/마지막일 수 있으므로 따로 집계)
        const linkedIds = new Set();
        for (const l of links) { linkedIds.add(l.source); linkedIds.add(l.target); }
        const isolatedCount = nodes.filter(n => !linkedIds.has(n.id)).length;

        this.graphData = { nodes, links };
        this.graphStats = stats;

        // Stats overlay
        const explicitCount = links.filter(l => l.type === 'explicit').length;
        const implicitCount = links.filter(l => l.type === 'implicit').length;
        const chronologyCount = links.filter(l => l.type === 'chronology').length;
        statsEl.replaceChildren();
        const mkSpan = (label, value) => {
            const s = document.createElement('span');
            const strong = document.createElement('strong');
            strong.textContent = String(value);
            s.append(strong, ` ${label}`);
            return s;
        };
        const sep = () => document.createTextNode(' · ');
        statsEl.append(
            mkSpan('일기', nodes.length),
            sep(),
            mkSpan('명시', explicitCount),
            sep(),
            mkSpan('키워드', implicitCount),
            sep(),
            mkSpan('시간순', chronologyCount),
        );
        if (isolatedCount > 0) {
            statsEl.append(sep(), mkSpan('고립', isolatedCount));
        }

        if (nodes.length > 500) {
            console.warn(`그래프에 ${nodes.length}개 노드 — 렌더링 성능에 영향 가능.`);
        }

        // Build the 3D graph
        const graph = ForceGraph3D()(graphContainer)
            .backgroundColor('rgba(0,0,0,0)')
            .graphData(this.graphData)
            .nodeLabel(() => '')  // 툴팁 비활성 — SpriteText 라벨이 대신함
            .nodeRelSize(4)
            .nodeVal(node => Math.min(node.val, 12))
            .nodeColor(node => this._graphNodeColor(node))
            .nodeOpacity(0.92)
            .nodeResolution(10)
            .linkColor(link => this._graphLinkColor(link))
            .linkWidth(link => {
                if (link.type === 'explicit') return 1.5;
                if (link.type === 'implicit') return 0.5;
                return 0.35; // chronology
            })
            .linkOpacity(1.0) // 투명도는 linkColor rgba 알파로만 제어
            .linkCurvature(0)
            .linkDirectionalParticles(link => link.type === 'explicit' ? 2 : 0)
            .linkDirectionalParticleSpeed(0.005)
            .linkDirectionalParticleWidth(1.8)
            .linkDirectionalParticleColor(() => 'rgba(140, 210, 255, 0.95)')
            .nodeThreeObjectExtend(true)
            .nodeThreeObject(node => {
                const size = Math.min(Math.max(node.val, 2), 12);
                const sprite = new SpriteText(node.name);
                sprite.color = '#ffffff';              // 흰색 — 어떤 배경에서도 가독성 보장
                sprite.backgroundColor = 'rgba(10,10,18,0.55)'; // 텍스트 뒤 반투명 패널
                sprite.textHeight = Math.max(4.0, size * 0.5 + 2.5);
                sprite.fontFace = 'Inter, -apple-system, sans-serif';
                sprite.fontWeight = '600';
                sprite.padding = 2;
                sprite.borderRadius = 3;
                sprite.position.set(0, size + 5, 0); // 노드 위에 배치
                return sprite;
            })
            .onNodeClick(node => {
                this._graphFocusNode(node);
                this._graphShowDetail(node);
            })
            .onNodeHover(node => {
                graphContainer.style.cursor = node ? 'pointer' : null;
            })
            .cooldownTicks(120)
            .warmupTicks(20);

        // Tune physics
        // 약한 척력으로 응집감 유지 + 시간순 링크는 짧고 강하게(타임라인 형태) + 키워드 링크는 길고 느슨하게
        graph.d3Force('charge').strength(-220);
        graph.d3Force('link')
            .distance(link => {
                if (link.type === 'explicit') return 60;
                if (link.type === 'chronology') return 40;
                return 100;
            })
            .strength(link => {
                if (link.type === 'explicit') return 0.7;
                if (link.type === 'chronology') return 0.35;
                return 0.12;
            });

        // Hide loading overlay after first render frame
        graph.onEngineTick(() => {
            if (!loadingEl.classList.contains('hidden')) {
                loadingEl.classList.add('hidden');
            }
        });

        // Bloom 제거 — 포스트프로세싱 파이프라인 없이 기본 WebGL 렌더링으로 성능 확보
        // 대신 노드/링크 색상의 채도·밝기를 올려 발광 느낌을 CSS+색상으로 대체

        this.graph = graph;

        // Resize the canvas when modal/window changes
        if (typeof ResizeObserver !== 'undefined') {
            this.graphResizeObserver = new ResizeObserver(() => {
                const { clientWidth, clientHeight } = graphContainer;
                if (this.graph && clientWidth && clientHeight) {
                    this.graph.width(clientWidth).height(clientHeight);
                }
            });
            this.graphResizeObserver.observe(graphContainer);
        }
    }

    _graphNodeColor(node) {
        const sel = this.graphSelectedId;
        const q = (this.graphSearchQuery || '').trim().toLowerCase();
        if (q) {
            const matches = node.id.toLowerCase().includes(q)
                || node.name.toLowerCase().includes(q)
                || (node.keywords || []).some(k => k.includes(q))
                || (node.fullContent || '').toLowerCase().includes(q);
            return matches ? node.color : 'rgba(140, 140, 150, 0.18)';
        }
        if (sel) {
            const isSelf = node.id === sel;
            const isNeighbor = (this.graphData?.links || []).some(l => {
                const s = typeof l.source === 'object' ? l.source.id : l.source;
                const t = typeof l.target === 'object' ? l.target.id : l.target;
                return (s === sel && t === node.id) || (t === sel && s === node.id);
            });
            if (isSelf || isNeighbor) return node.color;
            return 'rgba(140, 140, 150, 0.15)';
        }
        return node.color;
    }

    _graphLinkColor(link) {
        const visible = this._linkPassesFilter(link);
        if (!visible) return 'rgba(0,0,0,0)';
        const sel = this.graphSelectedId;
        const s = typeof link.source === 'object' ? link.source.id : link.source;
        const t = typeof link.target === 'object' ? link.target.id : link.target;
        const isHighlighted = sel && (s === sel || t === sel);
        if (link.type === 'explicit') {
            return isHighlighted ? 'rgba(100, 210, 255, 1)' : 'rgba(30, 148, 255, 0.90)';
        }
        if (link.type === 'chronology') {
            return isHighlighted ? 'rgba(255, 255, 255, 0.55)' : 'rgba(180, 180, 210, 0.22)';
        }
        // implicit (keyword)
        return isHighlighted ? 'rgba(200, 200, 255, 0.70)' : 'rgba(200, 200, 255, 0.30)';
    }

    _linkPassesFilter(link) {
        if (this.graphFilter === 'all') return true;
        if (this.graphFilter === 'explicit') return link.type === 'explicit';
        if (this.graphFilter === 'implicit') return link.type === 'implicit';
        if (this.graphFilter === 'chronology') return link.type === 'chronology';
        return true;
    }

    _graphFocusNode(node) {
        if (!this.graph || node.x == null) return;
        const distance = 80;
        const dist = Math.hypot(node.x, node.y, node.z) || 1;
        const ratio = 1 + distance / dist;
        
        // Add a slight rotation offset for cinematic panning
        const camPos = {
            x: node.x * ratio + 10,
            y: node.y * ratio + 15,
            z: node.z * ratio
        };
        
        this.graph.cameraPosition(
            camPos,
            { x: node.x, y: node.y, z: node.z },
            1200 // Slower cinematic duration
        );
        this.graphSelectedId = node.id;
        if (this.graph) this.graph.refresh();
    }

    _graphShowDetail(node) {
        document.getElementById('graphSidepanelEmpty').style.display = 'none';
        const detail = document.getElementById('graphSidepanelDetail');
        detail.style.display = '';

        document.getElementById('spDate').textContent = node.name;
        document.getElementById('spContent').textContent = node.fullContent || '내용 없음';
        document.getElementById('spExplicitCount').textContent = `↗ ${node.explicitDeg}`;
        document.getElementById('spImplicitCount').textContent = `≈ ${node.implicitDeg}`;

        const kwBox = document.getElementById('spKeywords');
        kwBox.replaceChildren();
        for (const kw of (node.keywords || [])) {
            const chip = document.createElement('span');
            chip.className = 'graph-sp-keyword';
            chip.textContent = kw;
            kwBox.appendChild(chip);
        }

        const openBtn = document.getElementById('spOpenInEditor');
        openBtn.onclick = () => {
            this.closeGraphViewModal();
            this.selectDate(new Date(node.date));
        };
    }

    _bindGraphControls() {
        const search = document.getElementById('graphSearch');
        if (search && !search._bound) {
            search.addEventListener('input', (e) => {
                this.graphSearchQuery = e.target.value;
                if (this.graph) this.graph.refresh();
            });
            search._bound = true;
        }
        document.querySelectorAll('.graph-filter-btn').forEach(btn => {
            if (btn._bound) return;
            btn.addEventListener('click', () => {
                this.graphFilter = btn.dataset.filter || 'all';
                document.querySelectorAll('.graph-filter-btn').forEach(b =>
                    b.classList.toggle('active', b === btn)
                );
                if (this.graph) this.graph.refresh();
            });
            btn._bound = true;
        });
    }
}

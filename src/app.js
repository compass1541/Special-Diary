/**
 * Special Diary - Main Application
 */
import { storage } from './storage.js';
import { supabaseStorage } from './supabase.js';
import { getImportSummary, parseBackup } from './backup.js';
import { gemini } from './gemini.js';
import { GraphView } from './graph/view.js';
import { PersonaChat } from './ai/persona.js';
import { ChatView } from './ai/chatView.js';

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

        // 기억의 우주 (3D 연결망) — src/graph/view.js
        this.graphView = new GraphView({
            onOpenEntry: (dateIso) => this.selectDate(new Date(dateIso)),
            onAskPersona: (entry) => this.chatView.open({ seedEntry: entry }),
        });

        // AI 분신 "또 다른 나" — src/ai/
        this.persona = new PersonaChat({
            getEntries: () => Promise.resolve(this.entries),
        });
        this.chatView = new ChatView({
            persona: this.persona,
            getEntries: () => Promise.resolve(this.entries),
            onOpenEntry: (dateId) => this.selectDate(new Date(`${dateId}T12:00:00`)),
        });

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
        document.getElementById('emptyNewEntryBtn')?.addEventListener('click', () => this.openTodayEntry());

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

        // Graph View (기억의 우주) — 열기만 여기서, 나머지는 GraphView가 스스로 바인딩
        document.getElementById('openGraphView').addEventListener('click', () =>
            this.graphView.open(this.entries));

        // AI 분신 채팅
        document.getElementById('openPersonaChat')?.addEventListener('click', () =>
            this.chatView.open());

        // Modal overlay clicks
        document.getElementById('aiSearchModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeAISearchModal();
        });
        document.getElementById('aiSuggestionModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeAISuggestionModal();
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
        if (file.size > 10 * 1024 * 1024) {
            alert('백업 파일은 10MB까지 가져올 수 있습니다.');
            return;
        }
        try {
            const text = await file.text();
            const entries = parseBackup(text);
            if (entries.length === 0) {
                this.showToast('백업 파일에 가져올 일기가 없습니다.');
                return;
            }

            const existingEntries = await this.getStorage().getAllEntries();
            const summary = getImportSummary(entries, existingEntries);
            const destination = this.useSupabase ? '로컬 백업과 클라우드' : '이 기기';
            const conflictLine = summary.conflicts > 0
                ? `\n같은 날짜 ${summary.conflicts}개는 기존 일기를 덮어씁니다.`
                : '';
            const approved = confirm(
                `${summary.total}개의 일기를 ${destination}에 가져옵니다.`
                + `\n새 일기 ${summary.additions}개${conflictLine}\n\n계속할까요?`
            );
            if (!approved) return;

            // 로컬에는 한 트랜잭션으로 저장해 중간 실패 시 부분 가져오기를 방지한다.
            await storage.importEntries(entries);
            let synced = entries.length;
            if (this.useSupabase) {
                // 기존 로컬 일기를 모두 올리지 않고, 이번에 가져온 항목만 동기화한다.
                synced = await supabaseStorage.syncFromLocal(entries);
            }
            await this.loadEntries();
            this.renderCalendar();
            this.renderEntriesList();

            if (this.useSupabase && synced !== entries.length) {
                alert(
                    `${entries.length}개 중 ${synced}개만 클라우드에 반영됐습니다.`
                    + '\n모든 항목은 로컬 백업에 안전하게 저장됐으며, 네트워크 상태를 확인한 후 다시 시도해주세요.'
                );
                return;
            }

            this.showToast(`${entries.length}개의 일기를 가져왔습니다 ✓`);
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

}

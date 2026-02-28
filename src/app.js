/**
 * Special Diary - Main Application
 */
import { storage } from './storage.js';
import { supabaseStorage } from './supabase.js';
import { gemini } from './gemini.js';
import ForceGraph from 'force-graph';

export class DiaryApp {
    constructor() {
        this.currentDate = new Date();
        this.selectedDate = null;
        this.calendarDate = new Date();
        this.datesWithEntries = new Set();
        this.entries = [];
        this.useSupabase = false; // Supabase 사용 여부

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
        });

        diaryContent.addEventListener('keydown', (e) => {
            this.handleEditorKeyDown(e); // 자동완성 네비게이션
        });

        document.getElementById('dailyComment').addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => this.autoSave(), 2000);
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

        // Auth events
        this.bindAuthEvents();
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
        document.getElementById('authModal').classList.add('active');
        document.getElementById('loginEmail').focus();
        this.hideAuthError();
    }

    closeAuthModal() {
        document.getElementById('authModal').classList.remove('active');
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

        if (password.length < 6) {
            this.showAuthError('비밀번호는 6자 이상이어야 합니다.');
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
        grid.innerHTML = '';

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
        list.innerHTML = '';

        const recentEntries = this.entries.slice(0, 10);

        if (recentEntries.length === 0) {
            list.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.875rem; text-align: center; padding: 1rem;">아직 작성된 일기가 없습니다</p>';
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

            item.innerHTML = `
                <div class="entry-header">
                    <div class="entry-date">${dateStr}</div>
                    <div class="entry-time">${timeStr}</div>
                </div>
                <div class="entry-preview">${preview || '내용 없음'}</div>
                ${entry.dailyComment ? `<div class="entry-comment">"${entry.dailyComment}"</div>` : ''}
            `;

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

        document.querySelector('.date-day').textContent = day;
        document.querySelector('.date-weekday').textContent = weekday;
        document.querySelector('.date-full').textContent = fullDate;

        // 작성 시간 표시 (상세 View)
        const timeDisplay = document.getElementById('writtenTime');
        if (timeDisplay) {
            timeDisplay.textContent = entry ? `작성 시간: ${this.formatTime(entry.createdAt)}` : '';
        }

        document.getElementById('diaryContent').value = entry?.content || '';
        document.getElementById('dailyComment').value = entry?.dailyComment || '';

        // Render linked entries
        this.renderLinkedEntries(entry?.content || '');
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

        const currentStorage = this.getStorage();
        await currentStorage.saveEntry(entry);
        await this.loadEntries();
        this.renderCalendar();
        this.renderEntriesList();

        this.showToast('일기가 저장되었습니다 ✨');
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

        const currentStorage = this.getStorage();
        await currentStorage.saveEntry(entry);
        await this.loadEntries();
        this.renderCalendar();
        this.renderEntriesList();
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
        list.innerHTML = '';
        this.autocompleteResults.forEach((entry, index) => {
            const date = new Date(entry.date);
            const dateStr = this.formatDisplayDate(date);
            const preview = (entry.content || '').substring(0, 30) + ((entry.content || '').length > 30 ? '...' : '');

            const item = document.createElement('div');
            item.className = `link-autocomplete-item ${index === this.autocompleteIndex ? 'active' : ''}`;
            item.innerHTML = `
                <div class="link-item-date">${dateStr}</div>
                <div class="link-item-preview">${preview || '내용 없음'}</div>
            `;

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

        listContainer.innerHTML = '';
        let hasValidLinks = false;

        linkedDateIds.forEach(dateId => {
            // Find if entry exists
            const entry = this.entries.find(e => e.id === dateId);
            if (entry) {
                hasValidLinks = true;
                const pill = document.createElement('div');
                pill.className = 'linked-entry-pill';

                const date = new Date(entry.date);
                pill.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>${this.formatDisplayDate(date)}</span>
                `;

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
        document.getElementById('aiSearchModal').classList.add('active');
        document.getElementById('aiSearchInput').focus();
    }

    closeAISearchModal() {
        document.getElementById('aiSearchModal').classList.remove('active');
        document.getElementById('aiSearchInput').value = '';
        document.getElementById('aiSearchResults').innerHTML = '';
    }

    async performAISearch() {
        const query = document.getElementById('aiSearchInput').value.trim();
        if (!query) return;

        const resultsContainer = document.getElementById('aiSearchResults');
        resultsContainer.innerHTML = '<div class="ai-loading">AI가 일기를 검색하고 있습니다...</div>';

        try {
            const searchResult = await gemini.searchDiaries(query, this.entries);

            if (searchResult.results && searchResult.results.length > 0) {
                resultsContainer.innerHTML = '';

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
                    item.innerHTML = `
                        <div class="search-result-date">${dateStr}</div>
                        <div class="search-result-content">${(entry.content || '').substring(0, 150)}...</div>
                        <div style="font-size: 0.8125rem; color: var(--accent); margin-top: 8px;">💡 ${result.reason}</div>
                    `;

                    item.addEventListener('click', () => {
                        this.closeAISearchModal();
                        this.selectDate(date);
                    });

                    resultsContainer.appendChild(item);
                }
            } else {
                resultsContainer.innerHTML = `
                    <div style="text-align: center; padding: 32px; color: var(--text-secondary);">
                        <p>${searchResult.message || '관련된 일기를 찾지 못했습니다.'}</p>
                    </div>
                `;
            }
        } catch (error) {
            resultsContainer.innerHTML = `
                <div style="text-align: center; padding: 32px; color: var(--danger);">
                    <p>검색 중 오류가 발생했습니다.</p>
                    <p style="font-size: 0.8125rem; margin-top: 8px;">${error.message}</p>
                </div>
            `;
        }
    }

    async showAISuggestions() {
        document.getElementById('aiSuggestionModal').classList.add('active');

        const contentDiv = document.getElementById('aiSuggestionContent');
        contentDiv.innerHTML = '<div class="ai-loading">AI가 제안을 생성하고 있습니다...</div>';

        try {
            const currentContent = document.getElementById('diaryContent').value;
            const suggestions = await gemini.getSuggestions(currentContent, this.entries);

            // Format suggestions with styling
            const formattedSuggestions = suggestions
                .split('\n')
                .filter(line => line.trim())
                .map(line => `<div class="suggestion-item">${line}</div>`)
                .join('');

            contentDiv.innerHTML = formattedSuggestions || '<p>제안을 생성할 수 없습니다.</p>';
        } catch (error) {
            contentDiv.innerHTML = `
                <div style="color: var(--danger);">
                    <p>제안을 가져오는 중 오류가 발생했습니다.</p>
                    <p style="font-size: 0.875rem; margin-top: 8px;">${error.message}</p>
                </div>
            `;
        }
    }

    closeAISuggestionModal() {
        document.getElementById('aiSuggestionModal').classList.remove('active');
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
        document.getElementById('graphViewModal').classList.add('active');
        // Small delay to ensure the modal is displayed and has valid dimensions
        setTimeout(() => this.renderGraphView(), 100);
    }

    closeGraphViewModal() {
        document.getElementById('graphViewModal').classList.remove('active');
        if (this.graph) {
            this.graph._destructor();
            this.graph = null;
        }
    }

    renderGraphView() {
        const graphContainer = document.getElementById('3d-graph');
        graphContainer.innerHTML = '';
        const tooltip = document.getElementById('graphTooltip');

        if (this.entries.length === 0) {
            graphContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);">일기가 없습니다.</div>';
            return;
        }

        const nodes = [];
        const links = [];
        const linkRegex = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;
        const nodeMap = new Map();

        // Create nodes
        // Create nodes
        this.entries.forEach(entry => {
            nodes.push({
                id: entry.id,
                name: this.formatDisplayDate(new Date(entry.date)),
                group: entry.id.substring(0, 7), // YYYY-MM
                val: 2,
                content: entry.content ? entry.content.substring(0, 50) + '...' : '내용 없음'
            });
            nodeMap.set(entry.id, true);
        });

        // Create links
        this.entries.forEach(entry => {
            if (!entry.content) return;
            const matches = [...entry.content.matchAll(linkRegex)];
            matches.forEach(match => {
                const targetId = match[1];
                if (nodeMap.has(targetId)) {
                    links.push({
                        source: entry.id,
                        target: targetId
                    });

                    // Increase node size if it has explicit connections
                    const sourceNode = nodes.find(n => n.id === entry.id);
                    const targetNode = nodes.find(n => n.id === targetId);
                    if (sourceNode) sourceNode.val += 1;
                    if (targetNode) targetNode.val += 1;
                }
            });
        });

        // Basic keyword extraction & clustering logic
        // In a real app, this should rely on real NLP or embeddings (e.g. from Gemini)
        const getKeywords = (text) => {
            if (!text) return new Set();
            // Remove special chars, split by space, keep words > 1 char
            const words = text.replace(/[^\w\s가-힣]/g, '').toLowerCase().split(/\s+/);
            return new Set(words.filter(w => w.length > 1));
        };

        const entryKeywords = new Map();
        this.entries.forEach(entry => {
            entryKeywords.set(entry.id, getKeywords(entry.content));
        });

        // Add implicit keyword-based links (connect entries with >= 3 shared words)
        for (let i = 0; i < this.entries.length; i++) {
            for (let j = i + 1; j < this.entries.length; j++) {
                const entryA = this.entries[i];
                const entryB = this.entries[j];
                const keywordsA = entryKeywords.get(entryA.id);
                const keywordsB = entryKeywords.get(entryB.id);

                let sharedCount = 0;
                keywordsA.forEach(k => { if (keywordsB.has(k)) sharedCount++; });

                // If they share 3 or more meaningful common words, link them implicitly
                if (sharedCount >= 3) {
                    links.push({
                        source: entryA.id,
                        target: entryB.id,
                        implicit: true // Marker for weaker connection styling later if needed
                    });

                    // Slightly increase node size to highlight heavily related topics
                    const sourceNode = nodes.find(n => n.id === entryA.id);
                    const targetNode = nodes.find(n => n.id === entryB.id);
                    if (sourceNode) sourceNode.val += 0.2;
                    if (targetNode) targetNode.val += 0.2;
                }
            }
        }

        const graphData = { nodes, links };

        this.graph = ForceGraph()(graphContainer)
            .graphData(graphData)
            .nodeLabel(() => '') // Disable default tooltip
            .nodeAutoColorBy('group')
            .nodeRelSize(4)
            .linkWidth(link => link.implicit ? 1.0 : 2.5) // Make lines thicker
            .linkColor(link => link.implicit ? 'rgba(230, 230, 240, 0.4)' : 'rgba(255, 255, 255, 0.9)') // Make lines much brighter and solid
            .linkLineDash(() => null) // ALWAYS solid lines
            .linkDirectionalParticles(0) // Remove particles for a clean look
            .nodeCanvasObject((node, ctx, globalScale) => {
                const label = node.name;
                // Scale node size by its link value (val)
                const nodeSize = Math.max(2, node.val * 1.5);

                // Draw node circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI, false);
                // Fill with group color or a default
                ctx.fillStyle = node.color || '#fff';
                ctx.fill();

                // Detailed crisp border
                ctx.lineWidth = 1 / globalScale;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                // Draw text label
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px "Inter", -apple-system, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = 'rgba(230, 230, 240, 0.9)';

                // Show labels, offset below the node
                ctx.fillText(label, node.x, node.y + nodeSize + (2 / globalScale));
            })
            .onNodeHover(node => {
                graphContainer.style.cursor = node ? 'pointer' : null;
                if (node) {
                    tooltip.innerHTML = `<strong>${node.name}</strong><br/>${node.content}`;
                    tooltip.style.display = 'block';
                } else {
                    tooltip.style.display = 'none';
                }
            })
            .onNodeClick(node => {
                // Focus on node
                this.graph.centerAt(node.x, node.y, 1000);
                this.graph.zoom(8, 2000);
            });

        // Track mouse to position tooltip
        graphContainer.addEventListener('mousemove', e => {
            if (tooltip.style.display === 'block') {
                const rect = graphContainer.getBoundingClientRect();
                let x = e.clientX - rect.left + 15;
                let y = e.clientY - rect.top + 15;

                // Keep tooltip within visible area
                if (x + tooltip.offsetWidth > rect.width) x = e.clientX - rect.left - tooltip.offsetWidth - 10;
                if (y + tooltip.offsetHeight > rect.height) y = e.clientY - rect.top - tooltip.offsetHeight - 10;

                tooltip.style.left = `${x}px`;
                tooltip.style.top = `${y}px`;
            }
        });

        // Setup scene
        this.graph.backgroundColor('rgba(0,0,0,0)'); // Transparent to show CSS background

        // Tweak physics: spread nodes and make links longer
        this.graph.d3Force('charge').strength(-300);
        this.graph.d3Force('link').distance(80);
    }
}

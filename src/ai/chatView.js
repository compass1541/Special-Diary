/**
 * ChatView — "또 다른 나" 분신 채팅 패널의 DOM 렌더링/이벤트.
 *
 * 상태·AI 호출은 PersonaChat(persona.js)에 위임. 여기는 화면만 담당한다.
 * XSS 방지: 모든 텍스트는 textContent/DOM API로만 렌더 (innerHTML 미사용).
 */

const DATE_LINK_RE = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;

const SUGGESTIONS = [
    '요즘 나는 어때 보여?',
    '이번 달의 나를 요약해줘',
    '내가 반복해서 고민하는 게 뭐야?',
    '최근에 나를 웃게 한 순간들 찾아줘',
];

export class ChatView {
    /**
     * @param {object} deps
     *   persona            PersonaChat 인스턴스
     *   getEntries         () => Promise<Array> 최신 엔트리
     *   onOpenEntry(dateId) 인용 칩 클릭 시 해당 일기 열기
     */
    constructor({ persona, getEntries, onOpenEntry }) {
        this.persona = persona;
        this.getEntries = getEntries;
        this.onOpenEntry = onOpenEntry;
        this.seedEntryId = null;
        this.busy = false;
        this._bind();
    }

    _el(id) { return document.getElementById(id); }

    _bind() {
        this._el('closePersonaPanel')?.addEventListener('click', () => this.close());
        this._el('personaResetBtn')?.addEventListener('click', () => {
            this.persona.reset();
            this._el('personaMessages').replaceChildren();
            this._clearSeed();
            this._welcome();
        });
        this._el('personaProfileBtn')?.addEventListener('click', () => this._toggleProfileDrawer());
        this._el('personaProfileRefresh')?.addEventListener('click', () => this._refreshProfile(true));

        const form = this._el('personaForm');
        const input = this._el('personaInput');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            this._sendFromInput();
        });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                this._sendFromInput();
            }
        });
        input?.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
        });
    }

    // ========================================
    // 열기/닫기
    // ========================================

    async open({ seedEntry = null } = {}) {
        const panel = this._el('personaPanel');
        panel.classList.add('active');
        panel.setAttribute('aria-hidden', 'false');

        if (seedEntry) {
            this.seedEntryId = seedEntry.id;
            this._renderSeedChip(seedEntry);
        }

        if (this.persona.history.length === 0 && this._el('personaMessages').children.length === 0) {
            this._welcome();
        }
        this._renderSuggestions();
        await this._updateStatus();
        this._el('personaInput')?.focus();

        // 프로필이 없으면 조용히 백그라운드 생성 시도 (실패해도 채팅은 가능)
        const entries = await this.getEntries();
        if (entries.length >= 3 && !this.persona.readProfile()) {
            this._refreshProfile(false).catch(() => { /* 첫 질문 시 에러가 보이므로 조용히 무시 */ });
        }
    }

    close() {
        const panel = this._el('personaPanel');
        panel.classList.remove('active');
        panel.setAttribute('aria-hidden', 'true');
        this._el('personaProfileDrawer')?.setAttribute('hidden', '');
    }

    async _updateStatus() {
        const entries = await this.getEntries();
        const cached = this.persona.readProfile();
        const stale = cached && this.persona.isProfileStale(entries);
        const statusEl = this._el('personaStatus');
        if (!statusEl) return;
        if (!cached) {
            statusEl.textContent = `일기 ${entries.length}개로부터 · 프로필 미생성`;
        } else {
            const d = new Date(cached.updatedAt);
            const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
            statusEl.textContent = `일기 ${entries.length}개 학습 · 프로필 ${dateStr}${stale ? ' (오래됨)' : ''}`;
        }
    }

    // ========================================
    // 메시지 렌더링
    // ========================================

    _welcome() {
        this._appendBubble('assistant',
            '안녕, 나야. 네가 남긴 일기들 속에서 태어난 또 다른 너.\n' +
            '기억을 뒤져 뭐든 찾아줄게. 아래에서 골라도 되고, 그냥 편하게 물어봐.');
    }

    _appendBubble(role, text) {
        const messages = this._el('personaMessages');
        const row = document.createElement('div');
        row.className = `persona-msg ${role === 'user' ? 'from-user' : 'from-persona'}`;

        if (role === 'assistant') {
            const avatar = document.createElement('div');
            avatar.className = 'persona-msg-avatar';
            avatar.textContent = '✦';
            row.appendChild(avatar);
        }

        const bubble = document.createElement('div');
        bubble.className = 'persona-bubble';
        if (role === 'assistant') {
            this._renderRichText(bubble, text);
        } else {
            bubble.textContent = text;
        }
        row.appendChild(bubble);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
        return bubble;
    }

    /** [[YYYY-MM-DD]] 를 클릭 가능한 날짜 칩으로 바꿔 렌더 */
    _renderRichText(container, text) {
        const str = String(text || '');
        let lastIndex = 0;
        for (const match of str.matchAll(DATE_LINK_RE)) {
            if (match.index > lastIndex) {
                container.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
            }
            const dateId = match[1];
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'persona-date-chip';
            chip.textContent = dateId;
            chip.title = '이 일기 열기';
            chip.addEventListener('click', () => this.onOpenEntry?.(dateId));
            container.appendChild(chip);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < str.length) {
            container.appendChild(document.createTextNode(str.slice(lastIndex)));
        }
    }

    _appendTyping() {
        const messages = this._el('personaMessages');
        const row = document.createElement('div');
        row.className = 'persona-msg from-persona persona-typing-row';
        const avatar = document.createElement('div');
        avatar.className = 'persona-msg-avatar';
        avatar.textContent = '✦';
        const bubble = document.createElement('div');
        bubble.className = 'persona-bubble persona-typing';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            dot.className = 'persona-typing-dot';
            bubble.appendChild(dot);
        }
        row.append(avatar, bubble);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
        return row;
    }

    // ========================================
    // 전송
    // ========================================

    _sendFromInput() {
        const input = this._el('personaInput');
        const text = input.value.trim();
        if (!text || this.busy) return;
        input.value = '';
        input.style.height = 'auto';
        this.send(text);
    }

    async send(text) {
        if (this.busy) return;
        this.busy = true;
        this._el('personaSend')?.setAttribute('disabled', '');
        this._el('personaSuggestions')?.replaceChildren();
        this._appendBubble('user', text);
        const typingRow = this._appendTyping();

        const seedId = this.seedEntryId;
        this._clearSeed();

        try {
            const reply = await this.persona.ask(text, { seedEntryId: seedId });
            typingRow.remove();
            this._appendBubble('assistant', reply);
        } catch (err) {
            console.error('Persona ask failed:', err);
            typingRow.remove();
            const bubble = this._appendBubble('assistant', '');
            bubble.classList.add('persona-error');
            bubble.textContent = err?.message || '응답 중 오류가 발생했어. 잠시 후 다시 시도해줘.';
        } finally {
            this.busy = false;
            this._el('personaSend')?.removeAttribute('disabled');
            this._el('personaInput')?.focus();
        }
    }

    _renderSuggestions() {
        const box = this._el('personaSuggestions');
        if (!box || this.persona.history.length > 0) return;
        box.replaceChildren();
        for (const s of SUGGESTIONS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'persona-suggestion-chip';
            chip.textContent = s;
            chip.addEventListener('click', () => this.send(s));
            box.appendChild(chip);
        }
    }

    // ========================================
    // 컨텍스트 시드 (그래프에서 "분신에게 묻기")
    // ========================================

    _renderSeedChip(entry) {
        const box = this._el('personaContext');
        if (!box) return;
        box.replaceChildren();
        const chip = document.createElement('div');
        chip.className = 'persona-context-chip';
        const label = document.createElement('span');
        label.textContent = `📎 ${entry.id} 일기에 대해`;
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = '✕';
        clear.setAttribute('aria-label', '컨텍스트 제거');
        clear.addEventListener('click', () => this._clearSeed());
        chip.append(label, clear);
        box.appendChild(chip);
    }

    _clearSeed() {
        this.seedEntryId = null;
        this._el('personaContext')?.replaceChildren();
    }

    // ========================================
    // 프로필 드로어
    // ========================================

    _toggleProfileDrawer() {
        const drawer = this._el('personaProfileDrawer');
        if (!drawer) return;
        if (drawer.hasAttribute('hidden')) {
            drawer.removeAttribute('hidden');
            this._renderProfile();
        } else {
            drawer.setAttribute('hidden', '');
        }
    }

    async _renderProfile() {
        const box = this._el('personaProfileContent');
        const meta = this._el('personaProfileMeta');
        if (!box) return;
        box.replaceChildren();

        const cached = this.persona.readProfile();
        if (!cached) {
            const p = document.createElement('p');
            p.className = 'persona-profile-empty';
            p.textContent = '아직 프로필이 없어. "갱신"을 누르면 일기를 읽고 너를 정리해볼게.';
            box.appendChild(p);
            if (meta) meta.textContent = '';
            return;
        }

        const profile = cached.profile || {};
        const addSection = (title, value) => {
            if (!value || (Array.isArray(value) && value.length === 0)) return;
            const section = document.createElement('div');
            section.className = 'persona-profile-section';
            const h = document.createElement('div');
            h.className = 'persona-profile-title';
            h.textContent = title;
            section.appendChild(h);
            if (Array.isArray(value)) {
                const chips = document.createElement('div');
                chips.className = 'persona-profile-chips';
                for (const item of value.slice(0, 8)) {
                    const chip = document.createElement('span');
                    chip.className = 'persona-profile-chip';
                    chip.textContent = String(item);
                    chips.appendChild(chip);
                }
                section.appendChild(chips);
            } else {
                const p = document.createElement('p');
                p.className = 'persona-profile-text';
                p.textContent = String(value);
                section.appendChild(p);
            }
            box.appendChild(section);
        };

        addSection('요약', profile.summary);
        addSection('가치관', profile.values);
        addSection('반복되는 주제', profile.themes);
        addSection('감정 패턴', profile.emotionalPatterns);
        addSection('내 곁의 사람들', profile.people);
        addSection('습관', profile.habits);
        addSection('말투', profile.voice);

        if (meta) {
            const entries = await this.getEntries();
            const stale = this.persona.isProfileStale(entries);
            const d = new Date(cached.updatedAt);
            meta.textContent = `마지막 갱신 ${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` +
                (stale ? ' — 새 일기가 반영되지 않았어. 갱신해줘.' : '');
        }
    }

    async _refreshProfile(userTriggered) {
        const btn = this._el('personaProfileRefresh');
        if (btn) { btn.disabled = true; btn.textContent = '읽는 중…'; }
        try {
            await this.persona.ensureProfile({ force: userTriggered });
            await this._updateStatus();
            const drawer = this._el('personaProfileDrawer');
            if (drawer && !drawer.hasAttribute('hidden')) this._renderProfile();
        } catch (err) {
            console.error('Profile refresh failed:', err);
            if (userTriggered) {
                const box = this._el('personaProfileContent');
                if (box) {
                    const p = document.createElement('p');
                    p.className = 'persona-profile-empty persona-error';
                    p.textContent = err?.message || '프로필 생성에 실패했어.';
                    box.replaceChildren(p);
                }
            }
            throw err;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '갱신'; }
        }
    }
}

/**
 * GraphView — "기억의 우주" 3D 연결망 뷰.
 *
 * app.js에서 분리된 그래프 전담 모듈. 데이터 계산은 ./data.js(순수 함수)에 위임하고
 * 여기서는 렌더링·상호작용만 담당한다.
 *
 * 주요 기능:
 *   - 키워드 허브 노드(옥타헤드론) + 일기 노드(구) 2-모드 그래프
 *   - UnrealBloom 글로우 (노드 300개 초과 시 기본 꺼짐, 토글 가능)
 *   - 스마트 라벨: 허브·선택·이웃·검색 매치만 표시 ("전체" 토글 가능)
 *   - 레이아웃: 자유(force) ↔ 시간 나선(날짜순 헬릭스)
 *   - 클러스터 범례 스포트라이트, 노드 포커스(카메라 플라이 + 이웃 발광)
 *   - 사이드패널: 일기 상세 / 키워드 허브 상세 / 관련 일기 / 분신에게 묻기
 */
import { buildGraphData, helixPositions, relatedEntries } from './data.js';

const DIM_NODE = 'rgba(120, 124, 140, 0.13)';

const LINK_STYLE = {
    explicit: {
        bright: 'rgba(110, 215, 255, 1)', normal: 'rgba(40, 150, 255, 0.85)', dim: 'rgba(40, 150, 255, 0.06)',
        width: 1.6, brightWidth: 2.4,
    },
    keyword: {
        bright: 'rgba(255, 222, 150, 0.95)', normal: 'rgba(214, 188, 130, 0.30)', dim: 'rgba(214, 188, 130, 0.05)',
        width: 0.7, brightWidth: 1.4,
    },
    chronology: {
        bright: 'rgba(220, 225, 255, 0.65)', normal: 'rgba(160, 168, 200, 0.18)', dim: 'rgba(160, 168, 200, 0.04)',
        width: 0.4, brightWidth: 0.9,
    },
};

const idOf = (x) => (typeof x === 'object' && x !== null ? x.id : x);

export class GraphView {
    /**
     * @param {object} callbacks
     *   onOpenEntry(dateIso)  — "편집기에서 열기"
     *   onAskPersona(entry)   — "분신에게 이 일기에 대해 묻기"
     */
    constructor({ onOpenEntry, onAskPersona }) {
        this.onOpenEntry = onOpenEntry;
        this.onAskPersona = onAskPersona;

        this.graph = null;
        this.data = null;
        this.entries = [];
        this.nodeById = new Map();
        this.adjacency = new Map();
        this.bloomPass = null;
        this.resizeObserver = null;
        this._escHandler = null;

        this.state = {
            filter: 'all',        // all | explicit | keyword | chronology
            search: '',
            selectedId: null,
            spotlightCluster: null,
            layout: 'free',       // free | helix
            bloom: true,
            labels: 'smart',      // smart | all
        };

        this._bindControls();
    }

    // ========================================
    // 모달 열기/닫기
    // ========================================

    open(entries) {
        this.entries = entries || [];
        const m = document.getElementById('graphViewModal');
        m.classList.add('active');
        m.setAttribute('aria-hidden', 'false');

        // 상태 초기화
        this.state.filter = 'all';
        this.state.search = '';
        this.state.selectedId = null;
        this.state.spotlightCluster = null;
        this.state.layout = 'free';
        this.state.labels = 'smart';
        this._syncToolbar();
        this._showEmpty();

        this._escHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (this.state.selectedId || this.state.spotlightCluster) {
                this._clearSelection();
            } else {
                this.close();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // 모달 레이아웃이 자리잡은 뒤 캔버스 크기가 잡히도록 지연 렌더
        setTimeout(() => this._render(), 50);
    }

    close() {
        const m = document.getElementById('graphViewModal');
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        this._teardownGraph();
    }

    _teardownGraph() {
        if (this.graph) {
            try { this.graph._destructor(); } catch { /* noop */ }
            this.graph = null;
        }
        if (this.resizeObserver) {
            try { this.resizeObserver.disconnect(); } catch { /* noop */ }
            this.resizeObserver = null;
        }
        this.bloomPass = null;
        this.data = null;
        this.nodeById = new Map();
        this.adjacency = new Map();
    }

    // ========================================
    // 렌더링
    // ========================================

    async _render() {
        const container = document.getElementById('3d-graph');
        const loadingEl = document.getElementById('graphLoading');
        container.replaceChildren();
        this._teardownGraph();

        if (this.entries.length === 0) {
            loadingEl.classList.add('hidden');
            const empty = document.createElement('div');
            empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);';
            empty.textContent = '일기가 없습니다. 첫 일기를 쓰면 우주가 시작됩니다.';
            container.appendChild(empty);
            document.getElementById('graphStats').replaceChildren();
            document.getElementById('graphClusterLegend').replaceChildren();
            return;
        }

        // 3D 엔진 lazy-load — 초기 번들에 포함되지 않게 유지
        loadingEl.classList.remove('hidden');
        loadingEl.textContent = '3D 엔진 로딩 중...';
        let ForceGraph3D, SpriteText, THREE, UnrealBloomPass;
        try {
            const [graphMod, spriteMod, threeMod, bloomMod] = await Promise.all([
                import('3d-force-graph'),
                import('three-spritetext'),
                import('three'),
                import('three/addons/postprocessing/UnrealBloomPass.js'),
            ]);
            ForceGraph3D = graphMod.default;
            SpriteText = spriteMod.default;
            THREE = threeMod;
            UnrealBloomPass = bloomMod.UnrealBloomPass;
        } catch (err) {
            console.error('3D 그래프 엔진 로드 실패:', err);
            loadingEl.textContent = '3D 엔진 로드 실패. 네트워크를 확인하세요.';
            return;
        }

        // ---- 데이터 구성 (순수 함수)
        this.data = buildGraphData(this.entries);
        this.nodeById = new Map(this.data.nodes.map(n => [n.id, n]));
        this.adjacency = new Map();
        for (const l of this.data.links) {
            const s = idOf(l.source), t = idOf(l.target);
            if (!this.adjacency.has(s)) this.adjacency.set(s, new Set());
            if (!this.adjacency.has(t)) this.adjacency.set(t, new Set());
            this.adjacency.get(s).add(t);
            this.adjacency.get(t).add(s);
        }

        this._renderStats();
        this._renderClusterLegend();

        // 노드가 많으면 bloom 기본 OFF (토글로 켤 수 있음)
        this.state.bloom = this.data.nodes.length <= 300;

        // ---- 그래프 생성
        const graph = ForceGraph3D()(container)
            .backgroundColor('#05060f')
            .graphData({ nodes: this.data.nodes, links: this.data.links })
            .nodeLabel(node => node.kind === 'keyword' ? `#${node.name} · 일기 ${node.count}개` : node.name)
            .nodeRelSize(4)
            .nodeVal(node => Math.min(node.val, 12))
            .nodeColor(node => this._nodeColor(node))
            .nodeOpacity(0.92)
            .nodeResolution(12)
            .linkColor(link => this._linkColor(link))
            .linkWidth(link => this._linkWidth(link))
            .linkOpacity(1.0) // 투명도는 rgba 알파로만 제어
            .linkDirectionalParticles(link => {
                if (!this._linkPassesFilter(link)) return 0;
                if (link.type !== 'explicit') return 0;
                return this._linkState(link) === 'bright' ? 4 : 2;
            })
            .linkDirectionalParticleSpeed(0.006)
            .linkDirectionalParticleWidth(1.8)
            .linkDirectionalParticleColor(() => 'rgba(150, 215, 255, 0.95)')
            .nodeThreeObjectExtend(node => node.kind === 'entry')
            .nodeThreeObject(node => this._nodeObject(node, { THREE, SpriteText }))
            .onNodeClick(node => this._handleNodeClick(node))
            .onBackgroundClick(() => this._clearSelection())
            .onNodeHover(node => { container.style.cursor = node ? 'pointer' : null; })
            .cooldownTicks(140)
            .warmupTicks(30);

        // ---- 물리: 허브 star는 짧고 단단히(별자리 느낌), 시간축은 얇은 실처럼
        graph.d3Force('charge').strength(-230);
        graph.d3Force('link')
            .distance(link => {
                if (link.type === 'explicit') return 55;
                if (link.type === 'keyword') return 45;
                return 42; // chronology
            })
            .strength(link => {
                if (link.type === 'explicit') return 0.7;
                if (link.type === 'keyword') return 0.3;
                return 0.3;
            });

        // ---- Bloom 글로우
        try {
            const { clientWidth: w, clientHeight: h } = container;
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(Math.max(w, 2), Math.max(h, 2)), 1.05, 0.55, 0.12
            );
            this.bloomPass.enabled = this.state.bloom;
            graph.postProcessingComposer().addPass(this.bloomPass);
        } catch (err) {
            console.warn('Bloom 초기화 실패 (기본 렌더링으로 진행):', err);
            this.bloomPass = null;
        }
        this._syncToolbar();

        // 첫 프레임 후 로딩 제거
        graph.onEngineTick(() => {
            if (!loadingEl.classList.contains('hidden')) loadingEl.classList.add('hidden');
        });

        // ---- 시네마틱 진입: 멀리서 천천히 다가오는 카메라
        const nodeCount = this.data.nodes.length;
        const dist = Math.max(340, 150 * Math.cbrt(nodeCount));
        graph.cameraPosition({ x: 0, y: dist * 0.18, z: dist * 2.6 });
        setTimeout(() => {
            if (this.graph === graph) {
                graph.cameraPosition({ x: dist * 0.22, y: dist * 0.14, z: dist }, { x: 0, y: 0, z: 0 }, 1800);
            }
        }, 80);

        // 레이아웃은 open()에서 'free'로 초기화되므로 여기서 별도 적용 불필요.
        // (엔진 초기화 전 d3ReheatSimulation() 호출은 tick 오류를 일으킨다.)
        this.graph = graph;

        // 모달/창 크기 변화 대응
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                const { clientWidth, clientHeight } = container;
                if (this.graph && clientWidth && clientHeight) {
                    this.graph.width(clientWidth).height(clientHeight);
                }
            });
            this.resizeObserver.observe(container);
        }
    }

    // ========================================
    // 노드/링크 시각 상태
    // ========================================

    _matchesSearch(node, q) {
        if (node.kind === 'keyword') return node.name.toLowerCase().includes(q);
        return node.id.toLowerCase().includes(q)
            || node.name.toLowerCase().includes(q)
            || (node.keywords || []).some(k => k.includes(q))
            || (node.fullContent || '').toLowerCase().includes(q);
    }

    _hubTouchesCluster(node, cluster) {
        const neighbors = this.adjacency.get(node.id);
        if (!neighbors) return false;
        for (const id of neighbors) {
            const n = this.nodeById.get(id);
            if (n && n.kind === 'entry' && n.cluster === cluster) return true;
        }
        return false;
    }

    /** @returns {'bright'|'normal'|'dim'} */
    _nodeState(node) {
        const q = this.state.search.trim().toLowerCase();
        if (q) return this._matchesSearch(node, q) ? 'bright' : 'dim';

        const cluster = this.state.spotlightCluster;
        if (cluster) {
            if (node.kind === 'entry') return node.cluster === cluster ? 'bright' : 'dim';
            return this._hubTouchesCluster(node, cluster) ? 'normal' : 'dim';
        }

        const sel = this.state.selectedId;
        if (sel) {
            if (node.id === sel) return 'bright';
            return this.adjacency.get(sel)?.has(node.id) ? 'bright' : 'dim';
        }

        // 링크 필터: 해당 종류 링크가 안 보이는 허브는 같이 가라앉힌다
        if (this.state.filter !== 'all' && this.state.filter !== 'keyword' && node.kind === 'keyword') {
            return 'dim';
        }
        return 'normal';
    }

    _nodeColor(node) {
        return this._nodeState(node) === 'dim' ? DIM_NODE : node.color;
    }

    _linkPassesFilter(link) {
        return this.state.filter === 'all' || link.type === this.state.filter;
    }

    /** @returns {'bright'|'normal'|'dim'} */
    _linkState(link) {
        const s = this.nodeById.get(idOf(link.source));
        const t = this.nodeById.get(idOf(link.target));
        if (!s || !t) return 'normal';
        const ss = this._nodeState(s), ts = this._nodeState(t);
        if (ss === 'dim' || ts === 'dim') return 'dim';
        if (ss === 'bright' && ts === 'bright') return 'bright';
        // 아무 강조도 없는 평상시
        if (!this.state.selectedId && !this.state.spotlightCluster && !this.state.search.trim()) return 'normal';
        return 'normal';
    }

    _linkColor(link) {
        if (!this._linkPassesFilter(link)) return 'rgba(0,0,0,0)';
        const style = LINK_STYLE[link.type] || LINK_STYLE.chronology;
        return style[this._linkState(link)];
    }

    _linkWidth(link) {
        if (!this._linkPassesFilter(link)) return 0;
        const style = LINK_STYLE[link.type] || LINK_STYLE.chronology;
        return this._linkState(link) === 'bright' ? style.brightWidth : style.width;
    }

    _labelVisible(node) {
        const state = this._nodeState(node);
        if (state === 'dim') return false;
        if (node.kind === 'keyword') return true;          // 허브 라벨은 항상 (dim 제외)
        if (this.state.labels === 'all') return true;
        if (state === 'bright') return true;               // 선택·이웃·검색 매치
        return false;
    }

    _nodeObject(node, { THREE, SpriteText }) {
        if (node.kind === 'keyword') {
            const dim = this._nodeState(node) === 'dim';
            const size = Math.max(3, 1.5 + node.count * 0.55);
            const group = new THREE.Group();
            const mesh = new THREE.Mesh(
                new THREE.OctahedronGeometry(size, 0),
                new THREE.MeshBasicMaterial({
                    color: 0xffd97a,
                    transparent: true,
                    opacity: dim ? 0.10 : 0.95,
                })
            );
            group.add(mesh);
            if (!dim && this._labelVisible(node)) {
                const label = new SpriteText(`#${node.name}`);
                label.color = '#ffe9b8';
                label.backgroundColor = 'rgba(10, 10, 18, 0.45)';
                label.textHeight = Math.max(3.6, Math.min(3 + node.count * 0.35, 7));
                label.fontFace = 'Inter, -apple-system, sans-serif';
                label.fontWeight = '600';
                label.padding = 1.5;
                label.borderRadius = 2;
                label.position.set(0, size + 4, 0);
                group.add(label);
            }
            return group;
        }

        // 일기 노드: 기본 구 + (조건부) 라벨 스프라이트
        if (!this._labelVisible(node)) return undefined;
        const r = 4 * Math.cbrt(Math.min(node.val, 12));
        const sprite = new SpriteText(node.name);
        sprite.color = '#ffffff';
        sprite.backgroundColor = 'rgba(8, 10, 20, 0.55)';
        sprite.textHeight = Math.max(4, r * 0.55 + 2.2);
        sprite.fontFace = 'Inter, -apple-system, sans-serif';
        sprite.fontWeight = '600';
        sprite.padding = 2;
        sprite.borderRadius = 3;
        sprite.position.set(0, r + 5, 0);
        return sprite;
    }

    // ========================================
    // 상호작용
    // ========================================

    _refresh() {
        if (this.graph) this.graph.refresh();
    }

    _handleNodeClick(node) {
        this.state.selectedId = node.id;
        this.state.spotlightCluster = null;
        this._flyTo(node);
        if (node.kind === 'keyword') {
            this._showHubDetail(node);
        } else {
            this._showEntryDetail(node);
        }
        this._refresh();
        this._renderClusterLegend();
    }

    _clearSelection() {
        this.state.selectedId = null;
        this.state.spotlightCluster = null;
        this._showEmpty();
        this._refresh();
        this._renderClusterLegend();
    }

    _flyTo(node) {
        if (!this.graph || node.x == null) return;
        const distance = 90;
        const dist = Math.hypot(node.x, node.y, node.z) || 1;
        const ratio = 1 + distance / dist;
        this.graph.cameraPosition(
            { x: node.x * ratio + 12, y: node.y * ratio + 14, z: node.z * ratio },
            { x: node.x, y: node.y, z: node.z },
            1100
        );
    }

    /** 사이드패널에서 다른 노드로 점프 (관련 일기 / 허브의 일기 목록) */
    _jumpToNode(nodeId) {
        const liveNode = this.graph?.graphData().nodes.find(n => n.id === nodeId);
        if (liveNode) this._handleNodeClick(liveNode);
    }

    // ========================================
    // 레이아웃 모드
    // ========================================

    _applyLayout() {
        if (!this.graph) return;
        const nodes = this.graph.graphData().nodes;
        if (this.state.layout === 'helix') {
            const positions = helixPositions(nodes.filter(n => n.kind === 'entry'));
            for (const n of nodes) {
                const p = positions.get(n.id);
                if (p) { n.fx = p.x; n.fy = p.y; n.fz = p.z; }
                else { delete n.fx; delete n.fy; delete n.fz; } // 허브는 force가 배치
            }
        } else {
            for (const n of nodes) { delete n.fx; delete n.fy; delete n.fz; }
        }
        this.graph.d3ReheatSimulation();
    }

    // ========================================
    // 툴바 / 범례 / 통계
    // ========================================

    _bindControls() {
        const search = document.getElementById('graphSearch');
        if (search && !search._bound) {
            search.addEventListener('input', (e) => {
                this.state.search = e.target.value;
                this._refresh();
            });
            search._bound = true;
        }

        document.querySelectorAll('.graph-filter-btn').forEach(btn => {
            if (btn._bound) return;
            btn.addEventListener('click', () => {
                this.state.filter = btn.dataset.filter || 'all';
                document.querySelectorAll('.graph-filter-btn').forEach(b =>
                    b.classList.toggle('active', b === btn));
                this._refresh();
            });
            btn._bound = true;
        });

        document.querySelectorAll('.graph-layout-btn').forEach(btn => {
            if (btn._bound) return;
            btn.addEventListener('click', () => {
                this.state.layout = btn.dataset.layout || 'free';
                document.querySelectorAll('.graph-layout-btn').forEach(b =>
                    b.classList.toggle('active', b === btn));
                this._applyLayout();
            });
            btn._bound = true;
        });

        const bloomBtn = document.getElementById('graphBloomToggle');
        if (bloomBtn && !bloomBtn._bound) {
            bloomBtn.addEventListener('click', () => {
                this.state.bloom = !this.state.bloom;
                if (this.bloomPass) this.bloomPass.enabled = this.state.bloom;
                bloomBtn.classList.toggle('active', this.state.bloom);
            });
            bloomBtn._bound = true;
        }

        const labelsBtn = document.getElementById('graphLabelsToggle');
        if (labelsBtn && !labelsBtn._bound) {
            labelsBtn.addEventListener('click', () => {
                this.state.labels = this.state.labels === 'smart' ? 'all' : 'smart';
                labelsBtn.classList.toggle('active', this.state.labels === 'all');
                this._refresh();
            });
            labelsBtn._bound = true;
        }

        document.getElementById('closeGraphView')?.addEventListener('click', () => this.close());
        document.getElementById('graphViewModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
    }

    _syncToolbar() {
        document.querySelectorAll('.graph-filter-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.filter === this.state.filter));
        document.querySelectorAll('.graph-layout-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.layout === this.state.layout));
        document.getElementById('graphBloomToggle')?.classList.toggle('active', this.state.bloom);
        document.getElementById('graphLabelsToggle')?.classList.toggle('active', this.state.labels === 'all');
        const search = document.getElementById('graphSearch');
        if (search) search.value = this.state.search;
    }

    _renderStats() {
        const statsEl = document.getElementById('graphStats');
        statsEl.replaceChildren();
        const c = this.data.counts;
        const mkSpan = (label, value) => {
            const s = document.createElement('span');
            const strong = document.createElement('strong');
            strong.textContent = String(value);
            s.append(strong, ` ${label}`);
            return s;
        };
        const sep = () => document.createTextNode(' · ');
        statsEl.append(
            mkSpan('일기', c.entries), sep(),
            mkSpan('키워드 허브', c.hubs), sep(),
            mkSpan('명시', c.explicit), sep(),
            mkSpan('키워드', c.keyword), sep(),
            mkSpan('시간순', c.chronology),
        );
        if (c.isolated > 0) statsEl.append(sep(), mkSpan('고립', c.isolated));
    }

    _renderClusterLegend() {
        const box = document.getElementById('graphClusterLegend');
        if (!box) return;
        box.replaceChildren();
        const top = (this.data?.clusters || [])
            .filter(cl => cl.id !== 'misc' && cl.size >= 2)
            .slice(0, 6);
        for (const cl of top) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'graph-cluster-chip';
            chip.classList.toggle('active', this.state.spotlightCluster === cl.id);
            const dot = document.createElement('span');
            dot.className = 'graph-cluster-dot';
            dot.style.background = cl.color;
            const label = document.createElement('span');
            label.textContent = `${cl.id} ${cl.size}`;
            chip.append(dot, label);
            chip.addEventListener('click', () => {
                this.state.spotlightCluster = this.state.spotlightCluster === cl.id ? null : cl.id;
                this.state.selectedId = null;
                this._showEmpty();
                this._renderClusterLegend();
                this._refresh();
            });
            box.appendChild(chip);
        }
    }

    // ========================================
    // 사이드패널
    // ========================================

    _showEmpty() {
        document.getElementById('graphSidepanelEmpty').style.display = '';
        document.getElementById('graphSidepanelDetail').style.display = 'none';
        document.getElementById('graphSidepanelHub').style.display = 'none';
    }

    _showEntryDetail(node) {
        document.getElementById('graphSidepanelEmpty').style.display = 'none';
        document.getElementById('graphSidepanelHub').style.display = 'none';
        const detail = document.getElementById('graphSidepanelDetail');
        detail.style.display = '';

        document.getElementById('spDate').textContent = node.name;
        document.getElementById('spContent').textContent = node.fullContent || '내용 없음';
        document.getElementById('spExplicitCount').textContent = `↗ 명시 ${node.explicitDeg}`;
        document.getElementById('spKeywordCount').textContent = `# 키워드 ${node.keywordDeg}`;

        // 키워드 칩 — 클릭하면 해당 허브로 점프
        const kwBox = document.getElementById('spKeywords');
        kwBox.replaceChildren();
        for (const kw of (node.keywords || [])) {
            const hubId = `kw:${kw}`;
            const hasHub = this.nodeById.has(hubId);
            const chip = document.createElement(hasHub ? 'button' : 'span');
            chip.className = 'graph-sp-keyword' + (hasHub ? ' clickable' : '');
            chip.textContent = `#${kw}`;
            if (hasHub) {
                chip.type = 'button';
                chip.addEventListener('click', () => this._jumpToNode(hubId));
            }
            kwBox.appendChild(chip);
        }

        // 관련 일기 (공유 키워드 기준)
        const relBox = document.getElementById('spRelated');
        relBox.replaceChildren();
        const related = relatedEntries(node.id, this.entries, this.data.stats, 5);
        if (related.length > 0) {
            const title = document.createElement('div');
            title.className = 'graph-sp-section-title';
            title.textContent = '관련 일기';
            relBox.appendChild(title);
            for (const rel of related) {
                const relNode = this.nodeById.get(rel.id);
                if (!relNode) continue;
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'graph-sp-related-item';
                const dateEl = document.createElement('span');
                dateEl.className = 'graph-sp-related-date';
                dateEl.textContent = relNode.name;
                const sharedEl = document.createElement('span');
                sharedEl.className = 'graph-sp-related-shared';
                sharedEl.textContent = rel.shared.map(t => `#${t}`).join(' ');
                row.append(dateEl, sharedEl);
                row.addEventListener('click', () => this._jumpToNode(rel.id));
                relBox.appendChild(row);
            }
        }

        document.getElementById('spOpenInEditor').onclick = () => {
            this.close();
            this.onOpenEntry?.(node.date);
        };
        const askBtn = document.getElementById('spAskPersona');
        if (askBtn) {
            askBtn.onclick = () => {
                const entry = this.entries.find(e => e.id === node.id);
                this.close();
                this.onAskPersona?.(entry || { id: node.id, date: node.date, content: node.fullContent });
            };
        }
    }

    _showHubDetail(node) {
        document.getElementById('graphSidepanelEmpty').style.display = 'none';
        document.getElementById('graphSidepanelDetail').style.display = 'none';
        const hubPanel = document.getElementById('graphSidepanelHub');
        hubPanel.style.display = '';

        document.getElementById('spHubName').textContent = `#${node.name}`;
        document.getElementById('spHubCount').textContent = `이 키워드로 연결된 일기 ${node.count}개`;

        const listBox = document.getElementById('spHubEntries');
        listBox.replaceChildren();
        const neighborIds = [...(this.adjacency.get(node.id) || [])]
            .filter(id => this.nodeById.get(id)?.kind === 'entry')
            .sort((a, b) => b.localeCompare(a)); // 최신 날짜 먼저
        for (const id of neighborIds) {
            const entryNode = this.nodeById.get(id);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'graph-sp-related-item';
            const dateEl = document.createElement('span');
            dateEl.className = 'graph-sp-related-date';
            dateEl.textContent = entryNode.name;
            const prevEl = document.createElement('span');
            prevEl.className = 'graph-sp-related-shared';
            prevEl.textContent = (entryNode.preview || '').slice(0, 40);
            row.append(dateEl, prevEl);
            row.addEventListener('click', () => this._jumpToNode(id));
            listBox.appendChild(row);
        }
    }
}

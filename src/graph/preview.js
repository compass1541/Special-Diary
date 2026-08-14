import * as THREE from 'three';
import { createPreviewGraph } from './previewData.js';

const MEMORY_NAMES = [
    '한강의 저녁 바람', '처음 마주친 골목', '비가 오던 카페', '새벽의 긴 대화',
    '여름 여행의 조각', '완성한 작은 프로젝트', '오래된 사진 한 장', '따뜻했던 저녁',
];

const NEON_NAMES = [
    'CORE MEMORY', 'EMOTION TRACE', 'PERSONA LINK', 'TEMPORAL NODE',
    'DREAM CACHE', 'SOCIAL ECHO', 'ARCHIVE GATE', 'UNKNOWN SIGNAL',
];

function makeGlowTexture(color = '#ffffff', hardCore = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(hardCore ? 0.08 : 0.18, color);
    gradient.addColorStop(0.48, `${color}66`);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

function createStars(scene, mode) {
    const count = mode === 'journey' ? 850 : 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = mode === 'journey'
        ? [new THREE.Color('#ffffff'), new THREE.Color('#afcbff'), new THREE.Color('#d8bfff')]
        : [new THREE.Color('#30f6ff'), new THREE.Color('#ff4eea'), new THREE.Color('#6b75ff')];

    for (let index = 0; index < count; index += 1) {
        positions[index * 3] = (Math.random() - 0.5) * 90;
        positions[index * 3 + 1] = (Math.random() - 0.5) * 58;
        positions[index * 3 + 2] = (Math.random() - 0.5) * 55 - 7;
        const color = palette[index % palette.length];
        const brightness = 0.35 + Math.random() * 0.65;
        colors[index * 3] = color.r * brightness;
        colors[index * 3 + 1] = color.g * brightness;
        colors[index * 3 + 2] = color.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        color: '#ffffff',
        size: mode === 'journey' ? 0.18 : 0.1,
        transparent: true,
        opacity: mode === 'journey' ? 0.72 : 0.5,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));
    scene.add(points);
    return points;
}

function addJourneyAtmosphere(scene) {
    const cloudGroup = new THREE.Group();
    const clouds = [
        ['#6252da', 15, -5, 2, -7],
        ['#37c7da', 11, 6, -3, -10],
        ['#e278c8', 9, 2, 6, -13],
        ['#617cff', 7, -8, -6, -3],
    ];
    for (const [color, size, x, y, z] of clouds) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeGlowTexture(color),
            color,
            transparent: true,
            opacity: 0.19,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        sprite.position.set(x, y, z);
        sprite.scale.set(size * 2.1, size, 1);
        cloudGroup.add(sprite);
    }
    scene.add(cloudGroup);
    return cloudGroup;
}

function addNeonGrid(scene) {
    const grid = new THREE.GridHelper(70, 34, '#16e9ff', '#102d48');
    grid.position.y = -10;
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    scene.add(grid);

    const backGrid = new THREE.GridHelper(70, 26, '#ff35dc', '#11273d');
    backGrid.rotation.x = Math.PI / 2;
    backGrid.position.z = -24;
    backGrid.material.transparent = true;
    backGrid.material.opacity = 0.2;
    scene.add(backGrid);

    const horizon = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 20),
        new THREE.MeshBasicMaterial({
            color: '#062743', transparent: true, opacity: 0.18,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        })
    );
    horizon.position.set(0, -9.8, -10);
    horizon.rotation.x = -Math.PI / 2;
    scene.add(horizon);
    return { grid, backGrid };
}

function linkCurve(source, target, mode, index) {
    if (mode === 'neon') return [source.clone(), target.clone()];
    const middle = source.clone().lerp(target, 0.5);
    middle.y += Math.sin(index * 1.7) * 0.9 + 0.65;
    middle.z += Math.cos(index * 1.23) * 0.7;
    return new THREE.QuadraticBezierCurve3(source, middle, target).getPoints(16);
}

function buildGraph(scene, mode) {
    const data = createPreviewGraph({ seed: mode === 'journey' ? 84 : 211, nodeCount: mode === 'journey' ? 25 : 28 });
    const group = new THREE.Group();
    const nodes = new Map();
    const links = [];
    const travelers = [];
    const journeyColors = ['#74e8ff', '#a78bff', '#ff8dd5'];
    const neonColors = ['#30f6ff', '#ff4eea', '#6c75ff'];
    const palette = mode === 'journey' ? journeyColors : neonColors;

    for (const node of data.nodes) {
        const color = palette[node.cluster];
        const nodeGroup = new THREE.Group();
        const scale = 0.18 + node.importance * (mode === 'journey' ? 0.32 : 0.22);
        const geometry = mode === 'journey'
            ? new THREE.SphereGeometry(scale, 20, 20)
            : new THREE.IcosahedronGeometry(scale * 1.1, node.importance > 0.7 ? 1 : 0);
        const material = mode === 'journey'
            ? new THREE.MeshStandardMaterial({
                color, emissive: color, emissiveIntensity: 2.6, roughness: 0.24, metalness: 0.05,
            })
            : new THREE.MeshBasicMaterial({ color, wireframe: node.importance < 0.46 });
        const core = new THREE.Mesh(geometry, material);
        core.userData.isNode = true;
        core.userData.nodeId = node.id;
        nodeGroup.add(core);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeGlowTexture(color, mode === 'neon'),
            color,
            transparent: true,
            opacity: mode === 'journey' ? 0.68 : 0.5,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        const haloSize = mode === 'journey' ? 2.6 + node.importance * 2.4 : 1.55 + node.importance;
        halo.scale.setScalar(haloSize);
        nodeGroup.add(halo);

        if (node.importance > 0.74) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(scale * 2.1, mode === 'journey' ? 0.015 : 0.025, 8, 44),
                new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.72,
                    blending: THREE.AdditiveBlending,
                })
            );
            ring.name = 'orbitRing';
            ring.rotation.x = Math.PI / 2.8;
            nodeGroup.add(ring);
        }

        nodeGroup.position.set(node.x, node.y, node.z);
        nodeGroup.userData = { id: node.id, baseScale: 1, importance: node.importance };
        nodes.set(node.id, nodeGroup);
        group.add(nodeGroup);
    }

    data.links.forEach((link, index) => {
        const source = nodes.get(link.source).position;
        const target = nodes.get(link.target).position;
        const points = linkCurve(source, target, mode, index);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const color = mode === 'journey'
            ? (index % 4 === 0 ? '#c9b8ff' : '#80dfff')
            : (index % 3 === 0 ? '#ff40df' : '#22eaff');
        const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: mode === 'journey' ? 0.2 + link.strength * 0.2 : 0.28 + link.strength * 0.36,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        line.userData = {
            source: link.source,
            target: link.target,
            normalOpacity: material.opacity,
        };
        links.push(line);
        group.add(line);

        if (index % (mode === 'journey' ? 3 : 2) === 0) {
            const traveler = new THREE.Mesh(
                new THREE.SphereGeometry(mode === 'journey' ? 0.055 : 0.075, 8, 8),
                new THREE.MeshBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending })
            );
            traveler.userData = {
                curve: mode === 'journey'
                    ? new THREE.CatmullRomCurve3(points)
                    : new THREE.LineCurve3(source, target),
                speed: 0.07 + (index % 5) * 0.014,
                offset: (index * 0.173) % 1,
            };
            travelers.push(traveler);
            group.add(traveler);
        }
    });

    scene.add(group);
    return { data, group, nodes, links, travelers };
}

function createConceptScene(canvas, mode) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = mode === 'journey' ? 1.35 : 1.15;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(mode === 'journey' ? '#050611' : '#020812');
    scene.fog = new THREE.FogExp2(scene.background, mode === 'journey' ? 0.018 : 0.012);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 160);
    camera.position.set(mode === 'journey' ? 0 : 1, mode === 'journey' ? 2.4 : 3.2, mode === 'journey' ? 29 : 31);

    scene.add(new THREE.AmbientLight(mode === 'journey' ? '#6d78ad' : '#18446a', 1.5));
    const light = new THREE.PointLight(mode === 'journey' ? '#a9dcff' : '#2ff7ff', 42, 65);
    light.position.set(3, 7, 12);
    scene.add(light);
    if (mode === 'journey') {
        const violetLight = new THREE.PointLight('#b183ff', 28, 48);
        violetLight.position.set(-10, -4, 4);
        scene.add(violetLight);
    }

    const stars = createStars(scene, mode);
    const atmosphere = mode === 'journey' ? addJourneyAtmosphere(scene) : addNeonGrid(scene);
    const graph = buildGraph(scene, mode);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const clock = new THREE.Clock();
    const status = document.getElementById(mode === 'journey' ? 'journeyStatus' : 'neonStatus');
    let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let selectedId = 'memory-0';
    let pointerDown = null;
    const dragRotation = { x: 0, y: 0 };

    function selectNode(id) {
        selectedId = id;
        const index = Number(id.split('-')[1]);
        status.textContent = mode === 'journey'
            ? MEMORY_NAMES[index % MEMORY_NAMES.length]
            : `MX-${String(index).padStart(2, '0')} // ${NEON_NAMES[index % NEON_NAMES.length]}`;
        for (const line of graph.links) {
            const connected = line.userData.source === id || line.userData.target === id;
            line.material.opacity = connected ? Math.min(1, line.userData.normalOpacity * 3.1) : line.userData.normalOpacity * 0.16;
        }
    }

    function updatePointer(event) {
        const rect = canvas.getBoundingClientRect();
        pointerTarget.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerTarget.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    canvas.addEventListener('pointerdown', (event) => {
        pointerDown = { x: event.clientX, y: event.clientY, rotationX: dragRotation.x, rotationY: dragRotation.y };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
        updatePointer(event);
        if (!pointerDown) return;
        dragRotation.y = pointerDown.rotationY + (event.clientX - pointerDown.x) * 0.005;
        dragRotation.x = pointerDown.rotationX + (event.clientY - pointerDown.y) * 0.003;
    });
    canvas.addEventListener('pointerup', (event) => {
        if (!pointerDown) return;
        const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
        pointerDown = null;
        if (moved > 7) return;
        updatePointer(event);
        pointer.copy(pointerTarget);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects([...graph.nodes.values()], true);
        const nodeHit = hits.find((hit) => hit.object.userData.isNode);
        if (nodeHit) selectNode(nodeHit.object.userData.nodeId);
    });
    canvas.addEventListener('pointerleave', () => { pointerDown = null; });

    const resizeObserver = new ResizeObserver(() => {
        const width = Math.max(canvas.clientWidth, 2);
        const height = Math.max(canvas.clientHeight, 2);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    });
    resizeObserver.observe(canvas);

    function animate() {
        const elapsed = clock.getElapsedTime();
        pointer.lerp(pointerTarget, 0.035);
        if (!paused) {
            graph.group.rotation.y += mode === 'journey' ? 0.0008 : 0.0016;
            graph.group.rotation.y += (dragRotation.y + pointer.x * 0.12 - graph.group.rotation.y) * 0.018;
            graph.group.rotation.x += (dragRotation.x - pointer.y * 0.055 - graph.group.rotation.x) * 0.018;
            stars.rotation.y = elapsed * (mode === 'journey' ? 0.003 : -0.007);
            if (mode === 'journey') {
                atmosphere.rotation.z = elapsed * 0.006;
            } else {
                atmosphere.grid.position.z = (elapsed * 1.8) % 4 - 2;
            }
        }

        graph.nodes.forEach((node, id) => {
            const selected = id === selectedId;
            const desired = selected ? 1.65 + Math.sin(elapsed * 3.4) * 0.12 : 1;
            node.scale.lerp(new THREE.Vector3(desired, desired, desired), selected ? 0.12 : 0.07);
            const ring = node.getObjectByName('orbitRing');
            if (ring && !paused) {
                ring.rotation.z = elapsed * (mode === 'journey' ? 0.6 : 1.8) + node.userData.importance;
            }
        });

        if (!paused) {
            for (const traveler of graph.travelers) {
                const progress = (elapsed * traveler.userData.speed + traveler.userData.offset) % 1;
                traveler.position.copy(traveler.userData.curve.getPoint(progress));
                const pulse = 0.7 + Math.sin(progress * Math.PI) * 1.2;
                traveler.scale.setScalar(pulse);
            }
        }

        camera.position.x += (pointer.x * (mode === 'journey' ? 1.2 : 0.7) - camera.position.x) * 0.018;
        camera.position.y += ((mode === 'journey' ? 2.4 : 3.2) + pointer.y * 0.55 - camera.position.y) * 0.018;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }

    selectNode(selectedId);
    animate();
    return {
        setPaused(nextPaused) { paused = nextPaused; },
    };
}

const scenes = {
    journey: createConceptScene(document.getElementById('journeyCanvas'), 'journey'),
    neon: createConceptScene(document.getElementById('neonCanvas'), 'neon'),
};

document.querySelectorAll('[data-scene-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
        const concept = button.dataset.sceneToggle;
        const paused = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(paused));
        button.lastChild.textContent = paused ? ' 장면 재생' : ' 장면 멈춤';
        button.querySelector('.toggle-icon').textContent = paused ? '▶' : 'Ⅱ';
        scenes[concept].setPaused(paused);
    });
});

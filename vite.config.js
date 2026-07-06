import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        // 3d-force-graph + three는 그래프 모달 열릴 때만 dynamic import로 로드되므로
        // 초기 로딩 경로에는 영향 없다. 경고 한도를 올려 빌드 출력을 깔끔하게.
        chunkSizeWarningLimit: 1500,
    },
    optimizeDeps: {
        // dynamic import 대상이라 Vite가 처음 만나면 lazy 사전번들을 시도하다 504를 내거나
        // "new dependencies optimized" 전체 리로드를 일으킬 수 있다.
        // 명시적으로 포함시켜 dev 서버 시작 시 한 번에 처리.
        include: [
            '3d-force-graph',
            'three',
            'three-spritetext',
            'three/addons/postprocessing/UnrealBloomPass.js',
        ],
    },
});

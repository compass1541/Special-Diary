import globals from 'globals';

export default [
    {
        files: ['src/**/*.js', 'supabase/functions/_shared/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-var': 'error',
            'prefer-const': 'warn',
            'eqeqeq': ['warn', 'smart'],
            // 잠재적 XSS 회귀 방지: innerHTML 직접 할당 경고.
            // 정당한 사용은 // eslint-disable-next-line으로 명시.
            'no-restricted-syntax': [
                'warn',
                {
                    selector: "AssignmentExpression[left.property.name='innerHTML']",
                    message: '직접 innerHTML 할당 금지 — textContent / createElement 사용. 정적 HTML이면 // eslint-disable-next-line으로 명시.',
                },
            ],
        },
    },
    {
        files: ['src/**/*.test.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['supabase/functions/**/*.ts'],
        // Edge Functions는 Deno 환경 — Node 린트에서 제외
        ignores: ['**/*'],
    },
];

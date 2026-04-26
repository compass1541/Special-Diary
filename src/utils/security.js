/**
 * 보안 관련 순수 함수 모음.
 * 외부 I/O 없음 — vitest로 직접 테스트 가능.
 */

/**
 * PostgREST `.or()` / `.ilike` 문자열에 안전하게 사용자 입력을 삽입하기 위한 escape.
 *   - 메타문자 ,()  → \,  \(  \)  로 escape (필터 절 주입 차단)
 *   - 와일드카드 % _ → \% \_ 로 escape (의도치 않은 패턴 매칭 차단)
 *   - 백슬래시 자체도 escape
 */
export function escapePostgRESTValue(input) {
    return String(input).replace(/[%_,()\\]/g, '\\$&');
}

/**
 * Gemini 프롬프트에서 사용자 데이터로 시스템 토큰을 흉내내지 못하도록 제거.
 * tagNames에 있는 태그 이름의 열림/닫힘 형태를 모두 제거한다.
 */
export function stripPromptTags(input, tagNames = ['USER_QUERY', 'ENTRIES', 'ENTRY', 'CURRENT', 'CONTEXT', 'SYSTEM']) {
    const pattern = new RegExp(`<\\/?(${tagNames.join('|')})>`, 'gi');
    return String(input ?? '').replace(pattern, '');
}

/**
 * 일기 본문에서 [[YYYY-MM-DD]] 링크 추출.
 */
const LINK_RE = /\[\[(\d{4}-\d{2}-\d{2})\]\]/g;
export function extractDiaryLinks(content) {
    if (!content) return [];
    const matches = [...String(content).matchAll(LINK_RE)];
    return [...new Set(matches.map(m => m[1]))];
}

/**
 * 비밀번호 강도 점수 (0-5).
 * 8자 미만 또는 영문/숫자 미포함 시 약함으로 표시되도록 사용처에서 처리.
 */
export function passwordStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
}

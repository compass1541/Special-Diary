# Special Diary

AI 기반 스마트 일기장. Vanilla JS + Vite + Supabase + Google Gemini.

- **AI 분신 "또 다른 나"** — 내 일기를 아는 페르소나와 대화. 질문과 관련된 일기를
  로컬 TF-IDF retrieval로 골라 보내고, 답변 속 `[[YYYY-MM-DD]]` 인용은 클릭하면 해당 일기가 열린다.
  "분신이 이해한 나" 프로필(가치관·주제·감정 패턴·습관·말투)을 생성/캐시.
- **기억의 우주 (3D 연결망 2.0)** — 공유 키워드가 **허브 노드**로 승격되는 2-모드 그래프.
  왜 연결됐는지가 구조로 보인다. Bloom 글로우, 스마트 라벨, 자유/시간 나선 레이아웃,
  클러스터 스포트라이트, 관련 일기 탐색, 그래프에서 바로 "분신에게 묻기".
- **Obsidian 스타일 링크** `[[YYYY-MM-DD]]` — 다른 날짜 일기 참조 (자동완성)
- **AI 검색·제안** — 자연어 질의로 관련 일기 찾기, 작성 중인 일기에 대한 코멘트
- **로컬 우선** — IndexedDB 기본, 로그인 시 Supabase로 클라우드 동기화
- **Google OAuth + 이메일 로그인**

---

## 셋업

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수

`.env.example`을 `.env`로 복사하고 값을 채운다.

```bash
cp .env.example .env
```

| 변수 | 설명 | 필수? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 클라우드 동기화 시 필수 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (publishable) 키. RLS가 데이터를 보호함 | 클라우드 동기화 시 필수 |
| `VITE_GEMINI_API_KEY` | Gemini API 키. **권장: 비워두고 Edge Function 사용** | AI 기능 시 (또는 Edge Function) |

> ⚠️ `VITE_*` 환경 변수는 빌드 시 클라이언트 번들에 정적으로 포함된다. Gemini 키를 여기에 넣으면
> `dist/`를 받은 누구나 키를 추출해 본인 명의의 Google Cloud 쿼터를 도용할 수 있다.
> **프로덕션은 Edge Function 경로(아래 섹션)를 사용할 것.**

### 3. Supabase 설정 (클라우드 동기화 사용 시)

#### 3-1. RLS 마이그레이션 적용 (필수)

`supabase/migrations/20260426_001_diary_entries_rls.sql`을 적용한다.

**Supabase CLI 사용:**
```bash
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

**또는 대시보드 SQL Editor에서** 마이그레이션 파일 내용을 그대로 실행.

> 이 단계를 건너뛰면 **anon 키만 가지고 누구나 모든 사용자의 일기를 읽고 쓸 수 있다.**
> (테이블 자체가 없거나 RLS가 꺼져 있으면 보안 사고 직결.)

#### 3-2. Auth Redirect URL 화이트리스트

대시보드 > Authentication > URL Configuration에서:
- **Site URL**: 본인 프로덕션 도메인 (예: `https://diary.example.com`)
- **Redirect URLs**: 위 + 개발용 `http://localhost:5173` 추가

이게 안 되어 있으면 OAuth 코드가 다른 도메인으로 우회될 수 있다.

#### 3-3. Edge Function 배포 (Gemini API 키 보호, 권장)

```bash
supabase functions deploy ai-proxy
supabase secrets set GEMINI_API_KEY=<your_actual_gemini_key>
# 모델 변경 시: supabase secrets set GEMINI_MODEL=gemini-2.5-pro
```

배포 후, 클라이언트가 자동으로 Edge Function을 사용한다(supabase 로그인 상태일 때).
`.env`의 `VITE_GEMINI_API_KEY`는 **비워둘 수 있다** (로컬 비로그인 사용자 폴백 용으로만 유지).

> ⚠️ **AI 분신(chat/profile 액션)은 ai-proxy 최신 버전 필요.** 과거에 배포한 적이 있다면
> 위 deploy 명령으로 **재배포**해야 한다. 구버전이 배포된 상태면 클라이언트가
> `VITE_GEMINI_API_KEY` 직접 호출로 폴백하고, 그것도 없으면 재배포 안내를 표시한다.

### 4. 실행

```bash
npm run dev          # http://localhost:5173
npm run build        # 프로덕션 번들 → dist/
npm run preview      # dist/ 미리보기
npm test             # vitest
npm run lint         # eslint
npm run format       # prettier
```

---

## 보안 체크리스트 (프로덕션 배포 전)

- [ ] `supabase/migrations/20260426_001_diary_entries_rls.sql` 적용 — `diary_entries`에 RLS ENABLED
- [ ] Auth > URL Configuration: 정확한 도메인만 등록
- [ ] `ai-proxy` Edge Function 배포 + `GEMINI_API_KEY` 시크릿 설정
- [ ] `.env`의 `VITE_GEMINI_API_KEY`를 비우고 다시 빌드 → `dist/`에서 `AIza`로 grep해 0건 확인
- [ ] 호스팅(Vercel/Netlify)에서 `Content-Security-Policy` 응답 헤더 추가 (메타 태그는 보조)
- [ ] Google Cloud Console에서 Gemini 키에 HTTP 리퍼러 제한 + 일일 쿼터 설정
- [ ] Supabase 대시보드 Auth > Password Policy에서 leaked password check (HIBP) 활성화

---

## 파일 구조

```
.
├── index.html                                    # SPA 진입점, CSP 메타 포함
├── src/
│   ├── main.js                                   # 부트스트랩
│   ├── app.js                                    # DiaryApp: 달력·편집기·인증 (그래프/분신은 모듈로 위임)
│   ├── storage.js                                # IndexedDB
│   ├── supabase.js                               # Supabase auth + diary CRUD + Edge Function 호출
│   ├── gemini.js                                 # ai-proxy 호출 우선, 로컬 SDK 폴백 (+분신 chat/profile)
│   ├── styles.css                                # 다크 테마
│   ├── graph/
│   │   ├── data.js                               # 순수 함수: 노드/링크/허브/클러스터/나선 좌표 [tested]
│   │   └── view.js                               # 기억의 우주 3D 뷰 (bloom, 레이아웃, 포커스, 사이드패널)
│   ├── ai/
│   │   ├── retrieval.js                          # 질문→관련 일기 top-K (TF-IDF+최근성) [tested]
│   │   ├── persona.js                            # 분신 상태: 대화 히스토리 + 프로필 캐시
│   │   └── chatView.js                           # 채팅 패널 DOM (인용 칩, 프로필 드로어)
│   └── utils/
│       ├── keywords.js                           # 토크나이즈, TF-IDF [tested]
│       ├── security.js                           # PostgREST escape, 프롬프트 sanitize, 비밀번호 강도
│       └── crypto.js                             # E2EE 준비 모듈 (미활성)
├── supabase/
│   ├── migrations/
│   │   └── 20260426_001_diary_entries_rls.sql    # 테이블 + RLS 정책
│   └── functions/
│       └── ai-proxy/
│           └── index.ts                          # Gemini 프록시 (JWT 검증, 레이트 리밋, chat/profile)
├── .github/workflows/ci.yml                      # 빌드/테스트/키 노출 검사
├── vitest.config.js
├── eslint.config.js
└── .prettierrc.json
```

## 알려진 한계 / TODO

- 분신 프로필 캐시는 `localStorage` (기기별). 기기 간 프로필 동기화는 미구현 — 다른 기기에선 재생성.
- 페이지네이션 인프라는 추가됐으나 (`getAllEntries({ limit, offset })`) UI 측 "더 보기" 버튼 미구현.
- 라이트 모드 미지원 (다크 테마 전용).
- 분신 응답은 스트리밍이 아닌 일괄 수신 (타이핑 인디케이터로 대기 표시).

### 종단간 암호화 (E2EE) — `src/utils/crypto.js`

WebCrypto 기반 AES-GCM + PBKDF2 모듈이 준비돼 있으나(테스트 통과), 기존 평문 일기를 손상 없이
마이그레이션하는 작업이 필요해 자동 활성화하지 않았다. 통합 시 다음 결정이 필요하다:

1. **AI 검색과의 트레이드오프** — 평문이 Gemini로 전송되어야 검색이 동작. E2EE를 켜면 AI 호출 시
   사용자가 명시적으로 "이 검색은 일기 내용을 AI 서버로 보냅니다" 동의 필요.
2. **passphrase 분실 = 데이터 영구 손실** — 큰 모달로 명시 필요.
3. **마이그레이션** — 기존 엔트리를 한 번에 암호화하는 일회성 절차. 실패 시 롤백 가능하도록 백업 강제.

원하면 `crypto.js`를 `storage.js`/`supabase.js`의 save/get에 wrap하는 방식으로 통합할 수 있다.

## 라이선스

ISC

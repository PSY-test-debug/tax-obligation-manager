# 파일 트리

전체 36개 파일. `package-lock.json` 2개는 아래 트리에서 생략했으나 패키지에 포함되어 있습니다.

```
shingo/
├── server/
│   ├── scripts/
│   │   ├── seed.js                         초기 데이터 (담당자 8 · 업체 14)
│   │   └── verify.js                       API 통합 검증 89개
│   ├── src/
│   │   ├── config/
│   │   │   └── env.js                      환경변수 검증 (누락 시 즉시 종료)
│   │   ├── db/
│   │   │   ├── sql/
│   │   │   │   ├── 000_legacy_backup.sql   기존 테이블 백업 (수동 실행)
│   │   │   │   └── 001_init.sql            스키마 (테이블 5 + 이력 트리거)
│   │   │   ├── migrate.js                  체크섬 기반 마이그레이션 러너
│   │   │   └── pool.js                     커넥션 풀 · 트랜잭션 헬퍼
│   │   ├── lib/
│   │   │   ├── ApiError.js                 4xx/5xx 구분용 에러 클래스
│   │   │   ├── asyncHandler.js             async 라우트 예외 전달
│   │   │   └── validate.js                 입력 검증 (외부 의존성 없음)
│   │   ├── middleware/
│   │   │   └── errorHandler.js             PG 에러코드 → 한글 원인 메시지
│   │   ├── modules/
│   │   │   ├── deptAccounts/
│   │   │   │   ├── deptAccount.repo.js     담당자 SQL
│   │   │   │   └── deptAccount.router.js   /api/dept-accounts
│   │   │   ├── firm/
│   │   │   │   ├── firm.repo.js            사무소 설정 SQL
│   │   │   │   └── firm.router.js          /api/firm
│   │   │   ├── ledgers/
│   │   │   │   ├── ledger.registry.js      ★ 세목 5종 정의 (추가 시 여기만)
│   │   │   │   ├── ledger.repo.js          원장 SQL · 낙관적 잠금
│   │   │   │   └── ledger.router.js        /api/ledgers (5개 세목 공통)
│   │   │   └── vendors/
│   │   │       ├── vendor.mapper.js        ★ camelCase ↔ snake_case 변환
│   │   │       ├── vendor.repo.js          총괄업체 SQL
│   │   │       └── vendor.router.js        /api/vendors
│   │   ├── app.js                          Express 조립 · 라우터 등록
│   │   └── index.js                        엔트리포인트 · DB 연결 확인 후 기동
│   ├── .env.example                        환경변수 템플릿 → .env 로 복사
│   ├── .gitignore
│   └── package.json                        의존성 4개 (express, pg, cors, dotenv)
├── web/
│   ├── scripts/
│   │   ├── test-hooks.mjs                  훅 동작 검증 29개
│   │   └── test-integration.mjs            Dashboard 패턴 검증 32개
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.js                   ★ fetch 래퍼 · 에러 정규화
│   │   │   └── endpoints.js                ★ 엔드포인트 래퍼
│   │   └── hooks/
│   │       ├── useAppData.js               ★ 도메인 훅 4종
│   │       └── useWriteThroughMap.js       ★ 동기화 엔진 (7개 스토어 공용)
│   ├── .gitignore
│   ├── APP_JS_INTEGRATION.md               ★ App.js 수정 가이드 (8개 지점)
│   └── package.json                        검증용 devDependencies 만
└── README.md                               전체 안내 · 설계 판단 · 검증 결과
```

## 문서가 참조하는 파일 확인

README와 APP_JS_INTEGRATION.md가 전제하는 프론트 파일 4개입니다.

| 문서상 경로 | 패키지 내 경로 |
|---|---|
| `src/api/client.js` | `web/src/api/client.js` |
| `src/api/endpoints.js` | `web/src/api/endpoints.js` |
| `src/hooks/useAppData.js` | `web/src/hooks/useAppData.js` |
| `src/hooks/useWriteThroughMap.js` | `web/src/hooks/useWriteThroughMap.js` |

`web/src/` 아래 내용을 기존 React 프로젝트의 `src/` 아래로 복사하면 문서의 경로와 일치합니다.

```
web/src/api/     →  (React 프로젝트)/src/api/
web/src/hooks/   →  (React 프로젝트)/src/hooks/
```

`web/scripts/`, `web/package.json`은 **검증 전용**이라 React 프로젝트로 복사하지 않습니다. 연동 계층이 의도대로 동작하는지 확인하고 싶을 때만 `web/` 폴더에서 따로 실행합니다.

## 의존성

**서버** — express, pg, cors, dotenv 4개뿐입니다.

**프론트** — 런타임 의존성이 **없습니다**. `client.js`는 브라우저 내장 `fetch`만, 훅은 React만 사용합니다. `web/package.json`의 react·react-test-renderer·esbuild는 검증 스크립트 실행용입니다.

## 전달본 검증 결과

이 패키지를 그대로 복사해 새 DB에서 처음부터 구동했습니다.

```
npm install → migrate → seed → start
백엔드 API 통합 검증     89개 통과 · 0개 실패
프론트 훅 동작 검증       29개 통과 · 0개 실패
Dashboard 패턴 검증       32개 통과 · 0개 실패
전체 JS 문법 검사         27개 파일 통과
```

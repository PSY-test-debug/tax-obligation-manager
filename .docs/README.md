# 신고의무 관리 시스템 — 백엔드 · 프론트 연동

세무법인 다솔티앤씨

프론트(React)에서 입력한 모든 데이터가 PostgreSQL에 저장되고, 새로고침·재접속 후에도 동일하게 복원되는 구조입니다.

---

## 시작하기

### 1. 기존 테이블 백업 (기존 DB를 쓰는 경우만, 1회)

1차 구축 때 만든 `vendors` / `reportStatus`는 새 스키마와 컬럼 구성이 다릅니다. 데이터를 지우지 않고 백업 이름으로 옮깁니다.

pgAdmin 4 쿼리 도구에서 `server/src/db/sql/000_legacy_backup.sql`을 실행합니다. 구조를 바꾸는 작업이라 자동 마이그레이션에 넣지 않았습니다.

새 DB로 시작한다면 이 단계는 건너뜁니다.

### 2. 서버

```bash
cd server
npm install
cp .env.example .env        # DB 접속 정보 입력
npm run migrate             # 스키마 생성
npm run seed                # 담당자 8건 · 업체 14건
npm start                   # http://localhost:5000/api
```

`npm run migrate`와 `npm run seed`는 여러 번 실행해도 안전합니다.

### 3. 프론트

`web/src/api/`와 `web/src/hooks/`를 React 프로젝트의 `src/` 아래로 복사한 뒤, 프로젝트 루트에 `.env`를 만듭니다.

```
REACT_APP_API_BASE=http://localhost:5000/api
```

App.js는 **8개 지점만** 수정합니다 → `web/APP_JS_INTEGRATION.md`

---

## 구조

```
server/
  src/
    config/env.js                환경변수 검증 (누락 시 즉시 종료)
    db/
      pool.js                    커넥션 풀 · 트랜잭션 헬퍼
      migrate.js                 체크섬 기반 마이그레이션 러너
      sql/000_legacy_backup.sql  기존 테이블 백업 (수동)
      sql/001_init.sql           스키마
    lib/                         ApiError · asyncHandler · validate
    middleware/errorHandler.js   PG 에러코드 → 한글 원인 메시지
    modules/
      vendors/                   총괄업체 (router · service · repo · mapper)
      deptAccounts/              홈택스 부서 계정
      firm/                      사무소 설정
      ledgers/                   세목 원장 5종 (registry + 공통 CRUD)
    app.js  index.js
  scripts/
    seed.js                      초기 데이터
    verify.js                    API 통합 검증 (89개)

web/
  src/
    api/client.js                fetch 래퍼 · 에러 정규화
    api/endpoints.js             엔드포인트 래퍼
    hooks/useWriteThroughMap.js  동기화 엔진 (7개 스토어 공용)
    hooks/useAppData.js          도메인 훅 4종
  scripts/                       훅 동작 검증 (61개)
  APP_JS_INTEGRATION.md          App.js 수정 가이드
```

---

## 설계 판단

### 왜 JSONB 문서인가

프론트 스토어 7개는 모두 **"기간 키 → 행 배열"** 구조입니다.

기존 `reportStatus`처럼 셀 하나를 행 하나로 정규화하면, `MONTHLY_COLS` / `HALF_COLS` / `FEB_COLS` / `MAR_COLS`에 신고 항목이 추가될 때마다 마이그레이션이 필요합니다. 이 도메인에서는 그게 계속 일어납니다.

그래서 하이브리드로 갔습니다.

| 대상 | 방식 | 이유 |
|---|---|---|
| `vendors` `dept_accounts` `firm_settings` | 정규화 테이블 | 조회·조인·검색·FK 필요 |
| 세목 원장 5종 | `ledgers(ledger, period_key, payload jsonb)` | 항목이 계속 변한다 |

`payload`가 곧 프론트의 `store[key]` 배열입니다. `setStore`의 의미가 전혀 바뀌지 않고, 신고 컬럼 추가 시 DDL 작업은 **0**입니다.

부수 이점으로 jsonb는 숫자를 `numeric`으로 저장하므로 금액·세율에 부동소수점 오차가 없습니다.

**주의:** jsonb는 객체 키 순서를 보존하지 않습니다. 프론트는 payload 내부를 상수 배열(`INCOME` 등)로 순회하고 키로 직접 접근하므로 영향이 없습니다. 다만 payload 안에서 `Object.keys()` 순서에 의존하는 코드를 새로 추가하면 안 됩니다.

### 세목 추가 방법

`ledger.registry.js`에 항목 하나만 넣습니다. 라우터·리포지토리·DDL 모두 그대로입니다.

```js
local_income: {
  label: '지방소득세',
  period: YEAR_ONLY,
},
```

### 동기화: debounce write-through

원천세 그리드는 행×열 체크박스가 수십 개입니다. 셀마다 API를 호출하면 요청이 폭증하고 클릭 반응도 느려집니다.

로컬 state는 **즉시** 갱신하고(UI 무지연), 편집이 멈춘 뒤 600ms 후 **변경된 기간만** 저장합니다. 편집 한 묶음당 요청 1건입니다.

변경 판별은 "마지막으로 서버와 일치했던 스냅샷(baseline)"과 비교합니다. 서버 응답과 텍스트 비교를 하면 jsonb 키 재정렬 때문에 매번 변경으로 오판합니다.

훅이 `useState`와 동일한 시그니처를 제공하므로 App.js 하위 로직(`patch`, `setRow`, `setEst`, `doMigrate`, `rollForward` …)은 수정이 필요 없습니다.

### 낙관적 잠금

두 담당자가 같은 달을 편집하면 나중 저장이 409로 거부되고, 프론트가 서버 값을 다시 불러옵니다. 조용히 덮어쓰지 않습니다.

`revision`은 **내용 버전**입니다. payload가 실제로 바뀌지 않았으면 올리지 않습니다. 그래야 같은 내용 재전송이 남의 작업에 불필요한 충돌을 만들지 않습니다.

### 변경 이력

`ledgers`가 갱신될 때마다 이전 스냅샷이 `ledger_history`에 자동 적재됩니다(내용이 실제로 바뀐 경우만). 세무 업무는 "그 시점에 신고 상태가 무엇이었는지"가 중요합니다.

```
GET /api/ledgers/wht/2026-7/history
GET /api/ledgers/wht/2026-7/history/:id
```

---

## 1차 구축 코드에서 고친 것

**1. `businessNumber`가 조회되지 않던 문제 — 가장 중요합니다.**

PostgreSQL은 따옴표 없는 식별자를 소문자로 접습니다. `INSERT INTO vendors (businessNumber …)`는 실제로 `businessnumber`에 저장되고, `SELECT *`도 `businessnumber`로 반환합니다. 프론트의 `row.businessNumber`는 항상 `undefined`였습니다. "저장은 되는데 화면에 안 뜨는" 전형적 원인입니다.

→ DB는 snake_case로 고정하고, 변환은 `vendor.mapper.js` 한 곳에서만 합니다. 컬럼이 추가되면 `FIELDS` 배열에 한 줄만 넣습니다.

**2. `POST /api/reportStatus`가 항상 INSERT** — 체크박스를 두 번 누르면 행이 중복 누적됐습니다. → UPSERT.

**3. DELETE 엔드포인트 없음** → 추가. 업체는 소프트 삭제입니다(원장 payload가 업체 id를 참조하므로 물리 삭제하면 과거 신고 이력의 업체명 조회가 깨집니다).

**4. 모든 예외가 500 + `error.message`** → 의도된 4xx와 서버 장애 5xx를 분리하고, PG 에러코드를 원인 메시지로 변환합니다.

**5. `express.json()` 기본 한도 100kb** → 사무소 로고가 base64 data URL이라 저장이 실패했습니다. 15mb로 올리고, 초과 시 413과 안내 메시지를 돌려줍니다.

**6. `cors()` 전체 허용** → 홈택스 ID/PW를 다루는 API이므로 오리진을 명시합니다.

**7. DB가 안 떠 있어도 서버가 기동** → 첫 요청에서야 에러를 알 수 있었습니다. 기동 시 연결을 확인하고, 실패하면 원인과 확인 항목을 출력하고 종료합니다.

**8. 트랜잭션 없음** → 일괄 저장은 하나의 트랜잭션입니다. 커넥션 반납도 보장됩니다.

---

## 검증

실제 PostgreSQL 16과 실제 React 렌더러로 검증했습니다.

```bash
cd server && npm run migrate && npm run seed && npm start
cd server && node scripts/verify.js     # 89개
cd web && npm install && npm test       # 61개
```

**백엔드 89개** — camelCase 왕복, 개인/법인 null 구분, 표시 순서 보존, 한글 기간키·필드, 큰 정수 정밀도, 낙관적 잠금, 변경 이력, 200행 저장(9ms), 잘못된 입력 거부.

**프론트 61개** — debounce(10회 편집 → 요청 1건), 변경된 키만 저장, 삭제 감지, jsonb 키 재정렬 무시, 저장 실패 후 자동 재시도, 409 충돌 재조회, 새로고침 후 상태 복원, 서버 장애 시 토스트.

---

## 연동 대상에서 제외한 것

`JongsoTab`(App.js 2367행)과 `seedJongso`(2347행)는 현재 어느 탭에서도 렌더되지 않는 구 버전입니다. 종합소득세 탭은 `JongseTab`을 사용합니다.

삭제하지 않고 그대로 두었으며, 연동만 하지 않았습니다. 실제로 필요해지면 그때 `useLedger`로 붙이면 됩니다.

`seedStore` 등 나머지 시드 함수도 남겨두었습니다. 서버 없이 UI만 확인할 때 유용하고, `server/scripts/seed.js`의 기준 데이터이기도 합니다.

---

## 아직 하지 않은 것

**인증.** `Login` 컴포넌트는 아이디만 받고 통과시킵니다. 홈택스 ID/PW와 사업자 정보를 담는 시스템이므로 실제 운영 전에는 로그인·세션이 필요합니다. 현재 API는 인증 없이 열려 있으므로 **사내망에서만** 사용하세요.

**비밀번호 암호화.** `hometax_pw` / `credit_pw` / `taxbot_pw`가 평문으로 저장됩니다. 운영 전에 애플리케이션 레벨 암호화(예: AES-256-GCM, 키는 환경변수)를 적용하는 편이 좋습니다.

**택스봇 연동.** `importTaxbot`은 여전히 토스트만 띄우는 스텁입니다.

이 세 가지는 다음 단계로 진행하시면 좋겠습니다. 특히 인증은 다른 작업보다 먼저 하는 편이 낫습니다.

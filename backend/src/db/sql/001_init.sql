/* ==================================================================
 * 신고의무 관리 시스템 — 스키마 초기화 (멱등)
 * 세무법인 다솔티앤씨
 *
 * 설계 원칙
 *  1) 조회·조인·검색 대상 엔터티는 정규화 테이블로 둔다.
 *     → vendors / dept_accounts / firm_settings
 *  2) 세목별 신고원장은 "기간 단위 JSONB 문서"로 둔다.
 *     → ledgers(ledger, period_key, payload)
 *     신고 항목(컬럼)이 늘어나도 DDL 변경이 필요 없다.
 *  3) 컬럼명은 전부 snake_case. PostgreSQL은 따옴표 없는 식별자를
 *     소문자로 접기 때문에 camelCase 컬럼은 조회 시 키가 어긋난다.
 *     camelCase ↔ snake_case 변환은 애플리케이션 mapper가 담당한다.
 * ================================================================== */

/* ---------- 공통: updated_at 자동 갱신 트리거 함수 ---------- */
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


/* ==================================================================
 * 1. 홈택스 부서 계정 (담당자)
 *    업체는 담당자 "성명"이 아니라 이 부서계정 id를 참조한다.
 *    인수인계 시 여기 name 만 바꾸면 물려 있는 모든 업체에 반영된다.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS dept_accounts (
  id           text PRIMARY KEY,
  name         text        NOT NULL DEFAULT '',
  phone        text        NOT NULL DEFAULT '',
  email        text        NOT NULL DEFAULT '',
  pw_entered   boolean     NOT NULL DEFAULT false,
  otp_entered  boolean     NOT NULL DEFAULT false,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_dept_accounts_updated ON dept_accounts;
CREATE TRIGGER trg_dept_accounts_updated
  BEFORE UPDATE ON dept_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ==================================================================
 * 2. 총괄업체 (프론트 profiles)
 *    id 는 프론트에서 생성한 문자열 키를 그대로 쓴다 (c1, j3, n1738...).
 *    - dept_id : '' 는 DB 에서 NULL 로 저장한다(FK 때문). mapper 가 변환.
 *    - joint_owners / memos : 가변 길이 → jsonb
 *    - extra : 향후 필드 추가 완충. 스키마 변경 없이 신규 항목 수용.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS vendors (
  id             text PRIMARY KEY,
  gubun          text        NOT NULL DEFAULT '개인'
                   CHECK (gubun IN ('개인', '법인')),
  tax_type       text        NOT NULL DEFAULT '과세',
  wht            text        NOT NULL DEFAULT '신고',
  name           text        NOT NULL DEFAULT '',
  dept_id        text        REFERENCES dept_accounts(id) ON DELETE SET NULL,
  biz_no         text        NOT NULL DEFAULT '',
  ceo_name       text        NOT NULL DEFAULT '',
  ceo_rrn        text        NOT NULL DEFAULT '',
  program        text        NOT NULL DEFAULT '더존',
  closing_month  smallint    NOT NULL DEFAULT 12
                   CHECK (closing_month BETWEEN 1 AND 12),
  ceo_phone      text        NOT NULL DEFAULT '',
  staff_phone    text        NOT NULL DEFAULT '',
  staff_email    text        NOT NULL DEFAULT '',
  hometax_id     text        NOT NULL DEFAULT '',
  hometax_pw     text        NOT NULL DEFAULT '',
  credit_id      text        NOT NULL DEFAULT '',
  credit_pw      text        NOT NULL DEFAULT '',
  industry       text        NOT NULL DEFAULT '',
  other_income   text,                    -- 개인만 ('포함'/'미포함'), 법인 NULL
  joint_type     text,                    -- 개인만 ('단독'/'공동'), 법인 NULL
  joint_count    smallint,                -- 공동사업자 인원수(대표 포함)
  joint_owners   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  memos          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  extra          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /* 화면 표시 순서 보존용.
   * 프론트는 Object.values(profiles) 를 정렬 없이 그대로 렌더하므로
   * (MasterTab / JongseTab / CorporateTab), 이름순으로 정렬해 내려주면
   * 기존 화면의 행 순서가 바뀐다. 원래 순서를 그대로 유지한다. */
  sort_order     integer     NOT NULL DEFAULT 0,
  is_deleted     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_vendors_updated ON vendors;
CREATE TRIGGER trg_vendors_updated
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_vendors_dept    ON vendors (dept_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_vendors_name    ON vendors (name)    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_vendors_biz_no  ON vendors (biz_no)  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_vendors_ceo     ON vendors (ceo_name, ceo_rrn) WHERE is_deleted = false;


/* ==================================================================
 * 3. 사무소 설정 (단일 행 — id = 1 고정)
 *    logo / invoice_logo 는 base64 data URL 이라 길다 → text
 *    'account' 는 오해를 부르는 이름이라 account_no 로 저장(mapper 변환).
 * ================================================================== */
CREATE TABLE IF NOT EXISTS firm_settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name         text        NOT NULL DEFAULT '',
  biz_no       text        NOT NULL DEFAULT '',
  ceo          text        NOT NULL DEFAULT '',
  bank         text        NOT NULL DEFAULT '',
  account_no   text        NOT NULL DEFAULT '',
  phone        text        NOT NULL DEFAULT '',
  taxbot_id    text        NOT NULL DEFAULT '',
  taxbot_pw    text        NOT NULL DEFAULT '',
  logo         text        NOT NULL DEFAULT '',
  invoice_logo text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_firm_settings_updated ON firm_settings;
CREATE TRIGGER trg_firm_settings_updated
  BEFORE UPDATE ON firm_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO firm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


/* ==================================================================
 * 4. 세목별 신고원장 (기간 문서)
 *
 *   ledger      period_key 예시           payload 형태
 *   ---------   -----------------------   -----------------------------
 *   wht         '2026-7'                  [{id, name, current, filings…}]
 *   vat         '2026-1-예정' '2026-2-면세' [{id, 대상, 신고여부…}]
 *   income      '2025'                    [{id, 구분, 사업장, 조정료…}]
 *   corp        '2024'                    [{id, 성실, 수입, 조정료…}]
 *   ar          '2026-3'                  [{id, reg, irr, cms…}]
 *
 *   프론트 store[periodKey] 를 payload 에 그대로 담는다.
 *   → 신고 항목이 추가되어도 DDL 변경 없음.
 *   revision 은 낙관적 잠금(동시 편집 충돌 감지)용.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS ledgers (
  ledger      text        NOT NULL
                CHECK (ledger IN ('wht', 'vat', 'income', 'corp', 'ar')),
  period_key  text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  revision    integer     NOT NULL DEFAULT 1,
  updated_by  text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger, period_key)
);

CREATE INDEX IF NOT EXISTS idx_ledgers_prefix ON ledgers (ledger, period_key text_pattern_ops);


/* ==================================================================
 * 5. 신고원장 변경 이력
 *    세무 업무는 "그 시점에 신고 상태가 무엇이었는지"가 중요하다.
 *    ledgers 가 갱신될 때마다 이전 스냅샷을 여기 남긴다.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS ledger_history (
  id          bigserial PRIMARY KEY,
  ledger      text        NOT NULL,
  period_key  text        NOT NULL,
  payload     jsonb       NOT NULL,
  revision    integer     NOT NULL,
  saved_by    text        NOT NULL DEFAULT '',
  saved_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_history_key
  ON ledger_history (ledger, period_key, saved_at DESC);

CREATE OR REPLACE FUNCTION ledgers_archive()
RETURNS trigger AS $$
BEGIN
  /* payload 가 실제로 바뀐 경우에만 이력을 남긴다 */
  IF OLD.payload IS DISTINCT FROM NEW.payload THEN
    INSERT INTO ledger_history (ledger, period_key, payload, revision, saved_by)
    VALUES (OLD.ledger, OLD.period_key, OLD.payload, OLD.revision, OLD.updated_by);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledgers_archive ON ledgers;
CREATE TRIGGER trg_ledgers_archive
  BEFORE UPDATE ON ledgers
  FOR EACH ROW EXECUTE FUNCTION ledgers_archive();

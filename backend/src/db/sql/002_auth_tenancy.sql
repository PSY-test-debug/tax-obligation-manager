/* ==================================================================
 * 002 · 인증 + 사무소(테넌트) 분리
 * 세무법인 다솔티앤씨
 *
 * 이 마이그레이션은 기존 데이터를 보존한다.
 *   1) firms 테이블 신설 · firm_settings 단일 행을 이관
 *   2) users / sessions 신설
 *   3) dept_accounts · vendors · ledgers 에 firm_id 추가 후 백필
 *   4) PK 를 (firm_id, …) 복합키로 전환
 *
 * ★ 실행 전 반드시 백업하세요.
 *     pg_dump -U postgres -d 데이터베이스명 -F c -f backup_20260731.dump
 *
 * PK 전환은 되돌리기 어렵습니다. 백업 없이 실행하지 마세요.
 * ================================================================== */


/* ==================================================================
 * 1. 사무소 (테넌트)
 *    기존 firm_settings(단일 행)를 대체한다.
 *    컬럼 구성은 동일하게 유지해 firm.repo.js 변경을 최소화한다.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS firms (
  id           bigserial PRIMARY KEY,
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
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_firms_updated ON firms;
CREATE TRIGGER trg_firms_updated
  BEFORE UPDATE ON firms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* 기존 firm_settings 내용을 그대로 옮긴다.
 * firm_settings 는 삭제하지 않고 남겨둔다(되돌릴 여지 확보). */
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM firms;
  IF v_count = 0 THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'firm_settings') THEN
      INSERT INTO firms (id, name, biz_no, ceo, bank, account_no, phone,
                         taxbot_id, taxbot_pw, logo, invoice_logo)
      SELECT 1, name, biz_no, ceo, bank, account_no, phone,
             taxbot_id, taxbot_pw, logo, invoice_logo
      FROM firm_settings WHERE id = 1;
    END IF;

    /* firm_settings 가 없거나 비어 있으면 빈 사무소를 만든다 */
    IF NOT EXISTS (SELECT 1 FROM firms) THEN
      INSERT INTO firms (id, name) VALUES (1, '');
    END IF;

    /* bigserial 시퀀스를 현재 최대값 뒤로 옮긴다 */
    PERFORM setval('firms_id_seq', GREATEST((SELECT MAX(id) FROM firms), 1));
  END IF;
END $$;


/* ==================================================================
 * 2. 로그인 계정
 *
 *    login_id 는 전역 UNIQUE 다.
 *    → 로그인 화면에서 사무소를 따로 고르지 않아도 되므로
 *      기존 Login 컴포넌트(아이디·비밀번호 2개 입력)를 그대로 쓸 수 있다.
 *
 *    role
 *      admin : 사무소 관리자. 전체 조회·수정, 계정 관리
 *      staff : 담당자. 자기 부서계정(dept_id)에 묶인다
 *
 *    dept_id 는 dept_accounts 를 참조한다.
 *    FK 는 dept_accounts 의 PK 전환(4단계) 이후에 건다.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS users (
  id              bigserial PRIMARY KEY,
  firm_id         bigint      NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  login_id        text        NOT NULL UNIQUE,
  password_hash   text        NOT NULL,
  name            text        NOT NULL DEFAULT '',
  role            text        NOT NULL DEFAULT 'staff'
                    CHECK (role IN ('admin', 'staff')),
  dept_id         text,
  is_active       boolean     NOT NULL DEFAULT true,
  must_change_pw  boolean     NOT NULL DEFAULT false,
  /* 무차별 대입 방어 */
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_users_firm ON users (firm_id) WHERE is_active = true;


/* ==================================================================
 * 3. 세션
 *
 *    쿠키에는 원본 토큰을, DB 에는 SHA-256 해시를 저장한다.
 *    DB 가 유출되어도 세션을 탈취할 수 없다.
 * ================================================================== */
CREATE TABLE IF NOT EXISTS sessions (
  id           bigserial PRIMARY KEY,
  token_hash   text        NOT NULL UNIQUE,
  user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firm_id      bigint      NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text        NOT NULL DEFAULT '',
  ip           text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);


/* ==================================================================
 * 4. 기존 테이블에 firm_id 추가 + PK 전환
 *
 *    업체 id('c1','n1738…')와 부서계정 id 는 사무소마다 겹칠 수 있다.
 *    따라서 PK 를 (firm_id, id) 복합키로 바꾼다.
 *
 *    ※ API 와 프론트 계약은 바뀌지 않는다.
 *      firm_id 는 세션에서 주입되므로 프론트는 존재를 모른다.
 * ================================================================== */

/* ---------- 4-1. dept_accounts ---------- */
ALTER TABLE dept_accounts ADD COLUMN IF NOT EXISTS firm_id bigint;
UPDATE dept_accounts SET firm_id = (SELECT MIN(id) FROM firms) WHERE firm_id IS NULL;
ALTER TABLE dept_accounts ALTER COLUMN firm_id SET NOT NULL;

DO $$
BEGIN
  /* vendors 의 기존 FK 를 먼저 떼야 dept_accounts PK 를 바꿀 수 있다 */
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_dept_id_fkey') THEN
    ALTER TABLE vendors DROP CONSTRAINT vendors_dept_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dept_accounts_pkey') THEN
    ALTER TABLE dept_accounts DROP CONSTRAINT dept_accounts_pkey;
  END IF;
END $$;

ALTER TABLE dept_accounts ADD PRIMARY KEY (firm_id, id);
ALTER TABLE dept_accounts
  DROP CONSTRAINT IF EXISTS dept_accounts_firm_fkey,
  ADD CONSTRAINT dept_accounts_firm_fkey
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;

/* ---------- 4-2. vendors ---------- */
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS firm_id bigint;
UPDATE vendors SET firm_id = (SELECT MIN(id) FROM firms) WHERE firm_id IS NULL;
ALTER TABLE vendors ALTER COLUMN firm_id SET NOT NULL;

DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
  FROM pg_constraint
  WHERE conrelid = 'vendors'::regclass
    AND contype = 'p';

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE vendors DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

ALTER TABLE vendors ADD PRIMARY KEY (firm_id, id);
ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_firm_fkey,
  ADD CONSTRAINT vendors_firm_fkey
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;

/* 담당자 FK 를 복합키로 다시 건다.
 * 같은 사무소 안의 부서계정만 지정할 수 있다. */
ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_dept_fkey,
  ADD CONSTRAINT vendors_dept_fkey
    FOREIGN KEY (firm_id, dept_id) REFERENCES dept_accounts(firm_id, id)
    ON DELETE SET NULL;

DROP INDEX IF EXISTS idx_vendors_dept;
CREATE INDEX IF NOT EXISTS idx_vendors_firm_dept
  ON vendors (firm_id, dept_id) WHERE is_deleted = false;

/* ---------- 4-3. ledgers ---------- */
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS firm_id bigint;
UPDATE ledgers SET firm_id = (SELECT MIN(id) FROM firms) WHERE firm_id IS NULL;
ALTER TABLE ledgers ALTER COLUMN firm_id SET NOT NULL;

DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
  FROM pg_constraint
  WHERE conrelid = 'ledgers'::regclass
    AND contype = 'p';

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ledgers DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

ALTER TABLE ledgers ADD PRIMARY KEY (firm_id, ledger, period_key);
ALTER TABLE ledgers
  DROP CONSTRAINT IF EXISTS ledgers_firm_fkey,
  ADD CONSTRAINT ledgers_firm_fkey
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_ledgers_prefix;
CREATE INDEX IF NOT EXISTS idx_ledgers_firm_prefix
  ON ledgers (firm_id, ledger, period_key text_pattern_ops);

/* ---------- 4-4. ledger_history ---------- */
ALTER TABLE ledger_history ADD COLUMN IF NOT EXISTS firm_id bigint;
UPDATE ledger_history SET firm_id = (SELECT MIN(id) FROM firms) WHERE firm_id IS NULL;
ALTER TABLE ledger_history ALTER COLUMN firm_id SET NOT NULL;

DROP INDEX IF EXISTS idx_ledger_history_key;
CREATE INDEX IF NOT EXISTS idx_ledger_history_firm_key
  ON ledger_history (firm_id, ledger, period_key, saved_at DESC);

/* 이력 적재 트리거를 firm_id 포함으로 교체 */
CREATE OR REPLACE FUNCTION ledgers_archive()
RETURNS trigger AS $$
BEGIN
  IF OLD.payload IS DISTINCT FROM NEW.payload THEN
    INSERT INTO ledger_history (firm_id, ledger, period_key, payload, revision, saved_by)
    VALUES (OLD.firm_id, OLD.ledger, OLD.period_key, OLD.payload, OLD.revision, OLD.updated_by);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


/* ==================================================================
 * 5. users.dept_id FK
 *    dept_accounts PK 전환이 끝난 뒤에 건다.
 *    담당자 계정이 삭제되면 사용자는 남되 소속만 해제된다.
 * ================================================================== */
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_dept_fkey,
  ADD CONSTRAINT users_dept_fkey
    FOREIGN KEY (firm_id, dept_id) REFERENCES dept_accounts(firm_id, id)
    ON DELETE SET NULL;

/* staff 는 반드시 부서계정에 묶여야 한다.
 * admin 은 부서계정 없이도 전체를 본다. */
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_staff_needs_dept,
  ADD CONSTRAINT users_staff_needs_dept
    CHECK (role <> 'staff' OR dept_id IS NOT NULL);


/* ==================================================================
 * 6. 만료 세션 정리 함수
 *    서버가 주기적으로 호출한다(별도 스케줄러 불필요).
 * ================================================================== */
CREATE OR REPLACE FUNCTION purge_expired_sessions()
RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM sessions WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

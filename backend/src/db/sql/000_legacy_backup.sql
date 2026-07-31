/* ==================================================================
 * 기존(1차 구축) 테이블 백업 — 수동 실행 전용
 *
 * 현재 server.js 가 쓰던 테이블:
 *   vendors      (name, businessNumber, representative, program)
 *   reportStatus (vendorId, month, year, reportType, completed)
 *
 * 새 스키마의 vendors 는 컬럼 구성이 다르므로 이름이 충돌한다.
 * 데이터를 지우지 않고 백업 이름으로 옮긴 뒤 001_init.sql 을 실행한다.
 *
 * 실행 방법 (pgAdmin 4 쿼리 도구 또는 psql):
 *   이 파일을 한 번만 직접 실행 → 이후 npm run migrate
 *
 * ⚠ 자동 마이그레이션(migrate.js)에는 포함되지 않는다.
 *    데이터 구조를 바꾸는 작업이라 반드시 눈으로 확인하고 실행할 것.
 * ================================================================== */

BEGIN;

/* 1) 기존 vendors → vendors_legacy 로 이름 변경 (데이터 보존) */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendors' AND column_name = 'businessnumber'
  ) THEN
    ALTER TABLE vendors RENAME TO vendors_legacy;
    RAISE NOTICE '기존 vendors → vendors_legacy 로 이름을 변경했습니다.';
  END IF;
END $$;

/* 2) 기존 reportStatus → report_status_legacy 로 이름 변경 */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'reportstatus'
  ) THEN
    ALTER TABLE reportstatus RENAME TO report_status_legacy;
    RAISE NOTICE '기존 reportStatus → report_status_legacy 로 이름을 변경했습니다.';
  END IF;
END $$;

COMMIT;

/* ------------------------------------------------------------------
 * 백업 테이블에서 새 스키마로 옮기고 싶다면 아래를 참고해 수동 실행.
 * (컬럼이 소문자로 접혀 있으므로 businessnumber / representative 사용)
 *
 *   INSERT INTO vendors (id, name, biz_no, ceo_name, program)
 *   SELECT 'lg' || id, name, businessnumber, representative,
 *          COALESCE(NULLIF(program, ''), '더존')
 *   FROM vendors_legacy
 *   ON CONFLICT (id) DO NOTHING;
 *
 * 확인이 끝난 뒤 정리:
 *   DROP TABLE vendors_legacy, report_status_legacy;
 * ------------------------------------------------------------------ */

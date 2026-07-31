const ApiError = require('../../lib/ApiError');

/* ==================================================================
 * 세목 원장 레지스트리
 *
 * 5개 세목이 "기간 키 → 행 배열" 이라는 동일한 구조를 갖는다.
 * 세목마다 라우터/리포지토리를 따로 만들면 같은 코드가 5벌 생긴다.
 * → 레지스트리 + 공통 CRUD 한 벌로 처리한다.
 *
 * 세목이 추가되면(예: 지방소득세) 여기에 항목 하나만 추가하면 된다.
 * DDL 변경도, 라우터 추가도 필요 없다.
 * ================================================================== */

/** 연-월 : '2026-7' (월에 0 패딩 없음 — 프론트 `${year}-${month}` 규칙) */
const YEAR_MONTH = {
  test: (k) => /^\d{4}-([1-9]|1[0-2])$/.test(k),
  hint: 'YYYY-M (예: 2026-7)',
};

/** 연도 : '2025' */
const YEAR_ONLY = {
  test: (k) => /^\d{4}$/.test(k),
  hint: 'YYYY (예: 2025)',
};

/** 부가세 : '2026-1-예정' / '2026-2-확정' / '2026-2-면세' */
const VAT_PERIOD = {
  test: (k) => /^\d{4}-[12]-(예정|확정|면세)$/.test(k),
  hint: 'YYYY-{1|2}-{예정|확정|면세} (예: 2026-1-확정)',
};

const LEDGERS = {
  wht: {
    label: '원천세',
    period: YEAR_MONTH,
    /* 프론트 store 소유: Dashboard.store */
  },
  vat: {
    label: '부가가치세',
    period: VAT_PERIOD,
  },
  income: {
    label: '종합소득세',
    period: YEAR_ONLY,
  },
  corp: {
    label: '법인세',
    period: YEAR_ONLY,
  },
  ar: {
    label: '미수금',
    period: YEAR_MONTH,
  },
};

const LEDGER_NAMES = Object.keys(LEDGERS);

/** 세목명 검증 후 정의 반환 */
function resolveLedger(name) {
  const def = LEDGERS[name];
  if (!def) {
    throw ApiError.badRequest(
      `알 수 없는 세목입니다: ${name} (사용 가능: ${LEDGER_NAMES.join(', ')})`
    );
  }
  return def;
}

/** 기간 키 검증 */
function assertPeriodKey(name, periodKey) {
  const def = resolveLedger(name);
  const key = String(periodKey || '');
  if (!def.period.test(key)) {
    throw ApiError.badRequest(
      `${def.label} 기간 키 형식이 올바르지 않습니다: "${key}" · 형식: ${def.period.hint}`
    );
  }
  return key;
}

module.exports = { LEDGERS, LEDGER_NAMES, resolveLedger, assertPeriodKey };

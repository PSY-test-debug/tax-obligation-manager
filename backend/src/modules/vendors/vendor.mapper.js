/* ==================================================================
 * 총괄업체 mapper
 *
 * ★ 여기가 기존 버그의 해결 지점 ★
 *   PostgreSQL 은 따옴표 없는 식별자를 소문자로 접는다.
 *   INSERT ... (businessNumber) 는 businessnumber 컬럼에 들어가고
 *   SELECT * 는 businessnumber 로 돌려주므로,
 *   프론트의 row.businessNumber 는 항상 undefined 였다.
 *
 *   → DB 는 snake_case 로 고정하고, 변환은 이 파일 한 곳에서만 한다.
 *     컬럼이 추가되면 FIELDS 배열에 한 줄만 넣으면 된다.
 *
 * 프론트 profile() 함수(App.js)의 필드 구성과 1:1 대응시킨다.
 * ================================================================== */

/** [프론트 키, DB 컬럼] — 단순 매핑 필드 */
const FIELDS = [
  ['gubun', 'gubun'],
  ['taxType', 'tax_type'],
  ['wht', 'wht'],
  ['name', 'name'],
  ['bizNo', 'biz_no'],
  ['ceoName', 'ceo_name'],
  ['ceoRRN', 'ceo_rrn'],
  ['program', 'program'],
  ['ceoPhone', 'ceo_phone'],
  ['staffPhone', 'staff_phone'],
  ['staffEmail', 'staff_email'],
  ['hometaxId', 'hometax_id'],
  ['hometaxPw', 'hometax_pw'],
  ['creditId', 'credit_id'],
  ['creditPw', 'credit_pw'],
  ['industry', 'industry'],
];

/** DB 에 실제로 쓰는 컬럼 순서 (INSERT/UPDATE 공용) */
const COLUMNS = [
  'id',
  ...FIELDS.map(([, col]) => col),
  'dept_id',
  'closing_month',
  'other_income',
  'joint_type',
  'joint_count',
  'joint_owners',
  'memos',
  'extra',
  'sort_order',
];

/** 프론트 profile 의 알려진 키 — 이외의 키는 extra 로 흘려보낸다 */
const KNOWN_KEYS = new Set([
  'id',
  ...FIELDS.map(([key]) => key),
  'deptId',
  'closingMonth',
  'otherIncome',
  'jointType',
  'jointCount',
  'jointOwners',
  'memos',
  'sortOrder',
]);

const str = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * DB row → 프론트 profile 객체
 * 프론트가 기대하는 형태를 정확히 재현한다(빈 문자열/null 구분 포함).
 */
function toProfile(row) {
  const p = { id: row.id };

  for (const [key, col] of FIELDS) {
    p[key] = str(row[col]);
  }

  /* dept_id: DB NULL ↔ 프론트 '' */
  p.deptId = row.dept_id === null ? '' : String(row.dept_id);

  p.closingMonth = Number(row.closing_month);

  /* 개인만 값이 있는 필드 — 법인은 null 을 유지해야
   * ProfileModal 의 조건부 렌더링이 원래대로 동작한다 */
  p.otherIncome = row.other_income === null ? null : String(row.other_income);
  p.jointType = row.joint_type === null ? null : String(row.joint_type);
  p.jointCount = row.joint_count === null ? null : Number(row.joint_count);

  p.jointOwners = Array.isArray(row.joint_owners) ? row.joint_owners : [];
  p.memos = Array.isArray(row.memos) ? row.memos : [];

  /* 표시 순서 — 프론트 로직은 참조하지 않지만, 저장 시 그대로 돌려보내
   * 순서가 유실되지 않도록 함께 내려준다. */
  p.sortOrder = Number(row.sort_order) || 0;

  /* 스키마에 없는 신규 필드는 extra 에서 복원 → 구버전 서버에서도 값이 유실되지 않는다 */
  if (row.extra && typeof row.extra === 'object') {
    for (const [k, v] of Object.entries(row.extra)) {
      if (!(k in p)) p[k] = v;
    }
  }

  return p;
}

/**
 * 프론트 profile → DB 파라미터 배열 (COLUMNS 순서와 일치)
 * 프론트의 profile() 기본값 규칙을 서버에서도 한 번 더 적용한다.
 * (클라이언트를 신뢰하지 않는다 — 직접 API 호출로도 데이터가 깨지지 않도록)
 */
function toRowValues(id, input) {
  const o = input || {};
  const gubun = o.gubun === '법인' ? '법인' : '개인';
  const isIndiv = gubun === '개인';

  /* 개인은 결산월 12월 고정 (프론트 profile() 규칙과 동일) */
  const closingMonth = isIndiv ? 12 : Number(o.closingMonth) || 12;

  const jointType = isIndiv ? (o.jointType || '단독') : null;
  const jointCount =
    isIndiv && jointType === '공동' ? Number(o.jointCount) || 2 : null;

  /* 알려지지 않은 키 → extra 로 보존 */
  const extra = {};
  for (const [k, v] of Object.entries(o)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }

  const byCol = {
    id,
    gubun,
    tax_type: str(o.taxType) || '과세',
    wht: str(o.wht) || '신고',
    name: str(o.name),
    biz_no: str(o.bizNo),
    ceo_name: str(o.ceoName),
    ceo_rrn: str(o.ceoRRN),
    program: str(o.program) || '더존',
    ceo_phone: str(o.ceoPhone),
    staff_phone: str(o.staffPhone),
    staff_email: str(o.staffEmail),
    hometax_id: str(o.hometaxId),
    hometax_pw: str(o.hometaxPw),
    credit_id: str(o.creditId),
    credit_pw: str(o.creditPw),
    industry: str(o.industry),
    /* '' → NULL : FK 제약 때문에 빈 문자열을 넣을 수 없다 */
    dept_id: o.deptId ? String(o.deptId) : null,
    closing_month: closingMonth,
    other_income: isIndiv ? (o.otherIncome ?? '포함') : null,
    joint_type: jointType,
    joint_count: jointCount,
    joint_owners: JSON.stringify(Array.isArray(o.jointOwners) ? o.jointOwners : []),
    memos: JSON.stringify(Array.isArray(o.memos) ? o.memos : []),
    extra: JSON.stringify(extra),
    sort_order: Number.isInteger(o.sortOrder) ? o.sortOrder : null,
  };

  return COLUMNS.map((col) => byCol[col]);
}

module.exports = { COLUMNS, toProfile, toRowValues };

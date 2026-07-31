const db = require('../../db/pool');
const { COLUMNS, toProfile, toRowValues } = require('./vendor.mapper');

/* ==================================================================
 * 총괄업체 repository — SQL 은 이 계층에만 존재한다.
 * (기존 server.js 는 라우터에 SQL 이 섞여 있어 재사용/테스트가 불가능했다)
 * ================================================================== */

const SELECT_COLS = COLUMNS.join(', ');

/** 전체 조회 — 프론트 profiles 와 같은 map 형태로 반환 */
async function findAll({ deptId } = {}) {
  const params = [];
  let where = 'WHERE is_deleted = false';
  if (deptId) {
    params.push(deptId);
    where += ` AND dept_id = $${params.length}`;
  }

  const { rows } = await db.query(
    /* 정렬: 프론트 Object.values(profiles) 의 원래 순서를 재현한다.
     * 이름순으로 바꾸면 총괄업체 관리·종합소득세·법인세 목록의
     * 행 순서가 달라져 UI 회귀가 된다. */
    `SELECT ${SELECT_COLS} FROM vendors ${where} ORDER BY sort_order, id`,
    params
  );

  const map = {};
  for (const row of rows) map[row.id] = toProfile(row);
  return map;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS} FROM vendors WHERE id = $1 AND is_deleted = false`,
    [id]
  );
  return rows[0] ? toProfile(rows[0]) : null;
}

async function exists(id) {
  const { rowCount } = await db.query('SELECT 1 FROM vendors WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * UPSERT — 프론트의 저장 동작(ProfileModal onSave)은
 * "새로 만들기"와 "수정"을 구분하지 않으므로 upsert 가 자연스럽다.
 * is_deleted = false 로 되살리는 효과도 있다.
 */
async function upsert(id, profile, client = db) {
  const values = toRowValues(id, profile);

  /* sort_order 특별 취급
   *  - 신규 등록이고 값이 없으면 맨 뒤에 붙인다.
   *    (프론트 addCompany 는 map 뒤에 추가되므로 화면에서도 마지막에 보인다)
   *  - 수정이고 값이 없으면 기존 순서를 유지한다.
   *    ProfileModal 저장 시 순서가 바뀌면 UI 회귀가 된다. */
  const placeholders = COLUMNS.map((col, i) =>
    col === 'sort_order'
      ? `COALESCE($${i + 1}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vendors))`
      : `$${i + 1}`
  ).join(', ');

  const updates = COLUMNS.filter((c) => c !== 'id')
    .map((c) =>
      c === 'sort_order'
        ? 'sort_order = COALESCE(EXCLUDED.sort_order, vendors.sort_order)'
        : `${c} = EXCLUDED.${c}`
    )
    .join(', ');

  const { rows } = await client.query(
    `INSERT INTO vendors (${SELECT_COLS})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE
       SET ${updates}, is_deleted = false
     RETURNING ${SELECT_COLS}`,
    values
  );
  return toProfile(rows[0]);
}

/** 여러 건 한 번에 저장 (초기 시드 / 택스봇 일괄 반영용) — 하나의 트랜잭션 */
async function upsertMany(profiles) {
  return db.transaction(async (client) => {
    const saved = [];
    for (const p of profiles) {
      saved.push(await upsert(p.id, p, client));
    }
    return saved;
  });
}

/**
 * 소프트 삭제.
 * 세목 원장(ledgers.payload)이 업체 id 를 참조하고 있으므로
 * 물리 삭제하면 과거 신고 이력의 업체명 조회가 깨진다.
 */
async function softDelete(id) {
  const { rowCount } = await db.query(
    'UPDATE vendors SET is_deleted = true WHERE id = $1 AND is_deleted = false',
    [id]
  );
  return rowCount > 0;
}

async function restore(id) {
  const { rowCount } = await db.query(
    'UPDATE vendors SET is_deleted = false WHERE id = $1',
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  exists,
  upsert,
  upsertMany,
  softDelete,
  restore,
};

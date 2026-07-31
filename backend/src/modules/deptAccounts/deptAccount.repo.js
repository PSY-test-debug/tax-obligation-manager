const db = require('../../db/pool');

/* ==================================================================
 * 홈택스 부서 계정(담당자) repository
 * 프론트 deptAccount() 필드: id, name, phone, email, pwEntered, otpEntered
 * ================================================================== */

const COLS = 'id, name, phone, email, pw_entered, otp_entered, sort_order';

function toAccount(row) {
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    pwEntered: !!row.pw_entered,
    otpEntered: !!row.otp_entered,
  };
}

function toValues(id, o = {}) {
  return [
    id,
    o.name === undefined || o.name === null ? '' : String(o.name),
    o.phone === undefined || o.phone === null ? '' : String(o.phone),
    o.email === undefined || o.email === null ? '' : String(o.email),
    !!o.pwEntered,
    !!o.otpEntered,
    Number.isInteger(o.sortOrder) ? o.sortOrder : 0,
  ];
}

/** 전체 조회 → 프론트 deptAccounts 와 동일한 map 형태 */
async function findAll() {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM dept_accounts ORDER BY sort_order, id`
  );
  const map = {};
  for (const row of rows) map[row.id] = toAccount(row);
  return map;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM dept_accounts WHERE id = $1`,
    [id]
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

async function upsert(id, account, client = db) {
  const { rows } = await client.query(
    `INSERT INTO dept_accounts (id, name, phone, email, pw_entered, otp_entered, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       pw_entered = EXCLUDED.pw_entered,
       otp_entered = EXCLUDED.otp_entered,
       sort_order = EXCLUDED.sort_order
     RETURNING ${COLS}`,
    toValues(id, account)
  );
  return toAccount(rows[0]);
}

async function upsertMany(accounts) {
  return db.transaction(async (client) => {
    const saved = [];
    for (const a of accounts) saved.push(await upsert(a.id, a, client));
    return saved;
  });
}

/**
 * 삭제.
 * vendors.dept_id 는 ON DELETE SET NULL 이므로,
 * 이 계정을 참조하던 업체는 담당자가 '미배정'으로 바뀐다.
 * 몇 곳이 영향받는지 함께 돌려주어 화면에서 안내할 수 있게 한다.
 */
async function remove(id) {
  return db.transaction(async (client) => {
    const { rows: affected } = await client.query(
      'SELECT count(*)::int AS n FROM vendors WHERE dept_id = $1 AND is_deleted = false',
      [id]
    );
    const { rowCount } = await client.query('DELETE FROM dept_accounts WHERE id = $1', [id]);
    return { deleted: rowCount > 0, unassignedVendors: affected[0].n };
  });
}

module.exports = { findAll, findById, upsert, upsertMany, remove };

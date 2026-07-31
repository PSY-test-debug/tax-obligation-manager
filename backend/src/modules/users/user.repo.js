const db = require('../../db/pool');

/* ==================================================================
 * 계정 관리 repository (사무소 관리자용)
 * 모든 조회는 firmId 로 제한된다 — 다른 사무소 계정은 보이지 않는다.
 * ================================================================== */

const COLS = `
  id, login_id, name, role, dept_id, is_active, must_change_pw,
  failed_attempts, locked_until, last_login_at, created_at
`;

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name || '',
    role: row.role,
    deptId: row.dept_id,
    isActive: row.is_active,
    mustChangePw: row.must_change_pw,
    isLocked: !!(row.locked_until && new Date(row.locked_until) > new Date()),
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

async function list(firmId) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM users WHERE firm_id = $1 ORDER BY role, login_id`,
    [firmId]
  );
  return rows.map(toUser);
}

async function findById(firmId, id) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM users WHERE firm_id = $1 AND id = $2`,
    [firmId, id]
  );
  return toUser(rows[0]);
}

async function create(firmId, { loginId, passwordHash, name, role, deptId, mustChangePw = true }) {
  const { rows } = await db.query(
    `INSERT INTO users (firm_id, login_id, password_hash, name, role, dept_id, must_change_pw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLS}`,
    [firmId, loginId, passwordHash, name || '', role, deptId || null, mustChangePw]
  );
  return toUser(rows[0]);
}

async function update(firmId, id, { name, role, deptId, isActive }) {
  const { rows } = await db.query(
    `UPDATE users SET
       name      = COALESCE($3, name),
       role      = COALESCE($4, role),
       dept_id   = CASE WHEN $5::text IS NULL THEN dept_id ELSE NULLIF($5, '') END,
       is_active = COALESCE($6, is_active)
     WHERE firm_id = $1 AND id = $2
     RETURNING ${COLS}`,
    [firmId, id, name ?? null, role ?? null, deptId ?? null, isActive ?? null]
  );
  return toUser(rows[0]);
}

/** 관리자에 의한 비밀번호 초기화 — 다음 로그인 시 변경을 강제한다 */
async function resetPassword(firmId, id, passwordHash) {
  const { rows } = await db.query(
    `UPDATE users
        SET password_hash = $3, must_change_pw = true,
            failed_attempts = 0, locked_until = NULL
      WHERE firm_id = $1 AND id = $2
      RETURNING ${COLS}`,
    [firmId, id, passwordHash]
  );
  return toUser(rows[0]);
}

/** 잠금 해제 */
async function unlock(firmId, id) {
  const { rows } = await db.query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL
      WHERE firm_id = $1 AND id = $2 RETURNING ${COLS}`,
    [firmId, id]
  );
  return toUser(rows[0]);
}

async function remove(firmId, id) {
  const { rowCount } = await db.query(
    'DELETE FROM users WHERE firm_id = $1 AND id = $2',
    [firmId, id]
  );
  return rowCount > 0;
}

/** 마지막 관리자를 지우거나 강등하지 못하게 막기 위한 카운트 */
async function countActiveAdmins(firmId, exceptId = null) {
  const { rows } = await db.query(
    exceptId
      ? `SELECT count(*)::int AS n FROM users
          WHERE firm_id = $1 AND role = 'admin' AND is_active = true AND id <> $2`
      : `SELECT count(*)::int AS n FROM users
          WHERE firm_id = $1 AND role = 'admin' AND is_active = true`,
    exceptId ? [firmId, exceptId] : [firmId]
  );
  return rows[0].n;
}

module.exports = {
  list, findById, create, update, resetPassword, unlock, remove, countActiveAdmins,
};

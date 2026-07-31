const db = require('../../db/pool');

/* ==================================================================
 * 인증 repository
 * ================================================================== */

const USER_COLS = `
  id, firm_id, login_id, password_hash, name, role, dept_id,
  is_active, must_change_pw, failed_attempts, locked_until, last_login_at
`;

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    firmId: row.firm_id,
    loginId: row.login_id,
    passwordHash: row.password_hash,
    name: row.name || '',
    role: row.role,
    deptId: row.dept_id,
    isActive: row.is_active,
    mustChangePw: row.must_change_pw,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
  };
}

/** login_id 는 전역 UNIQUE 이므로 사무소 지정 없이 조회된다 */
async function findByLoginId(loginId) {
  const { rows } = await db.query(
    `SELECT ${USER_COLS} FROM users WHERE lower(login_id) = lower($1)`,
    [String(loginId)]
  );
  return toUser(rows[0]);
}

async function findById(id) {
  const { rows } = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  return toUser(rows[0]);
}

/**
 * 로그인 실패 기록.
 * 5회 실패 시 15분 잠금. 무차별 대입을 실질적으로 차단한다.
 */
async function recordFailure(userId, { maxAttempts = 5, lockMinutes = 15 } = {}) {
  const { rows } = await db.query(
    `UPDATE users
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
              WHEN failed_attempts + 1 >= $2
              THEN now() + ($3 || ' minutes')::interval
              ELSE locked_until
            END
      WHERE id = $1
      RETURNING failed_attempts, locked_until`,
    [userId, maxAttempts, String(lockMinutes)]
  );
  return rows[0];
}

async function recordSuccess(userId) {
  await db.query(
    `UPDATE users
        SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1`,
    [userId]
  );
}

async function updatePassword(userId, passwordHash, { mustChangePw = false } = {}) {
  const { rowCount } = await db.query(
    `UPDATE users
        SET password_hash = $2, must_change_pw = $3, failed_attempts = 0, locked_until = NULL
      WHERE id = $1`,
    [userId, passwordHash, mustChangePw]
  );
  return rowCount > 0;
}

/** 사무소 정보 (로그인 응답에 함께 내려준다) */
async function findFirm(firmId) {
  const { rows } = await db.query(
    'SELECT id, name, biz_no, ceo FROM firms WHERE id = $1',
    [firmId]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].name, bizNo: rows[0].biz_no, ceo: rows[0].ceo };
}

/** 계정이 하나도 없는지 — 최초 관리자 생성 안내에 쓴다 */
async function countUsers() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  return rows[0].n;
}

module.exports = {
  findByLoginId,
  findById,
  recordFailure,
  recordSuccess,
  updatePassword,
  findFirm,
  countUsers,
};

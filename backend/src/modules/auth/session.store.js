const crypto = require('crypto');
const db = require('../../db/pool');

/* ==================================================================
 * 세션 저장소
 *
 * 쿠키에는 원본 토큰을, DB 에는 SHA-256 해시를 저장한다.
 * DB 가 유출되어도 세션을 그대로 탈취할 수 없다.
 * (비밀번호와 달리 토큰은 128비트 난수라 SHA-256 으로 충분하다)
 * ================================================================== */

const TOKEN_BYTES = 32;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** 세션 생성 → 원본 토큰 반환 (이 값만 쿠키로 나간다) */
async function create({ userId, firmId, ttlMs, userAgent = '', ip = '' }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.query(
    `INSERT INTO sessions (token_hash, user_id, firm_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hashToken(token), userId, firmId, expiresAt, String(userAgent).slice(0, 300), String(ip).slice(0, 60)]
  );

  return { token, expiresAt };
}

/**
 * 토큰으로 세션 + 사용자를 한 번에 조회.
 * 만료·비활성 계정은 걸러낸다.
 */
async function resolve(token) {
  if (!token) return null;

  const { rows } = await db.query(
    `SELECT s.id           AS session_id,
            s.expires_at,
            u.id           AS user_id,
            u.firm_id,
            u.login_id,
            u.name,
            u.role,
            u.dept_id,
            u.must_change_pw,
            f.name         AS firm_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN firms f ON f.id = u.firm_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.is_active = true
        AND f.is_active = true`,
    [hashToken(token)]
  );

  if (!rows[0]) return null;
  const r = rows[0];
  return {
    sessionId: r.session_id,
    expiresAt: r.expires_at,
    userId: r.user_id,
    firmId: r.firm_id,
    loginId: r.login_id,
    name: r.name,
    role: r.role,
    deptId: r.dept_id,
    mustChangePw: r.must_change_pw,
    firmName: r.firm_name,
  };
}

/** 슬라이딩 만료 — 활동이 있으면 만료 시각을 연장한다 */
async function touch(sessionId, ttlMs) {
  await db.query(
    `UPDATE sessions
        SET last_seen_at = now(), expires_at = now() + ($2::bigint || ' milliseconds')::interval
      WHERE id = $1`,
    [sessionId, ttlMs]
  );
}

async function destroy(token) {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE token_hash = $1', [
    hashToken(token),
  ]);
  return rowCount > 0;
}

/** 특정 사용자의 모든 세션 종료 (비밀번호 변경·계정 정지 시) */
async function destroyAllForUser(userId, exceptSessionId = null) {
  const { rowCount } = await db.query(
    exceptSessionId
      ? 'DELETE FROM sessions WHERE user_id = $1 AND id <> $2'
      : 'DELETE FROM sessions WHERE user_id = $1',
    exceptSessionId ? [userId, exceptSessionId] : [userId]
  );
  return rowCount;
}

async function purgeExpired() {
  const { rows } = await db.query('SELECT purge_expired_sessions() AS n');
  return rows[0].n;
}

module.exports = {
  create,
  resolve,
  touch,
  destroy,
  destroyAllForUser,
  purgeExpired,
  hashToken,
};

const ApiError = require('../lib/ApiError');
const sessions = require('../modules/auth/session.store');
const env = require('../config/env');

/* ==================================================================
 * 인증 미들웨어
 *
 * 성공 시 req.auth 를 채운다:
 *   { sessionId, userId, firmId, loginId, name, role, deptId }
 *
 * 이후 모든 repository 호출은 req.auth.firmId 를 받아
 * 사무소 경계를 넘지 못하게 한다.
 * ================================================================== */

/** 쿠키 또는 Authorization 헤더에서 토큰을 꺼낸다 */
function extractToken(req) {
  if (req.cookies && req.cookies[env.session.cookieName]) {
    return req.cookies[env.session.cookieName];
  }
  /* 서버 간 호출·스크립트 검증용 (브라우저는 쿠키를 쓴다) */
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new ApiError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    }

    const session = await sessions.resolve(token);
    if (!session) {
      /* 만료·삭제·비활성 계정 — 쿠키를 지워 재로그인을 유도한다 */
      res.clearCookie(env.session.cookieName, env.session.cookieOptions());
      throw new ApiError(401, 'SESSION_EXPIRED', '세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    req.auth = session;
    req.authToken = token;

    /* 슬라이딩 만료 — 매 요청마다 UPDATE 하면 부하가 크므로
     * 남은 시간이 절반 아래로 떨어졌을 때만 연장한다. */
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (remaining < env.session.ttlMs / 2) {
      await sessions.touch(session.sessionId, env.session.ttlMs);
      res.cookie(env.session.cookieName, token, {
        ...env.session.cookieOptions(),
        maxAge: env.session.ttlMs,
      });
    }

    /* 비밀번호 변경이 강제된 상태면 변경 API 외에는 막는다 */
    if (session.mustChangePw && !req.path.startsWith('/password')) {
      throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', '비밀번호를 변경해야 계속 사용할 수 있습니다.');
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

/** 사무소 관리자 전용 */
function requireAdmin(req, res, next) {
  if (!req.auth) {
    return next(new ApiError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.'));
  }
  if (req.auth.role !== 'admin') {
    return next(new ApiError(403, 'FORBIDDEN', '관리자만 사용할 수 있는 기능입니다.'));
  }
  return next();
}

module.exports = { requireAuth, requireAdmin, extractToken };

const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const ApiError = require('../../lib/ApiError');
const v = require('../../lib/validate');
const env = require('../../config/env');
const { hashPassword, verifyPassword, checkPasswordStrength } = require('../../lib/password');
const createRateLimit = require('../../middleware/rateLimit');
const { requireAuth } = require('../../middleware/requireAuth');
const sessions = require('./session.store');
const repo = require('./auth.repo');

const router = express.Router();

/* 로그인 시도 제한 (IP 단위) — .env 로 조정 가능
 * 기본 5분 60회. 사무실 NAT 환경을 고려한 값이다. */
const loginLimit = createRateLimit({
  windowMs: env.session.loginRateWindowMin * 60_000,
  max: env.session.loginRateMax,
  message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
});

/** 클라이언트로 내려보낼 사용자 정보 (비밀번호 해시 등은 제외) */
function publicUser(session) {
  return {
    loginId: session.loginId,
    name: session.name,
    role: session.role,
    deptId: session.deptId,
    mustChangePw: session.mustChangePw,
    firmName: session.firmName,
  };
}

/* ------------------------------------------------------------------
 * POST /api/auth/login
 *   { loginId, password }
 *
 * 기존 Login 컴포넌트가 아이디·비밀번호 두 개만 받으므로
 * 사무소는 따로 고르지 않는다(login_id 가 전역 UNIQUE).
 * ------------------------------------------------------------------ */
router.post(
  '/login',
  loginLimit,
  asyncHandler(async (req, res) => {
    const body = v.requireObject(req.body, '로그인 정보');
    const loginId = v.requireString(body.loginId, '아이디');
    const password = typeof body.password === 'string' ? body.password : '';

    /* 실패 응답은 항상 동일하게 — 아이디 존재 여부가 새어나가면
     * 공격자가 유효한 계정 목록을 만들 수 있다. */
    const genericFail = () =>
      new ApiError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');

    const user = await repo.findByLoginId(loginId);

    if (!user) {
      /* 존재하지 않는 아이디여도 해시 검증과 비슷한 시간을 쓴다.
       * 응답 시간 차이로 계정 존재를 알아내는 것을 막는다. */
      await verifyPassword(password, 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      throw genericFail();
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
      throw new ApiError(
        423,
        'ACCOUNT_LOCKED',
        `로그인 실패가 반복되어 계정이 잠겼습니다. ${mins}분 후에 다시 시도하거나 관리자에게 문의하세요.`
      );
    }

    if (!user.isActive) {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
    }

    const okPw = await verifyPassword(password, user.passwordHash);
    if (!okPw) {
      const after = await repo.recordFailure(user.id, {
        maxAttempts: env.session.maxLoginAttempts,
        lockMinutes: env.session.lockMinutes,
      });
      if (after && after.locked_until && new Date(after.locked_until) > new Date()) {
        throw new ApiError(
          423,
          'ACCOUNT_LOCKED',
          `로그인 실패가 ${env.session.maxLoginAttempts}회 누적되어 계정이 ${env.session.lockMinutes}분간 잠겼습니다.`
        );
      }
      throw genericFail();
    }

    await repo.recordSuccess(user.id);

    const { token } = await sessions.create({
      userId: user.id,
      firmId: user.firmId,
      ttlMs: env.session.ttlMs,
      userAgent: req.get('user-agent') || '',
      ip: req.ip || '',
    });

    res.cookie(env.session.cookieName, token, {
      ...env.session.cookieOptions(),
      maxAge: env.session.ttlMs,
    });

    const firm = await repo.findFirm(user.firmId);

    res.json({
      ok: true,
      data: {
        user: {
          loginId: user.loginId,
          name: user.name,
          role: user.role,
          deptId: user.deptId,
          mustChangePw: user.mustChangePw,
          firmName: firm ? firm.name : '',
        },
        firm,
      },
    });
  })
);

/* ------------------------------------------------------------------
 * POST /api/auth/logout
 *   세션을 DB 에서 지우고 쿠키를 제거한다.
 * ------------------------------------------------------------------ */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { extractToken } = require('../../middleware/requireAuth');
    const token = extractToken(req);
    if (token) await sessions.destroy(token);
    res.clearCookie(env.session.cookieName, env.session.cookieOptions());
    res.json({ ok: true, data: { loggedOut: true } });
  })
);

/* ------------------------------------------------------------------
 * GET /api/auth/me
 *   새로고침 시 세션 복원에 쓴다.
 *   미로그인은 에러가 아니라 null 을 돌려준다 → 프론트가 로그인 화면을 띄운다.
 * ------------------------------------------------------------------ */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { extractToken } = require('../../middleware/requireAuth');
    const token = extractToken(req);
    if (!token) return res.json({ ok: true, data: null });

    const session = await sessions.resolve(token);
    if (!session) {
      res.clearCookie(env.session.cookieName, env.session.cookieOptions());
      return res.json({ ok: true, data: null });
    }

    const firm = await repo.findFirm(session.firmId);
    return res.json({ ok: true, data: { user: publicUser(session), firm } });
  })
);

/* ------------------------------------------------------------------
 * POST /api/auth/password  — 본인 비밀번호 변경
 *   { currentPassword, newPassword }
 *
 * 변경 후 다른 기기의 세션은 모두 종료한다.
 * ------------------------------------------------------------------ */
router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = v.requireObject(req.body, '비밀번호 변경 정보');
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';

    const user = await repo.findById(req.auth.userId);
    if (!user) throw ApiError.notFound('계정을 찾을 수 없습니다.');

    const okPw = await verifyPassword(current, user.passwordHash);
    if (!okPw) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '현재 비밀번호가 올바르지 않습니다.');
    }

    if (current === next) {
      throw ApiError.badRequest('새 비밀번호가 기존과 동일합니다.');
    }

    const weak = checkPasswordStrength(next, { loginId: user.loginId });
    if (weak) throw ApiError.badRequest(weak);

    await repo.updatePassword(user.id, await hashPassword(next), { mustChangePw: false });

    /* 현재 세션은 유지하고 나머지는 끊는다 */
    const closed = await sessions.destroyAllForUser(user.id, req.auth.sessionId);

    res.json({ ok: true, data: { changed: true, otherSessionsClosed: closed } });
  })
);

/* ------------------------------------------------------------------
 * GET /api/auth/setup-required
 *   계정이 하나도 없으면 true.
 *   최초 설치 시 "관리자 계정을 먼저 만들어주세요" 안내에 쓴다.
 * ------------------------------------------------------------------ */
router.get(
  '/setup-required',
  asyncHandler(async (req, res) => {
    const n = await repo.countUsers();
    res.json({ ok: true, data: { setupRequired: n === 0 } });
  })
);

module.exports = router;

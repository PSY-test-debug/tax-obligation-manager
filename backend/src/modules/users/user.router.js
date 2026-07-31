const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const ApiError = require('../../lib/ApiError');
const v = require('../../lib/validate');
const { hashPassword, checkPasswordStrength } = require('../../lib/password');
const { requireAdmin } = require('../../middleware/requireAuth');
const sessions = require('../auth/session.store');
const repo = require('./user.repo');
const deptRepo = require('../deptAccounts/deptAccount.repo');

const router = express.Router();

/* 계정 관리는 전부 관리자 전용 */
router.use(requireAdmin);

const LOGIN_ID_RE = /^[a-zA-Z0-9._-]{4,32}$/;

/* GET /api/users */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await repo.list(req.auth.firmId) });
  })
);

/* ------------------------------------------------------------------
 * POST /api/users — 계정 생성
 *   { loginId, password, name, role, deptId }
 *
 * staff 는 반드시 담당자(부서계정)에 묶인다.
 * ------------------------------------------------------------------ */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = v.requireObject(req.body, '계정 정보');
    const loginId = v.requireString(body.loginId, '아이디');

    if (!LOGIN_ID_RE.test(loginId)) {
      throw ApiError.badRequest('아이디는 영문·숫자·. _ - 조합 4~32자여야 합니다.');
    }

    const role = v.requireEnum(body.role || 'staff', ['admin', 'staff'], '권한');
    const deptId = body.deptId ? String(body.deptId) : null;

    if (role === 'staff' && !deptId) {
      throw ApiError.badRequest('담당자 계정은 홈택스 부서계정을 지정해야 합니다.');
    }
    if (deptId) {
      const dept = await deptRepo.findById(req.auth.firmId, deptId);
      if (!dept) throw ApiError.badRequest(`부서계정(${deptId})을 찾을 수 없습니다.`);
    }

    const password = typeof body.password === 'string' ? body.password : '';
    const weak = checkPasswordStrength(password, { loginId });
    if (weak) throw ApiError.badRequest(weak);

    const created = await repo.create(req.auth.firmId, {
      loginId,
      passwordHash: await hashPassword(password),
      name: body.name,
      role,
      deptId,
      /* 관리자가 정해준 초기 비밀번호이므로 첫 로그인 시 변경하게 한다 */
      mustChangePw: body.mustChangePw !== false,
    });

    res.status(201).json({ ok: true, data: created });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/users/:id — 이름·권한·소속·사용여부 변경
 * ------------------------------------------------------------------ */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.optInt(req.params.id, { min: 1 });
    if (!id) throw ApiError.badRequest('계정 id 가 올바르지 않습니다.');

    const body = v.requireObject(req.body, '계정 정보');
    const target = await repo.findById(req.auth.firmId, id);
    if (!target) throw ApiError.notFound('계정을 찾을 수 없습니다.');

    const role = body.role ? v.requireEnum(body.role, ['admin', 'staff'], '권한') : undefined;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;

    /* 마지막 관리자를 강등하거나 비활성화하면 아무도 로그인할 수 없게 된다 */
    const losingAdmin =
      (target.role === 'admin' && role === 'staff') ||
      (target.role === 'admin' && isActive === false);
    if (losingAdmin) {
      const others = await repo.countActiveAdmins(req.auth.firmId, id);
      if (others === 0) {
        throw ApiError.conflict('마지막 관리자 계정입니다. 다른 관리자를 먼저 지정하세요.');
      }
    }

    const deptId = body.deptId !== undefined ? String(body.deptId || '') : undefined;
    if (deptId) {
      const dept = await deptRepo.findById(req.auth.firmId, deptId);
      if (!dept) throw ApiError.badRequest(`부서계정(${deptId})을 찾을 수 없습니다.`);
    }
    const nextRole = role || target.role;
    const nextDept = deptId !== undefined ? deptId : target.deptId;
    if (nextRole === 'staff' && !nextDept) {
      throw ApiError.badRequest('담당자 계정은 홈택스 부서계정을 지정해야 합니다.');
    }

    const updated = await repo.update(req.auth.firmId, id, {
      name: body.name, role, deptId, isActive,
    });

    /* 비활성화하면 즉시 로그아웃시킨다 */
    if (isActive === false) await sessions.destroyAllForUser(id);

    res.json({ ok: true, data: updated });
  })
);

/* ------------------------------------------------------------------
 * POST /api/users/:id/password — 관리자에 의한 비밀번호 초기화
 * ------------------------------------------------------------------ */
router.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const id = v.optInt(req.params.id, { min: 1 });
    if (!id) throw ApiError.badRequest('계정 id 가 올바르지 않습니다.');

    const target = await repo.findById(req.auth.firmId, id);
    if (!target) throw ApiError.notFound('계정을 찾을 수 없습니다.');

    const body = v.requireObject(req.body, '비밀번호');
    const password = typeof body.password === 'string' ? body.password : '';
    const weak = checkPasswordStrength(password, { loginId: target.loginId });
    if (weak) throw ApiError.badRequest(weak);

    const updated = await repo.resetPassword(req.auth.firmId, id, await hashPassword(password));

    /* 초기화된 계정의 기존 세션은 모두 끊는다 */
    const closed = await sessions.destroyAllForUser(id);

    res.json({ ok: true, data: { ...updated, sessionsClosed: closed } });
  })
);

/* POST /api/users/:id/unlock — 로그인 실패 잠금 해제 */
router.post(
  '/:id/unlock',
  asyncHandler(async (req, res) => {
    const id = v.optInt(req.params.id, { min: 1 });
    if (!id) throw ApiError.badRequest('계정 id 가 올바르지 않습니다.');
    const updated = await repo.unlock(req.auth.firmId, id);
    if (!updated) throw ApiError.notFound('계정을 찾을 수 없습니다.');
    res.json({ ok: true, data: updated });
  })
);

/* DELETE /api/users/:id */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.optInt(req.params.id, { min: 1 });
    if (!id) throw ApiError.badRequest('계정 id 가 올바르지 않습니다.');

    if (Number(id) === Number(req.auth.userId)) {
      throw ApiError.conflict('본인 계정은 삭제할 수 없습니다.');
    }

    const target = await repo.findById(req.auth.firmId, id);
    if (!target) throw ApiError.notFound('계정을 찾을 수 없습니다.');

    if (target.role === 'admin') {
      const others = await repo.countActiveAdmins(req.auth.firmId, id);
      if (others === 0) {
        throw ApiError.conflict('마지막 관리자 계정입니다. 다른 관리자를 먼저 지정하세요.');
      }
    }

    await sessions.destroyAllForUser(id);
    await repo.remove(req.auth.firmId, id);

    res.json({ ok: true, data: { id, deleted: true } });
  })
);

module.exports = router;

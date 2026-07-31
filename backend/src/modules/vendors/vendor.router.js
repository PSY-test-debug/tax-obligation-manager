const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const ApiError = require('../../lib/ApiError');
const v = require('../../lib/validate');
const repo = require('./vendor.repo');

const router = express.Router();

/* ------------------------------------------------------------------
 * GET /api/vendors
 *   → { "c1": {…profile}, "c2": {…} }
 *   프론트 profiles 와 동일한 map 형태로 내려준다.
 *   덕분에 Dashboard 는 응답을 그대로 setProfiles 에 넣을 수 있다.
 *
 *   ?deptId=tax680017  담당자별 필터 (선택)
 * ------------------------------------------------------------------ */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const deptId = req.query.deptId ? String(req.query.deptId) : null;
    const profiles = await repo.findAll(req.auth.firmId, { deptId });
    res.json({ ok: true, data: profiles });
  })
);

/* GET /api/vendors/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '업체 id');
    const profile = await repo.findById(req.auth.firmId, id);
    if (!profile) throw ApiError.notFound(`업체(${id})를 찾을 수 없습니다.`);
    res.json({ ok: true, data: profile });
  })
);

/* ------------------------------------------------------------------
 * POST /api/vendors
 *   프론트 addCompany() 는 "n" + Date.now() 로 id 를 직접 만든다.
 *   그 규칙을 그대로 존중하되, id 가 없으면 서버가 생성한다.
 * ------------------------------------------------------------------ */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = v.requireObject(req.body, '업체 정보');
    const id = body.id ? v.requireId(body.id, '업체 id') : `n${Date.now()}`;

    if (await repo.exists(req.auth.firmId, id)) {
      throw ApiError.conflict(`이미 존재하는 업체 id 입니다. (${id})`);
    }
    if (body.gubun) v.requireEnum(body.gubun, ['개인', '법인'], '구분');

    const saved = await repo.upsert(req.auth.firmId, id, body);
    res.status(201).json({ ok: true, data: saved });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/vendors/:id  — 전체 저장(upsert)
 *   ProfileModal 의 onSave 가 profile 객체 전체를 넘기므로
 *   부분 수정(PATCH)보다 전체 저장이 의미상 정확하다.
 * ------------------------------------------------------------------ */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '업체 id');
    const body = v.requireObject(req.body, '업체 정보');
    if (body.gubun) v.requireEnum(body.gubun, ['개인', '법인'], '구분');

    const saved = await repo.upsert(req.auth.firmId, id, body);
    res.json({ ok: true, data: saved });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/vendors  — 여러 건 일괄 저장
 *   배열 또는 map 모두 허용. 하나의 트랜잭션으로 처리된다.
 * ------------------------------------------------------------------ */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body;
    const list = Array.isArray(body)
      ? body
      : Object.entries(v.requireObject(body, '업체 목록')).map(([id, p]) => ({
          ...p,
          id,
        }));

    for (const p of list) v.requireId(p.id, '업체 id');

    const saved = await repo.upsertMany(req.auth.firmId, list);
    res.json({ ok: true, data: saved, count: saved.length });
  })
);

/* ------------------------------------------------------------------
 * DELETE /api/vendors/:id  — 소프트 삭제
 *   세목 원장(payload)이 업체 id 를 참조하므로 물리 삭제하지 않는다.
 *   과거 신고 이력에서 업체명을 조회할 수 있어야 한다.
 * ------------------------------------------------------------------ */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '업체 id');
    const ok = await repo.softDelete(req.auth.firmId, id);
    if (!ok) throw ApiError.notFound(`업체(${id})를 찾을 수 없습니다.`);
    res.json({ ok: true, data: { id, deleted: true } });
  })
);

/* POST /api/vendors/:id/restore — 삭제 취소 */
router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '업체 id');
    const ok = await repo.restore(req.auth.firmId, id);
    if (!ok) throw ApiError.notFound(`업체(${id})를 찾을 수 없습니다.`);
    res.json({ ok: true, data: await repo.findById(req.auth.firmId, id) });
  })
);

module.exports = router;

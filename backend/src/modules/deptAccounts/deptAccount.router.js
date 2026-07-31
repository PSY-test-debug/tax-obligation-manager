const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const ApiError = require('../../lib/ApiError');
const v = require('../../lib/validate');
const repo = require('./deptAccount.repo');

const router = express.Router();

/* GET /api/dept-accounts → { "tax680017": {…}, … } */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await repo.findAll() });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '부서계정 id');
    const account = await repo.findById(id);
    if (!account) throw ApiError.notFound(`부서계정(${id})을 찾을 수 없습니다.`);
    res.json({ ok: true, data: account });
  })
);

/* PUT /api/dept-accounts/:id — 단건 저장(upsert) */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '부서계정 id');
    const body = v.requireObject(req.body, '부서계정 정보');
    res.json({ ok: true, data: await repo.upsert(id, body) });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/dept-accounts — 전체 map 일괄 저장
 *   StaffAccountsModal 은 setDeptAccounts 로 map 전체를 갈아끼우므로
 *   일괄 저장 엔드포인트가 있어야 화면 동작과 어긋나지 않는다.
 * ------------------------------------------------------------------ */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body;
    const list = Array.isArray(body)
      ? body
      : Object.entries(v.requireObject(body, '부서계정 목록')).map(([id, a]) => ({
          ...a,
          id,
        }));

    for (const a of list) v.requireId(a.id, '부서계정 id');

    const saved = await repo.upsertMany(list);
    res.json({ ok: true, data: saved, count: saved.length });
  })
);

/* DELETE /api/dept-accounts/:id */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = v.requireId(req.params.id, '부서계정 id');
    const { deleted, unassignedVendors } = await repo.remove(id);
    if (!deleted) throw ApiError.notFound(`부서계정(${id})을 찾을 수 없습니다.`);
    res.json({ ok: true, data: { id, deleted: true, unassignedVendors } });
  })
);

module.exports = router;

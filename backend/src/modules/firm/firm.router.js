const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const v = require('../../lib/validate');
const { requireAdmin } = require('../../middleware/requireAuth');
const repo = require('./firm.repo');

const router = express.Router();

/* GET /api/firm */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await repo.get(req.auth.firmId) });
}));

/* PUT /api/firm — FirmSettingsModal onSave 가 firm 객체 전체를 넘긴다
 * 사무소 정보는 관리자만 수정할 수 있다(택스봇 계정이 들어 있다). */
router.put('/', requireAdmin, asyncHandler(async (req, res) => {
  const body = v.requireObject(req.body, '사무소 설정');
  res.json({ ok: true, data: await repo.save(req.auth.firmId, body) });
}));

module.exports = router;

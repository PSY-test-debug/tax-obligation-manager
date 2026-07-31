const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const v = require('../../lib/validate');
const repo = require('./firm.repo');

const router = express.Router();

/* GET /api/firm */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await repo.get() });
}));

/* PUT /api/firm — FirmSettingsModal onSave 가 firm 객체 전체를 넘긴다 */
router.put('/', asyncHandler(async (req, res) => {
  const body = v.requireObject(req.body, '사무소 설정');
  res.json({ ok: true, data: await repo.save(body) });
}));

module.exports = router;

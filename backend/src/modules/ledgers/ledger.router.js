const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const ApiError = require('../../lib/ApiError');
const v = require('../../lib/validate');
const repo = require('./ledger.repo');
const { LEDGERS, LEDGER_NAMES, resolveLedger, assertPeriodKey } = require('./ledger.registry');

const router = express.Router();

/* ------------------------------------------------------------------
 * GET /api/ledgers
 *   사용 가능한 세목 목록 (프론트에서 탭 구성 검증용)
 * ------------------------------------------------------------------ */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      ok: true,
      data: LEDGER_NAMES.map((name) => ({
        name,
        label: LEDGERS[name].label,
        periodFormat: LEDGERS[name].period.hint,
      })),
    });
  })
);

/* ------------------------------------------------------------------
 * GET /api/ledgers/:ledger
 *   → { store: { "2026-7": [...], … }, meta: { "2026-7": {revision} } }
 *
 *   store 가 프론트 store 와 동일한 형태이므로 그대로 setStore 가능.
 *
 *   ?prefix=2026            2026 년만
 *   ?keys=2026-7,2026-6     지정한 기간만 (원천세 6개월 이력 조회)
 * ------------------------------------------------------------------ */
router.get(
  '/:ledger',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    resolveLedger(ledger);

    const prefix = req.query.prefix ? String(req.query.prefix) : undefined;
    const keys = req.query.keys
      ? String(req.query.keys).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const { store, meta } = await repo.findAll(req.auth.firmId, ledger, { prefix, keys });
    res.json({ ok: true, data: { store, meta } });
  })
);

/* GET /api/ledgers/:ledger/periods — 등록된 기간 목록만 */
router.get(
  '/:ledger/periods',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    resolveLedger(ledger);
    res.json({ ok: true, data: await repo.listPeriods(req.auth.firmId, ledger) });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/ledgers/:ledger  — 여러 기간 일괄 저장
 *   본문: { "2026-7": [...], "2026-8": [...] }
 *   전월 데이터 이관/이월처럼 여러 기간이 함께 바뀌는 경우에 쓴다.
 *   ※ 세부 경로(/:periodKey)보다 먼저 선언해야 라우팅이 겹치지 않는다.
 * ------------------------------------------------------------------ */
router.put(
  '/:ledger',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    resolveLedger(ledger);

    const body = v.requireObject(req.body, '원장 데이터');
    const entries = Object.entries(body).map(([periodKey, payload]) => {
      assertPeriodKey(ledger, periodKey);
      v.requireArray(payload, `기간(${periodKey}) 데이터`);
      return { periodKey, payload };
    });

    if (!entries.length) throw ApiError.badRequest('저장할 기간이 없습니다.');

    const saved = await repo.saveMany(req.auth.firmId, ledger, entries, {
      updatedBy: req.auth.loginId,
    });
    res.json({ ok: true, data: saved, count: saved.length });
  })
);

/* ------------------------------------------------------------------
 * GET /api/ledgers/:ledger/:periodKey
 * ------------------------------------------------------------------ */
router.get(
  '/:ledger/:periodKey',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    const periodKey = assertPeriodKey(ledger, req.params.periodKey);

    const found = await repo.findOne(req.auth.firmId, ledger, periodKey);
    if (!found) {
      /* 데이터가 없는 기간은 에러가 아니다.
       * 프론트는 store[key] === undefined 일 때 EmptyState(이관 안내)를
       * 보여주도록 이미 만들어져 있다. 그 동작을 유지한다. */
      return res.json({ ok: true, data: null });
    }
    res.json({ ok: true, data: found });
  })
);

/* ------------------------------------------------------------------
 * PUT /api/ledgers/:ledger/:periodKey  — 단일 기간 저장
 *   본문: 배열 그대로  또는  { payload: [...], revision: n }
 *
 *   revision 을 함께 보내면 낙관적 잠금이 적용된다.
 *   (다른 담당자가 먼저 저장했으면 409 → 프론트가 재조회)
 * ------------------------------------------------------------------ */
router.put(
  '/:ledger/:periodKey',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    const periodKey = assertPeriodKey(ledger, req.params.periodKey);

    let payload;
    let expectedRevision;

    if (Array.isArray(req.body)) {
      payload = req.body;
    } else {
      const body = v.requireObject(req.body, '원장 데이터');
      payload = v.requireArray(body.payload, '원장 payload');

      /* revision 을 보냈다면 반드시 유효한 값이어야 한다.
       * 조용히 무시하면 낙관적 잠금이 사라진 것을 아무도 모른다. */
      if (body.revision !== undefined && body.revision !== null) {
        expectedRevision = v.optInt(body.revision, { min: 1 });
        if (expectedRevision === null) {
          throw ApiError.badRequest('revision 은 1 이상의 정수여야 합니다.');
        }
      }
    }

    const saved = await repo.save(req.auth.firmId, ledger, periodKey, payload, {
      expectedRevision,
      /* 누가 저장했는지 세션에서 가져온다 — 클라이언트가 위조할 수 없다 */
      updatedBy: req.auth.loginId,
    });
    res.json({ ok: true, data: saved });
  })
);

/* DELETE /api/ledgers/:ledger/:periodKey */
router.delete(
  '/:ledger/:periodKey',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    const periodKey = assertPeriodKey(ledger, req.params.periodKey);

    const ok = await repo.remove(req.auth.firmId, ledger, periodKey);
    if (!ok) throw ApiError.notFound(`${ledger} 원장에 ${periodKey} 기간 데이터가 없습니다.`);
    res.json({ ok: true, data: { periodKey, deleted: true } });
  })
);

/* GET /api/ledgers/:ledger/:periodKey/history — 변경 이력 */
router.get(
  '/:ledger/:periodKey/history',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    const periodKey = assertPeriodKey(ledger, req.params.periodKey);
    const limit = v.optInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
    res.json({ ok: true, data: await repo.history(req.auth.firmId, ledger, periodKey, limit) });
  })
);

/* GET /api/ledgers/:ledger/:periodKey/history/:historyId — 과거 스냅샷 */
router.get(
  '/:ledger/:periodKey/history/:historyId',
  asyncHandler(async (req, res) => {
    const ledger = req.params.ledger;
    const periodKey = assertPeriodKey(ledger, req.params.periodKey);
    const historyId = v.optInt(req.params.historyId, { min: 1 });
    if (!historyId) throw ApiError.badRequest('이력 id 가 올바르지 않습니다.');

    const snap = await repo.historyPayload(req.auth.firmId, ledger, periodKey, historyId);
    if (!snap) throw ApiError.notFound('해당 이력을 찾을 수 없습니다.');
    res.json({
      ok: true,
      data: { payload: snap.payload, revision: snap.revision, savedAt: snap.saved_at },
    });
  })
);

module.exports = router;

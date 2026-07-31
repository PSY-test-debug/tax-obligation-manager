const db = require('../../db/pool');
const ApiError = require('../../lib/ApiError');

/* ==================================================================
 * 세목 원장 repository (5개 세목 공통)
 *
 * payload 는 프론트 store[periodKey] 배열을 그대로 담는다.
 * 서버는 payload 내부 구조를 해석하지 않는다 → 신고 항목이 늘어나도
 * 서버 코드를 고칠 일이 없다.
 * ================================================================== */

/**
 * 세목 전체 조회 → { periodKey: payload } map
 * 프론트 store 와 동일한 형태이므로 응답을 그대로 setStore 에 넣을 수 있다.
 *
 * @param {string} ledger
 * @param {{ prefix?: string, keys?: string[] }} opts
 *        prefix : '2026' → 2026 으로 시작하는 기간만
 *        keys   : 명시한 기간만 (원천세 6개월 롤링 이력 조회 등에 사용)
 */
async function findAll(ledger, { prefix, keys } = {}) {
  const params = [ledger];
  let where = 'WHERE ledger = $1';

  if (Array.isArray(keys) && keys.length) {
    params.push(keys);
    where += ` AND period_key = ANY($${params.length})`;
  } else if (prefix) {
    params.push(`${prefix}%`);
    where += ` AND period_key LIKE $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT period_key, payload, revision, updated_at
       FROM ledgers ${where}
      ORDER BY period_key`,
    params
  );

  const store = {};
  const meta = {};
  for (const r of rows) {
    store[r.period_key] = r.payload;
    meta[r.period_key] = { revision: r.revision, updatedAt: r.updated_at };
  }
  return { store, meta };
}

/** 등록된 기간 키 목록만 (payload 없이 — 목록/네비게이션용) */
async function listPeriods(ledger) {
  const { rows } = await db.query(
    `SELECT period_key, revision, updated_at,
            jsonb_array_length(
              CASE WHEN jsonb_typeof(payload) = 'array' THEN payload ELSE '[]'::jsonb END
            ) AS row_count
       FROM ledgers
      WHERE ledger = $1
      ORDER BY period_key`,
    [ledger]
  );
  return rows.map((r) => ({
    periodKey: r.period_key,
    revision: r.revision,
    updatedAt: r.updated_at,
    rowCount: r.row_count,
  }));
}

async function findOne(ledger, periodKey) {
  const { rows } = await db.query(
    `SELECT period_key, payload, revision, updated_at, updated_by
       FROM ledgers WHERE ledger = $1 AND period_key = $2`,
    [ledger, periodKey]
  );
  if (!rows[0]) return null;
  return {
    periodKey: rows[0].period_key,
    payload: rows[0].payload,
    revision: rows[0].revision,
    updatedAt: rows[0].updated_at,
    updatedBy: rows[0].updated_by,
  };
}

/**
 * 기간 원장 저장(upsert).
 *
 * expectedRevision 이 주어지면 낙관적 잠금을 적용한다.
 * 두 담당자가 같은 달을 동시에 편집할 때, 나중 저장이 앞선 저장을
 * 조용히 덮어쓰는 사고를 막는다. 충돌 시 409 를 던져
 * 프론트가 서버 값을 다시 불러오게 한다.
 */
async function save(ledger, periodKey, payload, { expectedRevision, updatedBy = '' } = {}) {
  return db.transaction(async (client) => {
    const { rows: cur } = await client.query(
      'SELECT revision FROM ledgers WHERE ledger = $1 AND period_key = $2 FOR UPDATE',
      [ledger, periodKey]
    );

    if (cur[0] && Number.isInteger(expectedRevision) && cur[0].revision !== expectedRevision) {
      throw ApiError.conflict(
        '다른 사용자가 이미 이 기간을 저장했습니다. 최신 데이터를 불러온 뒤 다시 저장해주세요.',
        { currentRevision: cur[0].revision, expectedRevision }
      );
    }

    /* revision 은 "내용 버전"이다.
     * payload 가 실제로 바뀌지 않았으면 올리지 않는다.
     * (자동 저장이 같은 내용을 재전송할 때 revision 이 올라가면
     *  다른 담당자에게 불필요한 409 충돌이 발생한다) */
    const { rows } = await client.query(
      `INSERT INTO ledgers (ledger, period_key, payload, revision, updated_by)
       VALUES ($1, $2, $3::jsonb, 1, $4)
       ON CONFLICT (ledger, period_key) DO UPDATE SET
         payload    = EXCLUDED.payload,
         revision   = CASE
                        WHEN ledgers.payload IS DISTINCT FROM EXCLUDED.payload
                        THEN ledgers.revision + 1
                        ELSE ledgers.revision
                      END,
         updated_by = EXCLUDED.updated_by
       RETURNING period_key, payload, revision, updated_at`,
      [ledger, periodKey, JSON.stringify(payload), updatedBy]
    );

    return {
      periodKey: rows[0].period_key,
      payload: rows[0].payload,
      revision: rows[0].revision,
      updatedAt: rows[0].updated_at,
    };
  });
}

/** 여러 기간 일괄 저장 — 하나의 트랜잭션 (이관/이월 처리용) */
async function saveMany(ledger, entries, { updatedBy = '' } = {}) {
  return db.transaction(async (client) => {
    const saved = [];
    for (const { periodKey, payload } of entries) {
      const { rows } = await client.query(
        `INSERT INTO ledgers (ledger, period_key, payload, revision, updated_by)
         VALUES ($1, $2, $3::jsonb, 1, $4)
         ON CONFLICT (ledger, period_key) DO UPDATE SET
           payload    = EXCLUDED.payload,
           revision   = CASE
                          WHEN ledgers.payload IS DISTINCT FROM EXCLUDED.payload
                          THEN ledgers.revision + 1
                          ELSE ledgers.revision
                        END,
           updated_by = EXCLUDED.updated_by
         RETURNING period_key, revision`,
        [ledger, periodKey, JSON.stringify(payload), updatedBy]
      );
      saved.push({ periodKey: rows[0].period_key, revision: rows[0].revision });
    }
    return saved;
  });
}

async function remove(ledger, periodKey) {
  const { rowCount } = await db.query(
    'DELETE FROM ledgers WHERE ledger = $1 AND period_key = $2',
    [ledger, periodKey]
  );
  return rowCount > 0;
}

/** 변경 이력 조회 (최신순) */
async function history(ledger, periodKey, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, revision, saved_by, saved_at
       FROM ledger_history
      WHERE ledger = $1 AND period_key = $2
      ORDER BY saved_at DESC
      LIMIT $3`,
    [ledger, periodKey, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    savedBy: r.saved_by,
    savedAt: r.saved_at,
  }));
}

/** 특정 이력 스냅샷의 payload */
async function historyPayload(ledger, periodKey, historyId) {
  const { rows } = await db.query(
    `SELECT payload, revision, saved_at FROM ledger_history
      WHERE id = $1 AND ledger = $2 AND period_key = $3`,
    [historyId, ledger, periodKey]
  );
  return rows[0] || null;
}

module.exports = {
  findAll,
  listPeriods,
  findOne,
  save,
  saveMany,
  remove,
  history,
  historyPayload,
};

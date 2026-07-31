const { Pool } = require('pg');
const env = require('../config/env');

const pool = new Pool(env.db);

pool.on('error', (err) => {
  /* 유휴 클라이언트에서 발생한 에러는 잡아주지 않으면 프로세스가 죽는다 */
  console.error('[DB] 유휴 커넥션 오류:', err.message);
});

/**
 * 단일 쿼리 실행.
 * 개발 모드에서는 느린 쿼리(100ms 초과)를 로그로 남긴다.
 */
async function query(text, params) {
  const started = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - started;
  if (!env.isProd && ms > 100) {
    console.log(`[DB] ${ms}ms · ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  return res;
}

/**
 * 트랜잭션 실행. 콜백에 클라이언트를 넘긴다.
 *
 *   await transaction(async (c) => {
 *     await c.query('...');
 *     await c.query('...');
 *   });
 *
 * 콜백이 throw 하면 ROLLBACK, 정상 종료하면 COMMIT.
 * 커넥션 반납(release)은 어떤 경우에도 보장된다.
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB] ROLLBACK 실패:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** 서버 기동 시 연결 확인 */
async function checkConnection() {
  const { rows } = await query('SELECT current_database() AS db, now() AS at');
  return rows[0];
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, transaction, checkConnection, close };

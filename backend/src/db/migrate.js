/* ==================================================================
 * 마이그레이션 러너
 *   src/db/sql/*.sql 을 파일명 순서대로 실행하고, 실행 기록을 남긴다.
 *   같은 파일은 두 번 실행하지 않는다.
 *
 *   파일명이 0 으로 시작하는 것(000_*)은 "수동 실행 전용"이므로 건너뛴다.
 *
 *   실행: npm run migrate
 * ================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { transaction, query, close } = require('./pool');

const SQL_DIR = path.join(__dirname, 'sql');

async function ensureMigrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function run() {
  await ensureMigrationTable();

  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('000_')) // 수동 실행 전용
    .sort();

  const { rows } = await query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  let count = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        console.warn(
          `[migrate] ⚠ ${file} 내용이 적용 시점과 다릅니다. ` +
          `이미 반영된 파일은 수정하지 말고 새 파일(예: 002_*.sql)을 추가하세요.`
        );
      }
      continue;
    }

    await transaction(async (c) => {
      await c.query(sql);
      await c.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, checksum]
      );
    });
    console.log(`[migrate] ✓ ${file}`);
    count += 1;
  }

  console.log(count ? `[migrate] ${count}개 적용 완료` : '[migrate] 이미 최신 상태입니다.');
}

if (require.main === module) {
  run()
    .then(() => close())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] 실패:', err.message);
      process.exit(1);
    });
}

module.exports = { run };

const env = require('./config/env');
const db = require('./db/pool');
const createApp = require('./app');

async function main() {
  /* 기동 시 DB 연결을 먼저 확인한다.
   * 기존 server.js 는 DB 가 안 떠 있어도 그냥 리스닝해서,
   * 첫 요청에서야 에러를 알 수 있었다. */
  let info;
  try {
    info = await db.checkConnection();
  } catch (err) {
    console.error('[기동 실패] DB 에 연결할 수 없습니다:', err.message);
    console.error('  · PostgreSQL 이 실행 중인지 확인하세요.');
    console.error('  · server/.env 의 DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD 를 확인하세요.');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log('');
    console.log('  신고의무 관리 시스템 · API 서버');
    console.log(`  주소   http://localhost:${env.port}/api`);
    console.log(`  DB     ${info.db} @ ${env.db.host}:${env.db.port}`);
    console.log(`  모드   ${env.nodeEnv}`);
    console.log(`  CORS   ${env.corsOrigins.join(', ')}`);
    console.log('');
  });

  /* 정상 종료 — 커넥션 풀을 반납한다 */
  const shutdown = async (signal) => {
    console.log(`\n[${signal}] 서버를 종료합니다...`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    /* 10초 안에 닫히지 않으면 강제 종료 */
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});

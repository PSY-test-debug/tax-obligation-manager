require('dotenv').config();

/* 필수 환경변수 검증 — 누락 시 조용히 실패하지 않고 즉시 종료한다.
 * (기존 server.js 는 DB 정보가 비어도 그냥 떠서, 첫 요청에서야 에러가 났다) */
function required(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    console.error(`[설정 오류] 환경변수 ${name} 가 없습니다. server/.env 를 확인하세요.`);
    process.exit(1);
  }
  return v;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),

  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },

  /* CORS 허용 오리진. 쉼표로 여러 개 지정 가능 */
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /* JSON 본문 최대 크기 — 로고가 base64 data URL 이라 기본 100kb 로는 부족하다 */
  jsonLimit: process.env.JSON_LIMIT || '15mb',
};

env.isProd = env.nodeEnv === 'production';

module.exports = env;

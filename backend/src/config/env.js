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

  /* 프록시(nginx 등) 뒤에 둘 때 req.ip 를 실제 클라이언트 IP 로 잡으려면 필요 */
  trustProxy: process.env.TRUST_PROXY === 'true',

  session: {
    cookieName: process.env.SESSION_COOKIE || 'shingo_sid',
    /* 기본 12시간 — 업무일 기준. 활동이 있으면 자동 연장된다(슬라이딩) */
    ttlMs: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
    maxLoginAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),

    /* IP 단위 로그인 시도 제한.
     * 사무실은 보통 공인 IP 하나를 공유(NAT)하므로 너무 낮으면
     * 아침에 로그인이 몰릴 때 정상 사용자가 막힌다.
     * 주 방어선은 계정별 잠금(maxLoginAttempts)이고,
     * 이건 여러 계정을 훑는 공격을 막는 보조 수단이다. */
    loginRateMax: Number(process.env.LOGIN_RATE_MAX || 60),
    loginRateWindowMin: Number(process.env.LOGIN_RATE_WINDOW_MIN || 5),
  },
};

/* 쿠키 옵션 — 한 곳에서만 정의해 설정이 어긋나지 않게 한다 */
env.session.cookieOptions = () => ({
  httpOnly: true,           // JS 에서 읽을 수 없다 → XSS 로 세션 탈취 불가
  sameSite: 'lax',          // 외부 사이트발 요청에 쿠키가 실리지 않는다 (CSRF 1차 방어)
  secure: env.isProd,       // 운영(HTTPS)에서만 secure. 개발 http 에서는 꺼야 쿠키가 저장된다
  path: '/',
});

env.isProd = env.nodeEnv === 'production';

module.exports = env;

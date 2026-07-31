const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const db = require('./db/pool');
const asyncHandler = require('./lib/asyncHandler');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { requireAuth } = require('./middleware/requireAuth');
const originGuard = require('./middleware/originGuard');
const sessions = require('./modules/auth/session.store');

const authRouter = require('./modules/auth/auth.router');
const userRouter = require('./modules/users/user.router');
const vendorRouter = require('./modules/vendors/vendor.router');
const deptAccountRouter = require('./modules/deptAccounts/deptAccount.router');
const firmRouter = require('./modules/firm/firm.router');
const ledgerRouter = require('./modules/ledgers/ledger.router');

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  /* 프록시(nginx 등) 뒤에서 req.ip 를 실제 클라이언트 IP 로 잡는다.
   * 요청 제한이 프록시 IP 하나로 뭉뚱그려지는 것을 막는다. */
  if (env.trustProxy) app.set('trust proxy', 1);

  /* CORS — 쿠키를 주고받으므로 credentials 가 필수다.
   * origin 전체 허용과 credentials 는 함께 쓸 수 없으므로
   * 허용 오리진을 반드시 명시해야 한다. */
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS 차단: ${origin} (server/.env 의 CORS_ORIGIN 확인)`));
      },
      credentials: true,
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: env.jsonLimit }));

  /* CSRF 2차 방어 — 변경 요청의 Origin 검사 */
  app.use(originGuard);

  if (!env.isProd) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => {
        const who = req.auth ? req.auth.loginId : '-';
        console.log(`${res.statusCode} ${req.method} ${req.originalUrl} · ${who} · ${Date.now() - t}ms`);
      });
      next();
    });
  }

  /* ---------------- 인증 불필요 ---------------- */

  /* 헬스 체크 — 모니터링용. 내부 정보는 노출하지 않는다 */
  app.get(
    '/api/health',
    asyncHandler(async (req, res) => {
      await db.checkConnection();
      res.json({ ok: true, status: 'ok' });
    })
  );

  /* 로그인 / 로그아웃 / 세션 확인
   * (auth.router 내부에서 필요한 경로에만 requireAuth 를 건다) */
  app.use('/api/auth', authRouter);

  /* ---------------- 여기부터 전부 인증 필수 ----------------
   * 개별 라우터에 requireAuth 를 붙이지 않고 여기서 한 번에 건다.
   * 라우터를 새로 추가해도 인증을 빠뜨릴 수 없는 구조다. */
  app.use('/api', requireAuth);

  app.use('/api/users', userRouter);
  app.use('/api/vendors', vendorRouter);
  app.use('/api/dept-accounts', deptAccountRouter);
  app.use('/api/firm', firmRouter);
  app.use('/api/ledgers', ledgerRouter);

  /* ---------------- 마무리 ---------------- */
  app.use(notFound);
  app.use(errorHandler);

  /* 만료 세션 정리 — 1시간마다. 별도 스케줄러가 필요 없다. */
  const sweeper = setInterval(() => {
    sessions.purgeExpired().catch((err) => {
      console.error('[세션 정리 실패]', err.message);
    });
  }, 60 * 60 * 1000);
  if (sweeper.unref) sweeper.unref();
  app.locals.sessionSweeper = sweeper;

  return app;
}

module.exports = createApp;

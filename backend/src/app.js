const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const db = require('./db/pool');
const asyncHandler = require('./lib/asyncHandler');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const vendorRouter = require('./modules/vendors/vendor.router');
const deptAccountRouter = require('./modules/deptAccounts/deptAccount.router');
const firmRouter = require('./modules/firm/firm.router');
const ledgerRouter = require('./modules/ledgers/ledger.router');

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  /* CORS — 허용 오리진을 명시한다.
   * 기존 cors() 는 모든 오리진을 허용해서, 홈택스 ID/PW 같은 값을
   * 다루는 API 로는 위험하다. */
  app.use(
    cors({
      origin(origin, cb) {
        /* 같은 서버에서 서빙하거나 curl/Postman 은 origin 이 없다 */
        if (!origin) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS 차단: ${origin} (server/.env 의 CORS_ORIGIN 확인)`));
      },
      credentials: true,
      exposedHeaders: ['X-Revision'],
    })
  );

  /* 로고가 base64 data URL 이라 기본 100kb 로는 사무소 설정 저장이 실패한다 */
  app.use(express.json({ limit: env.jsonLimit }));

  /* 개발 모드 요청 로그 */
  if (!env.isProd) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => {
        console.log(`${res.statusCode} ${req.method} ${req.originalUrl} · ${Date.now() - t}ms`);
      });
      next();
    });
  }

  /* ---------------- 헬스 체크 ---------------- */
  app.get(
    '/api/health',
    asyncHandler(async (req, res) => {
      const info = await db.checkConnection();
      res.json({
        ok: true,
        status: 'ok',
        db: info.db,
        serverTime: info.at,
        env: env.nodeEnv,
      });
    })
  );

  /* ---------------- 도메인 라우터 ---------------- */
  app.use('/api/vendors', vendorRouter);
  app.use('/api/dept-accounts', deptAccountRouter);
  app.use('/api/firm', firmRouter);
  app.use('/api/ledgers', ledgerRouter);

  /* ---------------- 마무리 ---------------- */
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;

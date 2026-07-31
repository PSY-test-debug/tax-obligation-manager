const ApiError = require('../lib/ApiError');
const env = require('../config/env');

/* PostgreSQL 에러 코드 → 사용자에게 보여줄 메시지 매핑
 * 참고: https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_MESSAGES = {
  '23505': { status: 409, code: 'DUPLICATE', message: '이미 등록된 값입니다.' },
  '23503': { status: 400, code: 'FK_VIOLATION', message: '참조하는 대상이 존재하지 않습니다. (담당자 계정을 먼저 등록하세요)' },
  '23514': { status: 400, code: 'CHECK_VIOLATION', message: '허용되지 않는 값입니다.' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: '입력 형식이 올바르지 않습니다.' },
  '42P01': { status: 500, code: 'TABLE_MISSING', message: '테이블이 없습니다. npm run migrate 를 먼저 실행하세요.' },
  '3D000': { status: 500, code: 'DB_MISSING', message: '데이터베이스를 찾을 수 없습니다. .env 의 DB_NAME 을 확인하세요.' },
  '28P01': { status: 500, code: 'DB_AUTH', message: 'DB 인증에 실패했습니다. .env 의 DB_USER / DB_PASSWORD 를 확인하세요.' },
  ECONNREFUSED: { status: 503, code: 'DB_UNREACHABLE', message: 'DB 서버에 연결할 수 없습니다. PostgreSQL 이 실행 중인지 확인하세요.' },
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  /* 1) 의도된 에러 */
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  /* 2) express.json(body-parser) 에러
   *    이걸 처리하지 않으면 잘못된 JSON 이나 용량 초과가 전부 500 으로
   *    떨어져서, 프론트는 원인을 알 수 없다.
   *    특히 사무소 로고(base64)가 JSON_LIMIT 을 넘으면 여기로 온다. */
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      ok: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message:
          '요청 데이터가 너무 큽니다. 로고 이미지 용량을 줄이거나 ' +
          'server/.env 의 JSON_LIMIT 값을 올려주세요.',
        limit: err.limit,
      },
    });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      ok: false,
      error: { code: 'INVALID_JSON', message: '요청 본문이 올바른 JSON 객체 또는 배열이 아닙니다.' },
    });
  }

  /* CORS 차단 */
  if (typeof err.message === 'string' && err.message.startsWith('CORS 차단')) {
    return res.status(403).json({
      ok: false,
      error: { code: 'CORS_BLOCKED', message: err.message },
    });
  }

  /* 3) DB 에러 → 원인을 알려주는 메시지로 변환 */
  const mapped = PG_MESSAGES[err.code];
  if (mapped) {
    if (mapped.status >= 500) {
      console.error(`[DB 오류 ${err.code}]`, err.message);
    }
    return res.status(mapped.status).json({
      ok: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        detail: env.isProd ? undefined : err.detail || err.message,
      },
    });
  }

  /* 4) 예상치 못한 에러 — 서버 로그에 스택을 남기고,
   *    운영 환경에서는 내부 정보를 클라이언트로 흘리지 않는다. */
  console.error('[처리되지 않은 오류]', err);
  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL',
      message: '서버 내부 오류가 발생했습니다.',
      detail: env.isProd ? undefined : err.message,
      stack: env.isProd ? undefined : err.stack,
    },
  });
}

function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.originalUrl} 경로가 없습니다.` },
  });
}

module.exports = { errorHandler, notFound };

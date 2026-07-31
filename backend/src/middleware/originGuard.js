const ApiError = require('../lib/ApiError');
const env = require('../config/env');

/* ==================================================================
 * CSRF 방어 — Origin 검사
 *
 * 쿠키 기반 인증은 CSRF 에 노출된다.
 * 방어를 두 겹으로 둔다.
 *   1) 쿠키 SameSite=Lax  → 외부 사이트발 POST 에 쿠키가 실리지 않는다
 *   2) 여기 Origin 검사   → 1)을 우회하는 경우까지 차단
 *
 * 별도 CSRF 토큰을 두지 않은 이유: 오리진 허용목록이 이미 명시돼 있어
 * 토큰을 추가해도 실질적인 방어력이 늘지 않고, 프론트 변경만 늘어난다.
 * ================================================================== */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');

  /* 브라우저가 아닌 호출(curl·서버 간)은 Origin 이 없다.
   * 이 경우 쿠키가 아니라 Authorization 헤더를 쓰도록 요구한다.
   * → 쿠키만 있고 Origin 이 없는 요청은 거부한다. */
  if (!origin) {
    const hasBearer = (req.get('authorization') || '').startsWith('Bearer ');
    const hasCookie = !!(req.cookies && req.cookies[env.session.cookieName]);
    if (hasCookie && !hasBearer) {
      return next(
        new ApiError(403, 'ORIGIN_REQUIRED', 'Origin 헤더가 없는 쿠키 인증 요청은 허용되지 않습니다.')
      );
    }
    return next();
  }

  if (!env.corsOrigins.includes(origin)) {
    return next(
      new ApiError(403, 'ORIGIN_NOT_ALLOWED', `허용되지 않은 요청 출처입니다: ${origin}`)
    );
  }

  return next();
}

module.exports = originGuard;

const ApiError = require('../lib/ApiError');

/* ==================================================================
 * 간단한 요청 제한 (메모리 기반)
 *
 * 로그인 시도를 IP 단위로 제한한다.
 * 계정 단위 잠금(users.failed_attempts)과 함께 두 겹으로 막는다.
 *   - 계정 잠금 : 특정 계정을 노린 공격
 *   - IP 제한   : 여러 계정을 훑는 공격
 *
 * 단일 프로세스 기준이다. 서버를 여러 대로 늘리면
 * Redis 같은 공유 저장소로 옮겨야 한다.
 * ================================================================== */

function createRateLimit({ windowMs = 60_000, max = 10, message } = {}) {
  const hits = new Map(); // key → { count, resetAt }

  /* 만료 항목 정리 — 메모리 누수 방지 */
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const waitSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(waitSec));
      return next(
        new ApiError(
          429,
          'TOO_MANY_REQUESTS',
          message || `요청이 너무 많습니다. ${waitSec}초 후에 다시 시도해주세요.`
        )
      );
    }

    return next();
  };
}

module.exports = createRateLimit;

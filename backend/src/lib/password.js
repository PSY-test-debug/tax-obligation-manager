const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

/* ==================================================================
 * 비밀번호 해시 — Node 내장 crypto.scrypt
 *
 * bcrypt / argon2 를 쓰지 않은 이유: 네이티브 빌드가 필요해
 * Windows 환경에서 설치가 자주 막힌다. scrypt 는 Node 코어에 있어
 * 추가 의존성이 0이고, 메모리 하드 함수라 GPU 무차별 대입에 강하다.
 *
 * 저장 형식:  scrypt$N$r$p$saltB64$hashB64
 * ================================================================== */

/* OWASP 권장(2023) 기준. N=2^16, r=8, p=1 → 약 64MB 메모리 사용 */
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/* scrypt 는 maxmem 기본값(32MB)을 넘으면 실패한다.
 * 필요 메모리는 대략 128 * N * r 바이트다. */
const MAXMEM = 128 * N * R * 2;

/** 평문 → 저장용 해시 문자열 */
async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('비밀번호가 비어 있습니다.');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [
    'scrypt', N, R, P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * 검증. 저장된 문자열에서 파라미터를 읽으므로
 * 나중에 N 을 올려도 기존 해시가 그대로 검증된다.
 */
async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch (_) {
    return false;
  }

  let actual;
  try {
    actual = await scrypt(plain, salt, expected.length, {
      N: n, r, p, maxmem: 128 * n * r * 2,
    });
  } catch (_) {
    return false;
  }

  /* 타이밍 공격 방어 — 길이가 다르면 비교 자체가 예외를 던지므로 먼저 확인 */
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * 비밀번호 강도 검사.
 * 홈택스 ID/PW 를 담는 시스템이라 최소 기준을 강제한다.
 * @returns {string|null} 문제가 있으면 사유, 없으면 null
 */
function checkPasswordStrength(plain, { loginId } = {}) {
  if (typeof plain !== 'string' || plain.length < 10) {
    return '비밀번호는 10자 이상이어야 합니다.';
  }
  if (plain.length > 200) {
    return '비밀번호가 너무 깁니다. (200자 이하)';
  }
  const kinds =
    (/[a-z]/.test(plain) ? 1 : 0) +
    (/[A-Z]/.test(plain) ? 1 : 0) +
    (/[0-9]/.test(plain) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(plain) ? 1 : 0);
  if (kinds < 3) {
    return '영문 대문자·소문자·숫자·특수문자 중 3종류 이상을 포함해야 합니다.';
  }
  if (loginId && plain.toLowerCase().includes(String(loginId).toLowerCase())) {
    return '비밀번호에 아이디를 포함할 수 없습니다.';
  }
  if (/^(.)\1+$/.test(plain)) {
    return '같은 문자만 반복할 수 없습니다.';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, checkPasswordStrength };

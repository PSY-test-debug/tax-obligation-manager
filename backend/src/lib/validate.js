const ApiError = require('./ApiError');

/* ==================================================================
 * 최소 검증 유틸 — 외부 의존성 없이 필요한 만큼만.
 * (zod/joi 를 넣지 않은 이유: Windows 환경 초기 세팅을 단순하게 유지)
 * ================================================================== */

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 본문이 객체인지 확인 */
function requireObject(body, label = '요청 본문') {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest(`${label}은 JSON 객체여야 합니다.`);
  }
  return body;
}

/** 본문이 배열인지 확인 */
function requireArray(body, label = '요청 본문') {
  if (!Array.isArray(body)) {
    throw ApiError.badRequest(`${label}은 JSON 배열이어야 합니다.`);
  }
  return body;
}

/** 비어 있지 않은 문자열 */
function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(`${label}은 필수 값입니다.`);
  }
  return value.trim();
}

/** 허용 목록 검사 */
function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw ApiError.badRequest(
      `${label} 값이 올바르지 않습니다. (허용: ${allowed.join(', ')})`
    );
  }
  return value;
}

/**
 * 식별자 검증.
 * 업체 id / 부서계정 id / period_key 는 URL 경로에 들어가므로
 * 제어문자·경로문자를 걸러낸다. 한글은 허용해야 한다('2026-1-예정').
 */
const ID_RE = /^[\w가-힣-]{1,64}$/u;

function requireId(value, label = 'id') {
  const s = requireString(value, label);
  if (!ID_RE.test(s)) {
    throw ApiError.badRequest(
      `${label} 형식이 올바르지 않습니다. (영문·숫자·한글·_·- 만, 64자 이내)`
    );
  }
  return s;
}

/** 정수 (범위 옵션) */
function optInt(value, { min, max, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

module.exports = {
  isPlainObject,
  requireObject,
  requireArray,
  requireString,
  requireEnum,
  requireId,
  optInt,
};

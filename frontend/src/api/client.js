/* ==================================================================
 * API 클라이언트
 *   모든 서버 통신은 이 파일을 거친다.
 *   서버 응답 규약: { ok: true, data } | { ok: false, error: {code, message} }
 * ================================================================== */

/* CRA(react-scripts)면 REACT_APP_, Vite면 VITE_ 접두사를 쓴다.
 * 어느 쪽이든 동작하도록 둘 다 확인한다. */
function resolveBase() {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE) {
      return process.env.REACT_APP_API_BASE;
    }
  } catch (_) { /* noop */ }
  try {
    // eslint-disable-next-line no-undef
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) {
      // eslint-disable-next-line no-undef
      return import.meta.env.VITE_API_BASE;
    }
  } catch (_) { /* noop */ }
  return 'http://localhost:5000/api';
}

export const API_BASE = resolveBase();

/** 서버가 내려준 에러를 그대로 담는 예외 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** 낙관적 잠금 충돌 — 최신 데이터를 다시 불러와야 하는 상황 */
  get isConflict() {
    return this.status === 409;
  }
  /** 미인증 · 세션 만료 — 로그인 화면으로 보내야 하는 상황 */
  get isUnauthenticated() {
    return this.status === 401;
  }
  /** 권한 부족 */
  get isForbidden() {
    return this.status === 403;
  }
  /** 네트워크 단절 (서버 미기동 등) */
  get isOffline() {
    return this.code === 'NETWORK';
  }
}

/**
 * 사람이 읽을 수 있는 메시지로 변환.
 * 화면 토스트에 그대로 쓸 수 있어야 한다.
 */
export function describeError(err) {
  if (err instanceof ApiError) {
    if (err.isOffline) return 'API 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.';
    return err.message;
  }
  return err && err.message ? err.message : '알 수 없는 오류가 발생했습니다.';
}

/* ------------------------------------------------------------------
 * 세션 만료 알림
 *
 * 어느 API 든 401 을 받으면 여기서 구독자에게 알린다.
 * useAuth 가 이를 받아 로그인 화면으로 되돌린다.
 * 각 훅이 개별적으로 401 을 처리하지 않아도 된다.
 * ------------------------------------------------------------------ */
const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized(err) {
  for (const h of unauthorizedHandlers) {
    try { h(err); } catch (_) { /* 구독자 오류가 요청 흐름을 막지 않게 */ }
  }
}

async function request(method, path, body, opts = {}) {
  const url = `${API_BASE}${path}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
      /* 세션 쿠키를 주고받는다.
       * 이게 없으면 로그인은 되지만 이후 요청에 쿠키가 실리지 않아
       * 전부 401 이 된다. 프론트 연동에서 가장 흔한 실수 지점이다. */
      credentials: 'include',
    });
  } catch (err) {
    /* AbortError 는 호출자가 의도한 취소이므로 그대로 올린다 */
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', `서버에 연결할 수 없습니다: ${url}`);
  }

  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    /* 본문이 비어 있을 수 있다 */
  }

  if (!res.ok || !json || json.ok === false) {
    const e = (json && json.error) || {};
    const err = new ApiError(
      res.status,
      e.code || 'UNKNOWN',
      e.message || `요청 실패 (${res.status})`,
      e
    );

    /* 세션 만료는 전역으로 알린다.
     * 단, 세션 확인/로그인 요청 자체는 제외한다(무한 루프 방지). */
    if (err.status === 401 && !opts.skipAuthNotify) notifyUnauthorized(err);

    throw err;
  }

  return json.data;
}

export const http = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

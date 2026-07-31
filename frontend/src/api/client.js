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

async function request(method, path, body, opts = {}) {
  const url = `${API_BASE}${path}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.actor ? { 'X-Actor': opts.actor } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
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
    throw new ApiError(
      res.status,
      e.code || 'UNKNOWN',
      e.message || `요청 실패 (${res.status})`,
      e
    );
  }

  return json.data;
}

export const http = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

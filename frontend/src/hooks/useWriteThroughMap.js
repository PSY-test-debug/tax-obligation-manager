import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ==================================================================
 * useWriteThroughMap — 모든 스토어(7개)가 공유하는 단일 동기화 엔진
 *
 * 설계 의도
 *  1) useState 와 동일한 시그니처를 제공한다.
 *     기존 코드의 setStore((s) => ({...s, [key]: ...})) 를 한 줄도
 *     고치지 않고 그대로 쓸 수 있어야 한다.
 *
 *  2) 로컬 state 는 즉시 갱신하고(UI 무지연), 서버 저장은 debounce 한다.
 *     이 화면은 행×열 체크박스가 수십 개다. 셀마다 API 를 호출하면
 *     요청이 폭발하고 클릭 반응도 느려진다.
 *     → 편집이 멈춘 뒤 한 번에, 그리고 "바뀐 키만" 저장한다.
 *
 *  3) 저장 대상 판별은 "마지막으로 서버와 일치했던 스냅샷(baseline)"과
 *     비교한다. 서버 응답과 비교하지 않는 이유:
 *     PostgreSQL jsonb 는 객체 키 순서를 보존하지 않으므로
 *     서버 응답과 텍스트 비교를 하면 매번 변경으로 오판한다.
 *
 * 반환값
 *   value    현재 데이터 (map)
 *   setValue useState 와 동일 (값 또는 updater 함수)
 *   status   'loading' | 'ready' | 'error'
 *   saving   저장 진행 중 여부
 *   error    조회 실패 시 에러
 *   reload() 서버에서 다시 불러오기 (로컬 변경 폐기)
 *   flush()  debounce 대기 중인 저장을 즉시 실행 (페이지 이탈 전 등)
 * ================================================================== */

const DEFAULT_DEBOUNCE = 600;

/** 키 순서를 무시한 값 비교 (jsonb 왕복 대응) */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * @param {object}   options
 * @param {Function} options.load      () => Promise<map>            전체 조회
 * @param {Function} options.upsert    (key, value) => Promise<any>   단건 저장
 * @param {Function} options.remove    (key) => Promise<any>          단건 삭제
 * @param {number}   [options.debounceMs]
 * @param {Function} [options.onError] (err, phase) => void  phase: 'load' | 'save'
 * @param {boolean}  [options.enabled] false 면 조회하지 않는다(로그인 전 등)
 */
export function useWriteThroughMap({
  load,
  upsert,
  remove,
  debounceMs,
  onError,
  enabled = true,
}) {
  /* 명시하지 않으면 기본값 사용 (undefined 가 넘어와도 안전) */
  const wait = Number.isFinite(debounceMs) ? debounceMs : DEFAULT_DEBOUNCE;

  const [value, setValueRaw] = useState({});
  const [status, setStatus] = useState(enabled ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /* 서버와 일치한다고 알고 있는 스냅샷 — 변경 판별 기준 */
  const baselineRef = useRef({});
  /* 최신 value (debounce 콜백이 오래된 값을 보지 않도록) */
  const latestRef = useRef({});
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  /* 저장이 겹치지 않게 직렬화 */
  const savingChainRef = useRef(Promise.resolve());

  /* onError / load 등이 매 렌더마다 새 함수여도 effect 가 재실행되지 않도록 */
  const fnRef = useRef({ load, upsert, remove, onError });
  fnRef.current = { load, upsert, remove, onError };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /* ---------------- 조회 ---------------- */
  const reload = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    setError(null);
    try {
      const data = (await fnRef.current.load()) || {};
      if (!mountedRef.current) return;
      baselineRef.current = data;
      latestRef.current = data;
      setValueRaw(data);
      setStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
      setStatus('error');
      if (fnRef.current.onError) fnRef.current.onError(err, 'load');
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  /* ---------------- 저장 ---------------- */
  const persist = useCallback(async () => {
    const next = latestRef.current;
    const base = baselineRef.current;

    /* 변경된 키 / 삭제된 키 계산 */
    const changed = [];
    for (const key of Object.keys(next)) {
      if (!deepEqual(next[key], base[key])) changed.push(key);
    }
    const removed = Object.keys(base).filter(
      (key) => !Object.prototype.hasOwnProperty.call(next, key)
    );

    if (!changed.length && !removed.length) return;

    setSaving(true);
    try {
      /* 삭제를 먼저 처리 — 같은 키를 지웠다가 다시 만드는 순서 문제를 피한다 */
      for (const key of removed) {
        if (fnRef.current.remove) await fnRef.current.remove(key);
        /* 성공한 항목만 baseline 에서 제거 → 실패 시 다음 저장에 재시도 */
        const nb = { ...baselineRef.current };
        delete nb[key];
        baselineRef.current = nb;
      }

      for (const key of changed) {
        const saved = await fnRef.current.upsert(key, next[key]);
        /* 서버가 정규화한 값을 baseline 으로 삼는다.
         * (서버가 기본값을 채우거나 필드를 보정할 수 있다) */
        baselineRef.current = {
          ...baselineRef.current,
          [key]: saved === undefined ? next[key] : saved,
        };
      }
    } catch (err) {
      /* 저장 실패한 키는 baseline 에 반영되지 않았으므로
       * 다음 편집(또는 flush) 시 자동으로 재시도된다. */
      if (fnRef.current.onError) fnRef.current.onError(err, 'save');

      /* 낙관적 잠금 충돌 → 서버 값으로 맞춘다.
       * instanceof 로 판별하지 않는 이유: 번들 분할이나 모듈 중복 로드로
       * 클래스 동일성이 깨질 수 있다. 상태 코드로 보는 편이 견고하다. */
      if (err && (err.status === 409 || err.code === 'CONFLICT')) {
        await reload();
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [reload]);

  const schedulePersist = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      /* 이전 저장이 끝난 뒤 실행 — 요청 순서를 보장한다 */
      savingChainRef.current = savingChainRef.current.then(persist).catch(() => {});
    }, wait);
  }, [persist, wait]);

  /** debounce 대기 중인 저장을 즉시 실행하고 완료를 기다린다 */
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    savingChainRef.current = savingChainRef.current.then(persist).catch(() => {});
    await savingChainRef.current;
  }, [persist]);

  /* ---------------- setValue (useState 호환) ---------------- */
  const setValue = useCallback(
    (updater) => {
      setValueRaw((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        latestRef.current = next;
        return next;
      });
      schedulePersist();
    },
    [schedulePersist]
  );

  /* 브라우저 종료·새로고침 직전 저장 시도.
   * 완전한 보장은 불가능하지만(비동기), debounce 대기 중인 변경을 잃을
   * 확률을 크게 줄인다. 자동저장 간격이 600ms 라 실사용에서 충분하다. */
  useEffect(() => {
    const onBeforeUnload = (e) => {
      const hasPending = !!timerRef.current;
      if (hasPending) {
        flush();
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
      return undefined;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush]);

  return useMemo(
    () => ({ value, setValue, status, saving, error, reload, flush }),
    [value, setValue, status, saving, error, reload, flush]
  );
}

export { deepEqual };

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWriteThroughMap } from './useWriteThroughMap';
import { vendorsApi, deptAccountsApi, firmApi, ledgerApi } from '../api/endpoints';

/* ==================================================================
 * 도메인별 훅 — 전부 useWriteThroughMap 하나를 재사용한다.
 * 각 훅은 "무엇을 불러오고 무엇을 저장하는지"만 정의한다.
 * ================================================================== */

/* ------------------------------------------------------------------
 * 1. 총괄업체 (Dashboard.profiles)
 *
 *    사용:
 *      const { value: profiles, setValue: setProfiles } = useVendors({ onError });
 *
 *    setProfiles 는 useState 와 동일하게 동작하므로
 *    saveProfile / addCompany / deleteCompany 로직을 고칠 필요가 없다.
 * ------------------------------------------------------------------ */
export function useVendors({ onError, enabled = true, debounceMs } = {}) {
  return useWriteThroughMap({
    enabled,
    onError,
    debounceMs,
    load: useCallback(() => vendorsApi.list(), []),
    upsert: useCallback((id, profile) => vendorsApi.save(id, profile), []),
    remove: useCallback((id) => vendorsApi.remove(id), []),
  });
}

/* ------------------------------------------------------------------
 * 2. 홈택스 부서 계정 (Dashboard.deptAccounts)
 * ------------------------------------------------------------------ */
export function useDeptAccounts({ onError, enabled = true, debounceMs } = {}) {
  return useWriteThroughMap({
    enabled,
    onError,
    debounceMs,
    load: useCallback(() => deptAccountsApi.list(), []),
    upsert: useCallback((id, account) => deptAccountsApi.save(id, account), []),
    remove: useCallback((id) => deptAccountsApi.remove(id), []),
  });
}

/* ------------------------------------------------------------------
 * 3. 세목 원장 (원천세 / 부가세 / 종소세 / 법인세 / 미수금)
 *
 *    사용:
 *      const { value: store, setValue: setStore } = useLedger('wht', { onError });
 *
 *    revision 을 내부적으로 추적해 낙관적 잠금을 적용한다.
 *    다른 담당자가 먼저 저장했으면 409 → 자동으로 서버 값 재조회.
 *
 * ★ prefix 주의 ★
 *    원천세(wht)는 기간을 넘나들며 파생 판정을 한다.
 *      · 2·3월 지급명세서  → 전년(1~12월) 전체를 스캔
 *      · 반기 간이지급명세서 → 전년 하반기 또는 당해 상반기
 *      · 과거 6개월 이력    → 연도 경계를 넘음
 *    prefix 로 특정 연도만 불러오면 이 판정이 "조용히" 틀린다.
 *    오류가 나지 않고 그냥 신고 필요 표시가 안 뜨기 때문에 발견이 늦다.
 *    원천세에는 prefix 를 쓰지 말 것.
 * ------------------------------------------------------------------ */

/** 기간 교차 판정이 필요해 전체 로드가 필수인 세목 */
const CROSS_PERIOD_LEDGERS = new Set(['wht']);

export function useLedger(ledger, { onError, enabled = true, prefix, debounceMs } = {}) {
  if (prefix && CROSS_PERIOD_LEDGERS.has(ledger)) {
    /* 개발 중에만 경고 — 운영 빌드에서는 조용히 넘어간다 */
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[useLedger] '${ledger}' 에 prefix='${prefix}' 를 지정했습니다. ` +
        '원천세는 전년도 데이터를 스캔해 2·3월 지급명세서와 반기 간이지급명세서 ' +
        '신고여부를 판정하므로, 기간을 제한하면 판정이 틀립니다. prefix 를 제거하세요.'
      );
    }
  }

  /* periodKey → revision */
  const revisionsRef = useRef({});

  const load = useCallback(async () => {
    const res = await ledgerApi.list(ledger, prefix ? { prefix } : {});
    const store = (res && res.store) || {};
    const meta = (res && res.meta) || {};
    revisionsRef.current = Object.fromEntries(
      Object.entries(meta).map(([k, m]) => [k, m.revision])
    );
    return store;
  }, [ledger, prefix]);

  const upsert = useCallback(
    async (periodKey, rows) => {
      const rev = revisionsRef.current[periodKey];
      const saved = await ledgerApi.save(ledger, periodKey, rows, rev);
      if (saved && typeof saved.revision === 'number') {
        revisionsRef.current[periodKey] = saved.revision;
      }
      /* 서버가 돌려준 payload 를 baseline 으로 사용 */
      return saved && saved.payload ? saved.payload : rows;
    },
    [ledger]
  );

  const remove = useCallback(
    async (periodKey) => {
      await ledgerApi.remove(ledger, periodKey);
      delete revisionsRef.current[periodKey];
    },
    [ledger]
  );

  return useWriteThroughMap({ enabled, onError, debounceMs, load, upsert, remove });
}

/* ------------------------------------------------------------------
 * 4. 사무소 설정 — 단일 객체이므로 map 엔진을 쓰지 않는다.
 *
 *    프론트 초기값과 동일한 빈 객체를 기본값으로 둔다.
 *    (firm.logo / firm.taxbotId 등을 조건 없이 참조하는 코드가 있으므로
 *     로딩 중에도 객체 형태가 유지되어야 한다)
 * ------------------------------------------------------------------ */
const EMPTY_FIRM = {
  name: '', bizNo: '', ceo: '', bank: '', account: '', phone: '',
  taxbotId: '', taxbotPw: '', logo: '', invoiceLogo: '',
};

export function useFirm({ onError, enabled = true } = {}) {
  const [firm, setFirm] = useState(EMPTY_FIRM);
  const [status, setStatus] = useState(enabled ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const data = await firmApi.get();
      if (!mountedRef.current) return;
      setFirm({ ...EMPTY_FIRM, ...(data || {}) });
      setStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      if (onErrorRef.current) onErrorRef.current(err, 'load');
    }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * 저장.
   * 사무소 설정은 모달에서 "저장" 버튼을 누를 때만 바뀌므로
   * debounce 없이 즉시 저장하는 것이 맞다.
   */
  const save = useCallback(async (next) => {
    setSaving(true);
    /* 낙관적 갱신 — 저장 실패 시 되돌린다 */
    const prev = firm;
    setFirm({ ...EMPTY_FIRM, ...next });
    try {
      const saved = await firmApi.save(next);
      if (mountedRef.current && saved) setFirm({ ...EMPTY_FIRM, ...saved });
      return true;
    } catch (err) {
      if (mountedRef.current) setFirm(prev);
      if (onErrorRef.current) onErrorRef.current(err, 'save');
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [firm]);

  return useMemo(
    () => ({ firm, setFirm, save, status, saving, reload }),
    [firm, save, status, saving, reload]
  );
}

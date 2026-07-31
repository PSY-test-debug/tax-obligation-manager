import { http } from './client';

/* ==================================================================
 * 엔드포인트 래퍼
 *   컴포넌트/훅은 URL 문자열을 직접 다루지 않는다.
 *   경로가 바뀌면 이 파일만 수정한다.
 * ================================================================== */

/* ---------------- 총괄업체 (프론트 profiles) ---------------- */
export const vendorsApi = {
  /** → { [id]: profile } — 프론트 profiles 와 동일한 형태 */
  list: (opts) => http.get('/vendors', opts),
  get: (id, opts) => http.get(`/vendors/${encodeURIComponent(id)}`, opts),
  create: (profile, opts) => http.post('/vendors', profile, opts),
  save: (id, profile, opts) => http.put(`/vendors/${encodeURIComponent(id)}`, profile, opts),
  remove: (id, opts) => http.del(`/vendors/${encodeURIComponent(id)}`, opts),
  restore: (id, opts) => http.post(`/vendors/${encodeURIComponent(id)}/restore`, undefined, opts),
};

/* ---------------- 홈택스 부서 계정 (담당자) ---------------- */
export const deptAccountsApi = {
  /** → { [deptId]: account } */
  list: (opts) => http.get('/dept-accounts', opts),
  save: (id, account, opts) => http.put(`/dept-accounts/${encodeURIComponent(id)}`, account, opts),
  saveAll: (map, opts) => http.put('/dept-accounts', map, opts),
  remove: (id, opts) => http.del(`/dept-accounts/${encodeURIComponent(id)}`, opts),
};

/* ---------------- 사무소 설정 ---------------- */
export const firmApi = {
  get: (opts) => http.get('/firm', opts),
  save: (firm, opts) => http.put('/firm', firm, opts),
};

/* ---------------- 세목 원장 (5종 공통) ---------------- */

/** 프론트 스토어 ↔ 서버 세목명 매핑 */
export const LEDGER = {
  WHT: 'wht',       // 원천세   · Dashboard.store
  VAT: 'vat',       // 부가가치세 · Dashboard.vatStore
  INCOME: 'income', // 종합소득세 · Dashboard.jongStore
  CORP: 'corp',     // 법인세   · Dashboard.corpStore
  AR: 'ar',         // 미수금   · ReceivablesTab.store
};

export const ledgerApi = {
  /**
   * 세목 전체(또는 일부) 조회
   * → { store: { [periodKey]: rows[] }, meta: { [periodKey]: {revision} } }
   *
   * @param {{ prefix?: string, keys?: string[] }} filter
   */
  list(ledger, filter = {}, opts) {
    const qs = new URLSearchParams();
    if (filter.prefix) qs.set('prefix', filter.prefix);
    if (filter.keys && filter.keys.length) qs.set('keys', filter.keys.join(','));
    const q = qs.toString();
    return http.get(`/ledgers/${ledger}${q ? `?${q}` : ''}`, opts);
  },

  /** 단일 기간 조회 → { periodKey, payload, revision } | null */
  get: (ledger, periodKey, opts) =>
    http.get(`/ledgers/${ledger}/${encodeURIComponent(periodKey)}`, opts),

  /**
   * 단일 기간 저장.
   * revision 을 넘기면 낙관적 잠금이 적용된다(다른 담당자가 먼저 저장 → 409).
   */
  save: (ledger, periodKey, payload, revision, opts) =>
    http.put(
      `/ledgers/${ledger}/${encodeURIComponent(periodKey)}`,
      revision ? { payload, revision } : payload,
      opts
    ),

  /** 여러 기간 일괄 저장 — { periodKey: rows[] } (이관/이월용) */
  saveMany: (ledger, storeSlice, opts) => http.put(`/ledgers/${ledger}`, storeSlice, opts),

  remove: (ledger, periodKey, opts) =>
    http.del(`/ledgers/${ledger}/${encodeURIComponent(periodKey)}`, opts),

  /** 변경 이력 */
  history: (ledger, periodKey, opts) =>
    http.get(`/ledgers/${ledger}/${encodeURIComponent(periodKey)}/history`, opts),
};

/* ---------------- 헬스 체크 ---------------- */
export const healthApi = {
  check: (opts) => http.get('/health', opts),
};

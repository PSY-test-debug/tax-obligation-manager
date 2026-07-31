import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../api/endpoints';
import { onUnauthorized, describeError } from '../api/client';

/* ==================================================================
 * useAuth — 로그인 세션 관리
 *
 *   status
 *     'checking'  최초 세션 확인 중 (새로고침 직후)
 *     'anon'      미로그인 → 로그인 화면
 *     'authed'    로그인됨 → 대시보드
 *
 *   user  { loginId, name, role, deptId, mustChangePw, firmName }
 *
 * 세션은 httpOnly 쿠키에 있어 JS 가 읽을 수 없다.
 * 따라서 "로그인 여부"는 서버에 물어봐야 한다(/auth/me).
 * ================================================================== */

export function useAuth() {
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);
  const [firm, setFirm] = useState(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ---------- 최초 세션 확인 ---------- */
  const check = useCallback(async () => {
    try {
      const data = await authApi.me();
      if (!mountedRef.current) return;
      if (data && data.user) {
        setUser(data.user);
        setFirm(data.firm || null);
        setStatus('authed');
      } else {
        setUser(null);
        setStatus('anon');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      /* 서버가 꺼져 있어도 로그인 화면은 보여준다.
       * 여기서 멈추면 사용자는 빈 화면만 보게 된다. */
      setUser(null);
      setStatus('anon');
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  /* ---------- 세션 만료 자동 감지 ----------
   * 어느 API 든 401 을 받으면 로그인 화면으로 되돌린다.
   * 각 훅이 개별적으로 처리하지 않아도 된다. */
  useEffect(() => {
    return onUnauthorized(() => {
      if (!mountedRef.current) return;
      setUser(null);
      setStatus('anon');
      setError('세션이 만료되었습니다. 다시 로그인해주세요.');
    });
  }, []);

  /* ---------- 로그인 ---------- */
  const login = useCallback(async (loginId, password) => {
    setError('');
    try {
      const data = await authApi.login(loginId, password);
      if (!mountedRef.current) return { ok: true };
      setUser(data.user);
      setFirm(data.firm || null);
      setStatus('authed');
      return { ok: true, user: data.user };
    } catch (err) {
      if (mountedRef.current) setError(describeError(err));
      return { ok: false, message: describeError(err) };
    }
  }, []);

  /* ---------- 로그아웃 ---------- */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (_) {
      /* 서버 오류여도 로컬 상태는 정리한다 */
    }
    if (!mountedRef.current) return;
    setUser(null);
    setFirm(null);
    setStatus('anon');
    setError('');
  }, []);

  /* ---------- 비밀번호 변경 ---------- */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      await authApi.changePassword(currentPassword, newPassword);
      if (mountedRef.current) {
        /* 변경이 강제된 상태였다면 해제된다 */
        setUser((u) => (u ? { ...u, mustChangePw: false } : u));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describeError(err) };
    }
  }, []);

  /* ---------- 편의 값 ---------- */
  const isAdmin = !!user && user.role === 'admin';

  /* 담당자는 자기 부서계정에 고정된다.
   * Dashboard 의 viewAsDept 초기값으로 쓴다. */
  const fixedDeptId = user && user.role === 'staff' ? user.deptId : null;

  return useMemo(
    () => ({
      status, user, firm, error, isAdmin, fixedDeptId,
      login, logout, changePassword, recheck: check,
      clearError: () => setError(''),
    }),
    [status, user, firm, error, isAdmin, fixedDeptId, login, logout, changePassword, check]
  );
}

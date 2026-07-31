/* ==================================================================
 * 인증 · 권한 · 사무소 분리 검증
 *   실행: node scripts/verify-auth.js   (서버가 떠 있어야 함)
 * ================================================================== */
const BASE = process.env.VERIFY_BASE || 'http://localhost:5097/api';
const ORIGIN = process.env.VERIFY_ORIGIN || 'http://localhost:3000';

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${extra ? ' · ' + extra : ''}`); }
  else { fail += 1; console.log(`  ✗ ${label}${extra ? ' · ' + extra : ''}`); }
};

/** 쿠키 항아리(브라우저 흉내) */
function makeJar() {
  const cookies = new Map();
  return {
    header: () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (v === '') cookies.delete(k);
        else cookies.set(k, v);
      }
    },
    get size() { return cookies.size; },
    raw: cookies,
  };
}

async function req(method, path, body, { jar, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (origin) h.Origin = origin;
  if (jar && jar.size) h.Cookie = jar.header();

  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (jar) jar.absorb(res);
  let json = null;
  try { json = await res.json(); } catch (_) { /* 본문 없음 */ }
  return { status: res.status, body: json, headers: res.headers };
}

async function main() {
  console.log('\n=== 1. 인증 없는 접근 차단 ===');
  {
    const paths = ['/vendors', '/dept-accounts', '/firm', '/ledgers/wht', '/users'];
    for (const p of paths) {
      const r = await req('GET', p);
      ok(`GET ${p} → 401`, r.status === 401, r.body?.error?.code);
    }
    const w = await req('PUT', '/ledgers/wht/2026-7', []);
    ok('PUT /ledgers/wht/2026-7 → 401', w.status === 401, w.body?.error?.code);

    const d = await req('DELETE', '/vendors/c1');
    ok('DELETE /vendors/c1 → 401', d.status === 401);

    /* 헬스 체크는 열려 있어야 한다(모니터링용) */
    const h = await req('GET', '/health');
    ok('GET /health 는 인증 불필요', h.status === 200);
  }

  console.log('\n=== 2. 위조 토큰 거부 ===');
  {
    const fakeJar = makeJar();
    fakeJar.raw.set('shingo_sid', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const r = await req('GET', '/vendors', undefined, { jar: fakeJar });
    ok('임의 쿠키 → 401', r.status === 401, r.body?.error?.code);

    const b = await req('GET', '/vendors', undefined, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    ok('임의 Bearer → 401', b.status === 401);
  }

  console.log('\n=== 3. 로그인 ===');
  const admin = makeJar();
  {
    const bad = await req('POST', '/auth/login', { loginId: 'parksy', password: 'wrong-password' });
    ok('오답 → 401', bad.status === 401, bad.body?.error?.code);
    ok('실패 메시지가 계정 존재를 노출하지 않음',
      bad.body?.error?.message === '아이디 또는 비밀번호가 올바르지 않습니다.',
      bad.body?.error?.message);

    const noUser = await req('POST', '/auth/login', { loginId: 'nobody-here', password: 'x' });
    ok('없는 아이디도 동일 메시지',
      noUser.body?.error?.message === bad.body?.error?.message);

    const r = await req('POST', '/auth/login', { loginId: 'parksy', password: 'Dasol!2026tnc' }, { jar: admin });
    ok('정답 → 200', r.status === 200, r.body?.error?.message);
    ok('역할 admin', r.body?.data?.user?.role === 'admin');
    ok('이름 반환', r.body?.data?.user?.name === '박상용');
    ok('세션 쿠키 발급', admin.size > 0, [...admin.raw.keys()].join(','));

    /* 쿠키 보안 속성 */
    const setCookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).join(';');
    ok('HttpOnly (JS 접근 차단)', /HttpOnly/i.test(setCookie));
    ok('SameSite=Lax (CSRF 1차 방어)', /SameSite=Lax/i.test(setCookie));

    /* 비밀번호 해시가 응답에 섞이지 않아야 한다 */
    ok('응답에 비밀번호 정보 없음', !JSON.stringify(r.body).match(/scrypt|password_hash|passwordHash/i));
  }

  console.log('\n=== 4. 로그인 후 기존 API 정상 동작 ===');
  {
    const v = await req('GET', '/vendors', undefined, { jar: admin });
    ok('GET /vendors 200', v.status === 200);
    ok('업체 14건', Object.keys(v.body.data).length === 14, `${Object.keys(v.body.data).length}건`);
    ok('camelCase 유지', v.body.data.c1?.bizNo === '128-90-45123', v.body.data.c1?.bizNo);
    ok('표시 순서 유지', Object.keys(v.body.data)[0] === 'c1');

    /* 원장 데이터를 직접 만들어 확인한다(앞선 검증 상태에 의존하지 않는다) */
    await req('PUT', '/ledgers/wht/2026-7',
      [{ id: 'c1', name: '가온한의원', filings: { 원천세: '완료' } }], { jar: admin });

    const l = await req('GET', '/ledgers/wht', undefined, { jar: admin });
    ok('원장 조회 200', l.status === 200);
    ok('원장 저장·조회', !!l.body.data.store['2026-7']);
    ok('payload 무결(한글 키)', l.body.data.store['2026-7'][0].filings.원천세 === '완료');

    const f = await req('GET', '/firm', undefined, { jar: admin });
    ok('사무소 설정 조회', f.status === 200);

    /* 저장 후 updated_by 가 세션에서 채워지는지 */
    await req('PUT', '/ledgers/wht/2026-7', [{ id: 'c1', filings: { 원천세: '완료', 사업간이: '미신고' } }], { jar: admin });
    const one = await req('GET', '/ledgers/wht/2026-7', undefined, { jar: admin });
    ok('updatedBy 를 세션에서 기록', one.body.data.updatedBy === 'parksy', one.body.data.updatedBy);
  }

  console.log('\n=== 5. CSRF (Origin 검사) ===');
  {
    const evil = await req('PUT', '/ledgers/wht/2026-7', [], { jar: admin, origin: 'http://evil.example.com' });
    ok('외부 Origin 변경요청 차단', evil.status === 403, evil.body?.error?.code);

    /* CORS 미들웨어가 서버 단에서 거부한다.
     * 브라우저의 응답 차단에만 의존하지 않으므로, 쿠키를 훔친
     * 비브라우저 클라이언트도 오리진이 다르면 막힌다. */
    const evilGet = await req('GET', '/vendors', undefined, { jar: admin, origin: 'http://evil.example.com' });
    ok('외부 Origin 조회도 차단', evilGet.status === 403, evilGet.body?.error?.code);

    const noOrigin = await req('PUT', '/ledgers/wht/2026-7', [], { jar: admin, origin: null });
    ok('Origin 없는 쿠키 변경요청 차단', noOrigin.status === 403, noOrigin.body?.error?.code);
  }

  console.log('\n=== 6. 계정 관리 (관리자) ===');
  let staffUserId;
  {
    const list = await req('GET', '/users', undefined, { jar: admin });
    ok('계정 목록 조회', list.status === 200 && list.body.data.length === 1);
    ok('목록에 해시 없음', !JSON.stringify(list.body).match(/scrypt|passwordHash/i));

    const weak = await req('POST', '/users', {
      loginId: 'staff01', password: '1234', name: '이강효', role: 'staff', deptId: 'tax6800514',
    }, { jar: admin });
    ok('약한 비밀번호 거부', weak.status === 400, weak.body?.error?.message);

    const noDept = await req('POST', '/users', {
      loginId: 'staff01', password: 'Staff!2026aa', name: '이강효', role: 'staff',
    }, { jar: admin });
    ok('담당자 계정에 부서계정 필수', noDept.status === 400, noDept.body?.error?.message);

    const badDept = await req('POST', '/users', {
      loginId: 'staff01', password: 'Staff!2026aa', name: '이강효', role: 'staff', deptId: 'nonexistent',
    }, { jar: admin });
    ok('없는 부서계정 거부', badDept.status === 400);

    const created = await req('POST', '/users', {
      loginId: 'staff01', password: 'Staff!2026aa', name: '이강효', role: 'staff', deptId: 'tax6800514',
    }, { jar: admin });
    ok('담당자 계정 생성', created.status === 201, created.body?.error?.message);
    ok('초기 비밀번호 변경 강제', created.body?.data?.mustChangePw === true);
    staffUserId = created.body?.data?.id;

    const dup = await req('POST', '/users', {
      loginId: 'staff01', password: 'Staff!2026aa', name: 'x', role: 'staff', deptId: 'tax6800514',
    }, { jar: admin });
    ok('아이디 중복 409', dup.status === 409, dup.body?.error?.code);

    /* 마지막 관리자 보호 */
    const meRow = (await req('GET', '/users', undefined, { jar: admin })).body.data
      .find((u) => u.loginId === 'parksy');
    const demote = await req('PUT', `/users/${meRow.id}`, { role: 'staff', deptId: 'tax680017' }, { jar: admin });
    ok('마지막 관리자 강등 차단', demote.status === 409, demote.body?.error?.message);

    const selfDel = await req('DELETE', `/users/${meRow.id}`, undefined, { jar: admin });
    ok('본인 계정 삭제 차단', selfDel.status === 409, selfDel.body?.error?.message);
  }

  console.log('\n=== 7. 담당자 권한 제한 ===');
  const staff = makeJar();
  {
    /* 최초 로그인 → mustChangePw 상태 */
    const login = await req('POST', '/auth/login', { loginId: 'staff01', password: 'Staff!2026aa' }, { jar: staff });
    ok('담당자 로그인 성공', login.status === 200);
    ok('비밀번호 변경 필요 표시', login.body?.data?.user?.mustChangePw === true);
    ok('소속 부서계정 반환', login.body?.data?.user?.deptId === 'tax6800514');

    /* 변경 전에는 다른 API 가 막힌다 */
    const blocked = await req('GET', '/vendors', undefined, { jar: staff });
    ok('변경 전 API 차단', blocked.status === 403, blocked.body?.error?.code);

    /* 비밀번호 변경 */
    const weak = await req('POST', '/auth/password', {
      currentPassword: 'Staff!2026aa', newPassword: 'staff01aaaa',
    }, { jar: staff });
    ok('아이디 포함 비밀번호 거부', weak.status === 400, weak.body?.error?.message);

    const changed = await req('POST', '/auth/password', {
      currentPassword: 'Staff!2026aa', newPassword: 'Kanghyo!2026',
    }, { jar: staff });
    ok('비밀번호 변경 성공', changed.status === 200);

    const now = await req('GET', '/vendors', undefined, { jar: staff });
    ok('변경 후 API 정상', now.status === 200);

    /* 담당자는 계정 관리 불가 */
    const users = await req('GET', '/users', undefined, { jar: staff });
    ok('담당자는 계정 목록 차단', users.status === 403, users.body?.error?.code);

    const mkUser = await req('POST', '/users', {
      loginId: 'hack', password: 'Hack!2026aaa', role: 'admin',
    }, { jar: staff });
    ok('담당자는 계정 생성 차단', mkUser.status === 403);

    /* 담당자는 사무소 설정(택스봇 계정 포함) 수정 불가 */
    const firmW = await req('PUT', '/firm', { name: '탈취' }, { jar: staff });
    ok('담당자는 사무소 설정 수정 차단', firmW.status === 403, firmW.body?.error?.code);

    const firmR = await req('GET', '/firm', undefined, { jar: staff });
    ok('사무소 설정 조회는 허용(청구서 출력에 필요)', firmR.status === 200);
  }

  console.log('\n=== 8. 세션 수명주기 ===');
  {
    const me = await req('GET', '/auth/me', undefined, { jar: admin });
    ok('GET /auth/me 세션 복원', me.status === 200 && me.body.data?.user?.loginId === 'parksy');

    const anon = await req('GET', '/auth/me');
    ok('미로그인 me → null (에러 아님)', anon.status === 200 && anon.body.data === null);

    /* 로그아웃 */
    const tmp = makeJar();
    await req('POST', '/auth/login', { loginId: 'parksy', password: 'Dasol!2026tnc' }, { jar: tmp });
    const before = await req('GET', '/vendors', undefined, { jar: tmp });
    ok('로그아웃 전 접근 가능', before.status === 200);

    await req('POST', '/auth/logout', {}, { jar: tmp });
    const after = await req('GET', '/vendors', undefined, { jar: tmp });
    ok('로그아웃 후 401', after.status === 401, after.body?.error?.code);
  }

  console.log('\n=== 9. 비밀번호 변경 시 타 세션 종료 ===');
  {
    const j1 = makeJar();
    const j2 = makeJar();
    await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2026' }, { jar: j1 });
    await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2026' }, { jar: j2 });
    ok('두 기기 로그인', (await req('GET', '/vendors', undefined, { jar: j2 })).status === 200);

    await req('POST', '/auth/password', {
      currentPassword: 'Kanghyo!2026', newPassword: 'Kanghyo!2027',
    }, { jar: j1 });

    ok('변경한 기기는 유지', (await req('GET', '/vendors', undefined, { jar: j1 })).status === 200);
    ok('다른 기기 세션 종료', (await req('GET', '/vendors', undefined, { jar: j2 })).status === 401);
  }

  console.log('\n=== 10. 계정 정지 시 즉시 로그아웃 ===');
  {
    const j = makeJar();
    await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2027' }, { jar: j });
    ok('정지 전 접근 가능', (await req('GET', '/vendors', undefined, { jar: j })).status === 200);

    await req('PUT', `/users/${staffUserId}`, { isActive: false }, { jar: admin });
    ok('정지 후 즉시 401', (await req('GET', '/vendors', undefined, { jar: j })).status === 401);

    /* 정지된 계정은 로그인도 안 된다 */
    const relogin = await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2027' });
    ok('정지 계정 로그인 차단', relogin.status === 403, relogin.body?.error?.code);

    await req('PUT', `/users/${staffUserId}`, { isActive: true }, { jar: admin });
  }

  console.log('\n=== 11. 로그인 실패 누적 잠금 ===');
  {
    for (let i = 0; i < 5; i += 1) {
      await req('POST', '/auth/login', { loginId: 'staff01', password: `wrong${i}` });
    }
    const locked = await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2027' });
    ok('5회 실패 후 잠금 (정답이어도 거부)', locked.status === 423, locked.body?.error?.code);

    const unlocked = await req('POST', `/users/${staffUserId}/unlock`, {}, { jar: admin });
    ok('관리자 잠금 해제', unlocked.status === 200 && unlocked.body.data.isLocked === false);

    const after = await req('POST', '/auth/login', { loginId: 'staff01', password: 'Kanghyo!2027' });
    ok('해제 후 로그인 성공', after.status === 200);
  }

  console.log('\n=== 12. 사무소(테넌트) 분리 ===');
  {
    /* 두 번째 사무소와 관리자를 만들어 데이터가 섞이지 않는지 본다 */
    const setup = await fetch(`${BASE}/health`); // 서버 살아있는지 확인용
    ok('서버 응답', setup.ok);

    const other = makeJar();
    const r = await req('POST', '/auth/login', { loginId: 'firm2admin', password: 'Firm2!2026aa' }, { jar: other });
    if (r.status !== 200) {
      console.log('  – 두 번째 사무소 계정이 없어 건너뜁니다 (verify-tenancy.js 에서 검증)');
    } else {
      const v = await req('GET', '/vendors', undefined, { jar: other });
      ok('다른 사무소는 업체 0건', Object.keys(v.body.data).length === 0,
        `${Object.keys(v.body.data).length}건`);

      const l = await req('GET', '/ledgers/wht', undefined, { jar: other });
      ok('다른 사무소는 원장 0건', Object.keys(l.body.data.store).length === 0);

      const direct = await req('GET', '/vendors/c1', undefined, { jar: other });
      ok('다른 사무소 업체 직접 조회 404', direct.status === 404);

      const users = await req('GET', '/users', undefined, { jar: other });
      ok('다른 사무소 계정 목록에 안 섞임',
        users.body.data.every((u) => u.loginId !== 'parksy'),
        users.body.data.map((u) => u.loginId).join(','));
    }
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`결과: 통과 ${pass} · 실패 ${fail}`);
  console.log('='.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n검증 스크립트 오류:', err);
  process.exit(1);
});

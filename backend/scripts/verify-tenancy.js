/* ==================================================================
 * 사무소(테넌트) 분리 검증
 *
 * 두 번째 사무소를 만들고, 양쪽에 "같은 id" 의 업체를 넣어
 *   1) 데이터가 서로 보이지 않는지
 *   2) id 가 겹쳐도 충돌하지 않는지 (복합키 PK 확인)
 * 를 본다.
 *
 * 실행: node scripts/verify-tenancy.js   (서버가 떠 있어야 함)
 * 검증용 사무소/계정은 끝나면 정리한다.
 * ================================================================== */
const db = require('../src/db/pool');
const { hashPassword } = require('../src/lib/password');

const BASE = process.env.VERIFY_BASE || 'http://localhost:5097/api';
const ORIGIN = process.env.VERIFY_ORIGIN || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (l, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${l}${e ? ' · ' + e : ''}`); }
  else { fail++; console.log(`  ✗ ${l}${e ? ' · ' + e : ''}`); }
};

function makeJar() {
  const c = new Map();
  return {
    header: () => [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
        if (v === '') c.delete(k); else c.set(k, v);
      }
    },
    get size() { return c.size; },
  };
}

async function req(method, path, body, { jar } = {}) {
  const h = { Origin: ORIGIN };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (jar && jar.size) h.Cookie = jar.header();
  const res = await fetch(BASE + path, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (jar) jar.absorb(res);
  let json = null;
  try { json = await res.json(); } catch (_) { /* 없음 */ }
  return { status: res.status, body: json };
}

const FIRM2_NAME = '검증용 제2세무법인';
const FIRM2_ADMIN = 'firm2admin';
const FIRM2_PW = 'Firm2!2026aa';

async function setup() {
  await cleanup();
  const { rows } = await db.query(
    'INSERT INTO firms (name, ceo) VALUES ($1, $2) RETURNING id',
    [FIRM2_NAME, '홍길동']
  );
  const firmId = rows[0].id;
  await db.query(
    `INSERT INTO users (firm_id, login_id, password_hash, name, role, must_change_pw)
     VALUES ($1, $2, $3, '제2관리자', 'admin', false)`,
    [firmId, FIRM2_ADMIN, await hashPassword(FIRM2_PW)]
  );
  return firmId;
}

async function cleanup() {
  await db.query('DELETE FROM users WHERE login_id = $1', [FIRM2_ADMIN]);
  await db.query('DELETE FROM firms WHERE name = $1', [FIRM2_NAME]);
}

async function main() {
  console.log('\n=== 준비: 두 번째 사무소 생성 ===');
  const firm2Id = await setup();
  ok('사무소 생성', !!firm2Id, `firm_id=${firm2Id}`);

  const a = makeJar();  // 기존 사무소(다솔티앤씨) 관리자
  const b = makeJar();  // 두 번째 사무소 관리자

  const la = await req('POST', '/auth/login', { loginId: 'parksy', password: 'Dasol!2026tnc' }, { jar: a });
  const lb = await req('POST', '/auth/login', { loginId: FIRM2_ADMIN, password: FIRM2_PW }, { jar: b });
  ok('사무소A 로그인', la.status === 200);
  ok('사무소B 로그인', lb.status === 200);
  ok('사무소명이 서로 다름', la.body.data.firm?.name !== lb.body.data.firm?.name,
    `${la.body.data.firm?.name} / ${lb.body.data.firm?.name}`);

  console.log('\n=== 1. 업체 데이터 분리 ===');
  {
    const va = await req('GET', '/vendors', undefined, { jar: a });
    const vb = await req('GET', '/vendors', undefined, { jar: b });
    ok('A 는 기존 업체 보유', Object.keys(va.body.data).length === 14, `${Object.keys(va.body.data).length}건`);
    ok('B 는 업체 0건', Object.keys(vb.body.data).length === 0, `${Object.keys(vb.body.data).length}건`);

    const direct = await req('GET', '/vendors/c1', undefined, { jar: b });
    ok('B 가 A 의 업체 직접 조회 → 404', direct.status === 404, direct.body?.error?.code);

    const del = await req('DELETE', '/vendors/c1', undefined, { jar: b });
    ok('B 가 A 의 업체 삭제 시도 → 404', del.status === 404);

    /* A 의 업체가 실제로 멀쩡한지 확인 */
    const still = await req('GET', '/vendors/c1', undefined, { jar: a });
    ok('A 의 업체는 무사', still.status === 200 && still.body.data.name === '가온한의원');
  }

  console.log('\n=== 2. 같은 id 업체가 양쪽에 공존 (복합키 확인) ===');
  {
    /* B 사무소에도 'c1' 을 만든다 — 단일 PK 였다면 409 가 났을 것 */
    const made = await req('POST', '/vendors', {
      id: 'c1', gubun: '법인', name: '제2법인 소속업체', bizNo: '999-88-77777',
    }, { jar: b });
    ok('B 에 동일 id(c1) 생성 성공', made.status === 201, made.body?.error?.message);

    const ra = await req('GET', '/vendors/c1', undefined, { jar: a });
    const rb = await req('GET', '/vendors/c1', undefined, { jar: b });
    ok('A 의 c1 = 가온한의원', ra.body.data.name === '가온한의원', ra.body.data.name);
    ok('B 의 c1 = 제2법인 소속업체', rb.body.data.name === '제2법인 소속업체', rb.body.data.name);
    ok('서로 덮어쓰지 않음', ra.body.data.bizNo !== rb.body.data.bizNo);
  }

  console.log('\n=== 3. 원장 분리 ===');
  {
    /* A 사무소에 원장 데이터를 준비한다 */
    await req('PUT', '/ledgers/wht/2026-7',
      [{ id: 'c1', name: '가온한의원', filings: { 원천세: '완료' } }], { jar: a });

    const la2 = await req('GET', '/ledgers/wht', undefined, { jar: a });
    const lb2 = await req('GET', '/ledgers/wht', undefined, { jar: b });
    ok('A 는 원장 보유', Object.keys(la2.body.data.store).length > 0);
    ok('B 는 원장 0건', Object.keys(lb2.body.data.store).length === 0);

    /* B 가 같은 기간키로 저장해도 A 것을 건드리지 않아야 한다 */
    const beforeA = await req('GET', '/ledgers/wht/2026-7', undefined, { jar: a });
    await req('PUT', '/ledgers/wht/2026-7', [{ id: 'c1', filings: { 원천세: '미신고' } }], { jar: b });
    const afterA = await req('GET', '/ledgers/wht/2026-7', undefined, { jar: a });

    ok('A 의 동일 기간 원장 불변',
      JSON.stringify(beforeA.body.data.payload) === JSON.stringify(afterA.body.data.payload));
    ok('A 의 revision 불변', beforeA.body.data.revision === afterA.body.data.revision,
      `${beforeA.body.data.revision} → ${afterA.body.data.revision}`);

    const bLedger = await req('GET', '/ledgers/wht/2026-7', undefined, { jar: b });
    ok('B 는 자기 데이터만 조회', bLedger.body.data.payload[0].filings.원천세 === '미신고');

    /* 변경 이력도 사무소별로 분리 */
    const hb = await req('GET', '/ledgers/wht/2026-7/history', undefined, { jar: b });
    ok('B 의 이력에 A 기록 없음', hb.body.data.every((h) => h.savedBy !== 'parksy'),
      hb.body.data.map((h) => h.savedBy).join(',') || '(없음)');
  }

  console.log('\n=== 4. 담당자 계정 분리 ===');
  {
    const da = await req('GET', '/dept-accounts', undefined, { jar: a });
    const dbb = await req('GET', '/dept-accounts', undefined, { jar: b });
    ok('A 는 부서계정 8건', Object.keys(da.body.data).length === 8);
    ok('B 는 부서계정 0건', Object.keys(dbb.body.data).length === 0);

    /* B 가 A 와 같은 부서계정 id 를 만들 수 있어야 한다 */
    const mk = await req('PUT', '/dept-accounts/tax680017', {
      name: '제2사무소 담당자', phone: '02-000-0000', email: 'x@y.com',
    }, { jar: b });
    ok('B 에 동일 부서계정 id 생성', mk.status === 200);

    const checkA = await req('GET', '/dept-accounts/tax680017', undefined, { jar: a });
    ok('A 의 부서계정 이름 불변', checkA.body.data.name === '박상용', checkA.body.data.name);
  }

  console.log('\n=== 5. 계정 관리 분리 ===');
  {
    const ua = await req('GET', '/users', undefined, { jar: a });
    const ub = await req('GET', '/users', undefined, { jar: b });
    ok('A 계정 목록에 B 관리자 없음', ua.body.data.every((u) => u.loginId !== FIRM2_ADMIN),
      ua.body.data.map((u) => u.loginId).join(','));
    ok('B 계정 목록에 A 관리자 없음', ub.body.data.every((u) => u.loginId !== 'parksy'),
      ub.body.data.map((u) => u.loginId).join(','));

    /* B 가 A 의 계정 id 를 직접 지정해 조작 시도 */
    const target = ua.body.data.find((u) => u.loginId === 'parksy');
    const hijack = await req('PUT', `/users/${target.id}`, { name: '탈취됨' }, { jar: b });
    ok('B 가 A 계정 수정 시도 → 404', hijack.status === 404, hijack.body?.error?.code);

    const reset = await req('POST', `/users/${target.id}/password`, { password: 'Hijack!2026aa' }, { jar: b });
    ok('B 가 A 계정 비밀번호 초기화 시도 → 404', reset.status === 404);

    /* A 계정이 멀쩡한지 확인 */
    const stillA = makeJar();
    const relog = await req('POST', '/auth/login', { loginId: 'parksy', password: 'Dasol!2026tnc' }, { jar: stillA });
    ok('A 관리자 비밀번호 무사', relog.status === 200);
  }

  console.log('\n=== 6. 사무소 설정 분리 ===');
  {
    await req('PUT', '/firm', { name: '세무법인 다솔티앤씨', ceo: '이강오', taxbotPw: 'A사무소비밀' }, { jar: a });
    await req('PUT', '/firm', { name: FIRM2_NAME, ceo: '홍길동', taxbotPw: 'B사무소비밀' }, { jar: b });

    const fa = await req('GET', '/firm', undefined, { jar: a });
    const fb = await req('GET', '/firm', undefined, { jar: b });
    ok('A 사무소 설정 유지', fa.body.data.ceo === '이강오', fa.body.data.ceo);
    ok('B 사무소 설정 유지', fb.body.data.ceo === '홍길동', fb.body.data.ceo);
    ok('택스봇 비밀번호 섞이지 않음', fa.body.data.taxbotPw !== fb.body.data.taxbotPw);
  }

  console.log('\n=== 정리 ===');
  await cleanup();
  ok('검증용 사무소 삭제 (CASCADE)', true);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM vendors WHERE firm_id = $1', [firm2Id]);
  ok('B 사무소 데이터도 함께 삭제됨', rows[0].n === 0, `${rows[0].n}건`);
  /* 다른 검증에서 만들었다 지운 업체는 소프트 삭제로 남아 있으므로 제외한다 */
  const { rows: a2 } = await db.query(
    'SELECT count(*)::int AS n FROM vendors WHERE firm_id <> $1 AND is_deleted = false',
    [firm2Id]
  );
  ok('A 사무소 업체는 그대로', a2[0].n === 14, `${a2[0].n}건`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`결과: 통과 ${pass} · 실패 ${fail}`);
  console.log('='.repeat(52));
  await db.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n검증 오류:', err);
  await cleanup().catch(() => {});
  await db.close().catch(() => {});
  process.exit(1);
});

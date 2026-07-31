/* ==================================================================
 * API 통합 검증 스크립트
 *   실제 PostgreSQL 을 대상으로 전 엔드포인트를 왕복 검증한다.
 *   실행: node scripts/verify.js   (서버가 떠 있어야 함)
 * ================================================================== */
const BASE = process.env.VERIFY_BASE || 'http://localhost:5099/api';

let pass = 0;
let fail = 0;

function ok(label, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}${extra ? ' · ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${extra ? ' · ' + extra : ''}`);
  }
}

/** 키 순서를 무시한 깊은 비교.
 *  jsonb 는 객체 키 순서를 보존하지 않으므로(길이→바이트순 정렬)
 *  JSON.stringify 비교는 부적절하다. 값이 같은지만 본다. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log('\n=== 1. 헬스 체크 ===');
  {
    const r = await req('GET', '/health');
    ok('GET /health 200', r.status === 200 && r.body.ok === true, `db=${r.body?.db}`);
  }

  console.log('\n=== 2. 총괄업체 camelCase 왕복 ===');
  {
    const r = await req('GET', '/vendors');
    const m = r.body.data;
    ok('GET /vendors 200', r.status === 200);
    ok('업체 14건', Object.keys(m).length === 14, `실제 ${Object.keys(m).length}건`);

    /* ★ 기존 버그의 핵심 검증 ★
     * PostgreSQL 이 식별자를 소문자로 접어도 camelCase 로 되돌아오는가 */
    const c1 = m.c1;
    ok('bizNo 보존', c1.bizNo === '128-90-45123', c1.bizNo);
    ok('ceoRRN 보존', c1.ceoRRN === '78****-*******', c1.ceoRRN);
    ok('deptId 보존', c1.deptId === 'tax6800514', c1.deptId);
    ok('staffEmail 보존', c1.staffEmail === 'gaon@dasol.co.kr', c1.staffEmail);
    ok('hometaxId 보존', c1.hometaxId === 'gaonhani', c1.hometaxId);
    ok('closingMonth 숫자형', c1.closingMonth === 12, typeof c1.closingMonth);
    ok('taxType 기본값', c1.taxType === '과세', c1.taxType);

    /* 개인 전용 필드는 개인에만 값이 있어야 한다 */
    ok('개인 otherIncome 있음', c1.otherIncome === '포함', String(c1.otherIncome));
    ok('개인 jointType 있음', c1.jointType === '단독', String(c1.jointType));
    ok('법인 otherIncome null', m.c2.otherIncome === null, String(m.c2.otherIncome));
    ok('법인 jointType null', m.c2.jointType === null, String(m.c2.jointType));
    ok('법인 jointCount null', m.c2.jointCount === null, String(m.c2.jointCount));

    /* jsonb 배열 */
    ok('memos 배열 보존', Array.isArray(m.c2.memos) && m.c2.memos.length === 1, JSON.stringify(m.c2.memos));
    ok('jointOwners 빈배열', Array.isArray(c1.jointOwners) && c1.jointOwners.length === 0);

    /* 개인 결산월 12 고정 규칙 */
    ok('법인 c5 결산월 3', m.c5.closingMonth === 3, String(m.c5.closingMonth));

    /* ★ UI 회귀 방지 ★ 프론트는 Object.values(profiles) 를 정렬 없이 렌더한다.
     * 시드 순서(c1..c6, j1..j8)가 그대로 유지되어야 한다. */
    const order = Object.keys(m);
    const expected = ['c1','c2','c3','c4','c5','c6','j1','j2','j3','j4','j5','j6','j7','j8'];
    ok('표시 순서 보존', deepEqual(order, expected), order.join(','));
  }

  console.log('\n=== 3. 업체 생성/수정/삭제 ===');
  const newId = `n${Date.now()}`;
  {
    const r = await req('POST', '/vendors', {
      id: newId,
      gubun: '개인',
      name: '검증테스트업체',
      bizNo: '111-22-33333',
      deptId: 'tax680017',
      jointType: '공동',
      jointCount: 3,
      jointOwners: [{ name: '홍길동', rrn: '800101-1******' }, { name: '김철수', rrn: '850202-1******' }],
      memos: ['검증용'],
    });
    ok('POST /vendors 201', r.status === 201, `id=${r.body?.data?.id}`);
    ok('jointCount 3 보존', r.body?.data?.jointCount === 3, String(r.body?.data?.jointCount));
    ok('jointOwners 2건 보존', r.body?.data?.jointOwners?.length === 2);

    /* 중복 id → 409 */
    const dup = await req('POST', '/vendors', { id: newId, gubun: '개인', name: 'x' });
    ok('중복 id 409', dup.status === 409, dup.body?.error?.code);

    /* 수정 */
    const upd = await req('PUT', `/vendors/${newId}`, {
      gubun: '개인', name: '검증테스트업체(수정)', bizNo: '111-22-33333', otherIncome: '미포함',
    });
    ok('PUT /vendors/:id 200', upd.status === 200);
    ok('수정 반영', upd.body?.data?.name === '검증테스트업체(수정)', upd.body?.data?.name);
    ok('otherIncome 미포함', upd.body?.data?.otherIncome === '미포함');

    /* 알 수 없는 필드 → extra 로 보존 */
    const ext = await req('PUT', `/vendors/${newId}`, {
      gubun: '개인', name: '검증테스트업체(수정)', 신규필드테스트: '보존되어야함',
    });
    ok('미등록 필드 extra 보존', ext.body?.data?.['신규필드테스트'] === '보존되어야함',
      String(ext.body?.data?.['신규필드테스트']));

    /* 소프트 삭제 */
    const del = await req('DELETE', `/vendors/${newId}`);
    ok('DELETE /vendors/:id 200', del.status === 200);
    const gone = await req('GET', `/vendors/${newId}`);
    ok('삭제 후 404', gone.status === 404, gone.body?.error?.code);

    /* 복구 */
    const res2 = await req('POST', `/vendors/${newId}/restore`);
    ok('restore 200', res2.status === 200);
    await req('DELETE', `/vendors/${newId}`);
  }

  console.log('\n=== 4. 검증 실패 케이스 ===');
  {
    const r1 = await req('POST', '/vendors', { id: 'zz1', gubun: '중간' });
    ok('잘못된 구분 400', r1.status === 400, r1.body?.error?.message);

    const r2 = await req('PUT', '/vendors/bad%20id!!', { gubun: '개인' });
    ok('잘못된 id 400', r2.status === 400, r2.body?.error?.code);

    const r3 = await req('POST', '/vendors', 'not-an-object');
    ok('본문 비객체 400', r3.status === 400, r3.body?.error?.code);

    const rMalformed = await fetch(BASE + '/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    ok('깨진 JSON 400', rMalformed.status === 400, (await rMalformed.json())?.error?.code);

    const r4 = await req('GET', '/nonexistent');
    ok('없는 경로 404', r4.status === 404, r4.body?.error?.code);

    /* FK: 없는 담당자 참조 */
    const r5 = await req('POST', '/vendors', { id: 'zz2', gubun: '개인', name: 'x', deptId: '없는계정' });
    ok('없는 담당자 참조 400', r5.status === 400, r5.body?.error?.code);
  }

  console.log('\n=== 5. 담당자 계정 ===');
  {
    const r = await req('GET', '/dept-accounts');
    ok('GET /dept-accounts 200', r.status === 200);
    ok('8건', Object.keys(r.body.data).length === 8, `${Object.keys(r.body.data).length}건`);
    ok('pwEntered boolean', r.body.data.tax680017.pwEntered === true);
    ok('otpEntered boolean', r.body.data.tax6800502.otpEntered === true);
    ok('빈 이름 유지', r.body.data.TAX68005.name === '', JSON.stringify(r.body.data.TAX68005.name));

    /* 인수인계 시나리오: 이름만 바꾸면 물려 있는 업체 전체 반영 */
    const upd = await req('PUT', '/dept-accounts/tax680017', {
      name: '신규담당자', phone: '02-588-6800', email: 'x@y.com', pwEntered: true, otpEntered: false,
    });
    ok('담당자 이름 변경', upd.body?.data?.name === '신규담당자');
    const back = await req('PUT', '/dept-accounts/tax680017', {
      name: '박상용', phone: '02-588-6800', email: 'tax68005@naver.com', pwEntered: true, otpEntered: false,
    });
    ok('원복', back.body?.data?.name === '박상용');

    /* map 일괄 저장 (StaffAccountsModal 동작) */
    const bulk = await req('PUT', '/dept-accounts', r.body.data);
    ok('map 일괄 저장', bulk.status === 200 && bulk.body.count === 8, `${bulk.body?.count}건`);
  }

  console.log('\n=== 6. 사무소 설정 ===');
  {
    const r = await req('GET', '/firm');
    ok('GET /firm 200', r.status === 200);
    ok('초기 빈 객체', r.body.data.name === '' && r.body.data.logo === '');

    /* account → account_no 매핑 확인 */
    const bigLogo = 'data:image/png;base64,' + 'A'.repeat(300_000); // 약 300KB
    const save = await req('PUT', '/firm', {
      name: '세무법인 다솔티앤씨', bizNo: '123-81-45678', ceo: '이강오',
      bank: '국민은행', account: '123456-01-789012', phone: '02-588-6800',
      taxbotId: 'dasol', taxbotPw: 'pw', logo: bigLogo, invoiceLogo: '',
    });
    ok('PUT /firm 200', save.status === 200);
    ok('account 왕복(account_no 매핑)', save.body?.data?.account === '123456-01-789012', save.body?.data?.account);
    ok('대용량 로고 저장(300KB)', save.body?.data?.logo?.length === bigLogo.length,
      `${Math.round((save.body?.data?.logo?.length || 0) / 1024)}KB`);

    const re = await req('GET', '/firm');
    ok('재조회 일치', re.body.data.name === '세무법인 다솔티앤씨' && re.body.data.ceo === '이강오');
  }

  console.log('\n=== 7. 세목 원장 (5종 공통) ===');
  {
    const r = await req('GET', '/ledgers');
    ok('GET /ledgers 세목 5종', r.body.data.length === 5, r.body.data.map((d) => d.name).join(','));

    /* 원천세 — 프론트 store[key] 배열을 그대로 저장 */
    const whtPayload = [
      {
        id: 'c1', name: '가온한의원', type: '개인',
        history: { 근로: true, 사업: true, 일용: false, 기타: false, 이자: false, 배당: false, 퇴직: false },
        annual: {}, half: {},
        current: { 근로: true, 사업: true, 일용: false, 기타: false, 이자: false, 배당: false, 퇴직: false },
        ilyong: null, payroll: '완료',
        filings: { 원천세: '완료', 사업간이: '미신고' },
      },
    ];
    const s1 = await req('PUT', '/ledgers/wht/2026-7', whtPayload);
    ok('PUT /ledgers/wht/2026-7', s1.status === 200, `revision=${s1.body?.data?.revision}`);
    ok('revision 1', s1.body?.data?.revision === 1);

    const g1 = await req('GET', '/ledgers/wht/2026-7');
    ok('payload 완전 왕복(값 기준)', deepEqual(g1.body.data.payload, whtPayload));
    ok('한글 키 보존(근로/사업)', g1.body.data.payload[0].current.근로 === true);
    ok('한글 신고상태 보존', g1.body.data.payload[0].filings.원천세 === '완료');
    ok('null 보존(ilyong)', g1.body.data.payload[0].ilyong === null);

    /* 없는 기간 → 에러가 아니라 data: null (프론트 EmptyState 동작 유지) */
    const g2 = await req('GET', '/ledgers/wht/2026-9');
    ok('없는 기간 200 + null', g2.status === 200 && g2.body.data === null);

    /* store map 형태 조회 */
    await req('PUT', '/ledgers/wht/2026-6', [{ id: 'c1', filings: {} }]);
    const all = await req('GET', '/ledgers/wht');
    ok('store map 형태', !!all.body.data.store['2026-7'] && !!all.body.data.store['2026-6'],
      Object.keys(all.body.data.store).join(','));
    ok('meta revision 포함', all.body.data.meta['2026-7'].revision >= 1);

    /* keys 필터 (원천세 6개월 롤링 이력 조회) */
    const filtered = await req('GET', '/ledgers/wht?keys=2026-6');
    ok('keys 필터', Object.keys(filtered.body.data.store).length === 1,
      Object.keys(filtered.body.data.store).join(','));

    /* prefix 필터 */
    const pref = await req('GET', '/ledgers/wht?prefix=2026');
    ok('prefix 필터', Object.keys(pref.body.data.store).length === 2);

    /* 기간 키 형식 검증 */
    const bad1 = await req('PUT', '/ledgers/wht/2026-13', []);
    ok('원천세 13월 거부', bad1.status === 400, bad1.body?.error?.message?.slice(0, 40));
    const bad2 = await req('PUT', '/ledgers/wht/2026-07', []);
    ok('0패딩 거부(프론트 규칙 준수)', bad2.status === 400);

    /* 부가세 한글 기간 키 */
    const vat = await req('PUT', '/ledgers/vat/2026-1-확정', [
      { id: 'c1', 예정과세: 36363637, 확정과세: 41200000, 납부세액: 1650000, 신고여부: '자료 수집 필요' },
    ]);
    ok('부가세 한글 기간키 저장', vat.status === 200, '2026-1-확정');
    const vatG = await req('GET', '/ledgers/vat/2026-1-확정');
    ok('부가세 한글 필드 왕복', vatG.body.data.payload[0].신고여부 === '자료 수집 필요');
    const vatBad = await req('PUT', '/ledgers/vat/2026-3-예정', []);
    ok('부가세 3기 거부', vatBad.status === 400);

    /* 종합소득세·법인세 연도 키 */
    const inc = await req('PUT', '/ledgers/income/2025', [{ id: 'c1', 구분: '성실', 매출액: [620000000] }]);
    ok('종소세 연도키 저장', inc.status === 200);
    const corp = await req('PUT', '/ledgers/corp/2024', [{ id: 'c2', 성실: '일반', 수입: 9413629881 }]);
    ok('법인세 연도키 저장', corp.status === 200);
    ok('큰 정수 보존', (await req('GET', '/ledgers/corp/2024')).body.data.payload[0].수입 === 9413629881);

    /* 미수금 */
    const ar = await req('PUT', '/ledgers/ar/2026-3', [
      { id: 'c1', reg: 165000, irr: 0, cms: 165000, manual: 0, regIssued: true, irrIssued: true, prevAR: 0, prevUn: 0, note: '' },
    ]);
    ok('미수금 저장', ar.status === 200);

    /* 알 수 없는 세목 */
    const unk = await req('GET', '/ledgers/지방소득세');
    ok('미등록 세목 400', unk.status === 400, unk.body?.error?.message?.slice(0, 30));

    /* 낙관적 잠금 */
    /* 같은 내용 재저장 → revision 올라가지 않아야 한다 */
    const same = await req('PUT', '/ledgers/wht/2026-7', whtPayload);
    ok('동일 내용 재저장 시 revision 유지', same.body?.data?.revision === 1,
      `revision=${same.body?.data?.revision}`);

    /* 내용을 바꿔 저장 → revision 증가 */
    await req('PUT', '/ledgers/wht/2026-7', [{ ...whtPayload[0], payroll: '업체자료 대기중' }]);
    const cur = await req('GET', '/ledgers/wht/2026-7');
    const rev = cur.body.data.revision;
    ok('내용 변경 시 revision 증가', rev === 2, `revision=${rev}`);

    const conflict = await req('PUT', '/ledgers/wht/2026-7', { payload: [], revision: rev - 1 });
    ok('오래된 revision 409', conflict.status === 409, conflict.body?.error?.code);

    const badRev = await req('PUT', '/ledgers/wht/2026-7', { payload: [], revision: 0 });
    ok('revision 0 은 400(조용히 무시 안 함)', badRev.status === 400, badRev.body?.error?.message);
    const okSave = await req('PUT', '/ledgers/wht/2026-7', { payload: [{ id: 'c1', filings: {} }], revision: rev });
    ok('올바른 revision 저장', okSave.status === 200, `revision=${okSave.body?.data?.revision}`);
    ok('revision 증가', okSave.body?.data?.revision === rev + 1);

    /* 변경 이력 — 내용이 바뀐 저장에 대해서만 적재된다
     * 지금까지 2026-7 의 실제 내용 변경: (1) payroll 변경 (2) filings 축소 = 2건 */
    const hist = await req('GET', '/ledgers/wht/2026-7/history');
    ok('변경 이력 2건(내용 변경 횟수와 일치)',
      Array.isArray(hist.body.data) && hist.body.data.length === 2,
      `${hist.body.data.length}건`);
    ok('이력 최신순 정렬', hist.body.data[0].revision >= hist.body.data[1].revision);
    const snap = await req('GET', `/ledgers/wht/2026-7/history/${hist.body.data[hist.body.data.length - 1].id}`);
    ok('과거 스냅샷 조회', snap.status === 200 && Array.isArray(snap.body.data.payload));

    /* 여러 기간 일괄 저장 (이관/이월) */
    const bulk = await req('PUT', '/ledgers/wht', {
      '2026-8': [{ id: 'c1', filings: {} }],
      '2026-9': [{ id: 'c1', filings: {} }],
    });
    ok('여러 기간 일괄 저장', bulk.status === 200 && bulk.body.count === 2);
    const bulkBad = await req('PUT', '/ledgers/wht', { '2026-8': 'not-array' });
    ok('배열 아닌 payload 거부', bulkBad.status === 400);

    /* 기간 목록 */
    const periods = await req('GET', '/ledgers/wht/periods');
    ok('기간 목록 + 행수', periods.body.data.length >= 4 && 'rowCount' in periods.body.data[0],
      periods.body.data.map((p) => p.periodKey).join(','));

    /* 삭제 */
    const d = await req('DELETE', '/ledgers/wht/2026-9');
    ok('기간 삭제', d.status === 200);
    const d2 = await req('DELETE', '/ledgers/wht/2026-9');
    ok('없는 기간 삭제 404', d2.status === 404);
  }

  console.log('\n=== 8. 빈 payload / 대용량 ===');
  {
    const empty = await req('PUT', '/ledgers/wht/2026-5', []);
    ok('빈 배열 저장 허용', empty.status === 200);

    /* 업체 200곳 × 12개월 규모 가정 — 단일 기간 200행 */
    const big = Array.from({ length: 200 }, (_, i) => ({
      id: `b${i}`, name: `업체${i}`, type: i % 2 ? '개인' : '법인',
      current: { 근로: true, 사업: false, 일용: false, 기타: false, 이자: false, 배당: false, 퇴직: false },
      history: {}, annual: {}, half: {}, ilyong: null, payroll: '완료',
      filings: { 원천세: '완료' },
    }));
    const t0 = Date.now();
    const bigSave = await req('PUT', '/ledgers/wht/2026-4', big);
    const ms = Date.now() - t0;
    ok('200행 저장', bigSave.status === 200, `${ms}ms`);
    const bigGet = await req('GET', '/ledgers/wht/2026-4');
    ok('200행 조회 일치', bigGet.body.data.payload.length === 200);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`결과: 통과 ${pass} · 실패 ${fail}`);
  console.log('='.repeat(50));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n검증 스크립트 오류:', err.message);
  process.exit(1);
});

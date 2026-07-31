/* ==================================================================
 * 초기 데이터 시드
 *
 * App.js 의 seedDeptAccounts() / seedProfiles() 와 동일한 데이터를
 * DB 에 넣는다. 화면이 지금까지 보여주던 상태를 그대로 재현하기 위한 것.
 *
 * 세목 원장(ledgers)은 비워 둔다.
 *   → 원천세는 화면의 "총괄업체 데이터 불러오기" 버튼으로,
 *     미수금은 "전월 데이터 이월" 버튼으로 생성하는 게 정상 흐름이다.
 *     빈 상태에서 시작하면 그 흐름을 그대로 검증할 수 있다.
 *
 * 실행: npm run seed
 * 이미 있는 데이터는 덮어쓴다(upsert). 여러 번 실행해도 안전하다.
 * ================================================================== */
const db = require('../src/db/pool');
const vendorRepo = require('../src/modules/vendors/vendor.repo');
const deptRepo = require('../src/modules/deptAccounts/deptAccount.repo');

/* ---------------- 홈택스 부서 계정 ---------------- */
const DEPT_ACCOUNTS = [
  { id: 'tax680015',   name: '이지선', phone: '010-5265-5329', email: 'tax68005@naver.com', pwEntered: true,  otpEntered: false },
  { id: 'tax680017',   name: '박상용', phone: '02-588-6800',   email: 'tax68005@naver.com', pwEntered: true,  otpEntered: false },
  { id: 'TAX68005',    name: '',       phone: '02-588-6800',   email: 'tax68005@naver.com', pwEntered: true,  otpEntered: false },
  { id: 'tax6800501',  name: '오은아', phone: '02-588-6800',   email: 'tax68005@naver.com', pwEntered: false, otpEntered: false },
  { id: 'tax6800502',  name: '박수진', phone: '02-588-6800',   email: 'hq@dasoltnc.com',    pwEntered: true,  otpEntered: true  },
  { id: 'tax6800511',  name: '임소영', phone: '02-588-6800',   email: 'tax68005@naver.com', pwEntered: true,  otpEntered: false },
  { id: 'tax6800514',  name: '이강효', phone: '02-588-6800',   email: 'tax68005@naver.com', pwEntered: true,  otpEntered: false },
  { id: 'tax6800701',  name: '임옥련', phone: '02-588-6800',   email: 'hq@dasoltnc.com',    pwEntered: true,  otpEntered: false },
].map((a, i) => ({ ...a, sortOrder: i }));

/* ---------------- 총괄업체 ---------------- */
const VENDORS = [
  { id: 'c1', gubun: '개인', name: '가온한의원',     deptId: 'tax6800514', bizNo: '128-90-45123', ceoName: '정가온', ceoRRN: '78****-*******', industry: '한방 병·의원',      program: '세무사랑', ceoPhone: '010-2211-0091', staffPhone: '010-5541-2093', staffEmail: 'gaon@dasol.co.kr',    hometaxId: 'gaonhani' },
  { id: 'c2', gubun: '법인', name: '대성건설(주)',   deptId: 'tax680017',  bizNo: '220-81-33456', ceoName: '김대성', ceoRRN: '69****-*******', industry: '종합 건설업',        ceoPhone: '010-3322-7781', staffPhone: '010-5541-2093', staffEmail: 'daesung@dasol.co.kr', memos: ['일용직 다수 · 근로내역확인서 업체 직접신고'] },
  { id: 'c3', gubun: '개인', name: '밝은미소치과',   deptId: 'tax6800514', bizNo: '129-91-77812', ceoName: '이하늘', ceoRRN: '82****-*******', industry: '치과 의원',          program: '세무사랑', otherIncome: '미포함' },
  { id: 'c4', gubun: '법인', name: '한빛산업(주)',   deptId: 'tax680017',  bizNo: '312-81-90234', ceoName: '박한빛', ceoRRN: '71****-*******', industry: '산업설비 제조',      closingMonth: 12 },
  { id: 'c5', gubun: '법인', name: '서연이앤씨(주)', deptId: 'tax6800514', bizNo: '144-81-20991', ceoName: '최서연', ceoRRN: '75****-*******', industry: '엔지니어링 서비스',  closingMonth: 3 },
  { id: 'c6', gubun: '개인', name: '김해김씨 종친회', deptId: 'tax680017', bizNo: '215-82-61003', ceoName: '김종회', ceoRRN: '55****-*******', industry: '비영리 단체',        taxType: '면세', wht: '신고', otherIncome: '포함' },

  /* 종합소득세 개인사업자 (대표자 동일 = 다중 사업장) */
  { id: 'j1', gubun: '개인', name: '강남동물병원', deptId: 'tax680017',  ceoName: '최낙훈', ceoRRN: '830623-1******', bizNo: '114-90-11223', industry: '수의업(동물병원)', program: '더존' },
  { id: 'j2', gubun: '개인', name: '뷰티로망스',   deptId: 'tax680017',  ceoName: '최낙훈', ceoRRN: '830623-1******', bizNo: '114-90-11224', industry: '미용업',           program: '더존' },
  { id: 'j3', gubun: '개인', name: '수유동빌딩',   deptId: 'tax6800514', ceoName: '김경자', ceoRRN: '490709-2******', bizNo: '210-11-33445', industry: '부동산 임대업',    program: '더존' },
  { id: 'j4', gubun: '개인', name: '뉴캐슬',       deptId: 'tax6800514', ceoName: '김경자', ceoRRN: '490709-2******', bizNo: '210-11-33446', industry: '부동산 임대업',    program: '더존' },
  { id: 'j5', gubun: '개인', name: '대성디앤씨',   deptId: 'tax6800514', ceoName: '손대근', ceoRRN: '791113-1******', bizNo: '128-22-55667', industry: '도·소매업',        program: '세무사랑' },
  { id: 'j6', gubun: '개인', name: '더보니타',     deptId: 'tax680017',  ceoName: '김수연', ceoRRN: '920917-2******', bizNo: '144-33-77889', industry: '음식점업',         program: '더존' },
  { id: 'j7', gubun: '개인', name: '하밍컨설팅',   deptId: 'tax680017',  ceoName: '김수연', ceoRRN: '920917-2******', bizNo: '144-33-77890', industry: '경영 컨설팅업',    program: '더존' },
  { id: 'j8', gubun: '개인', name: '미선의원',     deptId: 'tax680017',  ceoName: '박미선', ceoRRN: '650525-2******', bizNo: '312-45-99001', industry: '의료업(의원)',     program: '더존' },
];

async function run() {
  console.log('[seed] 시작');

  /* 순서 중요: vendors.dept_id 가 dept_accounts 를 참조하므로 담당자를 먼저 */
  const depts = await deptRepo.upsertMany(DEPT_ACCOUNTS);
  console.log(`[seed] ✓ 담당자 계정 ${depts.length}건`);

  /* sortOrder 를 원본 배열 순서로 부여 → 화면 행 순서가 기존과 동일하게 유지된다 */
  const vendors = await vendorRepo.upsertMany(
    VENDORS.map((v, i) => ({ ...v, sortOrder: i }))
  );
  console.log(`[seed] ✓ 총괄업체 ${vendors.length}건`);

  console.log('[seed] 완료 — 세목 원장은 비어 있습니다.');
  console.log('       원천세: 화면에서 "총괄업체 데이터 불러오기"');
  console.log('       미수금: 화면에서 "업체 추가" 또는 "전월 데이터 이월"');
}

run()
  .then(() => db.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[seed] 실패:', err.message);
    if (err.code === '23503') {
      console.error('  → 담당자 계정보다 업체가 먼저 저장되려 했습니다. 스크립트 순서를 확인하세요.');
    }
    await db.close().catch(() => {});
    process.exit(1);
  });

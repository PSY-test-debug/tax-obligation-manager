/* ==================================================================
 * 최초 관리자 계정 생성
 *
 * 인증을 켜면 로그인할 계정이 하나도 없으므로 아무것도 할 수 없다.
 * 이 스크립트로 첫 관리자를 만든다.
 *
 *   대화형:  npm run create-admin
 *   비대화형: node scripts/create-admin.js --id parksy --name 박상용 --password '...'
 *
 * 비밀번호는 화면에 표시되지 않는다.
 * 이미 있는 아이디면 비밀번호를 재설정할지 물어본다.
 * ================================================================== */
const readline = require('readline');
const db = require('../src/db/pool');
const { hashPassword, checkPasswordStrength } = require('../src/lib/password');

/* ---------- 인자 파싱 ---------- */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

/* ---------- 입력 유틸 ---------- */
function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (!silent) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    /* 비밀번호 입력 — 화면에 표시하지 않는다 */
    const onData = (char) => {
      const s = String(char);
      if (s === '\n' || s === '\r' || s === '\u0004') {
        process.stdin.removeListener('data', onData);
      } else {
        /* 이미 출력된 글자를 지우고 질문만 다시 그린다 */
        process.stdout.write(`\r\x1b[2K${question}`);
      }
    };
    process.stdout.write(question);
    process.stdin.on('data', onData);

    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);

  console.log('\n  신고의무 관리 시스템 · 관리자 계정 생성\n');

  /* ---------- 사무소 확인 ---------- */
  const { rows: firms } = await db.query('SELECT id, name FROM firms ORDER BY id');
  if (!firms.length) {
    console.error('  사무소가 없습니다. npm run migrate 를 먼저 실행하세요.');
    process.exit(1);
  }

  let firm = firms[0];
  if (firms.length > 1) {
    console.log('  사무소 목록:');
    firms.forEach((f) => console.log(`    ${f.id}. ${f.name || '(이름 미등록)'}`));
    const pick = args.firm || (await ask('  사무소 id: '));
    firm = firms.find((f) => String(f.id) === String(pick));
    if (!firm) {
      console.error('  해당 사무소를 찾을 수 없습니다.');
      process.exit(1);
    }
  }
  console.log(`  사무소: ${firm.name || '(이름 미등록)'} (id=${firm.id})\n`);

  /* ---------- 아이디 ---------- */
  const loginId = args.id || (await ask('  아이디: '));
  if (!/^[a-zA-Z0-9._-]{4,32}$/.test(loginId)) {
    console.error('  아이디는 영문·숫자·. _ - 조합 4~32자여야 합니다.');
    process.exit(1);
  }

  const { rows: existing } = await db.query(
    'SELECT id, firm_id, role FROM users WHERE lower(login_id) = lower($1)',
    [loginId]
  );

  if (existing.length && !args.force) {
    console.log(`\n  '${loginId}' 계정이 이미 있습니다.`);
    const yn = args.reset ? 'y' : (await ask('  비밀번호를 재설정할까요? (y/N): ')).toLowerCase();
    if (yn !== 'y') {
      console.log('  취소했습니다.');
      process.exit(0);
    }
  }

  /* ---------- 이름 ---------- */
  const name = args.name || (await ask('  이름: '));

  /* ---------- 비밀번호 ---------- */
  let password = args.password;
  if (!password) {
    password = await ask('  비밀번호 (10자 이상, 3종류 이상 조합): ', { silent: true });
    const again = await ask('  비밀번호 확인: ', { silent: true });
    if (password !== again) {
      console.error('\n  비밀번호가 일치하지 않습니다.');
      process.exit(1);
    }
  }

  const weak = checkPasswordStrength(password, { loginId });
  if (weak) {
    console.error(`\n  ${weak}`);
    process.exit(1);
  }

  /* ---------- 저장 ---------- */
  const hash = await hashPassword(password);

  if (existing.length) {
    await db.query(
      `UPDATE users
          SET password_hash = $2, name = COALESCE(NULLIF($3, ''), name),
              role = 'admin', is_active = true, must_change_pw = false,
              failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [existing[0].id, hash, name]
    );
    /* 기존 세션은 모두 끊는다 */
    await db.query('DELETE FROM sessions WHERE user_id = $1', [existing[0].id]);
    console.log(`\n  ✓ '${loginId}' 계정의 비밀번호를 재설정하고 관리자로 전환했습니다.\n`);
  } else {
    await db.query(
      `INSERT INTO users (firm_id, login_id, password_hash, name, role, must_change_pw)
       VALUES ($1, $2, $3, $4, 'admin', false)`,
      [firm.id, loginId, hash, name || '']
    );
    console.log(`\n  ✓ 관리자 계정 '${loginId}' 을 생성했습니다.\n`);
  }

  console.log('  이제 로그인 화면에서 이 계정으로 접속할 수 있습니다.');
  console.log('  담당자 계정은 로그인 후 [계정 관리] 에서 추가하세요.\n');
}

main()
  .then(() => db.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n  실패:', err.message);
    if (err.code === '23505') console.error('  이미 사용 중인 아이디입니다.');
    if (err.code === '42P01') console.error('  테이블이 없습니다. npm run migrate 를 먼저 실행하세요.');
    await db.close().catch(() => {});
    process.exit(1);
  });

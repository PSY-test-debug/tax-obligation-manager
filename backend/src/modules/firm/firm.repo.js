const db = require('../../db/pool');

/* ==================================================================
 * 사무소 설정 repository — 단일 행(id = 1)
 * 프론트 firm 필드: name, bizNo, ceo, bank, account, phone,
 *                  taxbotId, taxbotPw, logo, invoiceLogo
 * DB 에서는 account → account_no 로 저장한다(의미 명확화).
 * ================================================================== */

const COLS =
  'name, biz_no, ceo, bank, account_no, phone, taxbot_id, taxbot_pw, logo, invoice_logo';

const s = (v) => (v === undefined || v === null ? '' : String(v));

function toFirm(row) {
  return {
    name: s(row.name),
    bizNo: s(row.biz_no),
    ceo: s(row.ceo),
    bank: s(row.bank),
    account: s(row.account_no),
    phone: s(row.phone),
    taxbotId: s(row.taxbot_id),
    taxbotPw: s(row.taxbot_pw),
    logo: s(row.logo),
    invoiceLogo: s(row.invoice_logo),
  };
}

async function get() {
  const { rows } = await db.query(`SELECT ${COLS} FROM firm_settings WHERE id = 1`);
  /* 행이 없으면(마이그레이션 직후 등) 프론트 초기값과 동일한 빈 객체를 만든다 */
  if (!rows[0]) return toFirm({});
  return toFirm(rows[0]);
}

async function save(firm = {}) {
  const { rows } = await db.query(
    `INSERT INTO firm_settings
       (id, name, biz_no, ceo, bank, account_no, phone, taxbot_id, taxbot_pw, logo, invoice_logo)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       biz_no = EXCLUDED.biz_no,
       ceo = EXCLUDED.ceo,
       bank = EXCLUDED.bank,
       account_no = EXCLUDED.account_no,
       phone = EXCLUDED.phone,
       taxbot_id = EXCLUDED.taxbot_id,
       taxbot_pw = EXCLUDED.taxbot_pw,
       logo = EXCLUDED.logo,
       invoice_logo = EXCLUDED.invoice_logo
     RETURNING ${COLS}`,
    [
      s(firm.name), s(firm.bizNo), s(firm.ceo), s(firm.bank), s(firm.account),
      s(firm.phone), s(firm.taxbotId), s(firm.taxbotPw), s(firm.logo), s(firm.invoiceLogo),
    ]
  );
  return toFirm(rows[0]);
}

module.exports = { get, save };

const db = require('../../db/pool');

/* ==================================================================
 * 사무소 설정 repository
 *
 * 002 마이그레이션에서 firm_settings(단일 행) → firms(테넌트)로 옮겼다.
 * 프론트가 보는 필드 구성은 그대로다.
 *   account → account_no 로 저장(의미 명확화)
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

async function get(firmId) {
  const { rows } = await db.query(`SELECT ${COLS} FROM firms WHERE id = $1`, [firmId]);
  /* 행이 없어도 프론트 초기값과 동일한 빈 객체를 돌려준다.
   * firm.logo 등을 조건 없이 참조하는 코드가 있어 형태가 유지되어야 한다. */
  if (!rows[0]) return toFirm({});
  return toFirm(rows[0]);
}

/**
 * 저장.
 * 사무소는 관리자가 생성하므로 여기서는 UPDATE 만 한다.
 * (테넌트를 API 로 새로 만들 수 없게 해 두는 편이 안전하다)
 */
async function save(firmId, firm = {}) {
  const { rows } = await db.query(
    `UPDATE firms SET
       name         = $2,
       biz_no       = $3,
       ceo          = $4,
       bank         = $5,
       account_no   = $6,
       phone        = $7,
       taxbot_id    = $8,
       taxbot_pw    = $9,
       logo         = $10,
       invoice_logo = $11
     WHERE id = $1
     RETURNING ${COLS}`,
    [
      firmId,
      s(firm.name), s(firm.bizNo), s(firm.ceo), s(firm.bank), s(firm.account),
      s(firm.phone), s(firm.taxbotId), s(firm.taxbotPw), s(firm.logo), s(firm.invoiceLogo),
    ]
  );
  if (!rows[0]) return toFirm({});
  return toFirm(rows[0]);
}

module.exports = { get, save };

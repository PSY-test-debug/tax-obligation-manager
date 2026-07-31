# App.js 연동 가이드 (최소 변경)

3,615줄 App.js를 통째로 재작성하지 않습니다. **8개 지점만** 수정하면 전체가 DB에 연결됩니다.

훅이 `useState`와 동일한 시그니처를 제공하므로 `patch`, `setRow`, `setEst`, `saveProfile`, `doMigrate`, `rollForward` 등 **하위 로직은 한 줄도 손대지 않습니다.**

---

## 사전 준비

`web/src/api/`, `web/src/hooks/` 폴더를 React 프로젝트의 `src/` 아래로 복사합니다.

```
src/
  App.js              ← 아래 8개 지점만 수정
  api/
    client.js
    endpoints.js
  hooks/
    useWriteThroughMap.js
    useAppData.js
```

프로젝트 루트에 `.env` 추가 (CRA 기준):

```
REACT_APP_API_BASE=http://localhost:5000/api
```

---

## 수정 1 — import 추가 (파일 최상단, 6행 뒤)

```js
import {
  Check, RefreshCw, LogOut, Building2, User, Search,
  ChevronDown, AlertCircle, ClipboardList, ArrowRight,
  X, Plus, Phone, Mail, KeyRound, Users, Wallet, Pencil, Info, Trash2, Settings, Printer, Link2,
} from "lucide-react";

/* ▼ 추가 */
import { useVendors, useDeptAccounts, useLedger, useFirm } from "./hooks/useAppData";
import { LEDGER } from "./api/endpoints";
import { describeError } from "./api/client";
```

---

## 수정 2 — Dashboard 상태 교체 (413~423행)

`flash`가 아래에서 정의되므로, 훅의 `onError`는 **ref를 경유**해야 합니다. (그냥 `flash`를 넘기면 초기화 순서 때문에 `undefined` 참조가 됩니다.)

### 변경 전

```js
  const [store, setStore] = useState(seedStore);
  const [query, setQuery] = useState("");
  const [migrate, setMigrate] = useState(null);
  const [migrateIncludeCurrent, setMigrateIncludeCurrent] = useState(true);
  const [toast, setToast] = useState("");
  const [profiles, setProfiles] = useState(seedProfiles);
  const [vatStore, setVatStore] = useState(seedVat);
  const [jongStore, setJongStore] = useState(seedJongse);
  const [corpStore, setCorpStore] = useState(seedCorp);
  const [firm, setFirm] = useState({ name: "", bizNo: "", ceo: "", bank: "", account: "", phone: "", taxbotId: "", taxbotPw: "", logo: "", invoiceLogo: "" });
  const [deptAccounts, setDeptAccounts] = useState(seedDeptAccounts);
```

### 변경 후

```js
  const [query, setQuery] = useState("");
  const [migrate, setMigrate] = useState(null);
  const [migrateIncludeCurrent, setMigrateIncludeCurrent] = useState(true);
  const [toast, setToast] = useState("");

  /* 서버 통신 오류를 기존 토스트로 그대로 노출한다.
   * flash 는 아래에서 정의되므로 ref 를 경유한다(초기화 순서). */
  const flashRef = useRef(null);
  const handleApiError = useCallback((err, phase) => {
    const prefix = phase === "load" ? "데이터를 불러오지 못했습니다" : "저장하지 못했습니다";
    if (flashRef.current) flashRef.current(`${prefix}: ${describeError(err)}`);
  }, []);

  /* 총괄업체 · 담당자 · 사무소 설정 */
  const vendors      = useVendors({ onError: handleApiError });
  const deptAccountsRes = useDeptAccounts({ onError: handleApiError });
  const firmRes      = useFirm({ onError: handleApiError });

  /* 세목 원장 4종 (미수금은 ReceivablesTab 내부에서 별도 사용) */
  const whtRes    = useLedger(LEDGER.WHT,    { onError: handleApiError });
  const vatRes    = useLedger(LEDGER.VAT,    { onError: handleApiError });
  const incomeRes = useLedger(LEDGER.INCOME, { onError: handleApiError });
  const corpRes   = useLedger(LEDGER.CORP,   { onError: handleApiError });

  /* ── 이하 기존 변수명을 그대로 유지한다 ──
   * 덕분에 이 아래 3,100여 줄은 수정이 필요 없다. */
  const profiles = vendors.value;
  const setProfiles = vendors.setValue;
  const deptAccounts = deptAccountsRes.value;
  const setDeptAccounts = deptAccountsRes.setValue;
  const firm = firmRes.firm;
  const store = whtRes.value;
  const setStore = whtRes.setValue;
  const vatStore = vatRes.value;
  const setVatStore = vatRes.setValue;
  const jongStore = incomeRes.value;
  const setJongStore = incomeRes.setValue;
  const corpStore = corpRes.value;
  const setCorpStore = corpRes.setValue;
```

`import` 문에 `useRef`, `useCallback`이 이미 포함되어 있는지 확인하세요. 1행은 원래 `useState, useMemo, useEffect, useRef`이므로 **`useCallback`만 추가**하면 됩니다.

```js
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
```

---

## 수정 3 — flashRef 연결 (445행 `flash` 정의 바로 뒤)

```js
  const flash = (msg) => { setToast(msg); };
  flashRef.current = flash;   /* ▼ 추가 */
```

---

## 수정 4 — 초기 로딩 화면 (442행 `const key = ...` 앞)

**이 처리는 필요합니다.** 없으면 로딩 중 `store`가 `{}`이라 원천세 화면에 “데이터가 없습니다 → 전월 데이터를 이관하시겠습니까?” 안내가 순간적으로 떴다 사라집니다. 사용자가 잘못 클릭할 수 있습니다.

```js
  /* 최초 로딩 — 기존 화면 구성은 그대로 두고 로딩 표시만 추가한다 */
  const bootLoading =
    vendors.status === "loading" ||
    deptAccountsRes.status === "loading" ||
    whtRes.status === "loading";

  if (bootLoading) {
    return (
      <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT, color: INK,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Style />
        <div style={{ textAlign: "center" }}>
          <RefreshCw size={22} color={NAVY} className="spin" />
          <div style={{ marginTop: 10, fontSize: 13, color: SUB }}>데이터를 불러오는 중입니다…</div>
        </div>
      </div>
    );
  }
```

`Style()` 컴포넌트에 회전 애니메이션이 없으면 아래를 추가합니다 (3582행 `Style` 함수 내부 `<style>` 안).

```css
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }
```

---

## 수정 5 — 사무소 설정 저장 (667행)

### 변경 전

```js
{settingsOpen && <FirmSettingsModal firm={firm} onSave={(f) => { setFirm(f); setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)} />}
```

### 변경 후

```js
{settingsOpen && (
  <FirmSettingsModal
    firm={firm}
    onSave={async (f) => {
      const ok = await firmRes.save(f);          /* 서버 저장 후 닫는다 */
      if (ok) { setSettingsOpen(false); flash("사무소 설정을 저장했습니다."); }
    }}
    onClose={() => setSettingsOpen(false)}
  />
)}
```

사무소 설정은 모달에서 “저장”을 누를 때만 바뀌므로 debounce 없이 즉시 저장합니다. 실패 시 모달이 닫히지 않아 재시도할 수 있습니다.

---

## 수정 6 — ReceivablesTab의 미수금 스토어 (1441행)

### 변경 전

```js
  const [store, setStore] = useState(seedAR);
```

### 변경 후

```js
  const arRes = useLedger(LEDGER.AR);
  const store = arRes.value;
  const setStore = arRes.setValue;
```

`setRow`, `setNum`, `rollForward`, `addToMonth`, `originMonths` 모두 그대로 동작합니다.

---

## 수정 7 — 담당자 삭제 시 서버 반영 확인 (StaffAccountsModal, 1306행)

이 모달은 `setDeptAccounts`로 map 전체를 교체합니다. 훅이 **삭제된 키를 감지해 DELETE를 호출**하므로 별도 수정은 필요 없습니다.

단, 담당자를 삭제하면 서버에서 해당 업체들의 `dept_id`가 `NULL`이 됩니다(= 미배정). 프론트의 `profiles`는 이를 모르므로 목록을 다시 불러와야 정확합니다.

```js
/* StaffAccountsModal 을 닫을 때 (668행) */
{staffModalOpen && (
  <StaffAccountsModal
    deptAccounts={deptAccounts}
    setDeptAccounts={setDeptAccounts}
    profiles={profiles}
    onClose={async () => {
      setStaffModalOpen(false);
      await deptAccountsRes.flush();   /* 대기 중 저장 반영 */
      vendors.reload();                /* 담당자 해제 결과 반영 */
    }}
  />
)}
```

---

## 수정 8 — 시드 함수 처리

`seedStore`, `seedProfiles`, `seedVat`, `seedJongse`, `seedCorp`, `seedAR`, `seedDeptAccounts`는 더 이상 호출되지 않습니다.

**삭제하지 마세요.** 서버 없이 UI만 확인할 때 유용하고, `server/scripts/seed.js`의 기준 데이터이기도 합니다. 린터가 미사용 경고를 내면 함수 위에 주석만 답니다.

```js
/* eslint-disable-next-line no-unused-vars */
function seedStore() { … }
```

`seedJongso`(2347행)와 `JongsoTab`(2367행)은 **현재 어느 탭에서도 렌더되지 않는 구 버전**이므로 연동 대상에서 제외했습니다. 그대로 둡니다.

---

## 변경 요약

| 지점 | 행 | 내용 |
|---|---|---|
| 1 | 1, 6 | `useCallback` 및 훅/API import 추가 |
| 2 | 413–423 | 7개 `useState` → 훅 (변수명 유지) |
| 3 | 445 | `flashRef.current = flash` |
| 4 | 442 앞 | 초기 로딩 화면 |
| 5 | 667 | 사무소 설정 즉시 저장 |
| 6 | 1441 | 미수금 스토어 |
| 7 | 668 | 담당자 모달 닫을 때 재조회 |
| 8 | — | 시드 함수 유지 (주석만) |

**수정 총량 약 60줄.** 나머지 3,550여 줄은 변경 없습니다.

---

## 동작 확인 순서

1. `cd server && npm install && npm run migrate && npm run seed && npm start`
2. `npm run dev` (프론트)
3. 로그인 → **총괄업체 관리** 탭에 14개 업체가 보이는지, 순서가 `가온한의원 … 미선의원`인지 확인
4. **원천세** 탭 → “총괄업체 데이터 불러오기” → 그리드 생성
5. 체크박스 몇 개 클릭 → **F5 새로고침** → 유지되는지 확인
6. 업체 하나 열어 정보 수정 → 저장 → 새로고침 → 유지 확인
7. 서버를 끄고 체크박스 클릭 → “저장하지 못했습니다…” 토스트 확인 → 서버 재시작 후 다시 클릭하면 자동 복구

7번이 중요합니다. 저장 실패한 변경은 baseline에 반영되지 않으므로 **다음 편집 시 자동 재시도**됩니다.

---

## 알아두어야 할 동작

**자동 저장 간격 600ms.** 편집이 멈춘 뒤 600ms 후 변경된 기간만 저장합니다. 셀마다 요청하지 않기 때문에 원천세 그리드처럼 체크박스가 많은 화면에서도 요청이 폭증하지 않습니다.

**동시 편집 보호.** 두 담당자가 같은 달을 편집하면 나중 저장이 409로 거부되고 서버 값을 다시 불러옵니다. 조용히 덮어쓰지 않습니다.

**업체 삭제는 소프트 삭제.** 원장 payload가 업체 id를 참조하므로 물리 삭제하면 과거 신고 이력의 업체명 조회가 깨집니다. 목록에서는 사라지지만 데이터는 남습니다.

**표시 순서.** 프론트는 `Object.values(profiles)`를 정렬 없이 렌더합니다. 서버가 `sort_order` 기준으로 내려주므로 기존 순서가 유지되고, 신규 업체는 맨 뒤에 붙습니다.

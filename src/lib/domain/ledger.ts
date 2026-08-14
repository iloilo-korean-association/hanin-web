import { toInt, monthsOfYear, monthOf } from "./money";
import { maskRealNames, publicPayee } from "./normalize";
import type { PayeePolicy } from "../validators/enums";
import { checkReceiptGaps, parseReceiptNo, type GapCheck } from "./invariants";
import { wasEdited } from "./direct-entry";

/**
 * 장부 집계 — 계좌·기금 잔액과 공개 회계.
 *
 * 원본: 02_노코드MVP/AppsScript/00_공통_유틸.gs 의 accountBalancesAsOf_ · fundBalancesAsOf_
 *       02_노코드MVP/AppsScript/11_웹앱_공개.gs 의 공개회계계산_
 *
 * ★ 전부 순수 함수다. 행 배열을 받아 계산만 한다. DB 를 모른다.
 *   → 서버 컴포넌트에서 findMany 로 읽어 그대로 넘기면 된다. 테스트도 그냥 된다.
 *
 * ★ 공개 범위 규칙 (필리핀 DPA RA10173 + 한국 PIPA)
 *   · 지출은 건별 전액 공개 (일자·과목·금액·수취인·적요·증빙유무·이해관계자배지)
 *   · **수입은 집계만.** 누가 얼마 냈는지 실명 공개 금지 — 미납자 낙인 + 법 위반 소지.
 *   → buildPublicLedger 는 수입 건별 목록을 **만들지 않는다.** 만들지 마라.
 */

/* ── 입력 행 타입 ─────────────────────────────────────────────────────── */

export type TxRow = {
  receiptNo: string;
  date: string;
  direction: string;
  amountPhp: number;
  accountId: string;
  fundId: string;
  categoryCode: string;
  counterpartyType: string;
  counterpartyName: string;
  method: string;
  memo: string;
  status: string;
  relatedParty: boolean;
  evidenceUrl: string;
  voidReason: string;
  fiscalYear: number;
  seq: number;
  /**
   * [추가] 사전 승인을 없앤 뒤 생긴 두 값. 없으면 옛 데이터로 보고 조용히 넘어간다
   * (임포트·테스트가 이 필드를 안 채우고 부르는 경로가 있다).
   */
  enteredAt?: Date | string | null;
  updatedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
};

export type AccountRow = {
  accountId: string;
  name: string;
  kind: string;
  status: string;
  openedOn: string;
  openingBalance: number;
  isPublic: boolean;
};

export type FundRow = {
  fundId: string;
  name: string;
  kind: string;
  purpose: string;
  startOn: string;
  openingBalance: number;
  isPublic: boolean;
};

export type CategoryRow = {
  code: string;
  publicName: string;
  name: string;
  majorType: string;
  isPublic: boolean;
  sortOrder: number;
};

/* ── 계좌 잔액 ────────────────────────────────────────────────────────── */

export type AccountBalance = AccountRow & {
  inflow: number;
  outflow: number;
  balance: number;
};

/**
 * asOf 일자(포함) 기준 계좌별 장부잔액.
 *
 * ★ 각 계좌의 **개시일 이후** POSTED 거래만 더한다.
 *   개시잔액은 연도이월(I6) 때 전기 마감잔액으로 갱신되므로, 개시일 이전 거래까지 또 더하면
 *   지난 연도가 이중계상된다. 개시일이 그 경계선이다.
 * ★ DRAFT 와 VOIDED 는 세지 않는다. DRAFT 는 미확정, VOIDED 는 역분개가 따로 잡힌다.
 */
export function accountBalancesAsOf(
  accounts: readonly AccountRow[],
  txs: readonly TxRow[],
  asOf?: string,
): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const a of accounts) {
    map.set(a.accountId, {
      ...a,
      openingBalance: toInt(a.openingBalance),
      inflow: 0,
      outflow: 0,
      balance: 0,
    });
  }
  for (const t of txs) {
    if (String(t.status).toUpperCase() !== "POSTED") continue;
    if (!t.date) continue;
    if (asOf && t.date > asOf) continue;
    const row = map.get(t.accountId);
    if (!row) continue;
    if (t.date < row.openedOn) continue;
    const p = toInt(t.amountPhp);
    if (String(t.direction).toUpperCase() === "IN") row.inflow += p;
    else row.outflow += p;
  }
  for (const row of map.values()) row.balance = row.openingBalance + row.inflow - row.outflow;
  return [...map.values()].sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
}

export type FundBalance = FundRow & {
  income: number;
  expense: number;
  balance: number;
};

/** 위와 같은 방식의 기금별 잔액. 기금은 시작일이 경계선이다. */
export function fundBalancesAsOf(
  funds: readonly FundRow[],
  txs: readonly TxRow[],
  asOf?: string,
): FundBalance[] {
  const map = new Map<string, FundBalance>();
  for (const f of funds) {
    map.set(f.fundId, { ...f, openingBalance: toInt(f.openingBalance), income: 0, expense: 0, balance: 0 });
  }
  for (const t of txs) {
    if (String(t.status).toUpperCase() !== "POSTED") continue;
    if (!t.date) continue;
    if (asOf && t.date > asOf) continue;
    const row = map.get(t.fundId);
    if (!row) continue;
    if (t.date < row.startOn) continue;
    const p = toInt(t.amountPhp);
    if (String(t.direction).toUpperCase() === "IN") row.income += p;
    else row.expense += p;
  }
  for (const row of map.values()) row.balance = row.openingBalance + row.income - row.expense;
  return [...map.values()].sort((a, b) => (a.fundId < b.fundId ? -1 : 1));
}

/* ── 공개 회계 ────────────────────────────────────────────────────────── */

export type PublicLedgerOptions = {
  fiscalYear: number;
  /** 오늘(마닐라). 당해연도면 오늘까지, 지난 연도면 12/31 까지로 자른다 */
  today: string;
  /** 공개.적요공개 */
  showMemo: boolean;
  /** 공개.적요_실명마스킹 — ★ 끄지 마라 */
  maskNames: boolean;
  /** 공개.수취인_개인표기 */
  payeePolicy: PayeePolicy;
  /** 회원 실명 목록 (마스킹용). 화면으로 절대 내보내지 않는다 */
  realNames: readonly string[];
  /** 공개.지출목록_최대 */
  maxExpenseRows: number;
  /** 영수증번호.접두 */
  receiptPrefix: string;
};

export type IncomeBucket = {
  categoryCode: string;
  displayName: string;
  amount: number;
  count: number;
};

export type PublicExpenseRow = {
  receiptNo: string;
  date: string;
  categoryCode: string;
  categoryName: string;
  fundId: string;
  fundName: string;
  amount: number;
  method: string;
  counterpartyType: string;
  /** 마스킹 정책이 적용된 표기 */
  payee: string;
  memo: string;
  hasEvidence: boolean;
  relatedParty: boolean;
  voided: boolean;
  voidReason: string;
  /**
   * 감사가 확인 도장을 찍었는가 (Transaction.reviewedAt).
   *
   * ★ 사전 승인을 없앤 뒤로 **이것이 공개 장부에서 가장 중요한 한 칸**이다.
   *   예전에는 "지출이 여기 있다 = 결재를 거쳤다" 였다. 이제는 아니다.
   *   그래서 거쳤는지 여부를 밖에서 볼 수 있게 그대로 내보낸다.
   */
  reviewed: boolean;
  /** 처음 적은 뒤에 내용이 바뀐 적이 있는가. 공개한 숫자가 사후에 바뀌면 밖에서 알아야 한다. */
  edited: boolean;
  /**
   * 내부이체 — 한인회 자기 계좌 사이의 돈 이동(현금함 → 통장 등).
   * ★ 목록에는 남기되 총수입·총지출에는 넣지 않는다. 넣으면 같은 돈이 수입에도 지출에도 잡혀
   *   "얼마 걷어서 얼마 썼나" 가 부풀려진다. 화면은 이 행을 다르게 표시해야 한다.
   */
  internalTransfer: boolean;
};

/** 자기 계좌 간 이동인가. */
export function isInternalTransfer(t: { counterpartyType: string }): boolean {
  return String(t.counterpartyType ?? "").trim() === "내부이체";
}

export type MonthPoint = { month: string; income: number; expense: number };

export type PublicLedger = {
  fiscalYear: number;
  totalIncome: number;
  totalExpense: number;
  net: number;
  postedCount: number;
  months: MonthPoint[];
  incomeByCategory: IncomeBucket[];
  expenses: PublicExpenseRow[];
  expensesTruncated: number;
  accounts: AccountBalance[];
  accountTotals: { openingBalance: number; inflow: number; outflow: number; balance: number };
  hiddenAccounts: { count: number; balance: number };
  funds: FundBalance[];
  fundTotal: number;
  /** 지정기금 잔액이 음수인 건이 있는가 — 있으면 목적외 사용 의심 */
  fundWarning: boolean;
  metrics: {
    gaps: GapCheck;
    evidenceRate: number | null;
    postedCount: number;
    withEvidence: number;
    draftCount: number;
    voidedCount: number;
    relatedPartyCount: number;
    relatedPartyAmount: number;
    /** 내부이체로 오간 금액 (총수입·총지출에서 제외된 액수) */
    internalTransferAmount: number;
    internalTransferCount: number;
    totalRows: number;
  };
};

/**
 * 공개 회계 집계.
 *
 * ★ 수입은 과목별 합계만 만든다. 건별 목록은 만들지 않는다 — 누가 얼마 냈는지가 드러난다.
 * ★ 지출은 VOIDED 도 "무효" 표시로 남긴다. 지우면 I1 의 의미가 사라진다.
 * ★ DRAFT 는 집계에도 목록에도 넣지 않는다(미확정).
 */
export function buildPublicLedger(
  txs: readonly TxRow[],
  accounts: readonly AccountRow[],
  funds: readonly FundRow[],
  categories: readonly CategoryRow[],
  opt: PublicLedgerOptions,
): PublicLedger {
  const fy = opt.fiscalYear;
  const from = `${fy}-01-01`;
  const to = `${fy}-12-31`;
  const catMap = new Map(categories.map((c) => [c.code, c]));
  const fundMap = new Map(funds.map((f) => [f.fundId, f]));

  const monthTable = new Map<string, MonthPoint>(
    monthsOfYear(fy).map((m) => [m, { month: m, income: 0, expense: 0 }]),
  );

  let totalIncome = 0;
  let totalExpense = 0;
  let postedCount = 0;
  let withEvidence = 0;
  let draftCount = 0;
  let voidedCount = 0;
  let relatedPartyCount = 0;
  let relatedPartyAmount = 0;
  let internalTransferAmount = 0;
  let internalTransferCount = 0;

  const incomeBuckets = new Map<string, IncomeBucket>();
  const expenses: PublicExpenseRow[] = [];
  const seqs: number[] = [];

  for (const t of txs) {
    if (!t.receiptNo) continue;

    // 결번 검사는 상태와 무관하게 "발행된 번호" 를 센다 (I2 는 번호에 관한 불변식이다)
    const parsed = parseReceiptNo(t.receiptNo);
    if (parsed && parsed.fiscalYear === fy && parsed.prefix === opt.receiptPrefix) seqs.push(parsed.seq);

    if (!t.date || t.date < from || t.date > to) continue;

    const status = String(t.status).toUpperCase();
    const dir = String(t.direction).toUpperCase();
    const amount = toInt(t.amountPhp);
    const hasEvidence = !!String(t.evidenceUrl ?? "").trim();
    const internal = isInternalTransfer(t);

    if (status === "DRAFT") {
      draftCount++;
      continue; // 미확정은 집계에도 목록에도 넣지 않는다
    }
    if (status === "VOIDED") voidedCount++;

    if (status === "POSTED") {
      postedCount++;
      if (hasEvidence) withEvidence++;
      if (internal) {
        // ★ 자기 계좌 간 이동은 수입도 지출도 아니다. 양쪽에서 똑같이 빼므로 수지(net)는 그대로다.
        //   빼지 않으면 현금을 통장에 넣은 것만으로 "수입 1만 · 지출 1만" 이 늘어나
        //   회원이 보는 "얼마 걷어서 얼마 썼나" 가 부풀려진다.
        if (dir === "OUT") {
          internalTransferAmount += amount;
          internalTransferCount++;
        }
      } else {
        const mk = monthOf(t.date);
        if (!monthTable.has(mk)) monthTable.set(mk, { month: mk, income: 0, expense: 0 });
        const mp = monthTable.get(mk)!;
        if (dir === "IN") {
          totalIncome += amount;
          mp.income += amount;
        } else {
          totalExpense += amount;
          mp.expense += amount;
        }
      }
      if (t.relatedParty) {
        relatedPartyCount++;
        relatedPartyAmount += amount;
      }
    }

    if (dir === "IN") {
      // ★ 수입은 집계만. 건별 목록을 절대 만들지 않는다.
      if (status === "POSTED" && !internal) {
        const cat = catMap.get(t.categoryCode);
        const code = cat && cat.isPublic ? t.categoryCode : "기타";
        const label = cat && cat.isPublic ? cat.publicName : "기타 수입";
        const b = incomeBuckets.get(code) ?? { categoryCode: code, displayName: label, amount: 0, count: 0 };
        b.amount += amount;
        b.count += 1;
        incomeBuckets.set(code, b);
      }
      continue;
    }

    // ---- 지출: 건별 전액 공개 ----
    const cat = catMap.get(t.categoryCode);
    const memoSrc = String(t.memo ?? "");
    expenses.push({
      receiptNo: t.receiptNo,
      date: t.date,
      categoryCode: t.categoryCode,
      categoryName: cat?.publicName || cat?.name || t.categoryCode || "(미분류)",
      fundId: t.fundId,
      fundName: fundMap.get(t.fundId)?.name ?? "",
      amount,
      method: t.method,
      counterpartyType: t.counterpartyType || "미기재",
      payee: publicPayee(t.counterpartyType, t.counterpartyName, opt.payeePolicy, opt.realNames),
      memo: opt.showMemo ? (opt.maskNames ? maskRealNames(memoSrc, opt.realNames) : memoSrc) : "",
      hasEvidence,
      relatedParty: t.relatedParty,
      voided: status === "VOIDED",
      // ★ 무효사유도 임원이 자유롭게 쓰는 칸이다. 적요와 같은 실명 마스킹을 건다.
      voidReason:
        status === "VOIDED"
          ? opt.maskNames
            ? maskRealNames(String(t.voidReason ?? ""), opt.realNames)
            : String(t.voidReason ?? "")
          : "",
      internalTransfer: internal,
      reviewed: !!t.reviewedAt,
      edited: wasEdited(t),
    });
  }

  expenses.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.receiptNo < b.receiptNo ? 1 : -1));
  const expensesTruncated = Math.max(0, expenses.length - opt.maxExpenseRows);
  const shownExpenses = expenses.slice(0, opt.maxExpenseRows);

  const asOf = opt.today >= from && opt.today <= to ? opt.today : to;

  const allAccountBalances = accountBalancesAsOf(accounts, txs, asOf);
  const accountTotals = allAccountBalances.reduce(
    (s, a) => ({
      openingBalance: s.openingBalance + a.openingBalance,
      inflow: s.inflow + a.inflow,
      outflow: s.outflow + a.outflow,
      balance: s.balance + a.balance,
    }),
    { openingBalance: 0, inflow: 0, outflow: 0, balance: 0 },
  );
  const hidden = allAccountBalances.filter((a) => !a.isPublic);
  const publicAccounts = allAccountBalances.filter((a) => a.isPublic);

  const allFundBalances = fundBalancesAsOf(funds, txs, asOf);
  const fundTotal = allFundBalances.reduce((s, f) => s + f.balance, 0);
  const fundWarning = allFundBalances.some((f) => f.kind === "지정" && f.balance < 0);
  const publicFunds = allFundBalances.filter((f) => f.isPublic);

  const months = [...monthTable.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  const incomeByCategory = [...incomeBuckets.values()].sort((a, b) => b.amount - a.amount);

  return {
    fiscalYear: fy,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    postedCount,
    months,
    incomeByCategory,
    expenses: shownExpenses,
    expensesTruncated,
    accounts: publicAccounts,
    accountTotals,
    hiddenAccounts: { count: hidden.length, balance: hidden.reduce((s, a) => s + a.balance, 0) },
    funds: publicFunds,
    fundTotal,
    fundWarning,
    metrics: {
      gaps: checkReceiptGaps(seqs),
      evidenceRate: postedCount ? Math.round((withEvidence * 1000) / postedCount) / 10 : null,
      postedCount,
      withEvidence,
      draftCount,
      voidedCount,
      relatedPartyCount,
      relatedPartyAmount,
      internalTransferAmount,
      internalTransferCount,
      totalRows: txs.length,
    },
  };
}

/* ── 대차 검산 ────────────────────────────────────────────────────────── */

export type BalanceAudit = {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
};

/**
 * 장부가 스스로 앞뒤가 맞는가. 시드 직후와 주간 무결성 검사에서 돌린다.
 *
 *  1) 계좌 합계 잔액 = 개시합계 + 총수입 - 총지출
 *  2) 계좌 합계 잔액 = 기금 합계 잔액   ← 모든 거래가 계좌와 기금 양쪽에 달려 있으므로 같아야 한다
 *  3) 음수 잔액 계좌 없음
 *  4) 지정기금 음수 없음 (목적외 사용)
 *  5) 영수증번호 결번 없음 (I2)
 */
export function auditBalances(
  accounts: readonly AccountRow[],
  funds: readonly FundRow[],
  txs: readonly TxRow[],
  fiscalYear: number,
  receiptPrefix: string,
  asOf?: string,
): BalanceAudit {
  const ab = accountBalancesAsOf(accounts, txs, asOf);
  const fb = fundBalancesAsOf(funds, txs, asOf);

  const posted = txs.filter(
    (t) => String(t.status).toUpperCase() === "POSTED" && (!asOf || t.date <= asOf),
  );
  const income = posted.filter((t) => t.direction === "IN").reduce((s, t) => s + toInt(t.amountPhp), 0);
  const expense = posted.filter((t) => t.direction !== "IN").reduce((s, t) => s + toInt(t.amountPhp), 0);

  const accTotal = ab.reduce((s, a) => s + a.balance, 0);
  const accOpening = ab.reduce((s, a) => s + a.openingBalance, 0);
  const fundTotal = fb.reduce((s, f) => s + f.balance, 0);

  const checks: BalanceAudit["checks"] = [];

  const expected = accOpening + income - expense;
  checks.push({
    name: "계좌잔액 = 개시 + 수입 - 지출",
    ok: accTotal === expected,
    detail: `${accTotal} vs ${expected} (개시 ${accOpening} + 수입 ${income} - 지출 ${expense})`,
  });

  checks.push({
    name: "계좌 합계 = 기금 합계",
    ok: accTotal === fundTotal,
    detail: `계좌 ${accTotal} vs 기금 ${fundTotal}`,
  });

  const negAcc = ab.filter((a) => a.balance < 0);
  checks.push({
    name: "음수 잔액 계좌 없음",
    ok: negAcc.length === 0,
    detail: negAcc.length ? negAcc.map((a) => `${a.accountId}=${a.balance}`).join(", ") : "없음",
  });

  const negFund = fb.filter((f) => f.balance < 0);
  checks.push({
    name: "음수 잔액 기금 없음",
    ok: negFund.length === 0,
    detail: negFund.length ? negFund.map((f) => `${f.fundId}(${f.kind})=${f.balance}`).join(", ") : "없음",
  });

  const seqs = txs
    .map((t) => parseReceiptNo(t.receiptNo))
    .filter((p): p is NonNullable<typeof p> => !!p && p.fiscalYear === fiscalYear && p.prefix === receiptPrefix)
    .map((p) => p.seq);
  const gaps = checkReceiptGaps(seqs);
  checks.push({ name: "영수증번호 결번 없음 (I2)", ok: gaps.ok, detail: gaps.message });

  return { ok: checks.every((c) => c.ok), checks };
}

/* eslint-disable no-console */
/**
 * 검산 — **DB 를 다시 읽어서** 확인한다.
 *
 * seed.ts 안의 검산은 메모리에 만든 계획을 검사한 것이다. 이 파일은 그게 실제로 DB 에
 * 그대로 들어갔는지를 확인한다. 둘 다 통과해야 "됐다" 고 말할 수 있다.
 *
 * 실행: npm run db:verify
 * 통과 못 하면 exit code 1.
 */
import { PrismaClient } from "@prisma/client";
import {
  auditBalances,
  buildPublicLedger,
  buildRealNameList,
  checkOpeningBalance,
  evaluateConflict,
  evaluateTxState,
  formatPeso,
  isExactRealName,
  isFyClosedIn,
  loadSettings,
  publicPolicyFrom,
  cfgNum,
  cashThresholdFrom,
  decideApprovalRoute,
  approvalConfigFrom,
  checkApprovalTrail,
  type AccountRow,
  type CategoryRow,
  type FundRow,
  type TxRow,
} from "../src/lib/domain";

const prisma = new PrismaClient();
const FY = 2026;
const TODAY = "2026-08-08";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

async function main(): Promise<void> {
  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);
  const cashThreshold = cashThresholdFrom(settings);

  const [accounts, funds, categories, txs, members, years, approvals, vendors, conflicts, officers] =
    await Promise.all([
      prisma.account.findMany(),
      prisma.fund.findMany(),
      prisma.category.findMany(),
      prisma.transaction.findMany({ orderBy: { seq: "asc" } }),
      prisma.member.findMany({ select: { memberNo: true, name: true } }),
      prisma.fiscalYear.findMany(),
      prisma.approval.findMany(),
      prisma.vendor.findMany(),
      prisma.conflictOfInterest.findMany(),
      prisma.officer.findMany(),
    ]);

  const accountRows: AccountRow[] = accounts.map((a) => ({
    accountId: a.accountId, name: a.name, kind: a.kind, status: a.status,
    openedOn: a.openedOn, openingBalance: a.openingBalance, isPublic: a.isPublic,
  }));
  const fundRows: FundRow[] = funds.map((f) => ({
    fundId: f.fundId, name: f.name, kind: f.kind, purpose: f.purpose,
    startOn: f.startOn, openingBalance: f.openingBalance, isPublic: f.isPublic,
  }));
  const categoryRows: CategoryRow[] = categories.map((c) => ({
    code: c.code, publicName: c.publicName, name: c.name,
    majorType: c.majorType, isPublic: c.isPublic, sortOrder: c.sortOrder,
  }));
  const txRows: TxRow[] = txs.map((t) => ({
    receiptNo: t.receiptNo, date: t.date, direction: t.direction, amountPhp: t.amountPhp,
    accountId: t.accountId, fundId: t.fundId, categoryCode: t.categoryCode,
    counterpartyType: t.counterpartyType, counterpartyName: t.counterpartyName,
    method: t.method, memo: t.memo, status: t.status, relatedParty: t.relatedParty,
    evidenceUrl: t.evidenceUrl, voidReason: t.voidReason, fiscalYear: t.fiscalYear, seq: t.seq,
  }));

  /* ── 대차 · 결번 · 개시잔액 ─────────────────────────────────────── */
  const audit = auditBalances(accountRows, fundRows, txRows, FY, policy.receiptPrefix, TODAY);
  for (const c of audit.checks) check(c.name, c.ok, c.detail);

  const prior = years.find((y) => y.year === FY - 1);
  const opening = checkOpeningBalance(accountRows, prior?.closingTotalPhp ?? null);
  check("I6 개시잔액 = 전기 마감", opening.ok, opening.message);

  /* ── I2: seq 가 DB 에서도 1..N 연속인가 ─────────────────────────── */
  const seqs = txs.map((t) => t.seq).sort((a, b) => a - b);
  const seqOk = seqs.every((s, i) => s === i + 1);
  check("I2 seq 연속 (DB)", seqOk, `1..${seqs.length}`);

  const counter = await prisma.receiptSequence.findUnique({ where: { fiscalYear: FY } });
  check(
    "I2 채번 카운터 = 발행 건수",
    counter?.lastSeq === txs.length,
    `카운터 ${counter?.lastSeq ?? "없음"} vs 거래 ${txs.length}`,
  );

  /* ── I3/I4: 저장된 status 가 도메인 판정과 일치하는가 ───────────── */
  const mismatched = txs.filter((t) => {
    if (t.status === "VOIDED") return false; // VOIDED 는 사람이 정하는 상태
    const v = evaluateTxState(
      { evidenceUrl: t.evidenceUrl, method: t.method, amount: t.amount, currency: t.currency, fxRate: t.fxRate, enteredBy: t.enteredBy, verifiedBy: t.verifiedBy },
      cashThreshold,
    );
    return v.status !== t.status;
  });
  check("I3/I4 상태 = 도메인 판정", mismatched.length === 0, mismatched.length ? mismatched.map((t) => t.receiptNo).join(",") : "전 건 일치");

  const postedNoEvidence = txs.filter((t) => t.status === "POSTED" && !t.evidenceUrl.trim());
  check("I3 증빙 없는 POSTED 없음", postedNoEvidence.length === 0, `${postedNoEvidence.length}건`);

  const badCash = txs.filter(
    (t) => t.status === "POSTED" && t.method === "CASH" && t.amountPhp > cashThreshold &&
      (!t.verifiedBy || t.verifiedBy.toLowerCase() === t.enteredBy.toLowerCase()),
  );
  check("I4 현금 고액 2인 확인", badCash.length === 0, `${badCash.length}건`);

  /* ── I1: VOIDED 에 사유가 있는가 ────────────────────────────────── */
  const voidNoReason = txs.filter((t) => t.status === "VOIDED" && !t.voidReason.trim());
  check("I1 무효사유 없는 VOIDED 없음", voidNoReason.length === 0, `${voidNoReason.length}건`);

  /* ── I5: 마감 연도에 거래가 없는가 ──────────────────────────────── */
  const closedYearTx = txs.filter((t) => isFyClosedIn(t.fiscalYear, years));
  check("I5 마감 연도 거래 없음", closedYearTx.length === 0, `${closedYearTx.length}건`);

  /* ── 지출 승인: 3,000 초과 POSTED 지출에 승인이 붙어 있는가 ─────── */
  const soleLimit = cfgNum(settings, "승인한도.총무", 3000);
  const apMap = new Map(approvals.map((a) => [a.approvalId, a]));
  // 내부이체(자기 계좌 간 이동)는 지출이 아니다 — 승인한도표의 대상이 아니다.
  const unapproved = txs.filter(
    (t) =>
      t.direction === "OUT" &&
      t.status === "POSTED" &&
      t.counterpartyType !== "내부이체" &&
      t.amountPhp > soleLimit &&
      !t.approvalId,
  );
  check(`전결 한도(${soleLimit}) 초과 지출에 승인 있음`, unapproved.length === 0, unapproved.length ? unapproved.map((t) => `${t.receiptNo}:${t.amountPhp}`).join(",") : "전 건 승인 있음");

  const cfg = approvalConfigFrom(settings);
  const badTrail = approvals
    .filter((a) => a.finalStatus === "집행완료")
    .map((a) => ({ a, r: checkApprovalTrail({ approvalId: a.approvalId, amountPhp: a.amountPhp, relatedParty: a.relatedParty, requiredStages: a.requiredStages, approver1: a.approver1, result1: a.result1, approver2: a.approver2, result2: a.result2, finalStatus: a.finalStatus, quoteUrl: a.quoteUrl }, cfg) }))
    .filter((x) => !x.r.ok);
  check("집행완료 승인의 결재 흔적 정상", badTrail.length === 0, badTrail.length ? badTrail.map((x) => `${x.a.approvalId}: ${x.r.ok ? "" : x.r.reason}`).join(" / ") : `${approvals.filter((a) => a.finalStatus === "집행완료").length}건 검증`);

  const wrongStages = approvals.filter(
    (a) => a.requiredStages !== decideApprovalRoute(a.amountPhp, a.relatedParty, cfg).requiredStages,
  );
  check("필요승인단계 = 재계산값", wrongStages.length === 0, wrongStages.length ? wrongStages.map((a) => a.approvalId).join(",") : `${approvals.length}건 일치`);

  /* ── 이해관계자 거래에 2단계 승인이 실제로 있는가 ───────────────── */
  const rpBad = txs
    .filter((t) => t.relatedParty && t.status === "POSTED" && t.direction === "OUT")
    .filter((t) => {
      const a = t.approvalId ? apMap.get(t.approvalId) : undefined;
      return !a || a.requiredStages !== 2 || a.result1 !== "승인" || a.result2 !== "승인";
    });
  check("이해관계자 지출 = 2단계 승인 완료", rpBad.length === 0, rpBad.length ? rpBad.map((t) => t.receiptNo).join(",") : `${txs.filter((t) => t.relatedParty && t.status === "POSTED").length}건 검증`);

  /* ── 공개 화면에 회원 실명이 0건인가 ────────────────────────────── */
  const realNames = buildRealNameList(members.map((m) => m.name));
  const ledger = buildPublicLedger(txRows, accountRows, fundRows, categoryRows, {
    fiscalYear: FY, today: TODAY, showMemo: policy.showMemo, maskNames: policy.maskNames,
    payeePolicy: policy.payeePolicy, realNames, maxExpenseRows: 10_000, receiptPrefix: policy.receiptPrefix,
  });
  const leaked = ledger.expenses.filter(
    (e) => isExactRealName(e.payee, realNames) || realNames.some((n) => e.memo.includes(n) || e.voidReason.includes(n)),
  );
  check("공개 지출목록 회원 실명 0건", leaked.length === 0, leaked.length ? leaked.map((e) => `${e.receiptNo}:${e.payee}`).join(",") : `지출 ${ledger.expenses.length}건 전수 확인`);

  // 수입은 집계만 나가야 한다 — buildPublicLedger 가 건별 수입 목록을 만들지 않는지 구조로 확인
  const hasIncomeRows = Object.prototype.hasOwnProperty.call(ledger, "incomeRows");
  check("공개 수입은 집계만 (건별 목록 없음)", !hasIncomeRows, `수입 과목 ${ledger.incomeByCategory.length}종`);

  // 내부이체를 수입·지출 양쪽에서 뺐으므로 수지(net)는 그대로여야 한다
  check(
    "공개 수지 + 개시 = 계좌 잔액",
    ledger.accountTotals.openingBalance + ledger.net === ledger.accountTotals.balance,
    `${ledger.accountTotals.openingBalance} + ${ledger.net} = ${ledger.accountTotals.balance}` +
      ` (내부이체 ${ledger.metrics.internalTransferCount}건 ${ledger.metrics.internalTransferAmount} 제외)`,
  );

  /* ── 이해상충 판정 (DB 데이터 기준) ─────────────────────────────── */
  const vRows = vendors.map((v) => ({ vendorId: v.vendorId, name: v.name, industry: v.industry, relatedMemberNo: v.relatedMemberNo, relatedParty: v.relatedParty, ownershipPct: v.ownershipPct }));
  const cRows = conflicts.map((c) => ({ conflictId: c.conflictId, declarerMemberNo: c.declarerMemberNo, declarerName: c.declarerName, role: c.role, counterpartyName: c.counterpartyName, relationType: c.relationType, vendorId: c.vendorId, detail: c.detail, disclosed: c.disclosed, recused: c.recused, ownershipPct: c.ownershipPct }));
  const oRows = officers.map((o) => ({ officerId: o.officerId, memberNo: o.memberNo, name: o.name, role: o.role, email: o.email, approvalLimit: o.approvalLimit, permissions: o.permissions, status: o.status }));

  // 우회 표기 — NFKC + 화이트리스트가 실제로 막는지
  const evasions = [
    "오톤 하드웨어",
    "- 오톤 하드웨어",
    "오​톤 하드웨어", // 제로폭 공백
    "ＰＩＡ 필리핀어학원", // 전각
    "(자로 케이터링)",
    "빌드앤셀·주택개발",
  ];
  const missed = evasions.filter((n) => !evaluateConflict({ counterpartyName: n }, vRows, cRows, oRows).related);
  check("이해상충 우회 표기 전부 탐지", missed.length === 0, missed.length ? `놓침: ${missed.join(" / ")}` : `${evasions.length}종 전부 탐지`);

  const clean = evaluateConflict({ counterpartyName: "SM 시티 일로일로 임대관리" }, vRows, cRows, oRows);
  check("무관 업체 오탐 없음", !clean.related && !clean.undetermined, `related=${clean.related}`);

  const undetermined = evaluateConflict({ counterpartyName: "---" }, vRows, cRows, oRows);
  check("부호만 있는 수취인 = 판정 불가", undetermined.undetermined, `undetermined=${undetermined.undetermined}`);

  // 회장(OF01)은 자기 업체 건을 승인할 수 없어야 한다
  const president = oRows.find((o) => o.role === "회장")!;
  const ohtonVerdict = evaluateConflict({ counterpartyName: "오톤 하드웨어" }, vRows, cRows, oRows);
  const presidentIsParty = ohtonVerdict.relatedOfficers.some((p) => p.memberNo === president.memberNo);
  check("회장 = 오톤 하드웨어 건의 회피 대상", presidentIsParty, `지분 ${ohtonVerdict.ownershipPct}%`);

  /* ── 회비고지 대사: 납부금액 = 실제 수납 거래 합계 ──────────────── */
  const invoices = await prisma.duesInvoice.findMany({ where: { fiscalYear: FY } });
  const duesByMember = new Map<string, number>();
  for (const t of txs) {
    if (t.categoryCode !== "R100" || t.status !== "POSTED" || !t.counterpartyMemberNo) continue;
    duesByMember.set(t.counterpartyMemberNo, (duesByMember.get(t.counterpartyMemberNo) ?? 0) + t.amountPhp);
  }
  // DRAFT 는 장부에 안 잡히므로 고지의 납부금액과 다를 수 있다 — 그 차이만큼만 허용한다
  const draftDues = new Map<string, number>();
  for (const t of txs) {
    if (t.categoryCode !== "R100" || t.status !== "DRAFT" || !t.counterpartyMemberNo) continue;
    draftDues.set(t.counterpartyMemberNo, (draftDues.get(t.counterpartyMemberNo) ?? 0) + t.amountPhp);
  }
  const invMismatch = invoices.filter((inv) => {
    const posted = duesByMember.get(inv.memberNo) ?? 0;
    const draft = draftDues.get(inv.memberNo) ?? 0;
    return inv.paidAmount !== posted + draft;
  });
  check("회비고지 납부금액 = 수납 거래 합계", invMismatch.length === 0, invMismatch.length ? invMismatch.map((i) => i.invoiceId).join(",") : `${invoices.length}건 대사`);

  const unpaidMath = invoices.filter((i) => i.unpaidAmount !== i.billedAmount - i.paidAmount);
  check("회비고지 미납 = 고지 - 납부", unpaidMath.length === 0, `${unpaidMath.length}건 불일치`);

  /* ── 지정기금 사용액 ≤ 접수액 ───────────────────────────────────── */
  const uses = await prisma.donationUse.groupBy({ by: ["fundId"], _sum: { amountPhp: true } });
  const donationsByFund = await prisma.donation.groupBy({ by: ["fundId"], where: { isDesignated: true }, _sum: { amountPhp: true } });
  const overUsed = uses.filter((u) => {
    const fund = funds.find((f) => f.fundId === u.fundId);
    if (!fund || fund.kind !== "지정") return false;
    const received = (donationsByFund.find((d) => d.fundId === u.fundId)?._sum.amountPhp ?? 0) + fund.openingBalance;
    return (u._sum.amountPhp ?? 0) > received;
  });
  check("지정기금 사용액 ≤ 접수액 + 개시", overUsed.length === 0, `${overUsed.length}건 초과`);

  /* ── 발송함 ─────────────────────────────────────────────────────── */
  const outbox = await prisma.outboxMail.count();
  const notify = await prisma.notifyLog.count();
  check("알림로그 = 발송함 건수", outbox === notify, `발송함 ${outbox} / 알림로그 ${notify}`);

  const magicLinks = await prisma.magicLink.findMany({ select: { linkPath: true, expiresAt: true } });
  const liveLinks = magicLinks.filter((m) => m.expiresAt > new Date());
  check("살아 있는 매직링크 있음", liveLinks.length > 0, `${liveLinks.length}/${magicLinks.length}개 유효`);

  /* ── 출력 ───────────────────────────────────────────────────────── */
  console.log("─".repeat(78));
  console.log("DB 검산 — 일로일로 한인회");
  console.log("─".repeat(78));
  for (const c of checks) {
    console.log(`  ${c.ok ? "OK  " : "FAIL"}  ${c.name.padEnd(34)} ${c.detail}`);
  }
  console.log("─".repeat(78));
  console.log(
    `  총수입 ${formatPeso(ledger.totalIncome)} · 총지출 ${formatPeso(ledger.totalExpense)} · ` +
      `수지 ${formatPeso(ledger.net)} · 잔액 ${formatPeso(ledger.accountTotals.balance)}`,
  );
  console.log(
    `  (내부이체 ${ledger.metrics.internalTransferCount}건 ${formatPeso(ledger.metrics.internalTransferAmount)} 는 수입·지출 양쪽에서 제외)`,
  );
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length === 0 ? `  ${checks.length}개 검사 전부 통과.` : `  ${failed.length}개 실패.`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

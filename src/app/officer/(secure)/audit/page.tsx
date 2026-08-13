import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  GuardDenied,
  PageContainer,
  PageHeader,
  Stack,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatDateTime,
  formatPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  accountBalancesAsOf,
  auditBalances,
  buildRealNameList,
  cashThresholdFrom,
  cfgNum,
  cfgStr,
  checkOpeningBalance,
  checkReceiptGaps,
  conflictNormalize,
  daysBetween,
  fiscalYearOf,
  isInternalTransfer,
  loadSettings,
  nameLooseMatch,
  parseReceiptNo,
  publicPolicyFrom,
  todayManila,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { PrintButton } from "../../_components/PrintButton";

export const metadata: Metadata = {
  title: "감사",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/audit — **읽기 전용.**
 *
 * 02_노코드MVP/AppsScript/06_주간무결성검사.gs 의 검사 항목(C1~C14)을 화면으로 옮긴 것이다.
 * 그쪽은 매주 월요일 메일로 보냈고, 여기서는 임원이 아무 때나 눌러 볼 수 있다.
 *
 * ★ 이 화면에는 쓰기 버튼이 하나도 없다. 검사는 아무것도 고치지 않는다 —
 *   "무엇이 어긋났는지" 만 말하고, 고치는 것은 사람의 판단이다.
 * ★ 감사 계정으로 들어와도 이 화면은 그대로 열린다(조회권). 반대로 수납·지출 화면은
 *   같은 계정으로 열면 서버가 거부한다. 그 대비가 통제가 동작한다는 증거다.
 */

/**
 * INFO — "위반은 아니지만 알고 있어야 하는 사실".
 * 과거 장부처럼 규정 이전이라 애초에 기록이 있을 수 없는 구간을 CRITICAL 로 세면
 * 경고가 수백 건으로 불어나 진짜 위반이 묻힌다. 그렇다고 조용히 빼면 장부가 감춘 것이
 * 되므로, 따로 세워 건수·합계를 명시한다.
 */
type Severity = "CRITICAL" | "WARN" | "INFO";
type Finding = {
  sev: Severity;
  code: string;
  title: string;
  lines: string[];
  fix: string;
};

const MAX_LINES = 25;

export default async function AuditPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "감사" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="감사"
            titleEn="Integrity Check"
            breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const today = todayManila();
  const fy = fiscalYearOf(today);
  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);
  const cashThreshold = cashThresholdFrom(settings);
  const countTolerance = cfgNum(settings, "검사.실사차액_허용오차", 100);
  const countStaleDays = cfgNum(settings, "검사.실사경과일_경고", 45);
  const duesCategory = cfgStr(settings, "기본.과목코드.회비", "R100");
  const soleLimit = cfgNum(settings, "승인한도.총무", 3000);

  const [
    txs,
    accounts,
    funds,
    categories,
    members,
    cashCounts,
    donations,
    donationUses,
    duesInvoices,
    approvals,
    fiscalYears,
    conflicts,
    reconciliations,
    priorFy,
  ] = await Promise.all([
    prisma.transaction.findMany({ orderBy: [{ fiscalYear: "asc" }, { seq: "asc" }] }),
    prisma.account.findMany({ orderBy: { accountId: "asc" } }),
    prisma.fund.findMany({ orderBy: { fundId: "asc" } }),
    prisma.category.findMany(),
    prisma.member.findMany({ select: { memberNo: true, name: true } }),
    prisma.cashCount.findMany({ orderBy: { countedAt: "desc" } }),
    prisma.donation.findMany(),
    prisma.donationUse.findMany(),
    prisma.duesInvoice.findMany({ where: { fiscalYear: fy } }),
    prisma.approval.findMany(),
    prisma.fiscalYear.findMany({ orderBy: { year: "asc" } }),
    prisma.conflictOfInterest.findMany(),
    prisma.reconciliation.findMany(),
    prisma.fiscalYear.findUnique({ where: { year: fy - 1 }, select: { closingTotalPhp: true } }),
  ]);

  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);
  const cap = (lines: string[]) =>
    lines.length <= MAX_LINES
      ? lines
      : [...lines.slice(0, MAX_LINES), `… 외 ${lines.length - MAX_LINES}건`];

  const fyTxs = txs.filter((t) => t.fiscalYear === fy);
  const accountName = new Map(accounts.map((a) => [a.accountId, a.name]));
  const fundName = new Map(funds.map((f) => [f.fundId, f.name]));

  /* ── C1 영수증번호 결번 / 중복 (I2) ────────────────────────────── */
  const seqs = fyTxs
    .map((t) => parseReceiptNo(t.receiptNo))
    .filter((p): p is NonNullable<typeof p> => !!p && p.fiscalYear === fy && p.prefix === policy.receiptPrefix)
    .map((p) => p.seq);
  const gaps = checkReceiptGaps(seqs);
  if (!gaps.ok) {
    push({
      sev: "CRITICAL",
      code: "C1",
      title: `영수증번호 결번 ${gaps.missing.length}건`,
      lines: cap(gaps.missing.map((n) => `${policy.receiptPrefix}-${fy}-${String(n).padStart(6, "0")}`)),
      fix:
        "거래가 삭제되었을 가능성이 큽니다. 거래는 지우는 것이 아니라 상태를 VOIDED 로 바꿉니다(I1). " +
        "이 앱에는 DELETE 경로 자체가 없으므로, 결번이 보인다면 DB 를 직접 손댄 것입니다.",
    });
  }

  /* ── C2 증빙 없는 POSTED (I3) ──────────────────────────────────── */
  const noEvidence = txs.filter(
    (t) => t.status === "POSTED" && !String(t.evidenceUrl ?? "").trim(),
  );
  if (noEvidence.length) {
    push({
      sev: "CRITICAL",
      code: "C2",
      title: `증빙 없는 POSTED ${noEvidence.length}건`,
      lines: cap(noEvidence.map((t) => `${t.receiptNo} (${t.date}, ${formatPeso(t.amountPhp)})`)),
      fix: "I3 위반입니다. 증빙을 첨부하거나 상태를 DRAFT 로 내려야 합니다.",
    });
  }

  /* ── C3 현금 고액 2인 확인 누락 (I4) ──────────────────────────── */
  const cashViolations: string[] = [];
  for (const t of txs) {
    if (t.status !== "POSTED") continue;
    if (String(t.method).trim().toUpperCase() !== "CASH") continue;
    if (t.amountPhp <= cashThreshold) continue;
    const entered = String(t.enteredBy ?? "").trim().toLowerCase();
    const verified = String(t.verifiedBy ?? "").trim().toLowerCase();
    if (!verified) cashViolations.push(`${t.receiptNo} — 확인자 없음 (${formatPeso(t.amountPhp)})`);
    else if (!entered || entered === "unknown" || entered === "system")
      cashViolations.push(`${t.receiptNo} — 입력자 불명 (${formatPeso(t.amountPhp)})`);
    else if (entered === verified)
      cashViolations.push(`${t.receiptNo} — 확인자=입력자 ${verified} (${formatPeso(t.amountPhp)})`);
  }
  if (cashViolations.length) {
    push({
      sev: "CRITICAL",
      code: "C3",
      title: `현금 2인 확인 누락 ${cashViolations.length}건`,
      lines: cap(cashViolations),
      fix: `I4 위반입니다. 임계액 ${formatPeso(cashThreshold)} 초과 현금은 입력자와 다른 사람이 확인해야 합니다.`,
    });
  }

  /* ── C4 계좌 장부잔액 vs 현금실사 ─────────────────────────────── */
  const balances = accountBalancesAsOf(accounts, txs, today);
  const latestCount = new Map<string, (typeof cashCounts)[number]>();
  for (const c of cashCounts) {
    const cur = latestCount.get(c.accountId);
    if (!cur || c.countedAt > cur.countedAt) latestCount.set(c.accountId, c);
  }
  /**
   * ★ 실사 차액은 **실사 시점의 장부잔액**과 비교해야 한다.
   *   오늘 잔액과 몇 달 전 실사액을 빼면 그 사이의 정상 거래가 전부 "차액" 으로 둔갑한다.
   *   (원본 06_주간무결성검사.gs 는 오늘 잔액과 비교했다 — 시드 데이터만 넣어도 심각 경고가
   *    뜨는 이유였다. 17_현금실사가 실사 시점 장부잔액을 함께 기록하므로 그 값을 쓴다.)
   *   실사 이후의 증감은 따로 보여 준다 — 그건 차액이 아니라 그냥 거래다.
   */
  const countRows = balances
    .filter((a) => a.status !== "CLOSED")
    .map((a) => {
      const c = latestCount.get(a.accountId);
      const countedOn = c ? c.countedAt.toISOString().slice(0, 10) : "";
      return {
        accountId: a.accountId,
        name: a.name,
        kind: a.kind,
        book: a.balance,
        counted: c ? c.countedBalance : null,
        bookAtCount: c ? c.bookBalance : null,
        countedOn,
        elapsed: countedOn ? daysBetween(countedOn, today) : null,
        /** 실사 시점의 진짜 차액 */
        diff: c ? c.countedBalance - c.bookBalance : null,
        /** 실사 이후 장부가 움직인 폭 (차액이 아니다) */
        movedSince: c ? a.balance - c.bookBalance : null,
        storedDiff: c ? c.diff : null,
      };
    });
  const noCount = countRows.filter((r) => r.counted === null);
  if (noCount.length) {
    push({
      sev: "WARN",
      code: "C4",
      title: `현금실사 기록이 한 번도 없는 계좌 ${noCount.length}개`,
      lines: noCount.map((r) => `${r.accountId} ${r.name} — 장부잔액 ${formatPeso(r.book)}`),
      fix: "이번 달 실사를 2인 입회로 진행하고 17_현금실사에 기록하십시오.",
    });
  }
  const stale = countRows.filter((r) => r.elapsed !== null && r.elapsed > countStaleDays);
  if (stale.length) {
    push({
      sev: "WARN",
      code: "C4",
      title: `실사가 ${countStaleDays}일 넘게 없는 계좌 ${stale.length}개`,
      lines: stale.map((r) => `${r.accountId} ${r.name} — 마지막 실사 ${r.countedOn} (${r.elapsed}일 경과)`),
      fix: "이번 주에 실사하십시오.",
    });
  }
  const diffed = countRows.filter((r) => r.diff !== null && Math.abs(r.diff) > countTolerance);
  if (diffed.length) {
    push({
      sev: "CRITICAL",
      code: "C4",
      title: `실사 차액이 허용오차(${formatPeso(countTolerance)})를 넘는 계좌 ${diffed.length}개`,
      lines: diffed.map(
        (r) =>
          `${r.accountId} ${r.name} — 실사일 ${r.countedOn} 기준 장부 ${formatPeso(r.bookAtCount ?? 0)} / 실제로 센 금액 ${formatPeso(r.counted ?? 0)} / 차액 ${formatPeso(r.diff ?? 0)}`,
      ),
      fix: "누락 거래가 없는지 확인하고 원인을 17_현금실사의 차액사유에 적으십시오. 원인 불명이면 감사 안건입니다.",
    });
  }
  // 기록된 차액과 다시 계산한 차액이 다르면 실사 행 자체가 손상된 것이다.
  const badDiffRow = countRows.filter(
    (r) => r.diff !== null && r.storedDiff !== null && r.diff !== r.storedDiff,
  );
  if (badDiffRow.length) {
    push({
      sev: "WARN",
      code: "C4",
      title: `17_현금실사의 차액 값이 재계산과 다른 계좌 ${badDiffRow.length}개`,
      lines: badDiffRow.map(
        (r) => `${r.accountId} ${r.name} — 기록된 차액 ${formatPeso(r.storedDiff ?? 0)} / 재계산 ${formatPeso(r.diff ?? 0)}`,
      ),
      fix: "차액 = 실사잔액 - 장부잔액 이어야 합니다. 실사 행을 손으로 고친 흔적입니다.",
    });
  }

  /* ── C5 지정기부 초과 사용 ─────────────────────────────────────── */
  const received = new Map<string, number>();
  for (const d of donations) {
    if (d.status === "취소" || !d.isDesignated || !d.fundId) continue;
    received.set(d.fundId, (received.get(d.fundId) ?? 0) + d.amountPhp);
  }
  const used = new Map<string, number>();
  for (const u of donationUses) {
    if (u.status === "취소") continue;
    used.set(u.fundId, (used.get(u.fundId) ?? 0) + u.amountPhp);
  }
  const overUsed: string[] = [];
  for (const [fundId, amount] of used) {
    const got = received.get(fundId) ?? 0;
    if (amount > got) {
      overUsed.push(
        `${fundId} ${fundName.get(fundId) ?? ""} — 접수 ${formatPeso(got)} / 사용 ${formatPeso(amount)} / 초과 ${formatPeso(amount - got)}`,
      );
    }
  }
  if (overUsed.length) {
    push({
      sev: "CRITICAL",
      code: "C5",
      title: `지정기부 초과 사용 ${overUsed.length}건`,
      lines: overUsed,
      fix: "목적외 사용이거나 08_기부사용 입력 오류입니다. 기부자에게 설명할 수 있어야 합니다.",
    });
  }

  /* ── C7 회비 대사 (06_회비고지 납부합계 vs 05_거래 회비수입) ────
     ★ DRAFT 도 더한다. 회비고지.납부금액은 "돈을 받았나" 를 뜻하므로 증빙이 아직 없어
       DRAFT 인 수납도 포함된다(수납 화면과 prisma/verify.ts 가 같은 규칙을 쓴다).
       POSTED 만 세면 사진을 아직 못 올린 수납 때문에 매번 대사 불일치가 뜬다. */
  const duesFromTx = fyTxs
    .filter(
      (t) =>
        (t.status === "POSTED" || t.status === "DRAFT") &&
        t.direction === "IN" &&
        t.categoryCode === duesCategory &&
        t.counterpartyMemberNo,
    )
    .reduce((s, t) => s + t.amountPhp, 0);
  const duesFromInvoice = duesInvoices.reduce((s, d) => s + d.paidAmount, 0);
  if (duesFromTx !== duesFromInvoice) {
    push({
      sev: "WARN",
      code: "C7",
      title: "회비 대사 불일치",
      lines: [
        `${fy}년 05_거래 회비수입(회원 연결분, POSTED+DRAFT) ${formatPeso(duesFromTx)}`,
        `06_회비고지 납부금액 합계 ${formatPeso(duesFromInvoice)}`,
        `차이 ${formatPeso(duesFromTx - duesFromInvoice)}`,
      ],
      fix: `비회원 회비 수납, 동명이인 미연결, 고지 없이 받은 돈 등이 원인입니다. 과목=${duesCategory} 인데 상대방회원번호가 빈 거래를 먼저 확인하십시오.`,
    });
  }

  /* ── C8 마스터에 없는 코드 ─────────────────────────────────────── */
  const accountIds = new Set(accounts.map((a) => a.accountId));
  const fundIds = new Set(funds.map((f) => f.fundId));
  const categoryCodes = new Set(categories.map((c) => c.code));
  const badCodes: string[] = [];
  for (const t of txs) {
    if (t.status === "VOIDED") continue;
    if (!accountIds.has(t.accountId)) badCodes.push(`${t.receiptNo} — 계좌ID "${t.accountId}"`);
    if (!fundIds.has(t.fundId)) badCodes.push(`${t.receiptNo} — 기금ID "${t.fundId}"`);
    if (!categoryCodes.has(t.categoryCode))
      badCodes.push(`${t.receiptNo} — 과목코드 "${t.categoryCode}"`);
  }
  if (badCodes.length) {
    push({
      sev: "WARN",
      code: "C8",
      title: `마스터에 없는 코드를 쓴 거래 ${badCodes.length}건`,
      lines: cap(badCodes),
      fix: "02_계좌 / 03_기금 / 04_과목에 코드를 추가하거나 거래의 코드를 고치십시오. 이 코드들은 공개 집계에서 '(미분류)' 로 빠집니다.",
    });
  }

  /* ── C9 사전승인 없는 한도초과 지출 ───────────────────────────── */
  const approvedIds = new Set(
    approvals
      .filter((a) => a.finalStatus === "승인" || a.finalStatus === "집행완료")
      .map((a) => a.approvalId),
  );
  const unapproved: string[] = [];
  /* ★ 과거 장부(승인제도 시행 이전)는 승인 기록이 **존재할 수 없다.**
     엑셀에서 소급 임포트한 2021~2025 지출을 같은 잣대로 재면 CRITICAL 이 수백 건 뜨고,
     그 소음에 정작 새로 생긴 진짜 위반이 묻힌다. 그래서 제외하되 **숨기지 않는다** —
     아래에 INFO 로 건수·합계를 따로 세워 "여기는 승인기록이 없는 구간" 임을 명시한다.
     기준 연도는 00_설정 '승인제도.시행연도' 이며, 그 해부터는 규정대로 검사한다. */
  const approvalSince = cfgNum(settings, "승인제도.시행연도", 0);
  const legacyUnapproved: string[] = [];
  let legacyAmount = 0;
  for (const t of txs) {
    if (t.status !== "POSTED" || t.direction !== "OUT") continue;
    // 내부이체(자기 계좌 간 이동)는 지출이 아니다 — 승인한도표의 대상이 아니다.
    // 빼지 않으면 현금함에서 통장으로 옮긴 것만으로 "무단 지출" 경고가 뜬다.
    if (isInternalTransfer(t)) continue;
    if (t.amountPhp <= soleLimit) continue;
    const isLegacy = approvalSince > 0 && t.fiscalYear < approvalSince && !t.approvalId;
    if (isLegacy) {
      legacyUnapproved.push(`${t.receiptNo} (${t.date}) — ${formatPeso(t.amountPhp)}`);
      legacyAmount += t.amountPhp;
      continue;
    }
    if (!t.approvalId) unapproved.push(`${t.receiptNo} — 승인ID 없음 (${formatPeso(t.amountPhp)})`);
    else if (!approvedIds.has(t.approvalId))
      unapproved.push(`${t.receiptNo} — 승인 ${t.approvalId} 이 승인 상태가 아님 (${formatPeso(t.amountPhp)})`);
  }
  if (unapproved.length) {
    push({
      sev: "CRITICAL",
      code: "C9",
      title: `사전승인 없는 한도초과 지출 ${unapproved.length}건`,
      lines: cap(unapproved),
      fix: `전결한도 ${formatPeso(soleLimit)} 를 넘는 지출은 11_승인에 승인 기록이 있어야 합니다.`,
    });
  }
  if (legacyUnapproved.length) {
    push({
      sev: "INFO",
      code: "C9-과거",
      title: `과거 장부(${approvalSince}년 이전) 승인기록 없는 한도초과 지출 ${legacyUnapproved.length}건 · ${formatPeso(legacyAmount)}`,
      lines: cap(legacyUnapproved),
      fix:
        `이 구간은 사전승인 제도가 시행되기 전이라 11_승인 기록이 존재하지 않습니다. ` +
        `위반이 아니라 제도 이전이라는 뜻이므로 C9(CRITICAL)에서 제외했습니다. ` +
        `${approvalSince}년부터의 지출은 규정대로 검사합니다. 기준 연도는 00_설정 "승인제도.시행연도" 에서 바꿉니다.`,
    });
  }

  /* ── C10 마감 회계연도 (I5) ────────────────────────────────────── */
  const closedYears = new Set(
    fiscalYears.filter((y) => y.status.toUpperCase() === "CLOSED").map((y) => y.year),
  );
  if (closedYears.size) {
    const closedDrafts = txs.filter((t) => closedYears.has(t.fiscalYear) && t.status === "DRAFT");
    if (closedDrafts.length) {
      push({
        sev: "CRITICAL",
        code: "C10",
        title: `마감 연도에 남아 있는 미확정(DRAFT) ${closedDrafts.length}건`,
        lines: cap(closedDrafts.map((t) => `${t.receiptNo} (${t.date})`)),
        fix: "I5 위반 상태입니다. 마감된 연도에는 DRAFT 가 남아 있으면 안 됩니다.",
      });
    }
    const lateEntries = txs.filter(
      (t) => closedYears.has(t.fiscalYear) && t.enteredAt.getUTCFullYear() > t.fiscalYear,
    );
    if (lateEntries.length) {
      push({
        sev: "WARN",
        code: "C10",
        title: `마감 연도 거래를 나중에 입력한 흔적 ${lateEntries.length}건`,
        lines: cap(
          lateEntries.map((t) => `${t.receiptNo} (일자 ${t.date} / 입력 ${formatDateTime(t.enteredAt)})`),
        ),
        fix: "정당한 지연 입력인지 확인하고 감사 의견을 남기십시오.",
      });
    }
  }

  /* ── C11 이해관계자 거래인데 신고가 없음 ──────────────────────── */
  const declaredNames = conflicts
    .map((c) => conflictNormalize(c.counterpartyName))
    .filter(Boolean);
  const undeclared: string[] = [];
  for (const t of txs) {
    if (t.status !== "POSTED" || !t.relatedParty) continue;
    const key = conflictNormalize(t.counterpartyName);
    if (!key) {
      undeclared.push(`${t.receiptNo} — 상대방명이 부호뿐이라 대조 불가 (${formatPeso(t.amountPhp)})`);
      continue;
    }
    // ★ 승인 화면의 evaluateConflict 와 **같은 정규화·같은 대조**를 쓴다.
    //   다른 규칙을 쓰면 승인 단계에서 이해관계자로 잡힌 거래가 여기서는 "신고 있음" 으로 흘러간다.
    if (!declaredNames.some((n) => nameLooseMatch(key, n))) {
      undeclared.push(`${t.receiptNo} — ${t.counterpartyName} (${t.date}, ${formatPeso(t.amountPhp)})`);
    }
  }
  if (undeclared.length) {
    push({
      sev: "WARN",
      code: "C11",
      title: `이해관계자 거래인데 13_이해상충 신고가 없는 건 ${undeclared.length}건`,
      lines: cap(undeclared),
      fix: "관계를 신고하고, 해당 안건 의결에서 회피했는지 기록하십시오.",
    });
  }

  /* ── C12 방치 DRAFT / 사유 없는 VOIDED ────────────────────────── */
  const stalled: string[] = [];
  const voidNoReason: string[] = [];
  for (const t of txs) {
    if (t.status === "DRAFT") {
      const age = daysBetween(t.date, today);
      if (age !== null && age > 14)
        stalled.push(`${t.receiptNo} (${age}일 경과, ${formatPeso(t.amountPhp)})`);
    } else if (t.status === "VOIDED" && !String(t.voidReason ?? "").trim()) {
      voidNoReason.push(t.receiptNo);
    }
  }
  if (stalled.length) {
    push({
      sev: "WARN",
      code: "C12",
      title: `14일 넘게 미확정으로 방치된 거래 ${stalled.length}건`,
      lines: cap(stalled),
      fix: "DRAFT 는 공개 장부에 잡히지 않습니다. 증빙·확인자를 채우거나 무효 처리하십시오.",
    });
  }
  if (voidNoReason.length) {
    push({
      sev: "CRITICAL",
      code: "C12",
      title: `무효사유가 없는 VOIDED ${voidNoReason.length}건`,
      lines: cap(voidNoReason),
      fix: "왜 무효화했는지 반드시 적어야 합니다. 사유 없는 무효는 은폐로 보입니다.",
    });
  }

  /* ── C14 적요에 회원 실명 (공개 유출 위험) ────────────────────── */
  const realNames = buildRealNameList(members.map((m) => m.name));
  const memberNoByName = new Map(members.map((m) => [m.name, m.memberNo]));
  const nameLeaks: string[] = [];
  for (const t of txs) {
    const memo = String(t.memo ?? "");
    if (!memo) continue;
    const hit = realNames.find((n) => memo.includes(n));
    if (hit) nameLeaks.push(`${t.receiptNo} — 적요에 "${hit}"(${memberNoByName.get(hit) ?? "?"})`);
  }
  if (nameLeaks.length) {
    push({
      sev: "WARN",
      code: "C14",
      title: `적요에 회원 실명이 들어간 거래 ${nameLeaks.length}건`,
      lines: cap(nameLeaks),
      fix:
        "공개 회계는 적요를 마스킹해서 내보내지만, 원장 열람 권한이 있는 임원 범위에서도 이름 노출을 줄이는 편이 안전합니다. " +
        "실명 대신 회원번호로 적으십시오.",
    });
  }

  /* ── 99_대사: 미매칭 ──────────────────────────────────────────── */
  const unmatched = reconciliations.filter((r) => r.matchStatus !== "MATCHED");
  if (unmatched.length) {
    push({
      sev: "WARN",
      code: "C15",
      title: `GCash·은행 대사 미매칭 ${unmatched.length}건`,
      lines: cap(
        unmatched.map(
          (r) =>
            `${r.reconId} — ${r.matchStatus} / ${accountName.get(r.accountId) ?? r.accountId} / ${formatPeso(r.externalAmount)} / ${r.externalMemo || "(적요 없음)"}`,
        ),
      ),
      fix: "명세서에는 있는데 장부에 없는 돈(UNMATCHED_EXT)은 누락 수납일 수 있습니다. 먼저 확인하십시오.",
    });
  }

  /* ── 대차 검산 + I6 ───────────────────────────────────────────── */
  const balanceAudit = auditBalances(accounts, funds, txs, fy, policy.receiptPrefix, today);
  for (const c of balanceAudit.checks) {
    if (c.ok) continue;
    push({
      sev: "CRITICAL",
      code: "BAL",
      title: `대차 검산 실패 — ${c.name}`,
      lines: [c.detail],
      fix: "모든 거래는 계좌와 기금 양쪽에 달려 있으므로 두 합계는 같아야 합니다. 어긋났다면 거래 한 건의 계좌ID 또는 기금ID 가 잘못됐습니다.",
    });
  }
  const opening = checkOpeningBalance(accounts, priorFy?.closingTotalPhp ?? null);
  if (!opening.ok) {
    push({
      sev: "CRITICAL",
      code: "I6",
      title: "개시잔액 ≠ 전기 마감잔액",
      lines: [opening.message],
      fix: "18_인수인계 기록과 전기 마감잔액을 대조하십시오. 개시잔액은 임의로 고치는 값이 아닙니다.",
    });
  }

  const critical = findings.filter((f) => f.sev === "CRITICAL");
  const warn = findings.filter((f) => f.sev === "WARN");
  const info = findings.filter((f) => f.sev === "INFO");
  /** 요약 배너·"이상 없음" 판정은 조치가 필요한 것만 센다 — INFO 는 조치 대상이 아니다. */
  const actionable = critical.length + warn.length;

  return (
    <PageContainer wide>
      <PageHeader
        title="감사"
        titleEn="Integrity Check"
        description={`${today} 기준 · ${fy} 회계연도. 이 화면은 아무것도 고치지 않습니다 — 무엇이 어긋났는지만 말합니다.`}
        breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
        actions={<PrintButton label="감사 결과 인쇄" />}
      />

      <Stack>
        <Alert tone="info" title="이 화면은 읽기 전용입니다">
          <p>
            저장·수정 버튼이 하나도 없습니다. 검사는 원장을 다시 읽어 계산할 뿐입니다.
            {me.isAuditor
              ? " 지금 감사 계정으로 보고 계십니다 — 수납·지출 화면을 열면 서버가 저장을 거부하는 것을 확인하실 수 있습니다."
              : ""}
          </p>
        </Alert>

        {actionable === 0 ? (
          <Alert tone="success" title="이상 없음 — 검사 항목을 전부 통과했습니다">
            <p>
              영수증번호 결번, 증빙 없는 POSTED, 현금 2인 확인, 실사 차액, 지정기부 초과 사용,
              사전승인 없는 지출, 마감연도 침범, 이해관계자 미신고, 대차 검산까지 모두 정상입니다.
              {info.length ? " 아래 참고 항목은 조치 대상이 아닙니다." : ""}
            </p>
          </Alert>
        ) : (
          <Alert
            tone={critical.length ? "error" : "warn"}
            title={
              `심각 ${critical.length}건 / 주의 ${warn.length}건` +
              (info.length ? ` / 참고 ${info.length}건` : "")
            }
          >
            <p>
              {critical.length
                ? "심각 항목은 회계 신뢰성에 직접 영향을 줍니다. 이번 주 안에 처리하십시오."
                : "심각 항목은 없습니다. 주의 항목을 확인해 주십시오."}
            </p>
          </Alert>
        )}

        {findings.length > 0 ? (
          <Stack gap="sm">
            {[...critical, ...warn, ...info].map((f, i) => (
              <Card key={`${f.code}-${i}`} as="article">
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          f.sev === "CRITICAL" ? "danger" : f.sev === "WARN" ? "warn" : "info"
                        }
                        dot
                      >
                        {f.sev === "CRITICAL" ? "심각" : f.sev === "WARN" ? "주의" : "참고"}
                      </Badge>
                      <span className="font-mono text-sm text-ink-muted">{f.code}</span>
                      <span>{f.title}</span>
                    </span>
                  }
                  headingLevel={2}
                />
                <CardBody>
                  <ul className="flex flex-col gap-1 font-mono text-sm text-ink-soft">
                    {f.lines.map((l, j) => (
                      <li key={j}>{l}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm">
                    <b>조치:</b> {f.fix}
                  </p>
                </CardBody>
              </Card>
            ))}
          </Stack>
        ) : null}

        {/* ── 계좌 잔액 vs 실사 ───────────────────────────── */}
        <Card>
          <CardHeader
            title="계좌 잔액과 현금실사"
            description={`허용오차 ${formatPeso(countTolerance)} · 실사 경과 경고 ${countStaleDays}일`}
          />
          <TableCardBody label="계좌 잔액과 현금실사">
            <Table caption={`${today} 기준 계좌별 장부잔액과 최근 실사`} captionHidden>
              <THead>
                <TR>
                  <TH>계좌</TH>
                  <TH>종류</TH>
                  <TH numeric>오늘 장부잔액</TH>
                  <TH>최근 실사일</TH>
                  <TH numeric>실사시점 장부</TH>
                  <TH numeric>실제로 센 금액</TH>
                  <TH numeric>차액</TH>
                  <TH numeric>실사 이후 증감</TH>
                </TR>
              </THead>
              <TBody>
                {countRows.map((r) => (
                  <TR
                    key={r.accountId}
                    tone={r.diff !== null && Math.abs(r.diff) > countTolerance ? "warn" : undefined}
                  >
                    <TD>
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-sm text-ink-muted">{r.accountId}</span>
                    </TD>
                    <TD>{r.kind}</TD>
                    <TD numeric>{formatPeso(r.book)}</TD>
                    <TD className="whitespace-nowrap tnum">
                      {r.countedOn || "—"}
                      {r.elapsed !== null ? (
                        <span className="block text-sm text-ink-muted">{r.elapsed}일 경과</span>
                      ) : null}
                    </TD>
                    <TD numeric>{r.bookAtCount === null ? "—" : formatPeso(r.bookAtCount)}</TD>
                    <TD numeric>{r.counted === null ? "—" : formatPeso(r.counted)}</TD>
                    <TD numeric className={r.diff ? "font-bold text-danger" : ""}>
                      {r.diff === null ? "—" : formatPeso(r.diff)}
                    </TD>
                    <TD numeric className="text-ink-muted">
                      {r.movedSince === null ? "—" : formatPeso(r.movedSince)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCardBody>
        </Card>

        {/* ── 대차 검산 ───────────────────────────────────── */}
        <Card>
          <CardHeader
            title="대차 검산"
            description="모든 거래는 계좌와 기금 양쪽에 달려 있다. 두 합계가 다르면 어딘가 한 건이 틀렸다는 뜻이다."
          />
          <TableCardBody label="대차 검산 결과">
            <Table caption="대차 검산 결과" captionHidden>
              <THead>
                <TR>
                  <TH>검사</TH>
                  <TH>결과</TH>
                  <TH>내용</TH>
                </TR>
              </THead>
              <TBody>
                {balanceAudit.checks.map((c) => (
                  <TR key={c.name} tone={c.ok ? undefined : "warn"}>
                    <TD>{c.name}</TD>
                    <TD>
                      <Badge tone={c.ok ? "success" : "danger"} dot>
                        {c.ok ? "정상" : "실패"}
                      </Badge>
                    </TD>
                    <TD className="font-mono text-sm">{c.detail}</TD>
                  </TR>
                ))}
                <TR>
                  <TD>개시잔액 = 전기 마감잔액 (I6)</TD>
                  <TD>
                    <Badge tone={opening.ok ? "success" : "danger"} dot>
                      {opening.ok ? "정상" : "실패"}
                    </Badge>
                  </TD>
                  <TD className="text-sm">{opening.message}</TD>
                </TR>
              </TBody>
            </Table>
          </TableCardBody>
        </Card>

        {/* ── 검사 항목 안내 ──────────────────────────────── */}
        <Card as="aside">
          <CardHeader
            title="무엇을 검사했는가"
            description="원본: 02_노코드MVP/AppsScript/06_주간무결성검사.gs"
          />
          <CardBody>
            <ul className="ml-4 list-disc text-sm text-ink-soft">
              <li>C1 영수증번호 결번 (I2) — 이 앱에는 거래 DELETE 경로 자체가 없다</li>
              <li>C2 증빙 없는 POSTED (I3)</li>
              <li>C3 현금 고액인데 2인 확인이 안 된 POSTED (I4)</li>
              <li>
                C4 현금실사 차액 · 실사 경과일 —{" "}
                <b>차액은 실사 시점의 장부잔액과 비교</b>합니다. 오늘 잔액과 비교하면 그 사이의 정상
                거래가 전부 차액으로 잡힙니다.
              </li>
              <li>C5 지정기부 접수액을 넘는 사용</li>
              <li>C7 06_회비고지 납부합계 vs 05_거래 회비수입 합계</li>
              <li>C8 마스터(계좌·기금·과목)에 없는 코드</li>
              <li>
                C9 사전승인 없는 전결한도 초과 지출 — 단, 승인제도 시행 이전(과거 장부)은
                기록이 존재할 수 없으므로 <b>C9-과거</b> 로 따로 세운다
              </li>
              <li>C10 마감 회계연도의 DRAFT · 사후 입력 흔적 (I5)</li>
              <li>C11 이해관계자 거래인데 13_이해상충 신고가 없음</li>
              <li>C12 14일 넘게 방치된 DRAFT · 사유 없는 VOIDED (I1)</li>
              <li>C14 적요에 회원 실명 노출</li>
              <li>C15 GCash·은행 대사 미매칭</li>
              <li>BAL 계좌 합계 = 기금 합계 · 음수 잔액 · 결번</li>
              <li>I6 개시잔액 = 전기 마감잔액</li>
            </ul>
            <p className="mt-3 text-sm text-ink-muted">
              영수증번호 중복은 검사하지 않습니다 — 영수증번호가 기본키이고 (회계연도, 일련번호)에
              유일 제약이 걸려 있어 DB 구조상 중복이 들어갈 수 없습니다. 시트 시절에는 가능했습니다.
            </p>
          </CardBody>
        </Card>

        {members.length === 0 ? (
          <EmptyState
            icon="🌱"
            title="데이터가 비어 있습니다"
            description="npm run db:seed 를 실행해 주십시오."
          />
        ) : null}
      </Stack>
    </PageContainer>
  );
}

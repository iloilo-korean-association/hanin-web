import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  EmptyState,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatGrid,
  StatLine,
  StatusBadge,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  accountBalancesAsOf,
  buildPublicLedger,
  buildRealNameList,
  cashThresholdFrom,
  checkOpeningBalance,
  evaluateTxState,
  fiscalYearOf,
  loadSettings,
  publicPolicyFrom,
  todayManila,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

export const metadata: Metadata = {
  title: "임원 대시보드",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer — 오늘 무엇을 해야 하는가.
 *
 * 임원이 이 화면에서 알아야 하는 것은 네 가지다.
 *   ① 내가 지금 누구이고 무엇을 할 수 있는가
 *   ② 결재·집행이 밀려 있는가
 *   ③ 장부가 지금 성한가 (결번·미확정·증빙)
 *   ④ 돈이 어디에 얼마 있는가
 */
export default async function OfficerDashboardPage() {
  let me;
  try {
    me = await requireOfficer({ screen: "임원 대시보드" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <Alert tone="error" title={e.message}>
            {e.howToFix}
          </Alert>
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

  const [txs, accounts, funds, categories, memberNames, approvals, duesRows, recent, priorFy] =
    await Promise.all([
      prisma.transaction.findMany({ where: { fiscalYear: fy }, orderBy: { seq: "asc" } }),
      prisma.account.findMany({ orderBy: { accountId: "asc" } }),
      prisma.fund.findMany({ orderBy: { fundId: "asc" } }),
      prisma.category.findMany(),
      // ★ 마스킹 계산용. 화면으로 내보내지 않는다.
      prisma.member.findMany({ select: { name: true } }),
      prisma.approval.findMany({
        where: { finalStatus: { in: ["대기", "승인", "집행중"] } },
        orderBy: { approvalId: "asc" },
        select: {
          approvalId: true,
          amountPhp: true,
          counterpartyName: true,
          relatedParty: true,
          finalStatus: true,
          executedReceiptNo: true,
          requiredStages: true,
          reason: true,
        },
      }),
      prisma.duesInvoice.groupBy({
        by: ["status"],
        where: { fiscalYear: fy },
        _count: { _all: true },
        _sum: { unpaidAmount: true },
      }),
      prisma.transaction.findMany({
        where: { fiscalYear: fy },
        orderBy: [{ date: "desc" }, { seq: "desc" }],
        take: 8,
        select: {
          receiptNo: true,
          date: true,
          direction: true,
          amountPhp: true,
          counterpartyName: true,
          status: true,
          relatedParty: true,
          categoryCode: true,
        },
      }),
      prisma.fiscalYear.findUnique({ where: { year: fy - 1 }, select: { closingTotalPhp: true } }),
    ]);

  const ledger = buildPublicLedger(txs, accounts, funds, categories, {
    fiscalYear: fy,
    today,
    realNames: buildRealNameList(memberNames.map((m) => m.name)),
    ...policy,
  });

  const balances = accountBalancesAsOf(accounts, txs, today);
  const balanceTotal = balances.reduce((s, a) => s + a.balance, 0);
  const opening = checkOpeningBalance(accounts, priorFy?.closingTotalPhp ?? null);

  const drafts = txs
    .filter((t) => t.status === "DRAFT")
    .map((t) => ({
      receiptNo: t.receiptNo,
      date: t.date,
      amountPhp: t.amountPhp,
      counterpartyName: t.counterpartyName,
      verdict: evaluateTxState(
        {
          evidenceUrl: t.evidenceUrl,
          method: t.method,
          amount: t.amount,
          currency: t.currency,
          fxRate: t.fxRate,
          enteredBy: t.enteredBy,
          verifiedBy: t.verifiedBy,
        },
        cashThreshold,
      ),
    }));

  const waitingApproval = approvals.filter((a) => a.finalStatus === "대기");
  const waitingExecution = approvals.filter(
    (a) => a.finalStatus === "승인" && !a.executedReceiptNo,
  );
  const stuck = approvals.filter((a) => a.finalStatus === "집행중");

  const categoryName = new Map(categories.map((c) => [c.code, c.publicName || c.name]));
  const unpaidTotal = duesRows.reduce((s, r) => s + (r._sum.unpaidAmount ?? 0), 0);
  const unpaidCount = duesRows
    .filter((r) => r.status === "미납" || r.status === "부분납")
    .reduce((s, r) => s + r._count._all, 0);

  return (
    <PageContainer wide>
      <PageHeader
        title="임원 대시보드"
        titleEn="Officer Dashboard"
        description={`${fy} 회계연도 · ${today} 기준. 이 화면의 숫자는 전부 05_거래 원본에서 그때그때 계산합니다.`}
        actions={
          <LinkButton href={ROUTES.ledger} variant="secondary">
            공개 회계 보기
          </LinkButton>
        }
      />

      <Stack>
        {/* ── 지금 막혀 있는 것 ───────────────────────────────── */}
        {stuck.length > 0 ? (
          <Alert
            tone="error"
            title={`집행이 중단된 채로 남아 있는 승인 ${stuck.length}건`}
            action={
              <LinkButton href={`${ROUTES.officer}/approve`} variant="primary">
                승인 · 집행 화면에서 확인
              </LinkButton>
            }
          >
            <p>
              {stuck.map((a) => a.approvalId).join(", ")} — 영수증번호를 선점한 뒤 거래 기록이 끝나지
              않은 상태입니다. 같은 돈을 두 번 내주지 않도록 자동으로 풀지 않습니다.
            </p>
          </Alert>
        ) : null}

        {!ledger.metrics.gaps.ok ? (
          <Alert tone="error" title="영수증번호 결번 의심 (I2)">
            <p>{ledger.metrics.gaps.message}</p>
          </Alert>
        ) : null}

        {!opening.ok ? (
          <Alert tone="error" title="개시잔액이 전기 마감잔액과 다릅니다 (I6)">
            <p>{opening.message}</p>
          </Alert>
        ) : null}

        {/* ── 요약 3숫자 ─────────────────────────────────────── */}
        <StatGrid
          label={`${fy} 회계연도 요약`}
          items={[
            {
              label: "총수입",
              labelEn: "Income",
              value: formatPeso(ledger.totalIncome),
              tone: "income",
              sub: `장부반영 ${ledger.metrics.postedCount}건`,
            },
            {
              label: "총지출",
              labelEn: "Expense",
              value: formatPeso(ledger.totalExpense),
              tone: "expense",
              sub: `이해관계자 거래 ${ledger.metrics.relatedPartyCount}건 · ${formatPeso(ledger.metrics.relatedPartyAmount)}`,
            },
            {
              label: "계좌 잔액",
              labelEn: "Balance",
              value: formatPeso(balanceTotal),
              tone: "balance",
              sub: `개시 ${formatPeso(opening.openingTotal)} + 수지 ${formatPeso(ledger.net)}`,
            },
          ]}
        />

        {/* ── 오늘 할 일 ─────────────────────────────────────── */}
        <CardGrid columns={3}>
          <Card>
            <CardHeader title="결재 대기" headingLevel={2} />
            <CardBody>
              <p className="text-3xl font-bold tnum">{waitingApproval.length}건</p>
              <p className="mt-1 text-sm text-ink-muted">
                {waitingApproval.length
                  ? `합계 ${formatPeso(waitingApproval.reduce((s, a) => s + a.amountPhp, 0))}`
                  : "결재를 기다리는 지출 요청이 없습니다."}
              </p>
              <div className="mt-3">
                <LinkButton href={`${ROUTES.officer}/approve`} size="sm">
                  승인 화면으로
                </LinkButton>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="집행 대기" headingLevel={2} />
            <CardBody>
              <p className="text-3xl font-bold tnum">{waitingExecution.length}건</p>
              <p className="mt-1 text-sm text-ink-muted">
                결재가 끝났지만 아직 장부에 들어가지 않은 지출입니다.
              </p>
              <div className="mt-3">
                <LinkButton href={`${ROUTES.officer}/approve`} size="sm">
                  집행 화면으로
                </LinkButton>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="미확정(DRAFT)" headingLevel={2} />
            <CardBody>
              <p className="text-3xl font-bold tnum">{drafts.length}건</p>
              <p className="mt-1 text-sm text-ink-muted">
                증빙(I3) 또는 2인 확인(I4)이 없어 공개 회계에 잡히지 않는 거래입니다.
              </p>
              <div className="mt-3">
                <LinkButton href={`${ROUTES.officer}/audit`} size="sm">
                  감사 화면에서 전부 보기
                </LinkButton>
              </div>
            </CardBody>
          </Card>
        </CardGrid>

        {/* ── DRAFT 상세: 왜 미확정인가 ───────────────────────── */}
        <Card>
          <CardHeader
            title="미확정 거래 — 무엇이 빠졌는가"
            description="상태는 서버가 정합니다. 화면에서 POSTED 로 바꿀 수 있는 방법은 없고, 빠진 것을 채워야 올라갑니다."
          />
          {drafts.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="✅"
                title="미확정 거래가 없습니다"
                description="모든 거래가 증빙과 2인 확인을 갖추고 장부에 반영돼 있습니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="미확정 거래 목록">
              <Table caption="DRAFT 상태 거래와 그 이유" captionHidden>
                <THead>
                  <TR>
                    <TH>영수증번호</TH>
                    <TH>일자</TH>
                    <TH numeric>금액</TH>
                    <TH>상대방</TH>
                    <TH>미확정 사유</TH>
                  </TR>
                </THead>
                <TBody>
                  {drafts.map((d) => (
                    <TR key={d.receiptNo} tone="warn">
                      <TD className="font-mono text-sm">{d.receiptNo}</TD>
                      <TD className="whitespace-nowrap tnum">{d.date}</TD>
                      <TD numeric>{formatPeso(d.amountPhp)}</TD>
                      <TD>{d.counterpartyName || "—"}</TD>
                      <TD>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {d.verdict.invariant ? (
                            <Badge tone="warn">{d.verdict.invariant}</Badge>
                          ) : null}
                          <span>{d.verdict.reason || "사유 미상"}</span>
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>

        <CardGrid columns={2}>
          {/* ── 계좌 잔액 ─────────────────────────────────────── */}
          <Card>
            <CardHeader title="계좌별 잔액" description={`${today} 기준 장부잔액`} />
            <TableCardBody label="계좌별 잔액">
              <Table caption="계좌별 장부잔액" captionHidden>
                <THead>
                  <TR>
                    <TH>계좌</TH>
                    <TH numeric>개시</TH>
                    <TH numeric>입금</TH>
                    <TH numeric>출금</TH>
                    <TH numeric>잔액</TH>
                  </TR>
                </THead>
                <TBody>
                  {balances.map((a) => (
                    <TR key={a.accountId} tone={a.balance < 0 ? "warn" : undefined}>
                      <TD>
                        <span className="font-semibold">{a.name}</span>
                        <span className="block text-sm text-ink-muted">
                          {a.accountId} · {a.kind}
                          {a.isPublic ? "" : " · 비공개"}
                        </span>
                      </TD>
                      <TD numeric>{formatPeso(a.openingBalance)}</TD>
                      <TD numeric>{formatPeso(a.inflow)}</TD>
                      <TD numeric>{formatPeso(a.outflow)}</TD>
                      <TD numeric className="font-bold">
                        {formatPeso(a.balance)}
                      </TD>
                    </TR>
                  ))}
                  <TR tone="muted">
                    <TD className="font-bold">합계</TD>
                    <TD numeric>{formatPeso(balances.reduce((s, a) => s + a.openingBalance, 0))}</TD>
                    <TD numeric>{formatPeso(balances.reduce((s, a) => s + a.inflow, 0))}</TD>
                    <TD numeric>{formatPeso(balances.reduce((s, a) => s + a.outflow, 0))}</TD>
                    <TD numeric className="font-bold">
                      {formatPeso(balanceTotal)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </TableCardBody>
          </Card>

          {/* ── 장부 건강 ─────────────────────────────────────── */}
          <Card>
            <CardHeader title="장부 상태" description="불변식이 지금 지켜지고 있는가" />
            <CardBody>
              <StatLine
                label="영수증번호 결번 (I2)"
                value={ledger.metrics.gaps.ok ? "없음" : `${ledger.metrics.gaps.missing.length}건`}
                tone={ledger.metrics.gaps.ok ? "income" : "expense"}
              />
              <StatLine
                label="증빙 첨부율 (I3)"
                value={
                  ledger.metrics.evidenceRate === null
                    ? "—"
                    : `${ledger.metrics.evidenceRate}% (${ledger.metrics.withEvidence}/${ledger.metrics.postedCount})`
                }
                tone={ledger.metrics.evidenceRate === 100 ? "income" : "expense"}
              />
              <StatLine label="미확정 DRAFT" value={`${ledger.metrics.draftCount}건`} />
              <StatLine label="무효 VOIDED" value={`${ledger.metrics.voidedCount}건`} />
              <StatLine
                label="내부이체 (수지 제외)"
                value={`${ledger.metrics.internalTransferCount}건 · ${formatPeso(ledger.metrics.internalTransferAmount)}`}
              />
              <StatLine
                label={`${fy}년 회비 미납`}
                value={`${unpaidCount}명 · ${formatPeso(unpaidTotal)}`}
                tone={unpaidTotal > 0 ? "expense" : "income"}
              />
              <StatLine label="개시잔액 검증 (I6)" value={opening.ok ? "정상" : "불일치"} tone={opening.ok ? "income" : "expense"} />
            </CardBody>
          </Card>
        </CardGrid>

        {/* ── 최근 거래 ───────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="최근 거래"
            description="임원 화면이므로 상대방 이름을 마스킹하지 않습니다. 공개 회계에서는 회원 실명이 가려집니다."
          />
          <TableCardBody label="최근 거래 8건">
            <Table caption="최근 거래 8건" captionHidden>
              <THead>
                <TR>
                  <TH>일자</TH>
                  <TH>영수증번호</TH>
                  <TH>과목</TH>
                  <TH>상대방</TH>
                  <TH numeric>금액</TH>
                  <TH>상태</TH>
                </TR>
              </THead>
              <TBody>
                {recent.map((t) => (
                  <TR key={t.receiptNo} tone={t.relatedParty ? "conflict" : undefined}>
                    <TD className="whitespace-nowrap tnum">{t.date}</TD>
                    <TD className="font-mono text-sm">{t.receiptNo}</TD>
                    <TD>{categoryName.get(t.categoryCode) ?? t.categoryCode}</TD>
                    <TD>
                      {t.counterpartyName || "—"}
                      {t.relatedParty ? (
                        <Badge tone="conflict" className="ml-1.5">
                          이해관계
                        </Badge>
                      ) : null}
                    </TD>
                    <TD numeric className={t.direction === "IN" ? "text-success" : "text-danger"}>
                      {t.direction === "IN" ? "+" : "−"}
                      {formatPeso(t.amountPhp).slice(1)}
                    </TD>
                    <TD>
                      <StatusBadge status={t.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCardBody>
        </Card>

        {/* ── 이 계정이 할 수 있는 일 ─────────────────────────── */}
        <Card as="aside">
          <CardHeader title={`${me.name} ${me.role} 계정으로 할 수 있는 일`} />
          <CardBody>
            <ul className="flex flex-col gap-2">
              <PermissionLine
                allowed={me.can("입력권") && !me.isAuditor}
                label="장부에 수입·지출 적기 · 고치기 · 무효 처리"
                need="입력권"
              />
              <PermissionLine
                allowed={me.can("확인권")}
                label="감사 확인 도장 (본인이 적은 거래는 제외)"
                need="확인권"
              />
              <PermissionLine allowed={me.can("조회권")} label="감사 화면 · 원장 조회" need="조회권" />
            </ul>
            {me.isAuditor ? (
              <Alert tone="warn" title="감사 계정입니다" className="mt-4">
                <p>
                  장부에는 아무것도 저장할 수 없습니다. 화면에서 버튼을 감추는 것이 아니라 서버가
                  거부합니다 — 장부 화면을 직접 열어 확인해 보십시오. 예외는 감사 화면의{" "}
                  <strong>확인 도장</strong> 하나이며, 그것은 장부를 고치는 것이 아니라 “내가
                  봤다”를 기록하는 것입니다.
                </p>
              </Alert>
            ) : null}
          </CardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}

function PermissionLine({
  allowed,
  label,
  need,
}: {
  allowed: boolean;
  label: string;
  need: string;
}) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={allowed ? "text-success" : "text-ink-faint"}>
        {allowed ? "✓" : "✕"}
      </span>
      <span className={allowed ? "" : "text-ink-muted"}>
        {label}
        <span className="ml-1.5 text-sm text-ink-faint">({need} 필요)</span>
      </span>
    </li>
  );
}

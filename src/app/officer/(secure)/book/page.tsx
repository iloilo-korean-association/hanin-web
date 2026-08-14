import { Alert, GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  cashThresholdFrom,
  cfgNum,
  entryFlags,
  loadSettings,
  monthOf,
  todayManila,
  type EntryFlagConfig,
} from "@/lib/domain";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { BookEntry, type BookRowUI, type MasterData } from "./BookEntry";

export const dynamic = "force-dynamic";

/**
 * 장부 — 수입·지출을 한 화면에서 직접 적는다.
 *
 * 예전에는 수납(/officer/receipt)과 지출 요청(/officer/expense) + 승인·집행(/officer/approve)
 * 세 화면으로 나뉘어 있었고, 지출 1건에 제출이 2~4회 필요했다. 여기 하나로 합쳤다.
 */
export default async function BookPage() {
  const me = await currentOfficer();
  if (!me) {
    return (
      <PageContainer>
        <GuardDenied message="임원 계정으로 로그인해 주십시오." howToFix={null} />
      </PageContainer>
    );
  }

  const canWrite = me.can("입력권") && !me.isAuditor;

  const settings = await loadSettings(prisma);
  const flagCfg: EntryFlagConfig = {
    cashThreshold: cashThresholdFrom(settings),
    largeAmount: cfgNum(settings, "감사확인_고액기준", 30000),
  };

  const today = todayManila();
  const thisMonth = monthOf(today);

  const [accounts, funds, categories, events, officers, rows] = await Promise.all([
    prisma.account.findMany({ where: { status: "ACTIVE" }, orderBy: { accountId: "asc" } }),
    prisma.fund.findMany({ where: { status: "ACTIVE" }, orderBy: { fundId: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.event.findMany({
      where: { status: { in: ["준비", "접수중", "마감", "완료"] } },
      orderBy: { startsAt: "desc" },
      select: { eventId: true, title: true },
      take: 30,
    }),
    prisma.officer.findMany({
      where: { status: "ACTIVE" },
      select: { email: true, name: true, role: true },
      orderBy: { officerId: "asc" },
    }),
    // 이번 달 것만 보여준다. 전체를 끌어오면 해가 갈수록 화면이 느려진다.
    prisma.transaction.findMany({
      where: { date: { startsWith: thisMonth } },
      orderBy: [{ date: "desc" }, { seq: "desc" }],
    }),
  ]);

  const master: MasterData = {
    accounts: accounts.map((a) => ({
      accountId: a.accountId,
      name: a.name,
      kind: a.kind,
      currency: a.currency,
      status: a.status,
    })),
    funds: funds.map((f) => ({ fundId: f.fundId, name: f.name, kind: f.kind })),
    categories: categories.map((c) => ({
      code: c.code,
      name: c.name,
      majorType: c.majorType,
    })),
    events: events.map((e) => ({ eventId: e.eventId, title: e.title })),
    // 확인자 목록에서 본인을 뺀다. 서버에서도 다시 막지만, 고를 수 없게 하는 것이 먼저다.
    officers: officers
      .filter((o) => o.email.toLowerCase() !== me.email.toLowerCase())
      .map((o) => ({ email: o.email, label: `${o.name} (${o.role})` })),
    today,
    cashThreshold: flagCfg.cashThreshold,
  };

  const ui: BookRowUI[] = rows.map((t) => ({
    receiptNo: t.receiptNo,
    date: t.date,
    direction: t.direction,
    amount: t.amount,
    amountPhp: t.amountPhp,
    currency: t.currency,
    method: t.method,
    accountId: t.accountId,
    fundId: t.fundId,
    categoryCode: t.categoryCode,
    categoryName: categories.find((c) => c.code === t.categoryCode)?.name ?? t.categoryCode,
    counterpartyName: t.counterpartyName,
    counterpartyType: t.counterpartyType,
    memo: t.memo,
    externalRef: t.externalRef,
    status: t.status,
    voidReason: t.voidReason,
    relatedParty: t.relatedParty,
    enteredBy: t.enteredBy,
    verifiedBy: t.verifiedBy,
    evidenceUrl: t.evidenceUrl,
    reviewedBy: t.reviewedBy,
    reviewedAt: t.reviewedAt ? t.reviewedAt.toISOString() : null,
    flags: entryFlags(
      {
        direction: t.direction,
        amount: t.amount,
        currency: t.currency,
        fxRate: t.fxRate,
        amountPhp: t.amountPhp,
        method: t.method,
        evidenceUrl: t.evidenceUrl,
        relatedParty: t.relatedParty,
        enteredBy: t.enteredBy,
        enteredAt: t.enteredAt,
        verifiedBy: t.verifiedBy,
        updatedAt: t.updatedAt,
        reviewedAt: t.reviewedAt,
        status: t.status,
      },
      flagCfg,
    ),
  }));

  // 계좌 잔액은 이번 달만이 아니라 전체를 봐야 맞다. 개시잔액 + 전 기간 POSTED 수지.
  const posted = await prisma.transaction.aggregate({
    where: { status: "POSTED", direction: "IN" },
    _sum: { amountPhp: true },
  });
  const postedOut = await prisma.transaction.aggregate({
    where: { status: "POSTED", direction: "OUT" },
    _sum: { amountPhp: true },
  });
  const opening = accounts.reduce((s, a) => s + a.openingBalance, 0);
  const balance = opening + (posted._sum.amountPhp ?? 0) - (postedOut._sum.amountPhp ?? 0);

  const closedFy = await prisma.fiscalYear.findMany({
    where: { status: "CLOSED" },
    select: { year: true },
  });

  return (
    <PageContainer>
      <PageHeader
        title="장부"
        titleEn="Book"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={
          <>
            받은 돈과 나간 돈을 여기서 바로 적습니다. 적는 즉시 공개 회계에 반영됩니다 —
            승인 절차는 없습니다. 대신 증빙·현금·이해관계 건은 자동으로 감사 확인 대기에 올라갑니다.
          </>
        }
      />
      <Stack gap="lg">
        {closedFy.length > 0 ? (
          <Alert tone="info" title={`마감된 회계연도 ${closedFy.map((y) => y.year).join(", ")}`}>
            마감된 연도의 날짜로는 적거나 고칠 수 없습니다. 그 해의 공개 결산이 바뀌지 않도록
            잠근 것입니다(I5).
          </Alert>
        ) : null}

        <BookEntry
          rows={ui}
          master={master}
          monthLabel={thisMonth}
          totalBalance={balance}
          readOnly={!canWrite}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 감사 화면에서 확인 도장만 찍을 수 있습니다."
              : '"입력권" 이 없습니다. 관리자에게 요청하십시오.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

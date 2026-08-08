import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConflictBadge,
  EmptyState,
  Field,
  LinkButton,
  PageContainer,
  PageHeader,
  Select,
  Stack,
  StatGrid,
  StatLine,
  StatusBadge,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableCardBody,
  formatAmount,
  formatDate,
  formatPeso,
  formatSignedPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  buildPublicLedger,
  buildRealNameList,
  cfgStr,
  evaluateConflict,
  fiscalYearOf,
  loadSettings,
  publicDisclosures,
  publicPolicyFrom,
  todayManila,
  type AccountRow,
  type CategoryRow,
  type FundRow,
  type PublicLedger,
  type TxRow,
} from "@/lib/domain";
import { ORG_NAME, ROUTES, absoluteUrl } from "@/lib/site";

import { Anchor } from "../_components/anchor";

export const metadata: Metadata = {
  title: "공개 회계",
  description:
    "일로일로 한인회의 회비와 기부금이 어디에 쓰였는지 건별로 전액 공개합니다. 임원 이해관계 거래는 지분율까지 함께 표시합니다.",
  alternates: { canonical: "/ledger" },
  openGraph: {
    type: "article",
    locale: "ko_KR",
    url: absoluteUrl("/ledger"),
    siteName: ORG_NAME,
    title: `공개 회계 · ${ORG_NAME}`,
    description:
      "지출은 건별 전액 공개. 수입은 집계만. 영수증번호는 결번 없이 1번부터, 거래는 삭제되지 않습니다.",
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다(curl 로 확인).
    //   그래서 이 화면 전용 카드(ledger/og/route.tsx)를 직접 가리킨다.
    //   그 카드에는 총수입·총지출·잔액이 실제 숫자로 찍힌다 — 링크만 봐도 내용이 보인다.
    images: [
      {
        url: "/ledger/og",
        width: 1200,
        height: 630,
        alt: `${ORG_NAME} 공개 회계 — 지출 건별 전액 공개`,
      },
    ],
  },
};

/** 총무가 수납·지출을 기록하면 즉시 반영돼야 한다. */
export const dynamic = "force-dynamic";

/* ── searchParams 정규화 ─────────────────────────────────────────────── */

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

export default async function LedgerPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayManila();

  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);
  const declaredAt = cfgStr(settings, "개시선언.기준일시", "");

  const fiscalYears = await prisma.fiscalYear.findMany({ orderBy: { year: "desc" } });
  const defaultFy =
    fiscalYears.find((y) => y.status === "OPEN")?.year ?? fiscalYears[0]?.year ?? fiscalYearOf(today);

  // ★ 쿼리 값은 신뢰하지 않는다. 존재하는 회계연도 목록 안에서만 고른다.
  const askedFy = Number(one(sp.fy));
  const fy = fiscalYears.some((y) => y.year === askedFy) ? askedFy : defaultFy;
  const fyRow = fiscalYears.find((y) => y.year === fy) ?? null;

  const askedMonth = one(sp.m);
  const month = (MONTHS as readonly string[]).includes(askedMonth) ? askedMonth : "";
  const monthKey = month ? `${fy}-${month}` : "";

  const [txs, accounts, funds, categories, members, vendors, conflicts, officers, events, cashCounts] =
    await Promise.all([
      prisma.transaction.findMany({ where: { fiscalYear: fy }, orderBy: { seq: "asc" } }),
      prisma.account.findMany(),
      prisma.fund.findMany(),
      prisma.category.findMany(),
      // ★ 마스킹 대조 전용. 이 배열은 화면으로 나가지 않는다.
      prisma.member.findMany({ select: { name: true } }),
      prisma.vendor.findMany(),
      prisma.conflictOfInterest.findMany(),
      prisma.officer.findMany(),
      prisma.event.findMany({ orderBy: { startsAt: "asc" } }),
      prisma.cashCount.findMany({ orderBy: { countedAt: "desc" } }),
    ]);

  const realNames = buildRealNameList(members.map((m) => m.name));
  const opt = { fiscalYear: fy, today, realNames, ...policy };

  const yearLedger = buildPublicLedger(
    txs as unknown as TxRow[],
    accounts as unknown as AccountRow[],
    funds as unknown as FundRow[],
    categories as unknown as CategoryRow[],
    opt,
  );

  /**
   * 월 필터.
   * 같은 buildPublicLedger 를 그 달의 거래만으로 한 번 더 돌린다.
   * 집계 규칙(내부이체 제외·DRAFT 제외·수취인 마스킹)이 연간과 한 글자도 달라지지 않게 하려고
   * 여기서 새 집계 함수를 만들지 않았다.
   * ★ 이 결과에서 쓰는 것은 수입·지출·수지·과목별 수입·지출목록뿐이다.
   *   잔액과 결번검사는 한 달만 잘라 보면 의미가 없으므로 연간 것을 쓴다.
   */
  const monthLedger: PublicLedger | null = monthKey
    ? buildPublicLedger(
        (txs as unknown as TxRow[]).filter((t) => t.date.slice(0, 7) === monthKey),
        accounts as unknown as AccountRow[],
        funds as unknown as FundRow[],
        categories as unknown as CategoryRow[],
        opt,
      )
    : null;

  const scoped = monthLedger ?? yearLedger;
  const scopeLabel = month ? `${fy}년 ${Number(month)}월` : `${fy}년 전체`;

  /**
   * 잔액 기준일. buildPublicLedger 안의 asOf 계산과 같은 규칙이다 —
   * 당해연도면 오늘까지, 지난 연도면 그 해 12/31 까지.
   * "오늘 기준" 이라고 써 놓고 실제로는 12/31 잔액을 보여 주면 거짓말이 된다.
   */
  const asOf = today >= `${fy}-01-01` && today <= `${fy}-12-31` ? today : `${fy}-12-31`;
  /** 이 회계연도에 이 시스템으로 기록된 거래가 하나도 없는가 (도입 이전 연도 등) */
  const emptyYear = txs.length === 0;

  /* ── 지출 행별 이해관계 배지 ──────────────────────────────────────────
     공개 목록의 수취인은 이미 마스킹된 값이라 그것으로는 대조할 수 없다.
     그래서 원본 거래의 상대방명으로 서버에서 판정하고, 영수증번호로만 화면에 연결한다.
     (원본 이름은 화면으로 나가지 않는다.) */
  const conflictByReceipt = new Map<
    string,
    { officer: string; relation: string; stakePct: number | null }
  >();
  const conflictById = new Map(conflicts.map((c) => [c.conflictId, c]));

  for (const t of txs) {
    if (t.direction !== "OUT") continue;
    if (!t.relatedParty) continue;
    const verdict = evaluateConflict(
      { counterpartyName: t.counterpartyName },
      vendors,
      conflicts,
      officers,
    );
    const first = verdict.relatedOfficers[0];
    const declared = verdict.conflictId ? conflictById.get(verdict.conflictId) : undefined;
    conflictByReceipt.set(t.receiptNo, {
      officer: first ? `${first.name || "임원"}${first.role ? ` ${first.role}` : ""}` : "임원 관련",
      relation: declared?.relationType || (verdict.undetermined ? "판정 불가" : "이해관계 신고"),
      stakePct: verdict.ownershipPct,
    });
  }

  /* ── 기금 분리 — 일반회계와 지정기부를 절대 한 숫자로 합치지 않는다 ──── */
  const generalFunds = yearLedger.funds.filter((f) => f.kind !== "지정");
  const designatedFunds = yearLedger.funds.filter((f) => f.kind === "지정");
  const generalTotal = generalFunds.reduce((s, f) => s + f.balance, 0);
  const designatedTotal = designatedFunds.reduce((s, f) => s + f.balance, 0);

  /* ── 기부 ─────────────────────────────────────────────────────────── */
  const [donations, donationUses] = await Promise.all([
    prisma.donation.findMany({
      where: { receivedOn: { gte: `${fy}-01-01`, lte: `${fy}-12-31` }, status: { not: "취소" } },
      orderBy: { receivedOn: "desc" },
    }),
    prisma.donationUse.findMany({
      where: { usedOn: { gte: `${fy}-01-01`, lte: `${fy}-12-31` }, status: { not: "취소" } },
    }),
  ]);

  const fundName = new Map(funds.map((f) => [f.fundId, f.name]));
  const donationByFund = new Map<string, { received: number; used: number; count: number }>();
  const bucket = (id: string) => {
    const k = id || "(미지정)";
    const cur = donationByFund.get(k) ?? { received: 0, used: 0, count: 0 };
    donationByFund.set(k, cur);
    return cur;
  };
  for (const d of donations) {
    const b = bucket(d.fundId ?? "");
    b.received += d.amountPhp;
    b.count += 1;
  }
  for (const u of donationUses) {
    bucket(u.fundId).used += u.amountPhp;
  }

  const namedDonors = donations.filter(
    (d) => d.publicConsent && !d.isAnonymous && d.publicDisplayName.trim(),
  );
  const quietDonors = donations.filter(
    (d) => !(d.publicConsent && !d.isAnonymous && d.publicDisplayName.trim()),
  );
  const quietTotal = quietDonors.reduce((s, d) => s + d.amountPhp, 0);

  /* ── 행사별 정산 ──────────────────────────────────────────────────── */
  const txByReceipt = new Map(txs.map((t) => [t.receiptNo, t]));
  const eventSettlements = events.map((e) => {
    const nos = e.settlementReceiptNos.split(",").map((s) => s.trim()).filter(Boolean);
    let spent = 0;
    let counted = 0;
    for (const no of nos) {
      const t = txByReceipt.get(no);
      if (!t || t.status !== "POSTED" || t.direction !== "OUT") continue;
      spent += t.amountPhp;
      counted += 1;
    }
    return { event: e, nos, spent, counted };
  });

  /* ── 이해상충 공시 ────────────────────────────────────────────────── */
  const disclosures = publicDisclosures(conflicts);
  const vendorName = new Map(vendors.map((v) => [v.vendorId, v.name]));

  const latestCount = cashCounts[0] ?? null;
  const priorYear = fiscalYears.find((y) => y.year === fy - 1) ?? null;

  return (
    <PageContainer wide>
      <PageHeader
        title="공개 회계"
        titleEn="Open Ledger"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        description={
          <>
            지출은 <b>한 건도 빠짐없이</b> 금액까지 공개합니다. 수입은 누가 냈는지 드러나지 않도록
            과목별·월별 <b>집계로만</b> 공개합니다. 임원과 이해관계가 있는 거래는 지분율까지 함께
            표시합니다.
          </>
        }
        actions={
          <LinkButton href={ROUTES.help} variant="secondary">
            이 숫자에 대해 문의
          </LinkButton>
        }
      />

      {/* 종이로 뽑았을 때 무엇을 뽑은 것인지 남는다 */}
      <p className="print-only mb-4 text-sm">
        {ORG_NAME} 공개 회계 · {scopeLabel} · 출력 {today}
      </p>

      <Stack gap="lg">
        {/* ══ 개시잔액 선언 — 상시 게시. 축약·삭제 금지 (개시잔액 선언서 제3조) ══ */}
        <Alert tone="info" title="이 장부는 언제부터 시작하는가 — 개시잔액에 관하여">
          <p>
            본회의 공개 원장은{" "}
            <b>{declaredAt ? declaredAt : "(개시 시점 미설정 — 확인 중)"}</b> 을 개시 시점으로
            시작합니다. 이 시점의 잔액은 전임 집행부가 실사하여 선언한 「개시잔액 선언서」에 따른
            것이며, <b>이 선언서는 감사보고서가 아닙니다.</b>
          </p>
          <p className="mt-2">
            <b>개시 시점 이전 기간의 회계는 이 시스템의 감사 대상이 아니며</b>, 본회는 전임 집행부의
            과거 회계 처리에 대하여 어떠한 소급 책임도 묻지 않습니다. 개시 시점 이후의 모든 거래는
            「재무회계규정」에 따라 전액 공개됩니다.
          </p>
          <p className="mt-2 text-sm">
            {fy}년 개시잔액 합계 <b className="tnum">{formatPeso(yearLedger.accountTotals.openingBalance)}</b>
            {priorYear?.closingTotalPhp !== null && priorYear?.closingTotalPhp !== undefined ? (
              <>
                {" · "}
                {priorYear.year}년 마감잔액{" "}
                <b className="tnum">{formatPeso(priorYear.closingTotalPhp)}</b>
                {priorYear.closingTotalPhp === yearLedger.accountTotals.openingBalance ? (
                  <span className="text-success"> · 일치 (I6)</span>
                ) : (
                  <span className="text-danger"> · 불일치 — 감사 확인 필요 (I6)</span>
                )}
              </>
            ) : null}
          </p>
        </Alert>

        {/* ══ 목차 — 페이지가 길다. 모바일에서 원하는 곳으로 바로 간다 ══════ */}
        <nav aria-label="이 페이지 목차" className="no-print">
          <ul className="flex flex-wrap gap-2">
            {[
              ["#summary", "요약"],
              ["#integrity", "투명성 지표"],
              ["#monthly", "월별 추이"],
              ["#income", "수입 (집계)"],
              ["#expense", "지출 (건별)"],
              ["#accounts", "계좌 잔액"],
              ["#fundsec", "기금 현황"],
              ["#donation", "기부"],
              ["#eventsec", "행사 정산"],
              ["#conflict", "이해상충 공시"],
              ["#howto", "직접 확인하는 방법"],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex min-h-10 items-center rounded-[var(--radius-pill)] border border-line bg-surface px-3 text-sm font-medium text-ink-soft hover:border-brand-300 hover:bg-brand-50"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ══ 필터 ═══════════════════════════════════════════════════════ */}
        <Card as="section" className="no-print">
          <CardHeader
            title="기간 선택"
            description="선택하면 주소(URL)가 바뀝니다. 그 주소를 그대로 복사해 공유하시면 같은 화면이 열립니다."
            headingLevel={2}
          />
          <CardBody>
            <form method="get" action={ROUTES.ledger} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field htmlFor="fy" label="회계연도" labelEn="Fiscal year" className="sm:w-48">
                <Select id="fy" name="fy" defaultValue={String(fy)}>
                  {fiscalYears.map((y) => (
                    <option key={y.year} value={y.year}>
                      {y.year}년 {y.status === "CLOSED" ? "(마감)" : "(진행 중)"}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field htmlFor="m" label="기간" labelEn="Period" className="sm:w-48">
                <Select id="m" name="m" defaultValue={month}>
                  <option value="">연간 전체</option>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {Number(m)}월
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex gap-2">
                <Button type="submit">보기</Button>
                {month ? (
                  <LinkButton href={`${ROUTES.ledger}?fy=${fy}`} variant="ghost">
                    연간 전체로
                  </LinkButton>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        {/* ══ 요약 큰 숫자 3개 ═══════════════════════════════════════════ */}
        <section id="summary" aria-labelledby="summary-h" className="scroll-mt-20">
          <h2 id="summary-h" className="mb-3 flex flex-wrap items-baseline gap-2 text-xl">
            <span>
              {scopeLabel} 요약{" "}
              <span className="text-base font-normal text-ink-faint">Summary</span>
            </span>
            {fyRow?.status === "CLOSED" ? (
              <Badge tone="neutral" title="마감된 회계연도의 거래는 조회만 가능합니다 (I5)">
                마감된 회계연도 · 변경 불가
              </Badge>
            ) : (
              <Badge tone="info">진행 중인 회계연도 · {today} 기준</Badge>
            )}
          </h2>

          {emptyYear ? (
            <Alert
              tone="warn"
              className="mb-3"
              title={`${fy}년에는 이 시스템에 기록된 거래가 없습니다`}
            >
              <p>
                이 회계연도는 새 회계시스템을 도입하기 이전이거나, 도입 전에 이미 마감된 연도입니다.
                아래 계좌·기금 잔액은 <b>현재 설정된 개시잔액</b>이며 {fy}년의 실제 거래 결과가
                아닙니다.
                {fyRow?.closingTotalPhp !== null && fyRow?.closingTotalPhp !== undefined ? (
                  <>
                    {" "}
                    {fy}년 마감잔액으로 선언된 금액은{" "}
                    <b className="tnum">{formatPeso(fyRow.closingTotalPhp)}</b> 입니다.
                  </>
                ) : null}
              </p>
            </Alert>
          ) : null}

          <StatGrid
            label={`${scopeLabel} 수입·지출·수지`}
            items={[
              {
                label: "총수입",
                labelEn: "Income",
                value: formatPeso(scoped.totalIncome),
                tone: "income",
                sub: `확정 거래 ${scoped.postedCount}건 기준`,
              },
              {
                label: "총지출",
                labelEn: "Expense",
                value: formatPeso(scoped.totalExpense),
                tone: "expense",
                sub: `건별 ${scoped.expenses.filter((e) => !e.voided).length}건 아래 전액 공개`,
              },
              {
                label: "수지차",
                labelEn: "Net",
                value: formatSignedPeso(scoped.net),
                tone: scoped.net >= 0 ? "balance" : "expense",
                sub: "수입 − 지출",
              },
            ]}
          />

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Alert tone="info" title="자기 계좌 사이의 돈 이동은 빼고 셉니다">
              현금함의 돈을 통장에 넣는 것처럼 한인회 안에서만 오간 돈은 수입에도 지출에도 넣지
              않습니다. 넣으면 “얼마 걷어서 얼마 썼나”가 부풀려집니다. {fy}년 내부이체{" "}
              <b>{yearLedger.metrics.internalTransferCount}건 · {formatPeso(yearLedger.metrics.internalTransferAmount)}</b>
              은 아래 지출 목록에 <b>남아 있지만</b> 위 합계에서는 빠져 있습니다.
            </Alert>
            <Alert tone="warn" title="미확정(DRAFT) 거래는 합계에 넣지 않습니다">
              증빙이 없거나 현금 고액에 2인 확인이 끝나지 않은 거래는 확정되지 않습니다. {fy}년
              미확정 <b>{yearLedger.metrics.draftCount}건</b>. 확정되면 자동으로 이 화면에
              나타납니다.
            </Alert>
          </div>
        </section>

        {/* ══ 투명성 지표 ════════════════════════════════════════════════ */}
        <Anchor id="integrity">
          <Card as="section">
            <CardHeader
              title="투명성 지표"
              description={`${fy}년 전체 기준. 이 장부가 스스로 앞뒤가 맞는지를 숫자로 보여 드립니다.`}
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <div>
                  <StatLine
                    label="영수증번호 결번 검사 (I2)"
                    value={
                      <Badge tone={yearLedger.metrics.gaps.ok ? "success" : "danger"} dot>
                        {yearLedger.metrics.gaps.ok ? "결번 없음" : "결번 의심"}
                      </Badge>
                    }
                  />
                  <StatLine
                    label="증빙 첨부율 (확정 거래 기준, I3)"
                    value={
                      yearLedger.metrics.evidenceRate === null
                        ? "—"
                        : `${yearLedger.metrics.evidenceRate}%`
                    }
                    tone={yearLedger.metrics.evidenceRate === 100 ? "income" : "expense"}
                  />
                  <StatLine label="확정(POSTED) 거래" value={`${yearLedger.metrics.postedCount}건`} />
                  <StatLine
                    label="미확정(DRAFT) 거래"
                    value={`${yearLedger.metrics.draftCount}건`}
                    tone={yearLedger.metrics.draftCount ? "expense" : "neutral"}
                  />
                </div>
                <div>
                  <StatLine
                    label="무효(VOIDED) 거래"
                    value={`${yearLedger.metrics.voidedCount}건`}
                  />
                  <StatLine
                    label="이해관계자 거래"
                    value={`${yearLedger.metrics.relatedPartyCount}건 · ${formatPeso(yearLedger.metrics.relatedPartyAmount)}`}
                  />
                  <StatLine
                    label="내부이체"
                    value={`${yearLedger.metrics.internalTransferCount}건 · ${formatPeso(yearLedger.metrics.internalTransferAmount)}`}
                  />
                  <StatLine
                    label="마지막 현금 실사"
                    value={
                      latestCount
                        ? `${formatDate(latestCount.countedAt)} · 차액 ${formatSignedPeso(latestCount.diff)}`
                        : "기록 없음"
                    }
                    tone={latestCount && latestCount.diff !== 0 ? "expense" : "neutral"}
                  />
                </div>
              </div>
  
              <p className="mt-4 text-sm text-ink-muted">{yearLedger.metrics.gaps.message}</p>
              {latestCount && latestCount.diff !== 0 && latestCount.diffReason ? (
                <p className="mt-1 text-sm text-ink-soft">
                  차액 사유 · {latestCount.diffReason}
                </p>
              ) : null}
            </CardBody>
          </Card>
        </Anchor>

        {/* ══ 월별 추이 ══════════════════════════════════════════════════ */}
        <Anchor id="monthly">
          <Card as="section">
            <CardHeader title="월별 추이" description={`${fy}년 · 확정 거래 기준, 내부이체 제외`} />
            <MonthlyTable ledger={yearLedger} fy={fy} month={month} />
          </Card>
        </Anchor>

        {/* ══ 수입 (집계) ════════════════════════════════════════════════ */}
        <Anchor id="income">
          <Card as="section">
            <CardHeader
              title={`수입 — 과목별 집계 (${scopeLabel})`}
              description="누가 얼마 냈는지는 공개하지 않습니다. 미납자를 드러내지 않기 위해서이고, 필리핀 RA 10173·한국 개인정보 보호법이 보호하는 정보이기 때문입니다. 금액은 하나도 빠지지 않습니다."
            />
            {scoped.incomeByCategory.length === 0 ? (
              <CardBody>
                <EmptyState
                  icon="🪙"
                  title={`${scopeLabel}에 확정된 수입이 없습니다`}
                  description="확정되지 않은(DRAFT) 수입은 여기에 나타나지 않습니다."
                />
              </CardBody>
            ) : (
              <TableCardBody label="과목별 수입">
                <Table caption={`${scopeLabel} 과목별 수입`} captionHidden>
                  <THead>
                    <TR>
                      <TH>과목</TH>
                      <TH numeric>금액</TH>
                      <TH numeric>건수</TH>
                      <TH numeric>비중</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {scoped.incomeByCategory.map((b) => (
                      <TR key={b.categoryCode}>
                        <TD>{b.displayName}</TD>
                        <TD numeric>{formatPeso(b.amount)}</TD>
                        <TD numeric>{b.count}</TD>
                        <TD numeric>
                          {scoped.totalIncome
                            ? `${Math.round((b.amount / scoped.totalIncome) * 1000) / 10}%`
                            : "—"}
                        </TD>
                      </TR>
                    ))}
                    <TR tone="muted">
                      <TH scope="row">합계</TH>
                      <TD numeric className="font-bold">
                        {formatPeso(scoped.totalIncome)}
                      </TD>
                      <TD numeric>
                        {scoped.incomeByCategory.reduce((s, b) => s + b.count, 0)}
                      </TD>
                      <TD numeric>100%</TD>
                    </TR>
                  </TBody>
                </Table>
              </TableCardBody>
            )}
          </Card>
        </Anchor>

        {/* ══ 지출 (건별 전액 공개) ══════════════════════════════════════ */}
        <Anchor id="expense">
          <Card as="section">
            <CardHeader
              title={`지출 — 건별 전액 공개 (${scopeLabel})`}
              description={
                <>
                  확정된 지출을 한 건도 빼지 않고 보여 드립니다. 무효 처리된 거래도{" "}
                  <b>지우지 않고 “무효”로 표시해 남깁니다</b> — 지우면 결번이 생기고, 결번이 생기면
                  이 장부를 믿을 수 없게 됩니다.
                </>
              }
              action={
                <Badge tone="neutral">
                  {scoped.expenses.length}건 표시
                  {scoped.expensesTruncated > 0 ? ` · ${scoped.expensesTruncated}건 생략` : ""}
                </Badge>
              }
            />
  
            {scoped.expenses.length === 0 ? (
              <CardBody>
                <EmptyState
                  icon="🧾"
                  title={`${scopeLabel}에 공개할 지출이 없습니다`}
                  description="이 기간에 확정된 지출 거래가 아직 없습니다. 다른 기간을 선택해 보십시오."
                  action={
                    <LinkButton href={`${ROUTES.ledger}?fy=${fy}`}>연간 전체 보기</LinkButton>
                  }
                />
              </CardBody>
            ) : (
              <>
                <TableCardBody label="지출 내역">
                  <Table caption={`${scopeLabel} 지출 전체`} captionHidden>
                    <THead>
                      <TR>
                        <TH>일자</TH>
                        <TH>영수증번호</TH>
                        <TH>과목 · 기금</TH>
                        <TH>수취인</TH>
                        <TH>적요</TH>
                        <TH numeric>금액</TH>
                        <TH>수단</TH>
                        <TH>증빙</TH>
                        <TH>상태</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {scoped.expenses.map((e) => {
                        const badge = conflictByReceipt.get(e.receiptNo);
                        const tone = e.voided
                          ? "muted"
                          : e.internalTransfer
                            ? "warn"
                            : e.relatedParty
                              ? "conflict"
                              : undefined;
                        return (
                          <TR key={e.receiptNo} tone={tone}>
                            <TD>
                              <time dateTime={e.date} className="tnum whitespace-nowrap">
                                {e.date}
                              </time>
                            </TD>
                            <TD className="tnum whitespace-nowrap text-sm text-ink-muted">
                              {e.receiptNo}
                            </TD>
                            <TD>
                              <span className="whitespace-nowrap">{e.categoryName}</span>
                              {e.fundName ? (
                                <span className="block text-sm text-ink-muted">{e.fundName}</span>
                              ) : null}
                            </TD>
                            <TD>
                              <span className="whitespace-nowrap">{e.payee}</span>
                              <span className="block text-sm text-ink-faint">
                                {e.counterpartyType}
                              </span>
                              {e.relatedParty ? (
                                <span className="mt-1 block">
                                  {badge ? (
                                    <ConflictBadge
                                      officer={badge.officer}
                                      relation={badge.relation}
                                      {...(badge.stakePct === null ? {} : { stakePct: badge.stakePct })}
                                    />
                                  ) : (
                                    <Badge tone="conflict">이해관계자 거래</Badge>
                                  )}
                                </span>
                              ) : null}
                              {e.internalTransfer ? (
                                <span className="mt-1 block">
                                  <Badge tone="warn" title="한인회 자기 계좌 사이의 이동입니다">
                                    내부이체 · 수지 제외
                                  </Badge>
                                </span>
                              ) : null}
                            </TD>
                            <TD className="max-w-[22rem] text-sm text-ink-soft">
                              {e.memo || <span className="text-ink-faint">—</span>}
                              {e.voided && e.voidReason ? (
                                <span className="mt-1 block text-danger">무효 사유 · {e.voidReason}</span>
                              ) : null}
                            </TD>
                            <TD numeric className={e.voided ? "line-through" : "font-semibold"}>
                              {formatPeso(e.amount)}
                            </TD>
                            <TD className="text-sm">{e.method}</TD>
                            <TD>
                              {e.hasEvidence ? (
                                <Badge tone="success" title="영수증·계산서가 첨부되어 있습니다">
                                  있음
                                </Badge>
                              ) : (
                                <Badge tone="danger">없음</Badge>
                              )}
                            </TD>
                            <TD>
                              <StatusBadge status={e.voided ? "VOIDED" : "POSTED"} />
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableCardBody>
                <ExpenseFootnote scoped={scoped} />
              </>
            )}
          </Card>
        </Anchor>

        {/* ══ 계좌 잔액 ══════════════════════════════════════════════════ */}
        <Anchor id="accounts">
          <Card as="section">
            <CardHeader
              title="계좌별 잔액"
              description={`${asOf} 기준 장부잔액. 개시잔액 + 확정 수입 − 확정 지출. (월을 선택해도 잔액은 이 기준일로 표시합니다)`}
            />
            <TableCardBody label="계좌별 잔액">
              <Table caption="계좌별 잔액" captionHidden>
                <THead>
                  <TR>
                    <TH>계좌</TH>
                    <TH>종류</TH>
                    <TH numeric>개시잔액</TH>
                    <TH numeric>수입</TH>
                    <TH numeric>지출</TH>
                    <TH numeric>현재 잔액</TH>
                  </TR>
                </THead>
                <TBody>
                  {yearLedger.accounts.map((a) => (
                    <TR key={a.accountId}>
                      <TD>
                        <span className="font-medium">{a.name}</span>
                        <span className="block text-sm text-ink-faint tnum">{a.accountId}</span>
                      </TD>
                      <TD className="text-sm">{a.kind}</TD>
                      <TD numeric>{formatPeso(a.openingBalance)}</TD>
                      <TD numeric className="text-success">{formatPeso(a.inflow)}</TD>
                      <TD numeric className="text-danger">{formatPeso(a.outflow)}</TD>
                      <TD numeric className="font-bold">{formatPeso(a.balance)}</TD>
                    </TR>
                  ))}
                  <TR tone="muted">
                    <TH scope="row" colSpan={2}>
                      합계
                    </TH>
                    <TD numeric>{formatPeso(yearLedger.accountTotals.openingBalance)}</TD>
                    <TD numeric>{formatPeso(yearLedger.accountTotals.inflow)}</TD>
                    <TD numeric>{formatPeso(yearLedger.accountTotals.outflow)}</TD>
                    <TD numeric className="font-bold">
                      {formatPeso(yearLedger.accountTotals.balance)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </TableCardBody>
            {yearLedger.hiddenAccounts.count > 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">
                  비공개로 설정된 계좌 {yearLedger.hiddenAccounts.count}개의 잔액은 위 합계에
                  포함되어 있습니다.
                </p>
              </CardBody>
            ) : null}
          </Card>
        </Anchor>

        {/* ══ 기금 — 일반회계와 지정기부를 절대 섞지 않는다 ═══════════════ */}
        <section id="fundsec" aria-labelledby="fund-h" className="scroll-mt-20">
          <h2 id="fund-h" className="mb-3 text-xl">
            기금 현황 <span className="text-base font-normal text-ink-faint">Funds</span>
          </h2>

          <Alert tone="warn" title="지정 기부금은 일반회계와 섞지 않습니다">
            장학·긴급구호처럼 <b>용도를 지정해 받은 돈</b>은 그 용도 외에는 쓸 수 없습니다. 그래서
            아래 두 표를 나누어 보여 드리고, 한 숫자로 합치지 않습니다.
            {yearLedger.fundWarning ? (
              <b className="mt-1 block text-danger">
                지정기금 잔액이 음수인 항목이 있습니다 — 목적외 사용 의심. 감사에게 문의해 주십시오.
              </b>
            ) : null}
          </Alert>

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                headingLevel={3}
                title="일반회계 · 적립금"
                description="용도를 지정하지 않고 받은 돈. 한인회 운영에 씁니다."
                action={<Badge tone="neutral">{formatPeso(generalTotal)}</Badge>}
              />
              <FundTable rows={generalFunds} label="일반회계 기금" />
            </Card>

            <Card>
              <CardHeader
                headingLevel={3}
                title="지정 기부금"
                description="기부자가 정한 용도로만 쓸 수 있는 돈."
                action={<Badge tone="info">{formatPeso(designatedTotal)}</Badge>}
              />
              <FundTable rows={designatedFunds} label="지정 기금" />
            </Card>
          </div>

          <p className="mt-3 text-sm text-ink-muted">
            기금 합계 <b className="tnum">{formatPeso(yearLedger.fundTotal)}</b> 는 계좌 합계{" "}
            <b className="tnum">{formatPeso(yearLedger.accountTotals.balance)}</b> 와 같아야
            합니다 —{" "}
            {yearLedger.fundTotal === yearLedger.accountTotals.balance ? (
              <b className="text-success">일치합니다.</b>
            ) : (
              <b className="text-danger">일치하지 않습니다. 감사에게 문의해 주십시오.</b>
            )}
          </p>
        </section>

        {/* ══ 기부 ═══════════════════════════════════════════════════════ */}
        <Anchor id="donation">
          <Card as="section">
            <CardHeader
              title={`기부 현황 (${fy}년)`}
              description="기금별로 얼마 들어와 얼마 나갔는지 공개합니다. 기부자 이름은 본인이 공개에 동의하고 직접 정한 표기만 나옵니다."
            />
            {donations.length === 0 ? (
              <CardBody>
                <EmptyState
                  icon="💛"
                  title={`${fy}년에 접수된 기부가 없습니다`}
                  description="기부해 주시면 사용 내역까지 이 화면에 전액 공개됩니다."
                  action={<LinkButton href={ROUTES.donate}>기부 안내</LinkButton>}
                />
              </CardBody>
            ) : (
              <>
                <TableCardBody label="기금별 기부 접수·사용">
                  <Table caption={`${fy}년 기금별 기부 접수와 사용`} captionHidden>
                    <THead>
                      <TR>
                        <TH>기금</TH>
                        <TH numeric>접수</TH>
                        <TH numeric>건수</TH>
                        <TH numeric>사용</TH>
                        <TH numeric>차액</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {[...donationByFund.entries()].map(([id, b]) => (
                        <TR key={id}>
                          <TD>{fundName.get(id) ?? (id === "(미지정)" ? "용도 미지정" : id)}</TD>
                          <TD numeric>{formatPeso(b.received)}</TD>
                          <TD numeric>{b.count}</TD>
                          <TD numeric>{formatPeso(b.used)}</TD>
                          <TD numeric className={b.received - b.used < 0 ? "text-danger" : ""}>
                            {formatSignedPeso(b.received - b.used)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableCardBody>
  
                <CardBody className="border-t border-line-soft">
                  <h3 className="text-lg">공개에 동의하신 기부자</h3>
                  {namedDonors.length === 0 ? (
                    <p className="mt-2 text-ink-muted">
                      이 기간에 이름 공개에 동의하신 분이 없습니다.
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {namedDonors.map((d) => (
                        <li
                          key={d.donationId}
                          className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft py-2 last:border-b-0"
                        >
                          <span>
                            <b>{d.publicDisplayName}</b>
                            <span className="ml-2 text-sm text-ink-muted tnum">{d.receivedOn}</span>
                            {d.fundId ? (
                              <span className="ml-2 text-sm text-ink-muted">
                                {fundName.get(d.fundId) ?? d.fundId} 지정
                              </span>
                            ) : null}
                          </span>
                          <span className="tnum font-semibold">
                            {formatPeso(d.amountPhp)}
                            {d.currency !== "PHP" ? (
                              <span className="ml-1 text-sm font-normal text-ink-muted">
                                ({formatAmount(d.amount, d.currency)} 환산)
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {quietDonors.length > 0 ? (
                    <p className="mt-3 text-sm text-ink-muted">
                      이름 공개에 동의하지 않으신 분과 익명 기부 <b>{quietDonors.length}건 ·{" "}
                      {formatPeso(quietTotal)}</b> 은 이름만 빼고 <b>금액은 위 합계에 그대로
                      포함</b>되어 있습니다.
                    </p>
                  ) : null}
                </CardBody>
              </>
            )}
          </Card>
        </Anchor>

        {/* ══ 행사 정산 ══════════════════════════════════════════════════ */}
        <Anchor id="eventsec">
          <Card as="section">
            <CardHeader
              title={`행사별 정산 (${fy}년)`}
              description="예산과 실제 집행액을 나란히 봅니다. 참가자 명단은 공개하지 않습니다."
            />
            {eventSettlements.length === 0 ? (
              <CardBody>
                <EmptyState icon="🎪" title={`${fy}년에 등록된 행사가 없습니다`} />
              </CardBody>
            ) : (
              <TableCardBody label="행사별 정산">
                <Table caption={`${fy}년 행사별 예산과 집행`} captionHidden>
                  <THead>
                    <TR>
                      <TH>행사</TH>
                      <TH>일자</TH>
                      <TH>상태</TH>
                      <TH numeric>예산</TH>
                      <TH numeric>집행</TH>
                      <TH numeric>차액</TH>
                      <TH>정산</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {eventSettlements.map(({ event: e, spent, counted, nos }) => (
                      <TR key={e.eventId}>
                        <TD>
                          <span className="font-medium">{e.title}</span>
                          <span className="block text-sm text-ink-muted">{e.place}</span>
                        </TD>
                        <TD className="tnum whitespace-nowrap">{formatDate(e.startsAt)}</TD>
                        <TD>
                          <Badge tone={e.status === "완료" ? "success" : "info"}>{e.status}</Badge>
                        </TD>
                        <TD numeric>{formatPeso(e.budget)}</TD>
                        <TD numeric>{nos.length ? formatPeso(spent) : "—"}</TD>
                        <TD numeric className={nos.length && e.budget - spent < 0 ? "text-danger" : ""}>
                          {nos.length ? formatSignedPeso(e.budget - spent) : "—"}
                        </TD>
                        <TD className="text-sm">
                          {nos.length ? (
                            <span>영수증 {counted}건 연결</span>
                          ) : (
                            <span className="text-ink-muted">정산 전</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableCardBody>
            )}
          </Card>
        </Anchor>

        {/* ══ 이해상충 공시 ══════════════════════════════════════════════ */}
        <Anchor id="conflict">
          <Card as="section">
            <CardHeader
              title="이해상충 공시"
              description="임원이 스스로 신고한 이해관계입니다. 숨기지 않고 상시 공개합니다. 해당 임원은 그 안건의 결재에서 빠집니다(회피)."
              action={<LinkButton href={ROUTES.biz}>업소 안내에서 보기</LinkButton>}
            />
            {disclosures.length === 0 ? (
              <CardBody>
                <EmptyState icon="🤝" title="공시된 이해상충 신고가 없습니다" />
              </CardBody>
            ) : (
              <TableCardBody label="이해상충 공시">
                <Table caption="임원 이해상충 신고 목록" captionHidden>
                  <THead>
                    <TR>
                      <TH>신고 임원</TH>
                      <TH>상대방</TH>
                      <TH>관계</TH>
                      <TH numeric>지분율</TH>
                      <TH>회피</TH>
                      <TH>내용</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {disclosures.map((c) => (
                      <TR key={c.conflictId} tone="conflict">
                        <TD>
                          <span className="font-medium">{c.declarerName}</span>
                          {c.role ? (
                            <span className="block text-sm text-ink-muted">{c.role}</span>
                          ) : null}
                        </TD>
                        <TD>
                          {c.vendorId ? (vendorName.get(c.vendorId) ?? c.counterpartyName) : c.counterpartyName}
                        </TD>
                        <TD>{c.relationType}</TD>
                        <TD numeric>
                          {c.ownershipPct === null || c.ownershipPct === undefined ? (
                            <span className="text-ink-muted">미확인</span>
                          ) : (
                            `${c.ownershipPct}%`
                          )}
                        </TD>
                        <TD>
                          {c.recused ? (
                            <Badge tone="success">회피함</Badge>
                          ) : (
                            <Badge tone="neutral">해당 안건 없음</Badge>
                          )}
                        </TD>
                        <TD className="max-w-[26rem] text-sm text-ink-soft">{c.detail}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableCardBody>
            )}
          </Card>
        </Anchor>

        {/* ══ 직접 확인하는 방법 ═════════════════════════════════════════ */}
        <Anchor id="howto">
          <Card as="section">
            <CardHeader title="이 숫자를 믿어도 되나요 — 직접 확인하는 방법" />
            <CardBody>
              <ol className="flex list-decimal flex-col gap-3 pl-5">
                <li>
                  <b>영수증번호에 빠진 번호가 있는지 보십시오.</b> 영수증은 1번부터 순서대로
                  발행됩니다. 한 건이라도 지우면 위 “결번 검사”에 즉시 드러납니다. 거래는 삭제할 수
                  없고, 취소할 때도 <b>무효</b>로 표시만 남습니다.
                </li>
                <li>
                  <b>증빙 첨부율을 보십시오.</b> 영수증 사진이 없는 지출은 애초에 확정될 수 없습니다.
                  확정되지 않은 거래는 위 합계에 들어가지 않습니다.
                </li>
                <li>
                  <b>이해관계 배지를 보십시오.</b> 임원이나 임원 가족이 관련된 업체와의 거래는 보라색
                  배지와 지분율로 표시됩니다. 그 거래는 해당 임원이 결재에서 빠진 상태로 2단계 승인을
                  거칩니다.
                </li>
                <li>
                  <b>궁금한 지출이 있으면 영수증번호를 적어 문의하십시오.</b> 회원은 누구나 원장 원본
                  열람을 요청할 수 있습니다. 개인정보 열람·정정·삭제도 같은 창구입니다.
                </li>
              </ol>
              <p className="mt-4">
                <Link href={ROUTES.help} className="link-ika font-semibold">
                  문의처 보기 →
                </Link>
                <span className="mx-2 text-ink-faint">·</span>
                <Link href={ROUTES.about} className="link-ika font-semibold">
                  한인회 회계 규칙 보기 →
                </Link>
              </p>
            </CardBody>
          </Card>
        </Anchor>
      </Stack>
    </PageContainer>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * 보조 컴포넌트 (이 화면 전용)
 * ══════════════════════════════════════════════════════════════════════ */

/** 지출 표 아래 각주 — 공개된 지출 합계가 요약의 총지출과 같은지 화면에서 검산한다. */
function ExpenseFootnote({ scoped }: { scoped: PublicLedger }) {
  return (
    <CardBody className="border-t border-line-soft">
      <p className="text-sm text-ink-muted">
        표시 {scoped.expenses.length}건
        {scoped.expensesTruncated > 0
          ? ` · 화면 한도를 넘어 ${scoped.expensesTruncated}건이 생략되었습니다. 기간을 좁혀 보십시오.`
          : ""}
        {" · "}
        공개된 지출 합계{" "}
        <b className="tnum">
          {formatPeso(
            scoped.expenses
              .filter((e) => !e.voided && !e.internalTransfer)
              .reduce((s, e) => s + e.amount, 0),
          )}
        </b>{" "}
        (위 요약의 총지출과 같아야 합니다:{" "}
        <b className="tnum">{formatPeso(scoped.totalExpense)}</b>
        {scoped.expenses
          .filter((e) => !e.voided && !e.internalTransfer)
          .reduce((s, e) => s + e.amount, 0) === scoped.totalExpense ? (
          <span className="text-success"> · 일치</span>
        ) : (
          <span className="text-danger"> · 불일치 — 감사에게 알려 주십시오</span>
        )}
        )
      </p>
    </CardBody>
  );
}

/** 기금 표. 일반/지정 양쪽이 같은 모양이어야 비교가 된다. */
function FundTable({
  rows,
  label,
}: {
  rows: PublicLedger["funds"];
  label: string;
}) {
  if (rows.length === 0) {
    return (
      <CardBody>
        <p className="text-ink-muted">해당하는 기금이 없습니다.</p>
      </CardBody>
    );
  }
  return (
    <TableCardBody label={label}>
      <Table caption={label} captionHidden>
        <THead>
          <TR>
            <TH>기금</TH>
            <TH numeric>개시</TH>
            <TH numeric>수입</TH>
            <TH numeric>사용</TH>
            <TH numeric>잔액</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((f) => (
            <TR key={f.fundId} tone={f.kind === "지정" && f.balance < 0 ? "warn" : undefined}>
              <TD>
                <span className="font-medium">{f.name}</span>
                <span className="block text-sm text-ink-muted">
                  {f.kind}
                  {f.purpose ? ` · ${f.purpose}` : ""}
                </span>
              </TD>
              <TD numeric>{formatPeso(f.openingBalance)}</TD>
              <TD numeric className="text-success">{formatPeso(f.income)}</TD>
              <TD numeric className="text-danger">{formatPeso(f.expense)}</TD>
              <TD numeric className="font-bold">{formatPeso(f.balance)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableCardBody>
  );
}

/** 월별 추이 — 막대는 CSS 폭으로만 그린다. 차트 라이브러리를 넣지 않는다. */
function MonthlyTable({
  ledger,
  fy,
  month,
}: {
  ledger: PublicLedger;
  fy: number;
  month: string;
}) {
  const peak = Math.max(1, ...ledger.months.map((m) => Math.max(m.income, m.expense)));

  return (
    <TableCardBody label="월별 수입·지출">
      <Table caption={`${fy}년 월별 수입과 지출`} captionHidden>
        <THead>
          <TR>
            <TH>월</TH>
            <TH numeric>수입</TH>
            <TH numeric>지출</TH>
            <TH numeric>수지</TH>
            <TH className="w-full min-w-[12rem]">비교</TH>
          </TR>
        </THead>
        <TBody>
          {ledger.months.map((m) => {
            const mm = m.month.slice(5, 7);
            const active = month === mm;
            return (
              <TR key={m.month} tone={active ? "warn" : undefined}>
                <TD className="whitespace-nowrap">
                  <Link
                    href={`${ROUTES.ledger}?fy=${fy}&m=${mm}`}
                    className="link-ika tnum font-medium"
                  >
                    {Number(mm)}월
                  </Link>
                </TD>
                <TD numeric className="text-success">
                  {m.income ? formatPeso(m.income) : "—"}
                </TD>
                <TD numeric className="text-danger">
                  {m.expense ? formatPeso(m.expense) : "—"}
                </TD>
                <TD numeric className={m.income - m.expense < 0 ? "text-danger" : ""}>
                  {m.income || m.expense ? formatSignedPeso(m.income - m.expense) : "—"}
                </TD>
                <TD>
                  <span
                    className="mb-1 block h-2.5 rounded-[var(--radius-pill)] bg-success"
                    style={{ width: `${Math.max(m.income ? 2 : 0, (m.income / peak) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <span
                    className="block h-2.5 rounded-[var(--radius-pill)] bg-danger"
                    style={{ width: `${Math.max(m.expense ? 2 : 0, (m.expense / peak) * 100)}%` }}
                    aria-hidden="true"
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </TableCardBody>
  );
}

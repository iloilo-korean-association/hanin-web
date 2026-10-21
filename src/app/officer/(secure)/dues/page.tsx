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
  StatGrid,
  StatLine,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatPeso,
  type BadgeTone,
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatPeriod, isFyClosed, loadSettings, todayManila } from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { duesIssueSchema, firstIssue } from "@/lib/validators";

import { DuesIssueForm } from "./DuesIssueForm";
import { duesContextFrom, loadDuesPlan } from "./plan-data";

/**
 * /officer/dues — 회비고지 일괄 생성 (연 1회).
 *
 * 고지는 지금까지 웹 가입 때만 만들어졌다. 그래서 기존 회원은 회비를 내도
 * "올해 회비 고지가 아직 없습니다" 로 회원증이 나오지 않았다.
 * 이 화면에서 그 해 고지가 없는 활동 회원에게 한 번에 고지를 만든다.
 *
 * ★ 화면은 **미리보기만** 한다. 버튼을 누르면 서버가 트랜잭션 안에서 같은 계산을
 *   다시 하고, 미리보기와 같을 때만 만든다(plan-data.ts · actions.ts).
 * ★ 개인정보 화면이다. 회원 실명이 보인다 — 임원(조회권) 전용.
 */
export const metadata: Metadata = {
  title: "회비고지",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = {
  미납: "warn",
  부분납: "warn",
  완납: "success",
  면제: "neutral",
};

/** 미납금액 표시 — 음수는 과납이다. 0 으로 깎지 않고 그대로 보여 준다. */
function unpaidLabel(n: number): string {
  return n < 0 ? `과납 ${formatPeso(-n)}` : formatPeso(n);
}

export default async function DuesPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "회비고지 생성" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회비고지"
            titleEn="Dues Invoices"
            breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const settings = await loadSettings(prisma);
  const ctx = duesContextFrom(settings, todayManila());
  const fy = ctx.fiscalYear;

  const [{ plan }, fyClosed] = await Promise.all([
    loadDuesPlan(prisma, ctx),
    isFyClosed(prisma, fy),
  ]);

  const dates = duesIssueSchema.safeParse({
    fiscalYear: plan.fiscalYear,
    billedOn: plan.billedOn,
    dueOn: plan.dueOn,
  });
  // 설정 납기일이 이미 지났으면 오늘 + 30일로 정한다(resolveDueOn). 그 사실을 화면에 밝힌다.
  const dueFallback = !(ctx.configuredDue > plan.billedOn);

  const canWrite = me.can("입력권") && !me.isAuditor;
  const disabledReason = !canWrite
    ? me.isAuditor
      ? "감사 계정은 읽기 전용입니다. 고지 생성은 총무가 합니다."
      : '"입력권" 이 없는 직책입니다. 관리자에게 요청하십시오.'
    : fyClosed
      ? `${fy} 회계연도는 마감되었거나 등록되지 않아 고지를 만들 수 없습니다(I5).`
      : !dates.success
        ? "설정 '회비.납기일' 형식을 먼저 고쳐 주십시오."
        : plan.toCreate.length === 0
          ? `${fy}년 회비고지를 새로 만들 회원이 없습니다.`
          : null;

  const stats: StatItem[] = [
    {
      label: "새로 고지할 회원",
      value: `${plan.totals.count}명`,
      tone: plan.totals.count > 0 ? "expense" : "neutral",
      sub: `고지 합계 ${formatPeso(plan.totals.billed)}`,
    },
    { label: "이미 고지 있음", value: `${plan.alreadyInvoiced}명`, sub: "건드리지 않습니다" },
    {
      label: "단가 없어 건너뜀",
      value: `${plan.skippedNoRate.length}명`,
      tone: plan.skippedNoRate.length > 0 ? "expense" : "neutral",
    },
    {
      label: "고지 전 받은 회비",
      value: formatPeso(plan.totals.paid),
      tone: plan.totals.paid > 0 ? "income" : "neutral",
      sub: "납부금액에 반영됩니다",
    },
  ];

  const rateEntries = Object.entries(ctx.duesTable);

  return (
    <PageContainer wide>
      <PageHeader
        title="회비고지"
        titleEn="Dues Invoices"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={`${fy} 회계연도 회비고지가 없는 활동 회원에게 고지를 한 번에 만듭니다. 이미 있는 고지는 건드리지 않고, 메일은 보내지 않습니다.`}
      />

      <Stack gap="md">
        {fyClosed ? (
          <Alert tone="error" title={`${fy} 회계연도에는 고지를 만들 수 없습니다 (I5)`}>
            <p>
              회계연도가 마감되었거나 아직 등록되지 않았습니다. 설정의 &lsquo;회계연도&rsquo; 값과
              회계연도 마감 상태를 확인해 주십시오.
            </p>
          </Alert>
        ) : null}

        {!dates.success ? (
          <Alert tone="error" title="고지일·납기일을 정하지 못했습니다">
            <p>
              {firstIssue(dates.error)} — 설정 &lsquo;회비.납기일&rsquo; 값(
              <code>{ctx.configuredDue}</code>)을 2026-02-28 형식으로 고쳐 주십시오.
            </p>
          </Alert>
        ) : null}

        {plan.skippedNoRate.length > 0 ? (
          <Alert tone="warn" title={`회비 단가가 없어 고지를 만들지 않는 회원 ${plan.skippedNoRate.length}명`}>
            <p>
              조용히 0원 면제로 만들지 않습니다. 설정에 &lsquo;회비단가.&lt;등급&gt;&rsquo; 을 넣거나
              회원의 회비등급을 고친 뒤 다시 와 주십시오.
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              {plan.skippedNoRate.map((s) => (
                <li key={s.memberNo}>
                  <b>{s.name}</b> ({s.memberNo}) · 등급 &ldquo;{s.duesGrade}&rdquo; — {s.reason}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <StatGrid label={`${fy} 회비고지 생성 미리보기`} items={stats} />

        <Card as="section">
          <CardHeader
            title={`${fy}년 고지 생성`}
            headingLevel={2}
            description="버튼을 누르면 서버가 같은 계산을 다시 하고, 이 미리보기와 같을 때만 만듭니다. 두 번 눌러도 같은 회원에게 고지가 두 번 생기지 않습니다."
          />
          <CardBody>
            <div className="mb-4">
              <StatLine label="회계연도 (설정 '회계연도')" value={fy} />
              <StatLine label="고지일" value={plan.billedOn} />
              <StatLine
                label={
                  dueFallback
                    ? `납기일 (설정 ${ctx.configuredDue} 이 지나 오늘 + 30일)`
                    : "납기일 (설정 '회비.납기일')"
                }
                value={plan.dueOn}
              />
              <StatLine
                label="회비 단가 (설정 '회비단가.*')"
                value={
                  rateEntries.length
                    ? rateEntries.map(([g, v]) => `${g} ${formatPeso(v)}`).join(" · ")
                    : "설정 없음"
                }
              />
              {plan.skippedSystem > 0 ? (
                <StatLine label="시스템 계정(M9xxx) 제외" value={`${plan.skippedSystem}개`} />
              ) : null}
            </div>
            <DuesIssueForm
              fiscalYear={fy}
              fingerprint={plan.fingerprint}
              count={plan.totals.count}
              disabled={disabledReason !== null}
              disabledReason={disabledReason}
            />
          </CardBody>
        </Card>

        {plan.toCreate.length === 0 ? (
          <Card as="section">
            <CardBody>
              <EmptyState
                icon="✅"
                title={`${fy}년 회비고지가 없는 활동 회원이 없습니다`}
                description={`활동 회원 ${plan.alreadyInvoiced}명은 이미 고지가 있습니다.${
                  plan.skippedNoRate.length ? " 단가가 없어 건너뛴 회원은 위 경고를 확인해 주십시오." : ""
                }`}
              />
            </CardBody>
          </Card>
        ) : (
          <>
            <Card as="section">
              <CardHeader title="등급별" headingLevel={2} />
              <TableCardBody label="등급별 고지 인원과 합계">
                <Table caption="등급별 고지 인원과 합계" captionHidden>
                  <THead>
                    <TR>
                      <TH>등급</TH>
                      <TH numeric>단가</TH>
                      <TH numeric>인원</TH>
                      <TH numeric>고지 합계</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {plan.byGrade.map((g) => (
                      <TR key={g.duesGrade}>
                        <TD>{g.duesGrade}</TD>
                        <TD numeric>{formatPeso(g.unitAmount)}</TD>
                        <TD numeric>{g.count}명</TD>
                        <TD numeric>{formatPeso(g.billedTotal)}</TD>
                      </TR>
                    ))}
                    <TR tone="muted">
                      <TD className="font-bold">합계</TD>
                      <TD numeric>—</TD>
                      <TD numeric className="font-bold">
                        {plan.totals.count}명
                      </TD>
                      <TD numeric className="font-bold">
                        {formatPeso(plan.totals.billed)}
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              </TableCardBody>
            </Card>

            <Card as="section">
              <CardHeader
                title={`고지 대상 ${plan.toCreate.length}명`}
                headingLevel={2}
                description="‘이미 낸 회비’ 는 장부에 회원이 연결된 회비 수납(같은 회계연도·확정분)입니다. 회원 연결 없이 이름만 적힌 수납은 여기 잡히지 않습니다."
              />
              <TableCardBody label="고지 대상 회원 목록">
                <Table caption="새로 만들 회비고지 미리보기" captionHidden>
                  <THead>
                    <TR>
                      <TH>회원번호</TH>
                      <TH>이름</TH>
                      <TH>등급</TH>
                      <TH numeric>고지금액</TH>
                      <TH numeric>이미 낸 회비</TH>
                      <TH numeric>미납</TH>
                      <TH>상태</TH>
                      <TH>회원 기간</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {plan.toCreate.map((p) => (
                      <TR key={p.memberNo}>
                        <TD className="font-mono text-sm">{p.memberNo}</TD>
                        <TD>{p.memberName}</TD>
                        <TD>{p.duesGrade}</TD>
                        <TD numeric>{formatPeso(p.billedAmount)}</TD>
                        <TD numeric>
                          {p.paidAmount ? formatPeso(p.paidAmount) : "—"}
                          {p.lastReceiptNo ? (
                            <span className="block text-xs text-ink-faint">
                              {p.receiptCount}건 · 최근 {p.lastReceiptNo}
                            </span>
                          ) : null}
                        </TD>
                        <TD numeric>{unpaidLabel(p.unpaidAmount)}</TD>
                        <TD>
                          <Badge tone={STATUS_TONE[p.status] ?? "neutral"} dot>
                            {p.status}
                          </Badge>
                          {p.exemptReason ? (
                            <span className="mt-1 block text-xs text-ink-muted">{p.exemptReason}</span>
                          ) : null}
                        </TD>
                        {/* 완납·면제로 만들어지는 고지만 — 납부일(면제는 고지일)부터 1년, 기존 기간이 있으면 이어붙임 */}
                        <TD className="whitespace-nowrap text-sm tnum">
                          {p.validFrom && p.validUntil
                            ? formatPeriod({ validFrom: p.validFrom, validUntil: p.validUntil })
                            : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableCardBody>
            </Card>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}

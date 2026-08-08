import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  CardBody,
  GuardDenied,
  LinkButton,
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
  formatPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  approvalConfigFrom,
  cfgStr,
  fiscalYearOf,
  fxTableFrom,
  loadSettings,
  todayManila,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { ExpenseForm } from "./ExpenseForm";

export const metadata: Metadata = {
  title: "지출 요청",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/expense — 지출 사전 승인 요청(11_승인) 접수.
 *
 * 돈은 여기서 나가지 않는다. 요청 → 결재 → 집행이 분리돼 있어야
 * "먼저 쓰고 나중에 결재" 라는 무통제 경로가 생기지 않는다(승인한도표 제4장).
 */
export default async function ExpensePage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "지출 요청" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="지출 요청"
            titleEn="Expense Request"
            breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
          />
          <GuardDenied
            message={e.message}
            howToFix={e.howToFix}
            action={
              <LinkButton href={`${ROUTES.officer}/approve`} variant="secondary">
                승인 · 집행 화면으로
              </LinkButton>
            }
          />
        </PageContainer>
      );
    }
    throw e;
  }

  const today = todayManila();
  const fy = fiscalYearOf(today);
  const settings = await loadSettings(prisma);

  const [vendors, conflicts, officers, categories, funds, mine] = await Promise.all([
    prisma.vendor.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ relatedParty: "desc" }, { name: "asc" }],
      // ★ tin(납세자번호)은 어떤 화면에도 내보내지 않는다.
      select: {
        vendorId: true,
        name: true,
        industry: true,
        relatedMemberNo: true,
        relatedParty: true,
        ownershipPct: true,
      },
    }),
    prisma.conflictOfInterest.findMany({
      select: {
        conflictId: true,
        declarerMemberNo: true,
        declarerName: true,
        role: true,
        counterpartyName: true,
        relationType: true,
        vendorId: true,
        detail: true,
        disclosed: true,
        recused: true,
        ownershipPct: true,
      },
    }),
    prisma.officer.findMany({
      select: {
        officerId: true,
        memberNo: true,
        name: true,
        role: true,
        email: true,
        approvalLimit: true,
        permissions: true,
        status: true,
      },
    }),
    prisma.category.findMany({
      where: { majorType: "지출", isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true },
    }),
    prisma.fund.findMany({
      where: { status: "ACTIVE" },
      orderBy: { fundId: "asc" },
      select: { fundId: true, name: true, kind: true },
    }),
    prisma.approval.findMany({
      where: { requestedBy: me.email },
      orderBy: { approvalId: "desc" },
      take: 10,
      select: {
        approvalId: true,
        amountPhp: true,
        counterpartyName: true,
        relatedParty: true,
        requiredStages: true,
        finalStatus: true,
        executedReceiptNo: true,
        reason: true,
      },
    }),
  ]);

  return (
    <PageContainer wide>
      <PageHeader
        title="지출 요청"
        titleEn="Expense Request"
        description={`${fy} 회계연도 · 결재선은 금액과 이해관계 여부로 자동 결정됩니다. 수취인을 적는 순간 판정이 화면에 뜹니다.`}
        breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
        actions={
          <LinkButton href={`${ROUTES.officer}/approve`} variant="secondary">
            승인 · 집행 화면
          </LinkButton>
        }
      />

      <Stack>
        {categories.length === 0 || funds.length === 0 ? (
          <Alert tone="error" title="마스터 데이터가 비어 있습니다">
            <p>
              04_과목(지출) 또는 03_기금이 비어 있습니다. <code>npm run db:seed</code> 를 실행해
              주십시오.
            </p>
          </Alert>
        ) : (
          <ExpenseForm
            today={today}
            me={{ memberNo: me.memberNo, email: me.email, name: me.name, role: me.role }}
            vendors={vendors}
            conflicts={conflicts}
            officers={officers}
            cfg={approvalConfigFrom(settings)}
            categories={categories}
            funds={funds}
            fxTable={fxTableFrom(settings)}
            defaults={{
              fundId: cfgStr(settings, "기본.기금ID", funds[0]?.fundId ?? "FD01"),
              categoryCode: categories[0]?.code ?? "E200",
            }}
          />
        )}

        <Card>
          <CardHeader
            title="내가 올린 최근 요청"
            description="결재 진행 상황은 승인 · 집행 화면에서 확인합니다."
          />
          {mine.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🧾"
                title="아직 올린 요청이 없습니다"
                description="위 폼으로 첫 지출 요청을 접수해 보십시오."
              />
            </CardBody>
          ) : (
            <TableCardBody label="내가 올린 최근 요청">
              <Table caption="내가 올린 최근 지출 요청" captionHidden>
                <THead>
                  <TR>
                    <TH>승인ID</TH>
                    <TH numeric>금액</TH>
                    <TH>수취인</TH>
                    <TH>사유</TH>
                    <TH>단계</TH>
                    <TH>상태</TH>
                  </TR>
                </THead>
                <TBody>
                  {mine.map((a) => (
                    <TR key={a.approvalId} tone={a.relatedParty ? "conflict" : undefined}>
                      <TD className="font-mono text-sm">{a.approvalId}</TD>
                      <TD numeric>{formatPeso(a.amountPhp)}</TD>
                      <TD>
                        {a.counterpartyName || "—"}
                        {a.relatedParty ? (
                          <Badge tone="conflict" className="ml-1.5">
                            이해관계
                          </Badge>
                        ) : null}
                      </TD>
                      <TD className="max-w-[22rem]">{a.reason}</TD>
                      <TD>{a.requiredStages === 0 ? "전결" : `${a.requiredStages}단계`}</TD>
                      <TD>
                        <Badge
                          tone={
                            a.finalStatus === "집행완료"
                              ? "success"
                              : a.finalStatus === "반려"
                                ? "danger"
                                : a.finalStatus === "승인"
                                  ? "info"
                                  : "warn"
                          }
                          dot
                        >
                          {a.finalStatus}
                        </Badge>
                        {a.executedReceiptNo ? (
                          <span className="block font-mono text-sm text-ink-muted">
                            {a.executedReceiptNo}
                          </span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>
      </Stack>
    </PageContainer>
  );
}

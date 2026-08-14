import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
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
  formatDate,
  formatPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

export const metadata: Metadata = {
  title: "승인 이력",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/approve — **읽기 전용 이력.**
 *
 * 예전에는 여기서 결재(1차·2차)와 집행을 했다. 지출 1건에 화면 2개·제출 2~4회·사람 2~3명이
 * 필요했고, 집행 함수 하나가 400줄이었다. 사전 승인 절차를 걷어내면서 그 경로를 없앴다 —
 * 이제 돈은 /officer/book 에서 바로 적고, 통제는 감사 화면의 확인 대기 큐가 맡는다.
 *
 * 그런데 **이 화면을 지우지는 않는다.** 이유가 둘이다.
 *   ① 여기 남은 Approval 행은 실제로 있었던 결재 이력이다. 화면을 지우면 조회할 길이 없어진다.
 *   ② 총회가 결재선을 되살리라고 결정하면 그때 다시 붙일 수 있어야 한다.
 *      (도메인 계산 domain/approval.ts 도 같은 이유로 남겨 두었다)
 *
 * ★ 쓰기 버튼이 하나도 없다. 거래를 만드는 경로는 /officer/book 하나뿐이어야 한다 —
 *   두 경로가 각자 채번하면 결번(I2)과 이중 집행이 다시 살아난다.
 */
export default async function ApprovalHistoryPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "승인 이력" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader title="승인 이력" titleEn="Approval History" />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }
  void me;

  const rows = await prisma.approval.findMany({
    orderBy: { requestedAt: "desc" },
    take: 200,
    include: { category: { select: { name: true } } },
  });

  return (
    <PageContainer>
      <PageHeader
        title="승인 이력"
        titleEn="Approval History"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description="사전 승인 제도를 쓰던 시기의 결재 기록입니다. 열람만 가능합니다."
      />
      <Stack gap="lg">
        <Alert tone="info" title="지금은 승인 절차 없이 장부에 바로 적습니다">
          지출도 수입도 <strong>장부</strong> 화면에서 한 줄로 적고 즉시 확정됩니다. 통제는 적기
          전의 결재가 아니라 <strong>적은 뒤의 감사 확인</strong>이 맡습니다 — 증빙이 없거나 현금
          고액이거나 이해관계 건이면 자동으로 감사 화면의 확인 대기에 올라갑니다.
        </Alert>

        <Card as="section">
          <CardHeader title={`결재 기록 (${rows.length}건)`} headingLevel={2} />
          {rows.length === 0 ? (
            <EmptyState icon="📄" title="결재 기록이 없습니다." />
          ) : (
            <TableCardBody label="결재 기록">
              <Table caption="결재 기록" captionHidden>
                <THead>
                  <TR>
                    <TH>승인ID</TH>
                    <TH>요청일</TH>
                    <TH>사유 · 과목</TH>
                    <TH numeric>금액</TH>
                    <TH>결재</TH>
                    <TH>결과</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((a) => (
                    <TR key={a.approvalId}>
                      <TD>
                        <div className="font-medium">{a.approvalId}</div>
                        {a.executedReceiptNo ? (
                          <div className="text-xs text-ink-faint">→ {a.executedReceiptNo}</div>
                        ) : null}
                      </TD>
                      <TD>{formatDate(a.requestedAt)}</TD>
                      <TD>
                        <div>{a.reason}</div>
                        <div className="text-xs text-ink-faint">
                          {a.category?.name ?? a.categoryCode ?? "—"}
                          {a.relatedParty ? " · 이해관계자" : ""}
                        </div>
                      </TD>
                      <TD numeric>{formatPeso(a.amountPhp)}</TD>
                      <TD>
                        <div className="text-xs">
                          {a.requiredStages === 0 ? "전결" : `${a.requiredStages}단계`}
                        </div>
                        <div className="text-xs text-ink-faint">
                          {a.approver1 ? `1차 ${a.approver1} (${a.result1})` : "1차 —"}
                          {a.approver2 ? ` · 2차 ${a.approver2} (${a.result2})` : ""}
                        </div>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            a.finalStatus === "집행완료"
                              ? "success"
                              : a.finalStatus === "반려"
                                ? "danger"
                                : a.finalStatus === "승인"
                                  ? "info"
                                  : "neutral"
                          }
                        >
                          {a.finalStatus}
                        </Badge>
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

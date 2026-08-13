import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatGrid,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { manilaDateTimeStr } from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { UploadForm } from "./UploadForm";

/**
 * /officer/ledger-import — 장부 가져오기 (L3).
 *
 * 실제 회계장부 엑셀(2021~2026 + 금부원 교민지원)을 웹 장부로 옮기는 통로다.
 * 흐름: 업로드 → 검토(대조표·확인필요 해소) → 반영 → 회원 연결.
 *
 * ★ 열람은 "조회권", 업로드·반영은 "입력권" + 쓰기(감사 제외)다.
 *   화면에서 버튼을 잠그는 것은 안내일 뿐이고, 서버 액션이 다시 검사한다.
 */
export const metadata: Metadata = {
  title: "장부 가져오기",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const BATCH_TONE: Record<string, BadgeTone> = {
  검토중: "warn",
  반영됨: "success",
  폐기: "neutral",
};

export default async function LedgerImportPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "장부 가져오기" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader title="장부 가져오기" breadcrumb={[{ href: ROUTES.officer, label: "임원" }]} />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const batches = await prisma.importBatch.findMany({
    orderBy: { batchId: "desc" },
    take: 30,
    select: {
      batchId: true,
      fileName: true,
      uploadedBy: true,
      uploadedAt: true,
      status: true,
      note: true,
      _count: { select: { rows: true } },
    },
  });

  const grouped = await prisma.importRow.groupBy({
    by: ["batchId", "status"],
    _count: { _all: true },
  });
  const statusOf = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    const cur = statusOf.get(g.batchId) ?? {};
    cur[g.status] = g._count._all;
    statusOf.set(g.batchId, cur);
  }

  const [totalRows, needsReview, applied, aliasCount] = await Promise.all([
    prisma.importRow.count(),
    prisma.importRow.count({ where: { status: "확인필요" } }),
    prisma.importRow.count({ where: { status: "반영됨" } }),
    prisma.payerAlias.count(),
  ]);

  const stats: StatItem[] = [
    { label: "임포트 행", value: `${totalRows.toLocaleString("en-PH")}건` },
    {
      label: "확인필요",
      value: `${needsReview.toLocaleString("en-PH")}건`,
      tone: needsReview > 0 ? "expense" : "neutral",
      sub: "날짜·금액을 사람이 정해야 반영됩니다",
    },
    { label: "장부 반영됨", value: `${applied.toLocaleString("en-PH")}건`, tone: "income" },
    { label: "납부자 판정", value: `${aliasCount.toLocaleString("en-PH")}건`, sub: "회원 연결 · 회원 아님" },
  ];

  const canWrite = me.can("입력권") && !me.isAuditor;
  const blockedReason = me.isAuditor
    ? "감사 계정은 읽기 전용입니다."
    : me.can("입력권")
      ? undefined
      : '"입력권" 이 없는 직책입니다.';

  return (
    <PageContainer wide>
      <PageHeader
        title="장부 가져오기"
        titleEn="Ledger Import"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description="종이·엑셀로 관리해 온 회계장부(2021~2026 + 금부원 교민지원)를 웹 장부로 옮깁니다. 업로드하면 바로 장부에 들어가지 않습니다 — 대조표를 확인하고 반영을 눌러야 거래가 만들어집니다."
        actions={<LinkButton href={`${ROUTES.officer}/ledger-import/link`}>납부자 회원 연결</LinkButton>}
      />

      <Stack gap="md">
        <Alert tone="warn" title="이 화면은 실명이 그대로 보이는 개인정보 화면입니다">
          <p>
            납부자 이름·금액이 원본 그대로 나옵니다. 화면을 내려받거나 다른 곳에 옮겨 담지
            마십시오. 올린 엑셀 원본은 <b>임원만 열 수 있는 비공개 저장소</b>에 보관되며, 반영된
            거래의 증빙(I3)이 됩니다. 업로드·편집·반영은 모두 감사로그에 남습니다.
          </p>
        </Alert>

        <StatGrid label="임포트 현황" items={stats} />

        <Card as="section">
          <CardHeader
            title="① 엑셀 업로드"
            headingLevel={2}
            description="같은 파일을 다시 올려도 안전합니다 — 이미 등록된 행(시트·행번호·블록이 같은 행)은 다시 만들지 않고 그대로 둡니다."
          />
          <CardBody>
            {canWrite ? (
              <UploadForm />
            ) : (
              <Alert tone="info" title="업로드 권한이 없습니다">
                <p>{blockedReason} 목록과 대조표는 그대로 보실 수 있습니다.</p>
              </Alert>
            )}
          </CardBody>
        </Card>

        <Card as="section">
          <CardHeader title={`② 배치 ${batches.length}건`} headingLevel={2} />
          {batches.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="📄"
                title="올라온 장부 파일이 없습니다"
                description="위에서 엑셀 원본을 올리면 시트별 대조표와 행 목록이 만들어집니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="임포트 배치 목록">
              <Table caption="업로드된 장부 엑셀 배치" captionHidden>
                <THead>
                  <TR>
                    <TH>배치</TH>
                    <TH>파일 · 업로더</TH>
                    <TH>상태</TH>
                    <TH numeric>행</TH>
                    <TH>행 상태</TH>
                    <TH>
                      <span className="sr-only">검토</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {batches.map((b) => {
                    const s = statusOf.get(b.batchId) ?? {};
                    return (
                      <TR key={b.batchId} tone={s["확인필요"] ? "warn" : undefined}>
                        <TD>
                          <Link
                            href={`${ROUTES.officer}/ledger-import/${b.batchId}`}
                            className="font-mono font-semibold underline underline-offset-2"
                          >
                            {b.batchId}
                          </Link>
                          <span className="block text-sm text-ink-muted">
                            {manilaDateTimeStr(b.uploadedAt)}
                          </span>
                        </TD>
                        <TD>
                          <span className="block break-all">{b.fileName}</span>
                          <span className="block text-sm text-ink-muted">{b.uploadedBy}</span>
                          {b.note ? (
                            <span className="mt-1 block max-w-[24rem] text-sm text-warn">{b.note}</span>
                          ) : null}
                        </TD>
                        <TD>
                          <Badge tone={BATCH_TONE[b.status] ?? "neutral"} dot>
                            {b.status}
                          </Badge>
                        </TD>
                        <TD numeric>{b._count.rows.toLocaleString("en-PH")}</TD>
                        <TD>
                          <span className="flex flex-wrap gap-1">
                            {(["정상", "확인필요", "반영됨", "제외"] as const).map((k) =>
                              s[k] ? (
                                <Badge
                                  key={k}
                                  tone={
                                    k === "확인필요" ? "warn" : k === "반영됨" ? "success" : "neutral"
                                  }
                                >
                                  {k} {s[k]}
                                </Badge>
                              ) : null,
                            )}
                          </span>
                        </TD>
                        <TD>
                          <LinkButton
                            href={`${ROUTES.officer}/ledger-import/${b.batchId}`}
                            size="sm"
                          >
                            검토
                          </LinkButton>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>
      </Stack>
    </PageContainer>
  );
}

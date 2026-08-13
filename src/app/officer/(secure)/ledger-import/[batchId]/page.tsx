import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

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
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  buildReconSummary,
  cashThresholdFrom,
  collectImportNeeds,
  formatMoney,
  loadSettings,
  manilaDateTimeStr,
  resolveImportBaseData,
  splitRawJson,
  type ReconSummary,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { toViewUrl } from "../../../_lib/evidence-view";
import { ApplyForm } from "./ApplyForm";
import { RowEditForm } from "./RowEditForm";

/**
 * /officer/ledger-import/[batchId] — 배치 검토 화면 (L3-b).
 *
 * 화면이 답해야 하는 질문은 셋이다.
 *   ① 파서가 읽은 합계가 **엑셀이 스스로 적어 둔 합계행**과 같은가 (대조표)
 *   ② 사람이 판단해야 할 행은 무엇이고 왜인가 (확인필요 + 원본 셀 + 경고 사유)
 *   ③ 지금 반영하면 무엇이 들어가고 무엇이 빠지는가 (기초데이터 준비 상태 + 반영 폼)
 *
 * ★ 대조표는 업로드 시점에 찍어 둔 요약(ImportBatch.summaryJson)에서 그린다.
 *   엑셀 합계행 값은 어느 행에도 저장되지 않기 때문이다(합계행은 행으로 만들지 않는다).
 */
export const metadata: Metadata = {
  title: "장부 임포트 검토",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ROW_LIMIT = 150;

const STATUS_TONE: Record<string, BadgeTone> = {
  정상: "info",
  확인필요: "warn",
  제외: "neutral",
  반영됨: "success",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** summaryJson 은 우리가 찍은 값이지만, 형태를 믿지 않고 필요한 모양만 골라 읽는다. */
type StoredSummary = {
  sheetName: string;
  year: number | null;
  rowCount: number;
  needsReview: number;
  duplicatesSkipped: number;
  parsed: {
    incomeKrw: number;
    incomePhp: number;
    donationKrw: number;
    donationPhp: number;
    inkindPhp: number;
    expenseRaw: number;
    expense: number;
    fundSupportPhp: number;
  };
  excel: {
    incomeKrw: number | null;
    incomePhp: number | null;
    expense: number | null;
    blocks: { label: string; rowNo: number; value: number }[];
  };
};

function readSummary(json: string): { sheets: StoredSummary[]; warnings: string[] } {
  try {
    const o = JSON.parse(json || "{}") as {
      sheetSummaries?: StoredSummary[];
      warnings?: string[];
    };
    return { sheets: o.sheetSummaries ?? [], warnings: o.warnings ?? [] };
  } catch {
    return { sheets: [], warnings: [] };
  }
}

export default async function BatchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: SP;
}) {
  const { batchId } = await params;
  const sp = await searchParams;

  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "장부 임포트 검토" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="장부 임포트 검토"
            breadcrumb={[
              { href: ROUTES.officer, label: "임원" },
              { href: `${ROUTES.officer}/ledger-import`, label: "장부 가져오기" },
            ]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const batch = await prisma.importBatch.findUnique({ where: { batchId } });
  if (!batch) notFound();

  const { sheets, warnings } = readSummary(batch.summaryJson);
  const recon: ReconSummary = buildReconSummary(sheets);

  /* ── 행 상태 집계 (필터 링크의 건수) ── */
  const byStatus = await prisma.importRow.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  const statusCount = new Map(byStatus.map((s) => [s.status, s._count._all]));
  const bySheet = await prisma.importRow.groupBy({
    by: ["sheetName"],
    where: { batchId },
    _count: { _all: true },
  });

  /* ── 필터 — 확인필요가 남아 있으면 그 화면부터 연다("확인필요 우선") ── */
  const askedStatus = one(sp.status);
  const askedSheet = one(sp.sheet);
  const hasStatusParam = Object.prototype.hasOwnProperty.call(sp, "status");
  const defaultStatus = (statusCount.get("확인필요") ?? 0) > 0 ? "확인필요" : "";
  const status = hasStatusParam ? askedStatus : defaultStatus;
  const sheet = bySheet.some((s) => s.sheetName === askedSheet) ? askedSheet : "";
  const offset = Math.max(0, Number(one(sp.offset)) || 0);

  const where = {
    batchId,
    ...(status ? { status } : {}),
    ...(sheet ? { sheetName: sheet } : {}),
  };
  const [filteredCount, rows] = await Promise.all([
    prisma.importRow.count({ where }),
    prisma.importRow.findMany({
      where,
      orderBy: [{ sheetName: "asc" }, { rowNo: "asc" }, { externalRef: "asc" }],
      skip: offset,
      take: ROW_LIMIT,
    }),
  ]);

  /* ── 반영 준비 상태 — 정상 행이 필요로 하는 기초데이터가 다 있는가 ── */
  const normalRows = await prisma.importRow.findMany({
    where: { batchId, status: "정상", receiptNo: null },
    select: { blockType: true, currency: true, method: true, date: true, amount: true },
  });
  const [settings, categories, funds, accounts] = await Promise.all([
    loadSettings(prisma),
    prisma.category.findMany({ select: { code: true, name: true, majorType: true, isActive: true } }),
    prisma.fund.findMany({ select: { fundId: true, name: true, kind: true, status: true } }),
    prisma.account.findMany({
      select: { accountId: true, name: true, kind: true, currency: true, status: true },
    }),
  ]);
  const resolved = resolveImportBaseData(collectImportNeeds(normalRows), {
    categories,
    funds,
    accounts,
    settings,
  });
  const cashThreshold = cashThresholdFrom(settings);
  // I4 대상 건수 — 현금이고 페소 환산이 임계액을 넘는 행. 원화는 환율이 없으면 셀 수 없으므로
  // 준비가 끝난 뒤에만 정확하다. 여기서는 페소 현금만 세어 **최소 건수**로 알린다.
  const cashOverThreshold = normalRows.filter(
    (r) => r.method === "CASH" && r.currency === "PHP" && r.amount > cashThreshold,
  ).length;

  const officers = await prisma.officer.findMany({
    where: { status: "ACTIVE", email: { not: me.email } },
    orderBy: { officerId: "asc" },
    select: { email: true, name: true, role: true },
  });

  const evidenceUrl = batch.blobUrl ? await toViewUrl(batch.blobUrl) : "";

  const canWrite = me.can("입력권") && !me.isAuditor;
  const blockedReason = me.isAuditor
    ? "감사 계정은 읽기 전용입니다."
    : me.can("입력권")
      ? undefined
      : '"입력권" 이 없는 직책입니다.';

  const normalCount = statusCount.get("정상") ?? 0;
  const needsReviewCount = statusCount.get("확인필요") ?? 0;

  const filterHref = (next: { status?: string; sheet?: string; offset?: number }) => {
    const q = new URLSearchParams();
    const s = next.status !== undefined ? next.status : status;
    const sh = next.sheet !== undefined ? next.sheet : sheet;
    q.set("status", s);
    if (sh) q.set("sheet", sh);
    if (next.offset) q.set("offset", String(next.offset));
    return `${ROUTES.officer}/ledger-import/${batchId}?${q.toString()}`;
  };

  return (
    <PageContainer wide>
      <PageHeader
        title={`${batchId} 검토`}
        titleEn="Import Review"
        breadcrumb={[
          { href: ROUTES.officer, label: "임원" },
          { href: `${ROUTES.officer}/ledger-import`, label: "장부 가져오기" },
        ]}
        description={`${batch.fileName} · ${batch.uploadedBy} · ${manilaDateTimeStr(batch.uploadedAt)}`}
        actions={
          evidenceUrl ? (
            <LinkButton href={evidenceUrl} external>
              원본 엑셀 내려받기
            </LinkButton>
          ) : undefined
        }
      />

      <Stack gap="md">
        {batch.note ? (
          <Alert tone="info" title="이 배치에 대한 안내">
            <p>{batch.note}</p>
          </Alert>
        ) : null}

        {/* ── ① 대조표 ── */}
        <Card as="section">
          <CardHeader
            title="시트별 대조표 — 파서 합계 vs 엑셀 합계행"
            headingLevel={2}
            description="엑셀이 스스로 적어 둔 합계행과 파서가 계산한 합계를 나란히 놓습니다. 하나라도 다르면 반영하기 전에 원인을 찾아야 합니다."
            action={
              <Badge tone={recon.matched === recon.total ? "success" : "danger"} dot>
                {recon.matched}/{recon.total} 일치
              </Badge>
            }
          />
          {recon.total === 0 ? (
            <CardBody>
              <Alert tone="warn" title="대조표를 만들 수 없습니다">
                <p>
                  이 배치에는 업로드 시점의 파서 요약이 없습니다. 엑셀을 다시 올리면 대조표가
                  만들어집니다.
                </p>
              </Alert>
            </CardBody>
          ) : (
            <>
              {recon.matched !== recon.total ? (
                <CardBody>
                  <Alert
                    tone="error"
                    title={`불일치 ${recon.total - recon.matched}건 — 반영하기 전에 원인을 확인해야 합니다`}
                  >
                    <p>
                      파서가 읽은 금액과 엑셀 합계행이 다릅니다. 이 상태로 반영하면 공개 회계가
                      원본 장부와 어긋납니다.
                    </p>
                  </Alert>
                </CardBody>
              ) : null}
              <TableCardBody label="시트별 합계 대조">
                <Table caption="파서 합계와 엑셀 합계행 대조" captionHidden>
                  <THead>
                    <TR>
                      <TH>시트</TH>
                      <TH>항목</TH>
                      <TH numeric>파서 합계</TH>
                      <TH numeric>엑셀 합계행</TH>
                      <TH>대조</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recon.lines.map((l) => (
                      <TR key={`${l.sheetName}-${l.label}`} tone={l.match ? undefined : "warn"}>
                        <TD>{l.sheetName}</TD>
                        <TD>
                          {l.label}
                          {l.roundedNote ? (
                            <span className="block text-sm text-ink-muted">{l.roundedNote}</span>
                          ) : null}
                        </TD>
                        <TD numeric>{fmtNum(l.parsed)}</TD>
                        <TD numeric>{fmtNum(l.excel)}</TD>
                        <TD>
                          <Badge tone={l.match ? "success" : "danger"} dot>
                            {l.match ? "일치" : "불일치"}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableCardBody>
            </>
          )}
        </Card>

        {/* ── 시트 요약 · 파서 경고 ── */}
        {sheets.length > 0 ? (
          <Card as="section">
            <CardHeader
              title="시트 요약"
              headingLevel={2}
              description="합계행이 없는 블록(족구·체육대회 후원 등)은 엑셀 자체 블록 합계를 함께 적어 둡니다."
            />
            <TableCardBody label="시트별 요약">
              <Table caption="시트별 행 수와 블록 합계" captionHidden>
                <THead>
                  <TR>
                    <TH>시트</TH>
                    <TH numeric>행</TH>
                    <TH numeric>확인필요</TH>
                    <TH numeric>중복 스킵</TH>
                    <TH numeric>후원(₩/₱)</TH>
                    <TH numeric>현물 평가액</TH>
                    <TH>엑셀 블록 합계</TH>
                  </TR>
                </THead>
                <TBody>
                  {sheets.map((s) => (
                    <TR key={s.sheetName}>
                      <TD>{s.sheetName}</TD>
                      <TD numeric>{s.rowCount}</TD>
                      <TD numeric>{s.needsReview}</TD>
                      <TD numeric>{s.duplicatesSkipped}</TD>
                      <TD numeric>
                        {formatMoney(s.parsed.donationKrw)} / {formatMoney(s.parsed.donationPhp)}
                      </TD>
                      <TD numeric>{formatMoney(s.parsed.inkindPhp)}</TD>
                      <TD className="text-sm">
                        {s.excel.blocks.length === 0
                          ? "—"
                          : s.excel.blocks
                              .map((b) => `${b.label} ${formatMoney(b.value)}`)
                              .join(" · ")}
                        {s.parsed.fundSupportPhp > 0 ? (
                          <span className="block text-ink-muted">
                            지원 항목 합 {formatMoney(s.parsed.fundSupportPhp)} (시트 자체 합계
                            밖)
                          </span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
            {warnings.length > 0 ? (
              <CardBody>
                <Alert tone="info" title={`파서 경고 ${warnings.length}건`}>
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              </CardBody>
            ) : null}
          </Card>
        ) : null}

        {/* ── ② 반영 ── */}
        <Card as="section">
          <CardHeader
            title="장부에 반영"
            headingLevel={2}
            description="상태가 '정상' 인 행만 05_거래로 만듭니다. 증빙(I3)은 이 배치의 엑셀 원본이 됩니다."
          />
          <CardBody>
            {resolved.ok ? (
              <Stack gap="sm">
                <Alert tone="success" title="기초데이터 준비 완료">
                  <p>과목·기금·계좌·연도별 환율이 모두 확인되었습니다.</p>
                </Alert>
                {canWrite ? (
                  <ApplyForm
                    batchId={batchId}
                    normalCount={normalRows.length}
                    needsReviewCount={needsReviewCount}
                    cashOverThresholdCount={cashOverThreshold}
                    cashThreshold={cashThreshold}
                    officers={officers.map((o) => ({
                      email: o.email,
                      label: `${o.name} (${o.role}) · ${o.email}`,
                    }))}
                  />
                ) : (
                  <Alert tone="info" title="반영 권한이 없습니다">
                    <p>{blockedReason}</p>
                  </Alert>
                )}
              </Stack>
            ) : (
              <Stack gap="sm">
                <Alert
                  tone="warn"
                  title={`기초데이터 준비 필요 — ${resolved.missing.length}건`}
                >
                  <p>
                    아래 항목이 준비되기 전에는 반영할 수 없습니다. 화면이 임의로 과목·계좌를
                    만들어 내지 않습니다 — 지금 만들면 나중에 정식 코드 체계가 들어왔을 때 같은
                    뜻의 과목이 두 벌 생기고 공개 회계가 갈라집니다.
                  </p>
                </Alert>
                <ul className="flex list-disc flex-col gap-2 pl-5">
                  {resolved.missing.map((m) => (
                    <li key={m.what}>
                      <span className="font-semibold">{m.what}</span>
                      <span className="block text-ink-muted">{m.howToFix}</span>
                    </li>
                  ))}
                </ul>
                {canWrite ? (
                  <ApplyForm
                    batchId={batchId}
                    normalCount={normalRows.length}
                    needsReviewCount={needsReviewCount}
                    cashOverThresholdCount={cashOverThreshold}
                    cashThreshold={cashThreshold}
                    officers={officers.map((o) => ({
                      email: o.email,
                      label: `${o.name} (${o.role}) · ${o.email}`,
                    }))}
                  />
                ) : null}
              </Stack>
            )}
          </CardBody>
        </Card>

        {/* ── ③ 행 목록 ── */}
        <Card as="section">
          <CardHeader
            title={`행 ${filteredCount.toLocaleString("en-PH")}건`}
            headingLevel={2}
            description={
              needsReviewCount > 0 && !hasStatusParam
                ? "손이 필요한 '확인필요' 행부터 보여 드립니다. 아래에서 다른 상태·시트로 바꿔 보실 수 있습니다."
                : "시트·상태로 걸러 볼 수 있습니다."
            }
          />
          <CardBody>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">상태</span>
                <FilterLink href={filterHref({ status: "", offset: 0 })} active={status === ""}>
                  전체 {(statusCount.get("정상") ?? 0) +
                    (statusCount.get("확인필요") ?? 0) +
                    (statusCount.get("제외") ?? 0) +
                    (statusCount.get("반영됨") ?? 0)}
                </FilterLink>
                {(["확인필요", "정상", "제외", "반영됨"] as const).map((s) => (
                  <FilterLink
                    key={s}
                    href={filterHref({ status: s, offset: 0 })}
                    active={status === s}
                  >
                    {s} {statusCount.get(s) ?? 0}
                  </FilterLink>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">시트</span>
                <FilterLink href={filterHref({ sheet: "", offset: 0 })} active={sheet === ""}>
                  전체
                </FilterLink>
                {bySheet
                  .slice()
                  .sort((a, b) => (a.sheetName < b.sheetName ? -1 : 1))
                  .map((s) => (
                    <FilterLink
                      key={s.sheetName}
                      href={filterHref({ sheet: s.sheetName, offset: 0 })}
                      active={sheet === s.sheetName}
                    >
                      {s.sheetName} {s._count._all}
                    </FilterLink>
                  ))}
              </div>
            </div>
          </CardBody>

          {rows.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="✅"
                title="이 조건에 해당하는 행이 없습니다"
                description="상태·시트 필터를 바꿔 보십시오."
              />
            </CardBody>
          ) : (
            <>
              <TableCardBody label="임포트 행 목록">
                <Table caption="엑셀에서 읽은 행" captionHidden>
                  <THead>
                    <TR>
                      <TH>시트 · 행</TH>
                      <TH>블록 · 상태</TH>
                      <TH>납부자 / 내역</TH>
                      <TH numeric>금액</TH>
                      <TH>원본 셀</TH>
                      <TH>경고 사유</TH>
                      <TH>편집</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((r) => {
                      const { cells } = splitRawJson(r.rawJson);
                      const locked = r.status === "반영됨";
                      return (
                        <TR key={r.id} tone={r.status === "확인필요" ? "warn" : undefined}>
                          <TD className="text-sm whitespace-nowrap">
                            <span className="block">{r.sheetName}</span>
                            <span className="block font-mono text-ink-muted">r{r.rowNo}</span>
                          </TD>
                          <TD>
                            <Badge tone="neutral">{r.blockType}</Badge>
                            <span className="mt-1 block">
                              <Badge tone={STATUS_TONE[r.status] ?? "neutral"} dot>
                                {r.status}
                              </Badge>
                            </span>
                            {r.receiptNo ? (
                              <span className="mt-1 block font-mono text-sm text-ink-muted">
                                {r.receiptNo}
                              </span>
                            ) : null}
                          </TD>
                          <TD className="max-w-[14rem]">
                            {r.payerName ? (
                              <span className="block font-semibold break-words">{r.payerName}</span>
                            ) : null}
                            {r.description ? (
                              <span className="block break-words text-ink-soft">
                                {r.description}
                              </span>
                            ) : null}
                            <span className="block text-sm text-ink-muted">
                              {r.date ?? "날짜 없음"} · {r.method}
                            </span>
                          </TD>
                          <TD numeric>
                            {formatMoney(r.amount)}
                            <span className="block text-sm text-ink-muted">{r.currency}</span>
                          </TD>
                          <TD className="max-w-[16rem] text-sm">
                            {Object.entries(cells).length === 0 ? (
                              <span className="text-ink-muted">—</span>
                            ) : (
                              <dl className="flex flex-col gap-0.5">
                                {Object.entries(cells).map(([k, v]) => (
                                  <div key={k} className="flex gap-1">
                                    <dt className="font-mono font-semibold text-ink-muted">{k}</dt>
                                    <dd className="break-words">{v}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </TD>
                          <TD className="max-w-[18rem] text-sm">
                            {r.parseWarning ? (
                              <ul className="flex list-disc flex-col gap-0.5 pl-4 text-warn">
                                {r.parseWarning.split(" | ").map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </TD>
                          <TD>
                            {canWrite ? (
                              <RowEditForm
                                rowId={r.id}
                                date={r.date}
                                amount={r.amount}
                                description={r.description}
                                currency={r.currency}
                                locked={locked}
                                lockedReason={
                                  locked ? "이미 장부에 반영된 행입니다(I1)." : undefined
                                }
                                showDescription={
                                  r.blockType === "지출" || r.blockType === "금부원지출"
                                }
                              />
                            ) : (
                              <span className="text-sm text-ink-muted">{blockedReason}</span>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableCardBody>
              {filteredCount > ROW_LIMIT ? (
                <CardBody>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      {offset + 1}~{Math.min(offset + rows.length, filteredCount)} /{" "}
                      {filteredCount.toLocaleString("en-PH")}건
                    </span>
                    {offset > 0 ? (
                      <Link
                        href={filterHref({ offset: Math.max(0, offset - ROW_LIMIT) })}
                        className="underline underline-offset-2"
                      >
                        ← 이전 {ROW_LIMIT}건
                      </Link>
                    ) : null}
                    {offset + rows.length < filteredCount ? (
                      <Link
                        href={filterHref({ offset: offset + ROW_LIMIT })}
                        className="underline underline-offset-2"
                      >
                        다음 {ROW_LIMIT}건 →
                      </Link>
                    ) : null}
                  </div>
                </CardBody>
              ) : null}
            </>
          )}
        </Card>

        <Alert tone="info" title="다음 단계">
          <p>
            반영이 끝나면 <b>납부자 회원 연결</b> 화면에서 이름을 회원에 이어 주십시오. 연결하면 그
            회원의 회비고지가 연도별로 소급 기록되고, 회원 포털 “납부 내역” 에 자동으로
            표시됩니다.
          </p>
          <p className="mt-2">
            <LinkButton href={`${ROUTES.officer}/ledger-import/link`} size="sm">
              납부자 회원 연결로
            </LinkButton>
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "rounded-[var(--radius-pill)] border border-brand-700 bg-brand-50 px-2.5 py-1 font-semibold text-brand-800"
          : "rounded-[var(--radius-pill)] border border-line-strong px-2.5 py-1 text-ink-soft hover:border-brand-300"
      }
    >
      {children}
    </Link>
  );
}

/** 소수가 섞인 엑셀 합계는 소수 둘째 자리까지 보여 준다 — 반올림해 버리면 대조의 근거가 사라진다. */
function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-PH")
    : n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConflictBadge,
  EmptyState,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatLine,
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
  approvalConfigFrom,
  canOfficerApprove,
  cashThresholdFrom,
  cfgStr,
  checkApprovalTrail,
  conflictBadgeText,
  decideApprovalRoute,
  evaluateConflict,
  isRecused,
  loadSettings,
  todayManila,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { toViewUrl } from "../../_lib/evidence-view";
import { toOfficerRow } from "../../_lib/server-utils";
import { DecisionForm } from "./DecisionForm";
import { ExecuteForm } from "./ExecuteForm";

export const metadata: Metadata = {
  title: "승인 · 집행",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/approve — 결재하고, 결재가 끝난 건을 장부에 넣는다.
 *
 * ★ 이해관계 당사자에게는 버튼을 **숨기지 않고 비활성 + 사유**로 보여준다.
 *   대표는 일로일로에서 7개 사업을 하고 배우자가 로펌을 한다. 좁은 한인망에서
 *   회피가 일어났다는 사실 자체가 기록·표시돼야 나중에 설명이 된다.
 */
export default async function ApprovePage() {
  let me;
  try {
    me = await requireOfficer({
      permissions: ["승인권", "입력권"],
      screen: "승인 · 집행",
    });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="승인 · 집행"
            titleEn="Approve & Execute"
            breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const today = todayManila();
  const settings = await loadSettings(prisma);
  const cfg = approvalConfigFrom(settings);
  const cashThreshold = cashThresholdFrom(settings);
  const meRow = toOfficerRow(me);

  const [openApprovals, doneApprovals, vendors, conflicts, officers, accounts, categories] =
    await Promise.all([
      prisma.approval.findMany({
        where: { finalStatus: { in: ["대기", "승인", "집행중"] } },
        orderBy: { approvalId: "asc" },
      }),
      prisma.approval.findMany({
        where: { finalStatus: "집행완료" },
        orderBy: { approvalId: "desc" },
        take: 6,
        select: {
          approvalId: true,
          amountPhp: true,
          counterpartyName: true,
          relatedParty: true,
          approver1: true,
          approver2: true,
          executedReceiptNo: true,
          requiredStages: true,
        },
      }),
      prisma.vendor.findMany(),
      prisma.conflictOfInterest.findMany(),
      prisma.officer.findMany(),
      prisma.account.findMany({ where: { status: "ACTIVE" }, orderBy: { accountId: "asc" } }),
      prisma.category.findMany({ select: { code: true, name: true } }),
    ]);

  const categoryName = new Map(categories.map((c) => [c.code, c.name]));
  const verifiers = officers
    .filter((o) => o.status === "ACTIVE" && o.email.toLowerCase() !== me.email.toLowerCase())
    .map((o) => ({ email: o.email, label: `${o.name} ${o.role} · ${o.email}` }));

  const accountByMethod: Record<string, string> = {
    CASH: cfgStr(settings, "기본.계좌ID.CASH", ""),
    GCASH: cfgStr(settings, "기본.계좌ID.GCASH", ""),
    MAYA: cfgStr(settings, "기본.계좌ID.MAYA", ""),
    BANK: cfgStr(settings, "기본.계좌ID.BANK", ""),
    CARD_2C2P: cfgStr(settings, "기본.계좌ID.BANK", ""),
    INKIND: "",
  };

  /* ── 계정 차원의 잠금 사유 (건별 사유보다 먼저 걸린다) ── */
  const auditorLock = me.isAuditor
    ? "감사 계정은 읽기 전용입니다. 12_임원에 승인권이 적혀 있어도 서버가 저장을 거부합니다 — 감사는 통보·이의제기권만 가집니다(승인한도표 제3조)."
    : null;
  const decideLock =
    auditorLock ?? (me.can("승인권") ? null : "승인권이 없는 직책입니다. 결재는 할 수 없습니다.");
  const executeLock =
    auditorLock ??
    (me.can("입력권")
      ? null
      : "집행(장부 기입)은 입력권이 필요합니다. 결재만 하시고 집행은 총무에게 넘기십시오.");

  /* ── 건별 판정 ── */
  const rows = await Promise.all(openApprovals.map(async (ap) => {
    const verdict = evaluateConflict(
      { counterpartyName: ap.counterpartyName, vendorId: ap.vendorId },
      vendors,
      conflicts,
      officers,
    );
    const gate = canOfficerApprove(meRow, ap, verdict);
    const route = decideApprovalRoute(ap.amountPhp, ap.relatedParty, cfg);
    // 견적이 빠져 있어도 집행 화면에서 그 문서를 지금 붙일 수 있다(폼에 첨부 칸이 뜬다).
    // 그래서 화면 단계에서는 버튼을 미리 잠그지 않고 "첨부 없이 누르면 서버가 막는다" 로 둔다.
    // 나머지 결재 흔적 검사(1차·2차 승인자, 전결 재계산 등)는 그대로 적용된다.
    const quoteMissing = route.quotesRequired > 0 && !ap.quoteUrl.trim();
    const trail = checkApprovalTrail(
      {
        approvalId: ap.approvalId,
        amountPhp: ap.amountPhp,
        relatedParty: ap.relatedParty,
        requiredStages: ap.requiredStages,
        approver1: ap.approver1,
        result1: ap.result1,
        approver2: ap.approver2,
        result2: ap.result2,
        finalStatus: ap.finalStatus,
        quoteUrl: quoteMissing ? "[집행화면에서 첨부 가능]" : ap.quoteUrl,
      },
      cfg,
    );
    const recusedForExecution = isRecused(meRow, verdict);
    const executeBlocked =
      executeLock ??
      (verdict.undetermined
        ? "이해상충을 판정할 수 없어 집행할 수 없습니다: " + verdict.reasons.join(" / ")
        : recusedForExecution
          ? `귀하는 이 건의 이해관계 당사자입니다(${conflictBadgeText(verdict)}). 결재에서 회피한 사람이 돈을 내주고 장부까지 적으면 회피가 형식만 남습니다.`
          : !trail.ok
            ? trail.reason
            : null);
    // 비공개 Blob 견적서는 그대로 열면 403 — 렌더 시점에 서명 URL 로 바꾼다.
    // (로컬 폴백 상대경로·구 데이터의 일반 URL 은 toViewUrl 이 그대로 돌려준다)
    const quoteViewUrl = await toViewUrl(ap.quoteUrl);
    return { ap, verdict, gate, route, trail, quoteMissing, executeBlocked, quoteViewUrl };
  }));

  const waiting = rows.filter((r) => r.ap.finalStatus === "대기");
  const toExecute = rows.filter((r) => r.ap.finalStatus === "승인" && !r.ap.executedReceiptNo);
  const stuck = rows.filter((r) => r.ap.finalStatus === "집행중");

  return (
    <PageContainer wide>
      <PageHeader
        title="승인 · 집행"
        titleEn="Approve & Execute"
        description="결재(승인권)와 집행(입력권)은 다른 권한입니다. 결재한 사람이 돈까지 내주고 장부에 적으면 2인 원칙이 형식만 남습니다."
        breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
        actions={
          <LinkButton href={`${ROUTES.officer}/expense`} variant="secondary">
            새 지출 요청
          </LinkButton>
        }
      />

      <Stack>
        {auditorLock ? <Alert tone="warn" title="감사 계정으로 보고 있습니다"><p>{auditorLock}</p></Alert> : null}

        {/* ── 집행이 중단된 건 ─────────────────────────────── */}
        {stuck.length > 0 ? (
          <Alert tone="error" title={`집행이 중단된 채로 남아 있는 건 ${stuck.length}개`}>
            <ul className="ml-4 list-disc">
              {stuck.map((r) => (
                <li key={r.ap.approvalId}>
                  {r.ap.approvalId} — 선점 영수증번호 {r.ap.executedReceiptNo ?? "(미발급)"}. 05_거래에
                  그 번호의 행이 실제로 있는지 감사와 함께 확인하십시오. 있으면 최종상태를
                  “집행완료”로, 없으면 “승인”으로 되돌린 뒤 다시 집행합니다. 같은 돈을 두 번 내주지
                  않기 위해 자동으로 풀지 않습니다.
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {/* ── 결재 대기 ───────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-xl">결재 대기 {waiting.length}건</h2>
          {waiting.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon="✅"
                  title="결재를 기다리는 건이 없습니다"
                  description="새 지출 요청이 접수되면 여기에 나타납니다."
                />
              </CardBody>
            </Card>
          ) : (
            <Stack>
              {waiting.map(({ ap, verdict, gate, route, quoteViewUrl }) => (
                <Card key={ap.approvalId} as="article">
                  <CardHeader
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base">{ap.approvalId}</span>
                        <span>{formatPeso(ap.amountPhp)}</span>
                        {ap.relatedParty ? (
                          <ConflictBadge
                            officer={verdict.relatedOfficers[0]?.name || "임원"}
                            relation={
                              verdict.relatedOfficers[0]?.role
                                ? `${verdict.relatedOfficers[0].role} 관련`
                                : "관련"
                            }
                            {...(verdict.ownershipPct !== null
                              ? { stakePct: verdict.ownershipPct }
                              : {})}
                          />
                        ) : null}
                        {gate.recused ? <Badge tone="conflict">회피 대상</Badge> : null}
                      </span>
                    }
                    description={ap.reason}
                  />
                  <CardBody>
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                      <div>
                        <StatLine label="수취인" value={ap.counterpartyName || "(미기재)"} />
                        <StatLine
                          label="과목 · 기금"
                          value={`${categoryName.get(ap.categoryCode ?? "") ?? ap.categoryCode ?? "—"} · ${ap.fundId ?? "—"}`}
                        />
                        <StatLine label="요청자" value={ap.requestedBy} />
                        <StatLine label="요청일시" value={formatDateTime(ap.requestedAt)} />
                        <StatLine label="금액 구간" value={route.band} />
                        <StatLine label="필요 결재선" value={route.route} />
                        <StatLine
                          label="필요 견적"
                          value={
                            route.quotesRequired
                              ? `${route.quotesRequired}곳 ${ap.quoteUrl ? "· 첨부됨" : "· 미첨부"}`
                              : "없음"
                          }
                          tone={route.quotesRequired && !ap.quoteUrl ? "expense" : "neutral"}
                        />
                        <StatLine
                          label="1차"
                          value={`${ap.result1}${ap.approver1 ? ` · ${ap.approver1}` : ""}`}
                        />
                        <StatLine
                          label="2차"
                          value={`${ap.result2}${ap.approver2 ? ` · ${ap.approver2}` : ""}`}
                        />
                        {ap.quoteUrl ? (
                          <p className="mt-2 text-sm">
                            {/* 서명 URL — 몇 분 뒤 만료된다. 안 열리면 페이지 새로고침. */}
                            <a className="link-ika" href={quoteViewUrl} target="_blank" rel="noreferrer">
                              첨부된 견적서 보기
                            </a>
                          </p>
                        ) : null}
                        {ap.note ? (
                          <p className="mt-2 text-sm text-ink-muted">{ap.note}</p>
                        ) : null}
                      </div>

                      <div>
                        {verdict.reasons.length > 0 ? (
                          <Alert
                            tone={verdict.undetermined ? "error" : "warn"}
                            title={
                              verdict.undetermined
                                ? "이해상충 판정 불가"
                                : `이해관계자 거래 — ${conflictBadgeText(verdict)}`
                            }
                            className="mb-3"
                          >
                            <ul className="ml-4 list-disc">
                              {verdict.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </Alert>
                        ) : null}

                        {route.warnings.map((w) => (
                          <Alert key={w} tone="warn" className="mb-3">
                            <p>{w}</p>
                          </Alert>
                        ))}

                        <DecisionForm
                          approvalId={ap.approvalId}
                          stage={gate.stage}
                          blockedReason={decideLock ?? (gate.canApprove ? null : gate.blockedReason)}
                        />
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </Stack>
          )}
        </section>

        {/* ── 집행 대기 ───────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-xl">집행 대기 {toExecute.length}건</h2>
          <p className="mb-3 text-ink-muted">
            결재가 끝난 건을 장부(05_거래)에 넣습니다. 여기가 지출이 들어가는 유일한 경로입니다.
          </p>
          {toExecute.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon="📘"
                  title="집행을 기다리는 건이 없습니다"
                  description="결재가 끝난 지출 요청이 여기에 나타납니다."
                />
              </CardBody>
            </Card>
          ) : (
            <Stack>
              {toExecute.map(({ ap, verdict, route, quoteMissing, executeBlocked }) => (
                <Card key={ap.approvalId} as="article">
                  <CardHeader
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base">{ap.approvalId}</span>
                        <span>{formatPeso(ap.amountPhp)}</span>
                        <span className="text-ink-muted">{ap.counterpartyName}</span>
                        {ap.relatedParty ? <Badge tone="conflict">이해관계</Badge> : null}
                      </span>
                    }
                    description={`${ap.reason} · 결재 완료 (${ap.requiredStages === 0 ? "전결" : `${ap.requiredStages}단계`})`}
                  />
                  <CardBody>
                    <ExecuteForm
                      approvalId={ap.approvalId}
                      approvedPhp={ap.amountPhp}
                      counterpartyName={ap.counterpartyName}
                      paymentMethod={route.paymentMethod}
                      today={today}
                      myEmail={me.email}
                      accounts={accounts.map((a) => ({
                        accountId: a.accountId,
                        name: a.name,
                        kind: a.kind,
                      }))}
                      verifiers={verifiers}
                      accountByMethod={accountByMethod}
                      cashThreshold={cashThreshold}
                      quotesRequired={route.quotesRequired}
                      quoteMissing={quoteMissing}
                      relatedParty={ap.relatedParty}
                      blockedReason={executeBlocked}
                    />
                    {verdict.related ? (
                      <p className="mt-3 text-sm text-conflict">
                        이 건은 공개 회계에 <b>이해관계자 거래 배지</b>와 함께 건별 전액 공개됩니다.
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </Stack>
          )}
        </section>

        {/* ── 최근 집행완료 ───────────────────────────────── */}
        <Card>
          <CardHeader
            title="최근 집행완료"
            description="이미 장부에 들어간 건입니다. 금액이 틀렸다면 삭제가 아니라 무효(VOIDED) + 정정 거래로 바로잡습니다(I1)."
          />
          <TableCardBody label="최근 집행완료 목록">
            <Table caption="최근 집행완료 승인" captionHidden>
              <THead>
                <TR>
                  <TH>승인ID</TH>
                  <TH numeric>금액</TH>
                  <TH>수취인</TH>
                  <TH>결재</TH>
                  <TH>영수증번호</TH>
                </TR>
              </THead>
              <TBody>
                {doneApprovals.map((a) => (
                  <TR key={a.approvalId} tone={a.relatedParty ? "conflict" : undefined}>
                    <TD className="font-mono text-sm">{a.approvalId}</TD>
                    <TD numeric>{formatPeso(a.amountPhp)}</TD>
                    <TD>
                      {a.counterpartyName}
                      {a.relatedParty ? (
                        <Badge tone="conflict" className="ml-1.5">
                          이해관계
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-sm">
                      {a.requiredStages === 0
                        ? "전결"
                        : [a.approver1, a.approver2].filter(Boolean).join(" → ") || "—"}
                    </TD>
                    <TD className="font-mono text-sm">{a.executedReceiptNo ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}

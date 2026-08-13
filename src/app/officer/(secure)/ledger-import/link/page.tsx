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
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { BLOCK_DIRECTION, formatMoney } from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { PayerDecisionForm } from "./PayerDecisionForm";

/**
 * /officer/ledger-import/link — 납부자 표기 → 회원 연결 (L4).
 *
 * 엑셀에는 "이름" 만 있다. 누구인지는 총무만 안다. 이 화면에서 표기 하나하나를
 * ① 기존 회원 ② 새 회원 ③ 회원 아님 중 하나로 정한다.
 *
 * ★ 연결하면 그 표기의 **전 거래**(연도 무관) 상대방회원번호가 한꺼번에 갱신되고,
 *   회비수입 블록 합계로 06_회비고지가 연도별 소급 기록된다.
 *   → 회원 포털 "납부 내역"(P2)이 코드 변경 없이 그 회원의 2021~2026 납부를 보여 준다.
 */
export const metadata: Metadata = {
  title: "납부자 회원 연결",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const MEMBER_LIST_ID = "ledger-import-member-options";
const PAYER_LIMIT = 200;

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 수입 블록만 납부자로 본다. 지출·지원 행의 이름은 수취인이지 납부자가 아니다. */
const INCOME_BLOCKS = (Object.keys(BLOCK_DIRECTION) as (keyof typeof BLOCK_DIRECTION)[]).filter(
  (b) => BLOCK_DIRECTION[b] === "IN",
);

export default async function PayerLinkPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;

  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "납부자 회원 연결" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="납부자 회원 연결"
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

  /* ── 임포트 수입 행을 전부 읽어 표기별로 묶는다 ──
     행 수가 수백 규모라 DB 그룹핑 대신 여기서 모은다 — 통화별 합계·연도 목록까지
     한 번에 만들 수 있고, 규칙이 코드에 그대로 보인다. */
  const rows = await prisma.importRow.findMany({
    where: { blockType: { in: INCOME_BLOCKS }, payerName: { not: "" }, status: { not: "제외" } },
    select: {
      payerName: true,
      amount: true,
      currency: true,
      date: true,
      status: true,
      blockType: true,
      receiptNo: true,
    },
  });

  type Agg = {
    alias: string;
    count: number;
    php: number;
    krw: number;
    years: Set<string>;
    duesCount: number;
    appliedCount: number;
  };
  const aggMap = new Map<string, Agg>();
  for (const r of rows) {
    const a = aggMap.get(r.payerName) ?? {
      alias: r.payerName,
      count: 0,
      php: 0,
      krw: 0,
      years: new Set<string>(),
      duesCount: 0,
      appliedCount: 0,
    };
    a.count += 1;
    if (r.currency === "KRW") a.krw += r.amount;
    else a.php += r.amount;
    if (r.date) a.years.add(r.date.slice(0, 4));
    if (r.blockType === "회비수입") a.duesCount += 1;
    if (r.receiptNo) a.appliedCount += 1;
    aggMap.set(r.payerName, a);
  }

  const aliases = await prisma.payerAlias.findMany({
    select: { alias: true, memberNo: true, kind: true, note: true },
  });
  const aliasMap = new Map(aliases.map((a) => [a.alias, a]));

  const all = [...aggMap.values()].sort(
    (a, b) => b.count - a.count || (a.alias < b.alias ? -1 : 1),
  );
  const undecided = all.filter((a) => !aliasMap.has(a.alias));
  const decided = all.filter((a) => aliasMap.has(a.alias));

  const view = one(sp.view) === "all" ? "all" : "undecided";
  const list = (view === "all" ? all : undecided).slice(0, PAYER_LIMIT);

  const members = await prisma.member.findMany({
    where: { status: { not: "WITHDRAWN" } },
    orderBy: { memberNo: "asc" },
    select: { memberNo: true, name: true, memberType: true },
  });
  const memberName = new Map(members.map((m) => [m.memberNo, m.name]));

  const linkedCount = decided.filter((a) => aliasMap.get(a.alias)?.kind === "회원").length;
  const notMemberCount = decided.filter((a) => aliasMap.get(a.alias)?.kind === "회원아님").length;

  const stats: StatItem[] = [
    { label: "납부자 표기", value: `${all.length.toLocaleString("en-PH")}건` },
    {
      label: "미판정",
      value: `${undecided.length.toLocaleString("en-PH")}건`,
      tone: undecided.length > 0 ? "expense" : "neutral",
    },
    { label: "회원 연결", value: `${linkedCount.toLocaleString("en-PH")}건`, tone: "income" },
    { label: "회원 아님", value: `${notMemberCount.toLocaleString("en-PH")}건` },
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
        title="납부자 회원 연결"
        titleEn="Payer → Member"
        breadcrumb={[
          { href: ROUTES.officer, label: "임원" },
          { href: `${ROUTES.officer}/ledger-import`, label: "장부 가져오기" },
        ]}
        description="엑셀에 적힌 납부자 이름을 회원에 이어 줍니다. 한 번 정해 두면 연도가 달라도 같은 표기는 자동으로 같은 회원으로 처리됩니다."
        actions={<LinkButton href={`${ROUTES.officer}/ledger-import`}>배치 목록으로</LinkButton>}
      />

      <Stack gap="md">
        <Alert tone="warn" title="회원 실명이 그대로 보이는 화면입니다">
          <p>
            연결하면 그 표기로 만들어진 <b>모든 연도의 거래</b>에 회원번호가 붙고, 회비수입
            합계로 회비고지가 소급 기록됩니다. 잘못 연결하면 다른 사람의 납부가 그 회원 화면에
            보입니다 — 동명이인을 특히 조심해 주십시오. 모든 판정은 감사로그에 남습니다.
          </p>
        </Alert>

        <StatGrid label="연결 현황" items={stats} />

        <Card as="section">
          <CardHeader
            title="연결 규칙"
            headingLevel={2}
            description="판단이 서지 않으면 그대로 두십시오. 미판정은 나중에 다시 볼 수 있지만, 잘못된 연결은 회원 화면에 그대로 보입니다."
          />
          <CardBody>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-soft">
              <li>
                <b>부부 병기</b>(“○○/○○”)는 쪼개지 않습니다. 대표로 한 분을 고르시거나 회원
                아님으로 두십시오 — 쪼개면 엑셀 합계와 대조가 되지 않습니다.
              </li>
              <li>
                <b>단체</b>(교회·선교사협의회 등)와 오기재는 “회원 아님” 으로 표시해 주십시오.
                기록해 두어야 미판정 목록에서 내려갑니다.
              </li>
              <li>
                <b>회비고지</b>에는 “회비수입” 블록만 들어갑니다. 후원금·기부는 회비가 아니므로
                고지에 넣지 않습니다.
              </li>
              <li>
                아직 장부에 반영되지 않은 표기도 미리 연결해 둘 수 있습니다. 회비고지는 거래가
                반영된 뒤 다시 연결하면 그때 만들어집니다.
              </li>
            </ul>
          </CardBody>
        </Card>

        {/* 회원 목록은 페이지에 한 번만 그린다. 표기마다 복제하면 HTML 이 수만 줄이 된다. */}
        <datalist id={MEMBER_LIST_ID}>
          {members.map((m) => (
            <option key={m.memberNo} value={m.memberNo}>
              {m.name} · {m.memberNo} · {m.memberType}
            </option>
          ))}
        </datalist>

        <Card as="section">
          <CardHeader
            title={`${view === "all" ? "전체" : "미판정"} 표기 ${list.length.toLocaleString("en-PH")}건`}
            headingLevel={2}
            action={
              <span className="flex gap-2 text-sm">
                <Link
                  href={`${ROUTES.officer}/ledger-import/link`}
                  className={
                    view === "undecided" ? "font-semibold underline underline-offset-2" : "underline underline-offset-2"
                  }
                >
                  미판정만
                </Link>
                <Link
                  href={`${ROUTES.officer}/ledger-import/link?view=all`}
                  className={
                    view === "all" ? "font-semibold underline underline-offset-2" : "underline underline-offset-2"
                  }
                >
                  전체
                </Link>
              </span>
            }
          />
          {list.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🔗"
                title={
                  all.length === 0
                    ? "임포트된 수입 행이 없습니다"
                    : "미판정 표기가 남아 있지 않습니다"
                }
                description={
                  all.length === 0
                    ? "먼저 장부 가져오기에서 엑셀을 업로드해 주십시오."
                    : "모든 납부자 표기가 회원 연결 또는 회원 아님으로 정리되었습니다."
                }
              />
            </CardBody>
          ) : (
            <>
              <TableCardBody label="납부자 표기 목록">
                <Table caption="엑셀 납부자 표기와 회원 연결 상태" captionHidden>
                  <THead>
                    <TR>
                      <TH>납부자 표기</TH>
                      <TH numeric>거래</TH>
                      <TH numeric>페소 합</TH>
                      <TH numeric>원화 합</TH>
                      <TH>연도</TH>
                      <TH>현재 판정</TH>
                      <TH>정하기</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {list.map((a, i) => {
                      const decision = aliasMap.get(a.alias) ?? null;
                      return (
                        <TR key={a.alias} tone={decision ? undefined : "warn"}>
                          <TD className="max-w-[14rem]">
                            <span className="font-semibold break-words">{a.alias}</span>
                            <span className="block text-sm text-ink-muted">
                              회비 {a.duesCount}건 · 반영됨 {a.appliedCount}건
                            </span>
                          </TD>
                          <TD numeric>{a.count}</TD>
                          <TD numeric>{formatMoney(a.php)}</TD>
                          <TD numeric>{formatMoney(a.krw)}</TD>
                          <TD className="text-sm">
                            {[...a.years].sort().join(", ") || "—"}
                          </TD>
                          <TD>
                            {decision ? (
                              decision.kind === "회원" ? (
                                <>
                                  <Badge tone="success" dot>
                                    회원
                                  </Badge>
                                  <span className="mt-1 block text-sm">
                                    {decision.memberNo}{" "}
                                    {decision.memberNo
                                      ? (memberName.get(decision.memberNo) ?? "(명부에 없음)")
                                      : ""}
                                  </span>
                                </>
                              ) : (
                                <Badge tone="neutral" dot>
                                  회원 아님
                                </Badge>
                              )
                            ) : (
                              <Badge tone="warn" dot>
                                미판정
                              </Badge>
                            )}
                            {decision?.note ? (
                              <span className="mt-1 block text-sm text-ink-muted">
                                {decision.note}
                              </span>
                            ) : null}
                          </TD>
                          <TD>
                            {canWrite ? (
                              <PayerDecisionForm
                                alias={a.alias}
                                idKey={String(i)}
                                memberListId={MEMBER_LIST_ID}
                                currentMemberNo={decision?.memberNo ?? null}
                                currentKind={decision?.kind ?? null}
                                canCreateMember={me.can("회원관리")}
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
              {(view === "all" ? all.length : undecided.length) > PAYER_LIMIT ? (
                <CardBody>
                  <p className="text-sm text-ink-muted">
                    {(view === "all" ? all.length : undecided.length).toLocaleString("en-PH")}건 중
                    상위 {PAYER_LIMIT}건만 표시합니다(거래 건수 많은 순). 처리하면 나머지가
                    올라옵니다.
                  </p>
                </CardBody>
              ) : null}
            </>
          )}
        </Card>
      </Stack>
    </PageContainer>
  );
}

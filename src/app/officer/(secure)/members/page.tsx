import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  GuardDenied,
  Input,
  LinkButton,
  PageContainer,
  PageHeader,
  Select,
  Stack,
  StatGrid,
  Field,
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
import { cfgNum, loadSettings } from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { MEMBER_STATUSES } from "@/lib/validators";

/**
 * 회원 리스트 — v1 은 **읽기 전용**이다. 편집 경로를 만들지 않았다(의도).
 *
 * ★ 개인정보 화면이다. 실명·연락처·이메일이 그대로 보인다.
 *   임원 전용(조회권)이며, 공개 화면·공개 회계로 이 데이터가 새는 경로를 만들지 마라.
 *   (robots noindex 는 /officer 레이아웃이 서브트리 전체에 못 박아 두었다)
 */

export const metadata: Metadata = {
  title: "회원",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "warn",
  WITHDRAWN: "danger",
  중복확인필요: "warn",
};

export default async function MembersPage({ searchParams }: { searchParams: SP }) {
  try {
    await requireOfficer({ permissions: ["조회권"], screen: "회원 명부" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원"
            titleEn="Members"
            breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 40);
  const statusRaw = one(sp.status).trim();
  const status = (MEMBER_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : "";

  const settings = await loadSettings(prisma);
  const maxRows = cfgNum(settings, "웹앱.명부최대", 400);

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { memberNo: { contains: q.toUpperCase() } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [rows, filteredCount, grouped] = await Promise.all([
    prisma.member.findMany({
      where,
      orderBy: { memberNo: "asc" },
      take: maxRows,
      select: {
        memberNo: true,
        name: true,
        memberType: true,
        status: true,
        duesGrade: true,
        region: true,
        phone: true,
        email: true,
        joinedOn: true,
        rosterConsent: true,
        notifyConsent: true,
      },
    }),
    prisma.member.count({ where }),
    prisma.member.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countOf = new Map(grouped.map((g) => [g.status, g._count._all]));
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);

  const stats: StatItem[] = [
    { label: "전체", value: `${total}명` },
    { label: "ACTIVE", value: `${countOf.get("ACTIVE") ?? 0}명`, tone: "income" },
    { label: "INACTIVE", value: `${countOf.get("INACTIVE") ?? 0}명` },
    { label: "WITHDRAWN", value: `${countOf.get("WITHDRAWN") ?? 0}명`, tone: "expense" },
  ];

  return (
    <PageContainer wide>
      <PageHeader
        title="회원"
        titleEn="Members"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description="회원 명부 열람 화면입니다. 이 화면에서는 고칠 수 없습니다 — 정정이 필요하면 총무에게 요청하십시오."
      />

      <Stack gap="md">
        <Alert tone="warn" title="개인정보 화면입니다">
          실명·연락처·이메일이 보입니다. 공개 화면이나 단체 채팅방으로 옮겨 적지 마십시오.
          특히 <b>명부공개에 동의하지 않은 회원</b>의 정보는 임원 업무 범위 밖에서 쓰면 안 됩니다.
        </Alert>

        <StatGrid label="회원 상태 요약" items={stats} />

        {/* ── 검색·필터 (서버 GET — 클라이언트 상태 없음) ─────────────── */}
        <Card as="section" className="no-print">
          <CardHeader title="찾기" headingLevel={2} />
          <CardBody>
            <form
              method="get"
              action={`${ROUTES.officer}/members`}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <Field htmlFor="q" label="이름 · 회원번호 · 연락처" className="sm:flex-1">
                <Input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="예: 김민준, M0006, 0917"
                  autoComplete="off"
                />
              </Field>
              <Field htmlFor="status" label="상태" className="sm:w-56">
                <Select id="status" name="status" defaultValue={status}>
                  <option value="">전체 상태</option>
                  {MEMBER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex gap-2">
                <Button type="submit">찾기</Button>
                {q || status ? (
                  <LinkButton href={`${ROUTES.officer}/members`} variant="ghost">
                    조건 지우기
                  </LinkButton>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        {/* ── 목록 ────────────────────────────────────────────────────── */}
        <Card as="section">
          <CardHeader
            title={`회원 ${filteredCount}명`}
            headingLevel={2}
            description={
              filteredCount > rows.length
                ? `화면에는 앞 ${rows.length}명까지만 그립니다(설정 웹앱.명부최대). 검색으로 좁혀 주십시오.`
                : undefined
            }
          />
          {rows.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🔎"
                title="조건에 맞는 회원이 없습니다"
                description="검색어를 줄이거나 상태를 '전체'로 바꿔 보십시오."
              />
            </CardBody>
          ) : (
            <TableCardBody label="회원 명부">
              <Table caption="회원 명부" captionHidden>
                <THead>
                  <TR>
                    <TH>회원번호</TH>
                    <TH>성명</TH>
                    <TH>회원구분</TH>
                    <TH>상태</TH>
                    <TH>회비등급</TH>
                    <TH>지역</TH>
                    <TH>연락처</TH>
                    <TH>이메일</TH>
                    <TH>가입일</TH>
                    <TH>동의</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((m) => (
                    <TR key={m.memberNo} tone={m.status === "WITHDRAWN" ? "muted" : undefined}>
                      <TD className="font-mono text-sm">{m.memberNo}</TD>
                      <TD className="font-medium">{m.name}</TD>
                      <TD>{m.memberType}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                      </TD>
                      <TD>{m.duesGrade}</TD>
                      <TD>{m.region || "—"}</TD>
                      <TD className="tnum whitespace-nowrap">{m.phone || "—"}</TD>
                      <TD className="break-all text-sm">{m.email || "—"}</TD>
                      <TD className="tnum whitespace-nowrap">{m.joinedOn}</TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {m.rosterConsent ? (
                            <Badge tone="success">명부공개</Badge>
                          ) : (
                            <Badge tone="neutral">명부비공개</Badge>
                          )}
                          {m.notifyConsent ? (
                            <Badge tone="info">알림수신</Badge>
                          ) : (
                            <Badge tone="warn">알림거부</Badge>
                          )}
                        </span>
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

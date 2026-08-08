import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  Table,
  TableScroll,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { computeIsAuditor, currentOfficer } from "@/lib/guard";
import { parsePermissions } from "@/lib/session";
import { ROUTES } from "@/lib/site";

import { devLoginAction, devLogoutAction } from "./actions";

export const metadata: Metadata = {
  title: "개발용 빠른 로그인",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /dev/login — 시드된 임원·회원을 클릭 한 번으로 오가는 화면.
 *
 * 왜 필요한가: 대표가 회장·총무·감사 세 시선으로 같은 화면을 봐야
 * "권한 통제가 실제로 동작하는지" 를 판단할 수 있다. 매번 비밀번호를 치게 하면
 * 그 판단을 안 하게 된다.
 *
 * 프로덕션에서는 /dev 레이아웃이 404 를 내고, 서버 액션도 스스로 거부한다.
 */
export default async function DevLoginPage() {
  const [me, officers, members] = await Promise.all([
    currentOfficer(),
    prisma.officer.findMany({
      orderBy: { officerId: "asc" },
      select: {
        officerId: true,
        name: true,
        role: true,
        email: true,
        permissions: true,
        approvalLimit: true,
        status: true,
        credential: { select: { officerId: true } },
      },
    }),
    prisma.member.findMany({
      where: { linkToken: { not: "" } },
      orderBy: { memberNo: "asc" },
      take: 12,
      select: {
        memberNo: true,
        name: true,
        memberType: true,
        status: true,
        duesGrade: true,
        linkToken: true,
      },
    }),
  ]);

  return (
    <PageContainer wide>
      <PageHeader
        title="개발용 빠른 로그인"
        titleEn="Dev Login"
        description="시드된 임원으로 즉시 전환하거나, 회원 매직링크로 바로 들어갑니다. 비밀번호를 묻지 않습니다."
      />

      <Stack>
        {/* 현재 세션 */}
        <Card>
          <CardHeader title="현재 로그인 상태" />
          <CardBody>
            {me ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold">
                    {me.name} <span className="text-ink-muted">· {me.role}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                    <span>{me.email}</span>
                    <span aria-hidden="true">·</span>
                    <span>{me.officerId}</span>
                    <span aria-hidden="true">·</span>
                    <span>승인한도 ₱{me.approvalLimit.toLocaleString("en-PH")}</span>
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {me.permissions.map((p) => (
                      <Badge key={p} tone="info">
                        {p}
                      </Badge>
                    ))}
                    {me.isAuditor ? <Badge tone="warn">읽기 전용 (감사)</Badge> : null}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <LinkButton href={ROUTES.officer} variant="primary">
                    임원 화면으로
                  </LinkButton>
                  <form action={devLogoutAction}>
                    <Button type="submit" variant="secondary">
                      로그아웃
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <p className="text-ink-muted">
                로그인하지 않은 상태입니다. 아래에서 임원을 선택하십시오.
              </p>
            )}
          </CardBody>
        </Card>

        {/* 임원 목록 */}
        <Card>
          <CardHeader
            title="임원으로 로그인"
            description="12_임원 시드 데이터입니다. 감사 계정으로 들어가 쓰기 화면이 실제로 막히는지 확인해 보십시오."
          />
          {officers.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🌱"
                title="시드된 임원이 없습니다"
                description="터미널에서 npm run db:reset 을 실행해 시드 데이터를 넣어 주십시오."
              />
            </CardBody>
          ) : (
            <CardBody flush>
              <div className="px-4 py-4 sm:px-5">
                <TableScroll label="임원 목록">
                  <Table caption="시드된 임원 계정" captionHidden>
                    <THead>
                      <TR>
                        <TH>임원ID</TH>
                        <TH>성명 · 직책</TH>
                        <TH>권한</TH>
                        <TH numeric>승인한도</TH>
                        <TH>상태</TH>
                        <TH>
                          <span className="sr-only">작업</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {officers.map((o) => {
                        const perms = parsePermissions(o.permissions);
                        const auditor = computeIsAuditor(o.role, perms);
                        const isMe = me?.officerId === o.officerId;
                        return (
                          <TR key={o.officerId} tone={isMe ? "warn" : undefined}>
                            <TD className="font-mono text-sm">{o.officerId}</TD>
                            <TD>
                              <span className="font-semibold">{o.name}</span>
                              <span className="ml-1.5 text-ink-muted">{o.role}</span>
                              <span className="block text-sm text-ink-faint">{o.email}</span>
                            </TD>
                            <TD>
                              <span className="flex flex-wrap gap-1">
                                {perms.map((p) => (
                                  <Badge key={p}>{p}</Badge>
                                ))}
                                {auditor ? <Badge tone="warn">읽기 전용</Badge> : null}
                              </span>
                            </TD>
                            <TD numeric>₱{o.approvalLimit.toLocaleString("en-PH")}</TD>
                            <TD>
                              {o.status === "ACTIVE" ? (
                                <Badge tone="success" dot>
                                  ACTIVE
                                </Badge>
                              ) : (
                                <Badge tone="danger" dot>
                                  {o.status}
                                </Badge>
                              )}
                              {!o.credential ? (
                                <span
                                  className="ml-1"
                                  title="OfficerCredential 이 없어 비밀번호 로그인은 불가합니다. 이 화면에서는 들어갈 수 있습니다."
                                >
                                  <Badge tone="neutral">비밀번호 없음</Badge>
                                </span>
                              ) : null}
                            </TD>
                            <TD>
                              <form action={devLoginAction}>
                                <input type="hidden" name="officerId" value={o.officerId} />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant={isMe ? "secondary" : "primary"}
                                >
                                  {isMe ? "현재 계정" : "이 계정으로"}
                                </Button>
                              </form>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableScroll>
              </div>
            </CardBody>
          )}
        </Card>

        {/* 회원 매직링크 */}
        <Card>
          <CardHeader
            title="회원으로 들어가기 (매직링크)"
            description="회원은 비밀번호가 없습니다. 링크토큰이 곧 신원입니다. 실제로는 이 링크가 메일로 나갑니다 — 발송함에서 확인하십시오."
            action={<LinkButton href={ROUTES.devOutbox} size="sm">메일 발송함 →</LinkButton>}
          />
          {members.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🌱"
                title="시드된 회원이 없습니다"
                description="npm run db:reset 을 실행해 주십시오."
              />
            </CardBody>
          ) : (
            <CardBody>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((m) => (
                  <li key={m.memberNo}>
                    <a
                      href={ROUTES.me(m.linkToken)}
                      className="flex min-h-touch flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 hover:border-brand-300 hover:bg-brand-50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{m.name}</span>
                        <span className="font-mono text-sm text-ink-faint">{m.memberNo}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                        <span>{m.memberType}</span>
                        <span aria-hidden="true">·</span>
                        <span>{m.duesGrade}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{m.linkToken}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-muted">
                최대 12명만 보여 줍니다. 전체 명부는 임원 화면에서 확인하십시오.
              </p>
            </CardBody>
          )}
        </Card>

        <Alert tone="warn" title="이 화면이 프로덕션에 나가지 않는 이유">
          <p>
            <code>/dev</code> 레이아웃이 <code>NODE_ENV=production</code> 일 때{" "}
            <code>notFound()</code> 를 호출하고, 로그인 서버 액션도 자기 안에서 같은 검사를 다시
            합니다. 화면에서 버튼을 숨기는 것은 통제가 아니므로 두 겹으로 막았습니다.
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}

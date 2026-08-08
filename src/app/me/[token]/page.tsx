import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatPeso,
  GuardDenied,
  LinkButton,
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
  StatusBadge,
  type BadgeTone,
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgNum, cfgStr, loadSettings, manilaDateTimeStr, todayManila } from "@/lib/domain";
import { isGuardError, requireMember } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { ProfileForm } from "./ProfileForm";

/**
 * ★ 비공개 화면이다. 검색엔진에 절대 들어가면 안 된다.
 *   robots 메타 + next.config.ts 의 X-Robots-Tag + Referrer-Policy: no-referrer 3중으로 막는다.
 *   (Referrer 가 나가면 외부 링크를 누르는 순간 토큰이 통째로 새어 나간다.)
 */
export const metadata: Metadata = {
  title: "내 정보",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DUES_TONE: Record<string, BadgeTone> = {
  완납: "success",
  부분납: "warn",
  미납: "danger",
  면제: "neutral",
};

export default async function MyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // 토큰 문자셋은 대문자뿐이다. 소문자로 옮겨 적으신 분도 들어올 수 있게 올려 준다.
  let me;
  try {
    me = await requireMember(decodeURIComponent(token).trim().toUpperCase());
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원 조회 링크를 확인해 주십시오"
            breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
          />
          <Stack>
            <GuardDenied
              message={e.message}
              howToFix={e.howToFix}
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <LinkButton href={ROUTES.join} variant="primary">
                    회원 가입하기
                  </LinkButton>
                  <LinkButton href={ROUTES.help}>총무에게 문의하기</LinkButton>
                </div>
              }
            />
            <Alert tone="info" title="링크는 이런 모양입니다">
              <p>
                가입 환영 메일이나 영수증 메일 안에 있는 <code>/me/ABCD2345</code> 형태의 주소입니다.
                8자리이고 대문자와 숫자만 들어갑니다(헷갈리는 0 · O · 1 · I · L 은 쓰지 않습니다).
              </p>
            </Alert>
          </Stack>
        </PageContainer>
      );
    }
    throw e;
  }

  const settings = await loadSettings(prisma);
  const fiscalYear = cfgNum(settings, "회계연도", Number(todayManila().slice(0, 4)));
  const rosterMax = cfgNum(settings, "웹앱.명부최대", 400);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  const [member, roster] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { memberNo: me.memberNo },
      include: {
        duesInvoices: { orderBy: { fiscalYear: "desc" } },
        counterpartyTxs: {
          orderBy: [{ date: "desc" }, { seq: "desc" }],
          take: 30,
          include: { category: { select: { publicName: true } } },
        },
        eventSignups: {
          orderBy: { appliedAt: "desc" },
          include: { event: { select: { title: true, startsAt: true, place: true } } },
        },
      },
    }),
    // 명부는 **공개 동의자만**. 그것도 이 화면(링크 인증 통과)에서만 보인다.
    prisma.member.findMany({
      where: { rosterConsent: true, status: "ACTIVE" },
      select: { memberNo: true, name: true, region: true, memberType: true },
      orderBy: [{ name: "asc" }],
      take: rosterMax,
    }),
  ]);

  const thisYear = member.duesInvoices.find((d) => d.fiscalYear === fiscalYear) ?? null;
  const paidTotal = member.counterpartyTxs
    .filter((t) => t.direction === "IN" && t.status === "POSTED")
    .reduce((s, t) => s + t.amountPhp, 0);

  const stats: StatItem[] = [
    {
      label: `${fiscalYear}년 회비`,
      labelEn: "Dues",
      value: thisYear ? formatPeso(thisYear.billedAmount) : "—",
      sub: thisYear ? `납기 ${thisYear.dueOn}` : "고지 없음",
      tone: "neutral",
    },
    {
      label: "납부액",
      labelEn: "Paid",
      value: thisYear ? formatPeso(thisYear.paidAmount) : "—",
      sub: thisYear?.lastPaidOn ? `최종 납부 ${thisYear.lastPaidOn}` : "기록 없음",
      tone: "income",
    },
    {
      label: "미납액",
      labelEn: "Unpaid",
      value: thisYear ? formatPeso(thisYear.unpaidAmount) : "—",
      sub: thisYear ? thisYear.status : "—",
      tone: thisYear && thisYear.unpaidAmount > 0 ? "expense" : "balance",
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={`${member.name}님`}
        description={
          <>
            회원번호 <b>{member.memberNo}</b> · {member.memberType} · 회비등급 {member.duesGrade} · 가입일{" "}
            {member.joinedOn}
          </>
        }
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        actions={
          member.status === "ACTIVE" ? (
            <Badge tone="success" dot>
              활동 회원
            </Badge>
          ) : (
            <Badge tone="warn">{member.status}</Badge>
          )
        }
      />

      <Stack gap="md">
        <Alert tone="info" title="이 링크는 비밀번호를 대신합니다">
          <p>
            주소 끝의 8자리(<b>{member.linkToken}</b>)를 아는 사람은 이 화면을 볼 수 있습니다. 단톡방이나
            SNS 에 이 주소를 올리지 마십시오. 잘못 알려지셨다면 총무(
            <a className="link-ika" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
            )에게 말씀하시면 새 링크로 바꿔 드립니다.
          </p>
        </Alert>

        <StatGrid label={`${fiscalYear} 회계연도 내 회비 현황`} items={stats} />

        {/* ── 회비 고지 ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="회비 고지 내역" description="연도별 고지와 납부 현황입니다." />
          {member.duesInvoices.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🧾"
                title="아직 고지된 회비가 없습니다"
                description="가입하신 해의 회비 고지가 만들어지면 이 자리에 표시됩니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="회비 고지 내역">
              <Table caption="연도별 회비 고지와 납부" captionHidden>
                <THead>
                  <TR>
                    <TH>회계연도</TH>
                    <TH>등급</TH>
                    <TH numeric>고지</TH>
                    <TH numeric>납부</TH>
                    <TH numeric>미납</TH>
                    <TH>납기</TH>
                    <TH>상태</TH>
                  </TR>
                </THead>
                <TBody>
                  {member.duesInvoices.map((d) => (
                    <TR key={d.invoiceId} tone={d.status === "미납" ? "warn" : undefined}>
                      <TD>{d.fiscalYear}</TD>
                      <TD>{d.duesGrade}</TD>
                      <TD numeric>{formatPeso(d.billedAmount)}</TD>
                      <TD numeric>{formatPeso(d.paidAmount)}</TD>
                      <TD numeric>{formatPeso(d.unpaidAmount)}</TD>
                      <TD>{d.dueOn}</TD>
                      <TD>
                        <Badge tone={DUES_TONE[d.status] ?? "neutral"} dot>
                          {d.status}
                        </Badge>
                        {d.exemptReason ? (
                          <span className="mt-1 block text-sm text-ink-muted">{d.exemptReason}</span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>

        {/* ── 영수증 ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="내 영수증 · 납부 이력"
            description={`최근 30건까지 보여 드립니다. 확인된 납부액 합계 ${formatPeso(paidTotal)}.`}
          />
          {member.counterpartyTxs.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="💳"
                title="아직 납부 기록이 없습니다"
                description="총무에게 회비를 납부하시면 영수증번호가 발급되고 이 자리에 표시됩니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="내 영수증 목록">
              <Table caption="내 납부 이력" captionHidden>
                <THead>
                  <TR>
                    <TH>영수증번호</TH>
                    <TH>일자</TH>
                    <TH>항목</TH>
                    <TH numeric>금액</TH>
                    <TH>수단</TH>
                    <TH>상태</TH>
                  </TR>
                </THead>
                <TBody>
                  {member.counterpartyTxs.map((t) => (
                    <TR key={t.receiptNo} tone={t.status === "VOIDED" ? "muted" : undefined}>
                      <TD className="tnum">{t.receiptNo}</TD>
                      <TD>{t.date}</TD>
                      <TD>
                        {t.category.publicName}
                        {t.memo ? <span className="block text-sm text-ink-muted">{t.memo}</span> : null}
                      </TD>
                      <TD numeric>{formatPeso(t.amountPhp)}</TD>
                      <TD>{t.method}</TD>
                      <TD>
                        <StatusBadge status={t.status} />
                        {t.status === "VOIDED" && t.voidReason ? (
                          <span className="mt-1 block text-sm text-ink-muted">{t.voidReason}</span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>

        {/* ── 행사 신청 ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="내 행사 신청 내역" />
          {member.eventSignups.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="📅"
                title="신청하신 행사가 없습니다"
                description="지금 신청 받는 행사가 있는지 확인해 보십시오."
                action={<LinkButton href={ROUTES.events}>행사 보기</LinkButton>}
              />
            </CardBody>
          ) : (
            <TableCardBody label="내 행사 신청 내역">
              <Table caption="내가 신청한 행사" captionHidden>
                <THead>
                  <TR>
                    <TH>행사</TH>
                    <TH>일시</TH>
                    <TH numeric>인원</TH>
                    <TH numeric>참가비</TH>
                    <TH>납부</TH>
                    <TH>참석</TH>
                  </TR>
                </THead>
                <TBody>
                  {member.eventSignups.map((s) => (
                    <TR key={s.signupId} tone={s.status === "취소" ? "muted" : undefined}>
                      <TD>
                        {s.event.title}
                        <span className="block text-sm text-ink-muted">
                          {s.signupId} · {s.status}
                        </span>
                      </TD>
                      <TD>{manilaDateTimeStr(s.event.startsAt)}</TD>
                      <TD numeric>{s.totalPeople}</TD>
                      <TD numeric>{s.feeTotal > 0 ? formatPeso(s.feeTotal) : "무료"}</TD>
                      <TD>
                        {s.feeTotal === 0 ? (
                          <span className="text-ink-muted">—</span>
                        ) : s.paid ? (
                          <Badge tone="success" dot>
                            납부
                          </Badge>
                        ) : (
                          <Badge tone="warn" dot>
                            미납
                          </Badge>
                        )}
                      </TD>
                      <TD>{s.attendance}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>

        {/* ── 정보 수정 ─────────────────────────────────────────────── */}
        <ProfileForm
          token={member.linkToken}
          phone={member.phone}
          email={member.email}
          region={member.region}
          rosterConsent={member.rosterConsent}
          notifyConsent={member.notifyConsent}
        />

        {/* ── 회원 명부 (동의자만) ──────────────────────────────────── */}
        <Card as="aside">
          <CardHeader
            title="회원 명부"
            description={`명부 공개에 동의하신 회원 ${roster.length}명만 표시됩니다. 연락처는 어느 화면에도 나오지 않습니다.`}
          />
          <CardBody>
            {roster.length === 0 ? (
              <EmptyState
                icon="👥"
                title="명부에 표시할 회원이 없습니다"
                description="명부 공개에 동의하신 회원이 아직 없습니다."
              />
            ) : (
              <details>
                <summary className="inline-flex min-h-touch cursor-pointer items-center font-semibold text-brand-700">
                  명부 펼쳐 보기 ({roster.length}명)
                </summary>
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {roster.map((r) => (
                    <li
                      key={r.memberNo}
                      className="rounded-[var(--radius-field)] border border-line-soft bg-surface-sub px-3 py-2"
                    >
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {r.memberType}
                        {r.region ? ` · ${r.region}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink-muted">
                  본인 이름을 빼거나 넣으시려면 위 &quot;내 정보 수정&quot; 에서 명부 공개 동의를 켜고
                  끄시면 됩니다.
                </p>
              </details>
            )}
          </CardBody>
        </Card>

        <Card as="aside">
          <CardHeader title="궁금하신 점" headingLevel={2} />
          <CardBody>
            <div className="flex flex-col gap-3">
              <StatLine label="회비를 냈는데 표시가 안 됩니다" value="총무가 기록하면 반영됩니다" />
              <p className="text-ink-soft">
                총무가 영수증 사진과 함께 기록해야 장부에 올라갑니다. 증빙이 없으면 임시(DRAFT) 상태로
                남고 공개 집계에도 잡히지 않습니다. 3일이 지나도 안 보이면 총무(
                <a className="link-ika" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
                )에게 알려 주십시오.
              </p>
              <p className="text-ink-soft">
                한인회가 돈을 어디에 썼는지는{" "}
                <Link href={ROUTES.ledger} className="link-ika">
                  공개 회계
                </Link>{" "}
                에서 건별로 전액 보실 수 있습니다. 누가 얼마를 냈는지는 공개하지 않습니다.
              </p>
            </div>
          </CardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}

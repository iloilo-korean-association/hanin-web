import Link from "next/link";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatPeso,
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
import {
  buildMemberPayments,
  cfgNum,
  cfgStr,
  loadSettings,
  manilaDateTimeStr,
  PAYMENT_KINDS_IN,
  todayManila,
  type MemberTxRow,
  type PaymentKind,
} from "@/lib/domain";
import { ROUTES } from "@/lib/site";

import { memberLogoutAction } from "../../(public)/login/actions";
import { ProfileForm } from "../[token]/ProfileForm";

/**
 * 회원 포털 본문 — 매직링크(/me/[token])와 세션 로그인(/me)이 **같은 화면**을 그린다.
 *
 * P1 에서 /me/[token]/page.tsx 의 본문을 그대로 옮겨 왔다. 두 경로가 각자 그리면
 * 반드시 어긋나므로 여기 한 곳에만 둔다. 페이지 파일은 인증(토큰/세션)만 책임진다.
 *
 * mode
 *   "token"   — 링크토큰으로 들어옴. 링크 주의 안내를 보여주고 폼도 토큰으로 인증한다.
 *   "session" — 비밀번호 로그인으로 들어옴. 로그아웃·비밀번호 변경 버튼을 보여주고
 *               폼은 세션으로 인증한다(token="").
 *
 * ★ 호출 전에 페이지가 인증을 끝냈어야 한다. 이 컴포넌트는 memberNo 를 믿는다 —
 *   requireMember / requireMemberSession 이 돌려준 값만 넘겨라.
 */
const DUES_TONE: Record<string, BadgeTone> = {
  완납: "success",
  부분납: "warn",
  미납: "danger",
  면제: "neutral",
};

/** 통합 납부 내역의 구분 배지 색. 글자가 항상 함께 나가므로 색만으로 의미를 싣지 않는다. */
const KIND_TONE: Record<PaymentKind, BadgeTone> = {
  회비: "info",
  행사비: "neutral",
  기부: "success",
  기타: "neutral",
  지급: "warn",
};

export async function MemberPortal({
  memberNo,
  mode,
  year: yearParam,
}: {
  memberNo: string;
  mode: "token" | "session";
  /** ?year= 쿼리 원문. 검증 전이므로 신뢰하지 않는다 — 실제 연도 목록 안에서만 고른다. */
  year?: string | undefined;
}) {
  const settings = await loadSettings(prisma);
  const fiscalYear = cfgNum(settings, "회계연도", Number(todayManila().slice(0, 4)));
  const rosterMax = cfgNum(settings, "웹앱.명부최대", 400);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  const [member, roster, txYears] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { memberNo },
      include: {
        duesInvoices: { orderBy: { fiscalYear: "desc" } },
        eventSignups: {
          orderBy: { appliedAt: "desc" },
          include: { event: { select: { title: true, startsAt: true, place: true } } },
        },
      },
    }),
    // 명부는 **공개 동의자만**. 그것도 이 화면(인증 통과)에서만 보인다.
    prisma.member.findMany({
      where: { rosterConsent: true, status: "ACTIVE" },
      select: { memberNo: true, name: true, region: true, memberType: true },
      orderBy: [{ name: "asc" }],
      take: rosterMax,
    }),
    // 연도 필터에 보여 줄 회계연도 — 이 회원의 거래가 실제로 있는 해만
    prisma.transaction.groupBy({
      by: ["fiscalYear"],
      where: { counterpartyMemberNo: memberNo },
    }),
  ]);

  /* ── 연도 필터 — 거래·고지가 있는 해 + 현재 회계연도. 기본은 올해(설정 회계연도) ── */
  const years = [
    ...new Set([
      fiscalYear,
      ...txYears.map((y) => y.fiscalYear),
      ...member.duesInvoices.map((d) => d.fiscalYear),
    ]),
  ].sort((a, b) => b - a);
  const askedYear = Number(yearParam);
  const year = years.includes(askedYear) ? askedYear : fiscalYear;

  /* ── 통합 납부 내역 — 선택 연도의 05_거래 전 건. 30건 제한 없음.
        합계 규칙은 공개 회계와 동일(buildMemberPayments 주석 참조). ── */
  const txs = await prisma.transaction.findMany({
    where: { counterpartyMemberNo: memberNo, fiscalYear: year },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    include: {
      category: { select: { publicName: true, midType: true } },
      // 각 원장과의 연결 — 회비고지(최종수납), 기부, 행사신청이 이 영수증을 가리키면 표시한다
      duesInvoices: { select: { invoiceId: true } },
      donations: { select: { donationId: true } },
      eventSignups: { select: { signupId: true, event: { select: { title: true } } } },
    },
  });

  const { rows, summary } = buildMemberPayments(
    txs.map(
      (t): MemberTxRow => ({
        receiptNo: t.receiptNo,
        date: t.date,
        direction: t.direction,
        amountPhp: t.amountPhp,
        counterpartyType: t.counterpartyType,
        method: t.method,
        memo: t.memo,
        status: t.status,
        voidReason: t.voidReason,
        fiscalYear: t.fiscalYear,
        seq: t.seq,
        categoryMidType: t.category.midType,
        categoryName: t.category.publicName,
      }),
    ),
  );
  /** 영수증번호 → 연결된 원장 표기 (회비고지 ID · 기부 ID · 행사명) */
  const linksByReceipt = new Map(
    txs.map((t) => [
      t.receiptNo,
      [
        ...t.duesInvoices.map((d) => `회비고지 ${d.invoiceId}`),
        ...t.donations.map((d) => `기부 ${d.donationId}`),
        ...t.eventSignups.map((s) => `행사 「${s.event.title}」 (${s.signupId})`),
      ],
    ]),
  );

  const selectedInvoice = member.duesInvoices.find((d) => d.fiscalYear === year) ?? null;
  const subtotalText = PAYMENT_KINDS_IN.filter((k) => summary.byKind[k] > 0)
    .map((k) => `${k} ${formatPeso(summary.byKind[k])}`)
    .join(" · ");

  const stats: StatItem[] = [
    {
      label: `${year}년 납부 합계`,
      labelEn: "Paid total",
      value: formatPeso(summary.paidTotal),
      sub: subtotalText || "확정된 납부가 없습니다",
      tone: "income",
    },
    {
      label: `${year}년 회비 미납 잔액`,
      labelEn: "Dues unpaid",
      value: selectedInvoice ? formatPeso(selectedInvoice.unpaidAmount) : "—",
      sub: selectedInvoice
        ? `${selectedInvoice.status} · 고지 ${formatPeso(selectedInvoice.billedAmount)} · 납기 ${selectedInvoice.dueOn}`
        : "고지 없음",
      tone: selectedInvoice && selectedInvoice.unpaidAmount > 0 ? "expense" : "balance",
    },
    {
      label: "최근 납부일",
      labelEn: "Last paid",
      value: summary.lastPaidOn ?? "—",
      sub: `${year}년 확정 납부 ${summary.paidCount}건`,
      tone: "neutral",
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
        {mode === "token" ? (
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
        ) : (
          <Alert tone="info" title="회원번호(아이디)와 비밀번호로 로그인하셨습니다">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                공용 PC 에서는 다 보신 뒤 꼭 로그아웃해 주십시오. 비밀번호는 언제든지 바꾸실 수
                있습니다.
              </p>
              <span className="flex shrink-0 flex-wrap gap-2 no-print">
                <LinkButton href={ROUTES.mePassword} size="sm" variant="secondary">
                  비밀번호 변경
                </LinkButton>
                <form action={memberLogoutAction}>
                  <Button type="submit" size="sm" variant="ghost">
                    로그아웃
                  </Button>
                </form>
              </span>
            </div>
          </Alert>
        )}

        <StatGrid label={`${year} 회계연도 내 납부 요약`} items={stats} />

        {/* ── 통합 납부 내역 — 회비·행사비·기부를 한 표로 (05_거래 원본) ── */}
        <Card>
          <CardHeader
            title="내 납부 내역 (회비 · 행사비 · 기부)"
            description={
              <>
                공개 회계와 같은 원본(거래 원장)에서 그대로 가져온 {year}년 전체 내역입니다.
                합계에는 <b>확정(장부반영)된 납부만</b> 넣습니다 — 미확정·무효 건은 표에 보이지만
                합계에서 빠집니다.
              </>
            }
            action={<Badge tone="neutral">{rows.length}건 전체 표시</Badge>}
          />
          <CardBody className="border-b border-line-soft">
            <nav aria-label="회계연도 선택" className="flex flex-wrap items-center gap-2 no-print">
              <span className="text-sm font-semibold text-ink-muted">회계연도</span>
              {years.map((y) =>
                y === year ? (
                  <span
                    key={y}
                    aria-current="true"
                    className="inline-flex min-h-10 items-center rounded-[var(--radius-pill)] border border-brand-300 bg-brand-50 px-3 text-sm font-semibold text-brand-800"
                  >
                    {y}년
                  </span>
                ) : (
                  <Link
                    key={y}
                    href={`?year=${y}`}
                    className="inline-flex min-h-10 items-center rounded-[var(--radius-pill)] border border-line bg-surface px-3 text-sm font-medium text-ink-soft hover:border-brand-300 hover:bg-brand-50"
                  >
                    {y}년
                  </Link>
                ),
              )}
            </nav>
          </CardBody>
          {rows.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="💳"
                title={`${year}년에는 납부 기록이 없습니다`}
                description="총무에게 회비·행사비·기부금을 납부하시면 영수증번호가 발급되고 이 자리에 표시됩니다."
              />
            </CardBody>
          ) : (
            <>
              <TableCardBody label="내 납부 내역">
                <Table caption={`${year}년 내 납부 내역 전체`} captionHidden>
                  <THead>
                    <TR>
                      <TH>구분</TH>
                      <TH>일자</TH>
                      <TH>영수증번호</TH>
                      <TH>항목 · 연결</TH>
                      <TH numeric>금액</TH>
                      <TH>수단</TH>
                      <TH>상태</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((t) => {
                      const links = linksByReceipt.get(t.receiptNo) ?? [];
                      return (
                        <TR key={t.receiptNo} tone={t.status === "VOIDED" ? "muted" : undefined}>
                          <TD>
                            <Badge tone={KIND_TONE[t.kind]}>{t.kind}</Badge>
                          </TD>
                          <TD>
                            <time dateTime={t.date} className="tnum whitespace-nowrap">
                              {t.date}
                            </time>
                          </TD>
                          <TD className="tnum whitespace-nowrap text-sm text-ink-muted">
                            {t.receiptNo}
                          </TD>
                          <TD>
                            {t.categoryName}
                            {links.length > 0 ? (
                              <span className="block text-sm text-ink-muted">
                                {links.join(" · ")}
                              </span>
                            ) : null}
                            {t.memo ? (
                              <span className="block text-sm text-ink-muted">{t.memo}</span>
                            ) : null}
                          </TD>
                          <TD
                            numeric
                            className={t.status === "VOIDED" ? "line-through" : undefined}
                          >
                            {t.kind === "지급" ? `−${formatPeso(t.amountPhp)}` : formatPeso(t.amountPhp)}
                          </TD>
                          <TD>{t.method}</TD>
                          <TD>
                            <StatusBadge status={t.status} />
                            {t.status === "VOIDED" && t.voidReason ? (
                              <span className="mt-1 block text-sm text-ink-muted">
                                {t.voidReason}
                              </span>
                            ) : null}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableCardBody>
              <CardBody className="border-t border-line-soft">
                <p className="text-sm text-ink-muted">
                  {year}년 확정 납부 합계 <b className="tnum">{formatPeso(summary.paidTotal)}</b>
                  {subtotalText ? <> ({subtotalText})</> : null}
                  {summary.draftCount > 0 ? (
                    <>
                      {" · "}미확정 <b>{summary.draftCount}건</b>은 증빙·확인이 끝나면 합계에
                      들어갑니다
                    </>
                  ) : null}
                  {summary.outCount > 0 ? (
                    <>
                      {" · "}지급(한인회 → 회원) <b>{summary.outCount}건</b>은 납부 합계에 넣지
                      않습니다
                    </>
                  ) : null}
                  . 공개 회계의 수입 집계와 같은 규칙으로 셉니다.
                </p>
              </CardBody>
            </>
          )}
        </Card>

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

        {/* ── 정보 수정 — token="" 이면 액션이 세션으로 본인을 특정한다 ── */}
        <ProfileForm
          token={mode === "token" ? member.linkToken : ""}
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

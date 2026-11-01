import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  type BadgeTone,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  cardPeriodsFrom,
  cfgNum,
  duesTableFrom,
  editLocks,
  fiscalYearOf,
  formatPeriod,
  formatPeriodDate,
  loadSettings,
  memberTypeForGrade,
  periodState,
  todayManila,
  type PeriodState,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { DUES_GRADES, MEMBER_STATUSES, zMemberNo } from "@/lib/validators";

import { REGIONS } from "../../../../(public)/_shared";
import { ResetPasswordButton } from "../ResetPasswordButton";
import { MemberEditForm, type GradeOption } from "./MemberEditForm";

/**
 * /officer/members/[회원번호] — 임원 회원 정보 수정 (대표 요청 2026-10-22).
 *
 * ★ 개인정보 화면이다. 실명·연락처·이메일이 그대로 보인다.
 *   열람 = "조회권"(이 페이지), 저장 = "회원관리" + 쓰기(감사 제외) — 서버 액션이 다시 검사한다.
 *   robots noindex 는 /officer 레이아웃 metadata 와 next.config.ts 의 X-Robots-Tag 헤더가 이미 건다.
 * ★ 링크토큰(/me/<토큰>)은 그 회원의 본인 화면 열쇠라 이 화면에도 보여 주지 않는다.
 * ★ 사진 자체는 열지 않는다 — 상태만. 얼굴 사진은 검수 화면(/officer/members/photos)에서만.
 */

export const metadata: Metadata = {
  title: "회원 정보 수정",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "warn",
  WITHDRAWN: "danger",
  중복확인필요: "warn",
};
const PHOTO_TONE: Record<string, BadgeTone> = { 대기: "warn", 승인: "success", 반려: "danger" };
const DUES_TONE: Record<string, BadgeTone> = { 미납: "danger", 부분납: "warn", 완납: "success", 면제: "info" };

function peso(n: number): string {
  return "₱" + n.toLocaleString("en-US");
}

function PeriodText({ state }: { state: PeriodState }) {
  if (state.kind === "active") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="success" dot>
          기간 중
        </Badge>
        <span className="tnum">{formatPeriod(state.period)}</span>
      </span>
    );
  }
  if (state.kind === "upcoming") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="warn">시작 전</Badge>
        <span className="tnum">{formatPeriodDate(state.startsOn)} 부터</span>
      </span>
    );
  }
  if (state.kind === "expired") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="danger">만료</Badge>
        <span className="tnum">{formatPeriodDate(state.endedOn)} 까지였음</span>
      </span>
    );
  }
  return <Badge tone="neutral">기간 없음</Badge>;
}

/** 요약 한 칸. 375px 에서는 2열, 넓으면 3~4열. */
function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0 sm:col-span-3 lg:col-span-2" : "min-w-0"}>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{children}</dd>
    </div>
  );
}

export default async function MemberEditPage({ params }: { params: Promise<{ memberNo: string }> }) {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "회원 정보 수정" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원 정보 수정"
            breadcrumb={[
              { href: ROUTES.officer, label: "임원" },
              { href: `${ROUTES.officer}/members`, label: "회원" },
            ]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const { memberNo: raw } = await params;
  let decoded = "";
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    notFound(); // '%E0%A4%A' 같은 깨진 주소 — 500 대신 404
  }
  const parsedNo = zMemberNo.safeParse(decoded.toUpperCase());
  if (!parsedNo.success) notFound();
  const memberNo = parsedNo.data;

  const settings = await loadSettings(prisma);
  const today = todayManila();
  const fiscalYear = cfgNum(settings, "회계연도", fiscalYearOf(today));
  const duesTable = duesTableFrom(settings);

  const m = await prisma.member.findUnique({
    where: { memberNo },
    select: {
      memberNo: true,
      name: true,
      nameEn: true,
      phone: true,
      email: true,
      birthYear: true,
      region: true,
      memberType: true,
      duesGrade: true,
      note: true,
      rosterConsent: true,
      notifyConsent: true,
      status: true,
      joinedOn: true,
      createdBy: true,
      credential: { select: { mustChange: true, lockedUntil: true } },
      // 상태만. ★ photoUrl 은 가져오지 않는다(명부와 같은 원칙)
      card: { select: { photoStatus: true } },
      duesInvoices: {
        select: {
          invoiceId: true,
          fiscalYear: true,
          duesGrade: true,
          billedAmount: true,
          paidAmount: true,
          unpaidAmount: true,
          status: true,
          exemptReason: true,
          validFrom: true,
          validUntil: true,
        },
      },
      officer: { select: { role: true, status: true } },
    },
  });
  if (!m) notFound();

  const invoice = m.duesInvoices.find((i) => i.fiscalYear === fiscalYear) ?? null;
  const period = periodState(
    cardPeriodsFrom(m.duesInvoices.filter((i) => i.validFrom)),
    today,
  );

  const locks = editLocks(memberNo, me.memberNo);
  const canEdit = me.can("회원관리") && !me.isAuditor;
  const blockedReason = me.isAuditor
    ? "감사 계정은 읽기 전용입니다."
    : me.can("회원관리")
      ? undefined
      : '"회원관리" 권한이 없습니다.';

  // 회비등급을 바꾸면 올해 고지가 어떻게 되는지 — 서버 액션(decideGradeInvoice)과 같은 갈래
  const gradeHint = !invoice
    ? `${fiscalYear}년 회비고지가 없습니다 — 등급을 바꿔도 고지는 만들지 않습니다(고지는 회비고지 화면에서 만듭니다).`
    : invoice.paidAmount > 0 || invoice.status === "완납" || invoice.status === "부분납"
      ? `${fiscalYear}년 고지(${invoice.invoiceId})에 납부가 있어, 등급을 바꿔도 고지는 그대로 둡니다 — 차액은 총무가 판단합니다.`
      : invoice.status === "면제"
        ? `${fiscalYear}년 고지(${invoice.invoiceId})가 면제라, 등급을 바꿔도 고지는 그대로 둡니다.`
        : `${fiscalYear}년 고지(${invoice.invoiceId})가 미납(납부 0)이라, 등급을 바꾸면 고지금액을 새 단가로 고칩니다. ₱0 등급이면 면제가 되고 회원 기간이 오늘부터 1년 생깁니다.`;

  const grades: GradeOption[] = DUES_GRADES.map((g) => ({
    grade: g,
    rate: duesTable[g] ?? null,
    memberType: memberTypeForGrade(g) ?? g,
  }));

  const now = new Date();
  const pwLocked = Boolean(m.credential?.lockedUntil && m.credential.lockedUntil > now);

  return (
    <PageContainer>
      <PageHeader
        title={`${m.name} · ${m.memberNo}`}
        titleEn="Edit member"
        breadcrumb={[
          { href: ROUTES.officer, label: "임원" },
          { href: `${ROUTES.officer}/members`, label: "회원" },
        ]}
        description="회원 정보를 고칩니다. 바뀐 칸만 저장되고 칸마다 감사로그가 남습니다."
        actions={<LinkButton href={`${ROUTES.officer}/members`}>회원 명부로</LinkButton>}
      />

      <Stack gap="md">
        <Alert tone="warn" title="개인정보 화면입니다">
          실명·연락처·이메일이 보입니다. 공개 화면이나 단체 채팅방으로 옮겨 적지 마십시오.
          특히 <b>명부공개에 동의하지 않은 회원</b>의 정보는 임원 업무 범위 밖에서 쓰면 안 됩니다.
        </Alert>

        {/* ── 요약 (읽기 전용) ─────────────────────────────────────── */}
        <Card as="section">
          <CardHeader title="요약" headingLevel={2} description="회원번호·가입일은 고칠 수 없습니다." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
              <Item label="회원번호">
                <span className="font-mono">{m.memberNo}</span>
              </Item>
              <Item label="영문 이름">
                {m.nameEn ? (
                  <span className="break-words">{m.nameEn}</span>
                ) : (
                  // 영문 이름은 선택이다(2026-11-01). 비어 있으면 회원증에 한글 이름만 나가고, 회원이 '내 정보' 에서 넣을 수 있다.
                  // 배지는 줄바꿈이 안 되므로 짧게 — 긴 설명은 아래 줄에(375px 에서 가로 스크롤이 생겼다).
                  <>
                    <Badge tone="neutral">미등록</Badge>
                    <span className="mt-1 block text-sm font-normal text-ink-muted">
                      회원이 내 정보에서 직접 넣을 수 있습니다
                    </span>
                  </>
                )}
              </Item>
              <Item label="가입일">
                <span className="tnum">{m.joinedOn}</span>
              </Item>
              <Item label="상태">
                <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
              </Item>
              <Item label="회원구분 · 회비등급">
                {m.memberType} · {m.duesGrade}
              </Item>
              <Item label="회원증 사진">
                {!m.card ? (
                  <Badge tone="neutral">미제출</Badge>
                ) : (
                  <Badge tone={PHOTO_TONE[m.card.photoStatus] ?? "neutral"} dot>
                    {m.card.photoStatus}
                  </Badge>
                )}
              </Item>
              <Item label="비밀번호">
                <span className="flex flex-wrap gap-1">
                  {!m.credential ? (
                    <Badge tone="neutral">미설정</Badge>
                  ) : m.credential.mustChange ? (
                    <Badge tone="warn">임시</Badge>
                  ) : (
                    <Badge tone="success">설정됨</Badge>
                  )}
                  {pwLocked ? <Badge tone="danger">잠김</Badge> : null}
                </span>
              </Item>
              {m.officer ? (
                <Item label="임원">
                  {m.officer.role}
                  {m.officer.status !== "ACTIVE" ? ` (${m.officer.status})` : ""}
                </Item>
              ) : null}
              <Item label={`${fiscalYear}년 회비고지`} wide>
                {invoice ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={DUES_TONE[invoice.status] ?? "neutral"}>{invoice.status}</Badge>
                    <span className="tnum">
                      {invoice.duesGrade} · 고지 {peso(invoice.billedAmount)} · 납부 {peso(invoice.paidAmount)}
                    </span>
                    <span className="font-mono text-sm text-ink-muted">{invoice.invoiceId}</span>
                    {invoice.exemptReason ? (
                      <span className="text-sm text-ink-muted">면제사유: {invoice.exemptReason}</span>
                    ) : null}
                    {invoice.validFrom && invoice.validUntil ? (
                      <span className="text-sm tnum text-ink-muted">
                        이 고지의 회원 기간 {formatPeriod({ validFrom: invoice.validFrom, validUntil: invoice.validUntil })}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-ink-muted">고지 없음</span>
                )}
              </Item>
              <Item label="회원 기간 (오늘 기준)" wide>
                <PeriodText state={period} />
              </Item>
            </dl>
          </CardBody>
        </Card>

        {/* ── 수정 폼 ─────────────────────────────────────────────── */}
        {locks.all ? (
          <Alert tone="info" title="수정할 수 없는 계정입니다">
            {locks.all}
          </Alert>
        ) : (
          <MemberEditForm
            memberNo={m.memberNo}
            initial={{
              name: m.name,
              nameEn: m.nameEn,
              phone: m.phone,
              email: m.email,
              birthYear: m.birthYear === null ? "" : String(m.birthYear),
              region: m.region,
              duesGrade: m.duesGrade,
              status: m.status,
              note: m.note,
              rosterConsent: m.rosterConsent,
              notifyConsent: m.notifyConsent,
            }}
            initialMemberType={m.memberType}
            grades={grades}
            regions={REGIONS}
            statuses={MEMBER_STATUSES}
            gradeHint={gradeHint}
            canEdit={canEdit}
            blockedReason={blockedReason}
            gradeStatusLock={locks.gradeAndStatus}
          />
        )}

        {/* ── 비밀번호 — 기존 재설정 버튼 그대로 ─────────────────────── */}
        {!locks.all ? (
          <Card as="section">
            <CardHeader
              title="비밀번호"
              headingLevel={2}
              description="비밀번호는 고쳐 넣지 않고, 임시 비밀번호를 새로 발급합니다. 화면에 한 번만 보입니다."
            />
            <CardBody>
              {m.status !== "WITHDRAWN" ? (
                <ResetPasswordButton
                  memberNo={m.memberNo}
                  memberName={m.name}
                  disabled={!canEdit}
                  disabledReason={blockedReason}
                />
              ) : (
                <p className="text-sm text-ink-muted">탈퇴 회원에게는 비밀번호를 발급하지 않습니다.</p>
              )}
            </CardBody>
          </Card>
        ) : null}
      </Stack>
    </PageContainer>
  );
}

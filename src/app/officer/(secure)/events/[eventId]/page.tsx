import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  Alert,
  Badge,
  GuardDenied,
  PageContainer,
  PageHeader,
  Stack,
  StatGrid,
  formatPeso,
  type BadgeTone,
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { manilaDateTimeStr } from "@/lib/domain";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { PrintButton } from "../../../_components/PrintButton";
import { SignupRoster, type SignupRowUI } from "./SignupRoster";

/**
 * 행사별 참가자 명단 — 현장 체크인용.
 *
 * ★ 개인정보 화면이다. 신청자 실명·연락처가 그대로 보인다.
 *   임원 로그인이면 열람 가능하되, 공개 화면((public)/events)은 집계만 내보낸다 —
 *   이 데이터를 공개 쪽으로 옮기는 코드를 만들지 마라.
 * ★ 상태 변경(접수→확정/취소)은 "행사관리" 권한 + 감사 아님. 서버 액션이 다시 검사한다.
 */

export const metadata: Metadata = {
  title: "행사 참가자 명단",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const EVENT_TONE: Record<string, BadgeTone> = {
  접수중: "success",
  준비: "neutral",
  마감: "warn",
  완료: "neutral",
  취소: "danger",
};

export default async function EventRosterPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const me = await currentOfficer();
  if (!me) {
    return (
      <PageContainer>
        <GuardDenied message="임원 계정으로 로그인해 주십시오." howToFix={null} />
      </PageContainer>
    );
  }

  const { eventId } = await params;
  const ev = await prisma.event.findUnique({
    where: { eventId: decodeURIComponent(eventId) },
    include: { signups: { orderBy: { signupId: "asc" } } },
  });
  if (!ev) notFound();

  const canManage = me.can("행사관리") && !me.isAuditor;

  const rows: SignupRowUI[] = ev.signups.map((s) => ({
    signupId: s.signupId,
    applicantName: s.applicantName,
    phone: s.phone,
    guests: s.guests,
    totalPeople: s.totalPeople,
    feeTotal: s.feeTotal,
    paid: s.paid,
    status: s.status,
    appliedAt: manilaDateTimeStr(s.appliedAt),
    specialNote: s.specialNote,
  }));

  // 정원 검사와 같은 규칙: 취소를 뺀 totalPeople 합이 "차지한 자리" 다.
  const active = ev.signups.filter((s) => s.status !== "취소");
  const peopleTotal = active.reduce((sum, s) => sum + s.totalPeople, 0);
  const feeTotal = active.reduce((sum, s) => sum + s.feeTotal, 0);
  const cancelled = ev.signups.length - active.length;
  const remaining = ev.capacity > 0 ? ev.capacity - peopleTotal : null;

  const stats: StatItem[] = [
    {
      label: "신청 건수",
      value: `${active.length}건`,
      sub: cancelled > 0 ? `취소 ${cancelled}건 별도` : "취소 없음",
    },
    {
      label: "인원 합계",
      value: `${peopleTotal}명`,
      sub: "동반 포함 · 취소 제외",
    },
    {
      label: "정원 대비 잔여",
      value: remaining === null ? "제한 없음" : `${remaining}명`,
      sub: ev.capacity > 0 ? `정원 ${ev.capacity}명` : "정원 미설정",
      tone: remaining !== null && remaining <= 0 ? "expense" : "neutral",
    },
    {
      label: "참가비 합계",
      value: ev.fee > 0 ? formatPeso(feeTotal) : "무료",
      sub: ev.fee > 0 ? `1인 ${formatPeso(ev.fee)} · 취소 제외` : undefined,
    },
  ];

  return (
    <PageContainer wide>
      <PageHeader
        title={`참가자 명단 — ${ev.title}`}
        titleEn="Event Roster"
        breadcrumb={[
          { href: ROUTES.officer, label: "임원" },
          { href: `${ROUTES.officer}/events`, label: "행사 관리" },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{ev.eventId}</span>
            <Badge tone={EVENT_TONE[ev.status] ?? "neutral"}>{ev.status}</Badge>
            <span>
              {manilaDateTimeStr(ev.startsAt).slice(0, 10)}
              {ev.place ? ` · ${ev.place}` : ""}
            </span>
          </span>
        }
        actions={<PrintButton label="명단 인쇄" />}
      />

      <Stack gap="md">
        <Alert tone="warn" title="개인정보 화면입니다" className="no-print">
          신청자 실명과 연락처가 보입니다. 공개 화면·단체 채팅방으로 옮겨 적지 마십시오. 인쇄물은
          행사 종료 후 파쇄하십시오.
        </Alert>

        <StatGrid label={`${ev.title} 신청 요약`} items={stats} />

        <SignupRoster
          rows={rows}
          canManage={canManage}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 상태 변경은 서버가 거부합니다."
              : '"행사관리" 권한이 없어 상태를 바꿀 수 없습니다. 열람은 가능합니다.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

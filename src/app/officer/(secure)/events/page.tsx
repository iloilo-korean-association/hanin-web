import { GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { EventAdmin, type EventRowUI } from "./EventAdmin";

export const dynamic = "force-dynamic";

/** DateTime → 'yyyy-MM-dd' (마닐라 기준). date 입력칸에 그대로 들어가야 한다. */
function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default async function EventsAdminPage() {
  const me = await currentOfficer();
  if (!me) {
    return (
      <PageContainer>
        <GuardDenied
          message="임원 계정으로 로그인해 주십시오."
          howToFix={null}
        />
      </PageContainer>
    );
  }

  const canEdit = me.can("행사관리") && !me.isAuditor;

  const rows = await prisma.event.findMany({
    orderBy: { startsAt: "desc" },
    include: { _count: { select: { signups: true } } },
  });

  const ui: EventRowUI[] = rows.map((e) => ({
    eventId: e.eventId,
    title: e.title,
    kind: e.kind,
    startsAt: ymd(e.startsAt),
    endsAt: ymd(e.endsAt),
    place: e.place,
    capacity: e.capacity,
    fee: e.fee,
    budget: e.budget,
    ownerEmail: e.ownerEmail,
    signupDeadline: e.signupDeadline ?? "",
    status: e.status,
    isPublic: e.isPublic,
    note: e.note,
    signupCount: e._count.signups,
  }));

  const open = ui.filter((e) => e.status === "접수중").length;

  return (
    <PageContainer>
      <PageHeader
        title="행사 관리"
        titleEn="Events"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={
          <>
            회원 신청 화면(<code>/events</code>)에는 상태가 <strong>접수중</strong>인 행사만
            뜹니다. 현재 {open}건이 접수 중입니다.
          </>
        }
      />
      <Stack gap="lg">
        <EventAdmin
          rows={ui}
          readOnly={!canEdit}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 열람만 가능합니다."
              : '"행사관리" 권한이 없습니다. 관리자에게 요청하십시오.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

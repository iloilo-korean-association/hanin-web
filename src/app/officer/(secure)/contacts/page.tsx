import { GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { ContactAdmin, type ContactRowUI } from "./ContactAdmin";

export const dynamic = "force-dynamic";

const GROUP_ORDER: Record<string, number> = {
  national: 0,
  consular: 1,
  police: 2,
  rescue: 3,
  hospital: 4,
  civil: 5,
};

export default async function ContactsAdminPage() {
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

  const canEdit = me.can("연락처관리") && !me.isAuditor;

  const rows = await prisma.emergencyContact.findMany();
  rows.sort(
    (a, b) =>
      (GROUP_ORDER[a.groupId] ?? 9) - (GROUP_ORDER[b.groupId] ?? 9) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "ko"),
  );

  const ui: ContactRowUI[] = rows.map((c) => ({
    contactId: c.contactId,
    groupId: c.groupId,
    groupTitle: c.groupTitle,
    sortOrder: c.sortOrder,
    name: c.name,
    nameEn: c.nameEn,
    numbers: c.numbers,
    note: c.note,
    hours: c.hours,
    email: c.email,
    address: c.address,
    emphasis: c.emphasis,
    grade: c.grade,
    sourceUrl: c.sourceUrl,
    verifiedOn: c.verifiedOn,
    isActive: c.isActive ? "true" : "false",
  }));

  const pending = ui.filter((c) => c.grade === "pending").length;
  const stale = ui.filter(
    (c) => c.grade !== "pending" && c.verifiedOn && c.verifiedOn < "2026-02-09",
  ).length;

  return (
    <PageContainer>
      <PageHeader
        title="긴급 연락처 관리"
        titleEn="Emergency Contacts"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={
          <>
            홈 화면과 긴급 연락처(<code>/sos</code>)에 그대로 나갑니다. 총 {ui.length}건
            {pending > 0 ? ` · 확인 중 ${pending}건(번호 미표시)` : ""}
            {stale > 0 ? ` · 6개월 넘게 재확인 안 된 항목 ${stale}건` : ""}.
          </>
        }
      />
      <Stack gap="lg">
        <ContactAdmin
          rows={ui}
          readOnly={!canEdit}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 열람만 가능합니다."
              : '"연락처관리" 권한이 없습니다. 관리자에게 요청하십시오.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

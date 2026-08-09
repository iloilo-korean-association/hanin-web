import { GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { ServiceAdmin, type ServiceRowUI } from "./ServiceAdmin";

export const dynamic = "force-dynamic";

export default async function ServicesAdminPage() {
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

  // 권한이 없어도 화면은 연다. 목록은 보이고 편집만 잠긴다 —
  // 숨겨 버리면 "내 권한이 어디까지인지" 를 아무도 확인할 수 없다.
  const canEdit = me.can("서비스관리") && !me.isAuditor;

  const rows = await prisma.service.findMany({ orderBy: { serviceId: "asc" } });
  const ui: ServiceRowUI[] = rows.map((s) => ({
    serviceId: s.serviceId,
    title: s.title,
    category: s.category,
    description: s.description,
    howToApply: s.howToApply,
    contactName: s.contactName,
    contactPhone: s.contactPhone,
    fee: s.fee,
    status: s.status,
    isPublic: s.isPublic,
    sortOrder: s.sortOrder,
    note: s.note,
  }));

  const live = ui.filter((s) => s.isPublic && s.status === "운영중").length;

  return (
    <PageContainer>
      <PageHeader
        title="서비스 관리"
        titleEn="Services"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={
          <>
            공개 페이지(<code>/services</code>)에는 <strong>공개 + 운영중</strong>인 서비스만
            뜹니다. 현재 {live}건이 공개되고 있습니다.
          </>
        }
      />
      <Stack gap="lg">
        <ServiceAdmin
          rows={ui}
          readOnly={!canEdit}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 열람만 가능합니다."
              : '"서비스관리" 권한이 없습니다. 관리자에게 요청하십시오.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

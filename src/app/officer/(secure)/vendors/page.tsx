import { GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { VendorAdmin, type VendorRowUI } from "./VendorAdmin";

export const dynamic = "force-dynamic";

export default async function VendorsAdminPage() {
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
  const canEdit = me.can("업소관리") && !me.isAuditor;

  const rows = await prisma.vendor.findMany({ orderBy: { vendorId: "asc" } });
  const ui: VendorRowUI[] = rows.map((v) => ({
    vendorId: v.vendorId,
    name: v.name,
    aliases: v.aliases,
    ownerName: v.ownerName,
    industry: v.industry,
    phone: v.phone,
    address: v.address,
    relatedParty: v.relatedParty,
    relatedMemberNo: v.relatedMemberNo,
    ownershipPct: v.ownershipPct,
    note: v.note,
    status: v.status,
  }));

  const related = ui.filter((v) => v.relatedParty).length;
  const noAlias = ui.filter((v) => v.relatedParty && !v.aliases.trim()).length;

  return (
    <PageContainer>
      <PageHeader
        title="업소 관리"
        titleEn="Businesses"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description={
          <>
            업소 안내(<code>/biz</code>)와 공개 회계의 이해관계자 배지가 이 표에서 나옵니다.
            {related > 0 ? ` 현재 이해관계 업체 ${related}곳.` : ""}
            {noAlias > 0
              ? ` ★ 그중 ${noAlias}곳에 별칭이 없어 로마자 표기 우회에 취약합니다.`
              : ""}
          </>
        }
      />
      <Stack gap="lg">
        <VendorAdmin
          rows={ui}
          readOnly={!canEdit}
          readOnlyReason={
            me.isAuditor
              ? "감사 계정은 읽기 전용입니다. 열람만 가능합니다."
              : '"업소관리" 권한이 없습니다. 관리자에게 요청하십시오.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

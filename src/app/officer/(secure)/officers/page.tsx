import { Alert, GuardDenied, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { currentOfficer } from "@/lib/guard";
import { parsePermissions } from "@/lib/session";
import { ROUTES } from "@/lib/site";

import { PermissionAdmin, type OfficerRowUI } from "./PermissionAdmin";

export const dynamic = "force-dynamic";

export default async function OfficersAdminPage() {
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

  const canEdit = me.can("임원관리");

  const rows = await prisma.officer.findMany({ orderBy: { officerId: "asc" } });
  const ui: OfficerRowUI[] = rows.map((o) => ({
    officerId: o.officerId,
    name: o.name,
    role: o.role,
    email: o.email,
    permissions: [...parsePermissions(o.permissions)],
    approvalLimit: o.approvalLimit,
    status: o.status,
    isSelf: o.email.toLowerCase() === me.email.toLowerCase(),
  }));

  const admins = ui.filter((o) => o.status === "ACTIVE" && o.permissions.includes("임원관리"));

  return (
    <PageContainer>
      <PageHeader
        title="임원 · 권한 관리"
        titleEn="Officers & Permissions"
        breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
        description="누가 무엇을 할 수 있는지 정합니다. 업소·행사·연락처 관리 권한도 여기서 임원에게 넘길 수 있습니다."
      />
      <Stack gap="lg">
        {admins.length === 1 ? (
          <Alert tone="warn" title="임원관리 권한자가 한 명뿐입니다">
            <strong>{admins[0].name}</strong> 님만 권한을 줄 수 있습니다. 이 계정에 접근할 수
            없게 되면 아무도 권한을 바꿀 수 없습니다. 최소 한 명 더 지정해 두십시오.
          </Alert>
        ) : null}

        <PermissionAdmin
          rows={ui}
          canEdit={canEdit}
          readOnlyReason={
            '"임원관리" 권한이 없습니다. 이 권한은 다른 사람의 권한을 바꿀 수 있어 관리자만 가집니다.'
          }
        />
      </Stack>
    </PageContainer>
  );
}

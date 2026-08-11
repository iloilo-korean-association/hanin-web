import type { Metadata } from "next";

import {
  Alert,
  Card,
  CardBody,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { isGuardError, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { PasswordChangeForm } from "./PasswordChangeForm";

/**
 * /me/password — 비밀번호 변경 (P1).
 *
 * 두 경우가 이 화면으로 온다:
 *   ① mustChange — 총무가 발급한 임시 비밀번호로 로그인 → /me 가 이리로 강제 이동
 *   ② 자발 변경 — /me 상단 "비밀번호 변경" 버튼
 */
export const metadata: Metadata = {
  title: "비밀번호 변경",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  let me;
  try {
    me = await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원 로그인이 필요합니다"
            breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
          />
          <GuardDenied
            message={e.message}
            howToFix={e.howToFix}
            action={
              <LinkButton href={ROUTES.login} variant="primary">
                회원 로그인
              </LinkButton>
            }
          />
        </PageContainer>
      );
    }
    throw e;
  }

  const cred = await prisma.memberCredential.findUnique({
    where: { memberNo: me.memberNo },
    select: { mustChange: true },
  });
  const mustChange = cred?.mustChange ?? false;

  return (
    <PageContainer>
      <PageHeader
        title="비밀번호 변경"
        titleEn="Change Password"
        description={`${me.name}님 (${me.memberNo})`}
        breadcrumb={[
          { href: ROUTES.home, label: "홈" },
          { href: ROUTES.meHome, label: "내 정보" },
        ]}
      />

      <Stack>
        {mustChange ? (
          <Alert tone="warn" title="임시 비밀번호로 로그인하셨습니다 — 새 비밀번호를 만들어 주십시오">
            <p>
              총무가 발급한 임시 비밀번호는 본인만의 비밀번호로 바꾸셔야 내 정보 화면을 이용하실 수
              있습니다. 바꾸시면 임시 비밀번호는 더 이상 쓸 수 없습니다.
            </p>
          </Alert>
        ) : null}

        <Card>
          <CardBody>
            <PasswordChangeForm mustChange={mustChange} />
          </CardBody>
        </Card>

        {!mustChange ? (
          <div>
            <LinkButton href={ROUTES.meHome} variant="secondary">
              ← 내 정보로 돌아가기
            </LinkButton>
          </div>
        ) : null}
      </Stack>
    </PageContainer>
  );
}

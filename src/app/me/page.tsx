import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GuardDenied, LinkButton, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { isGuardError, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { MemberPortal } from "./_portal/MemberPortal";

/**
 * /me — 세션 기반 회원 홈 (P1).
 *
 * 본문은 매직링크(/me/[token])와 같은 컴포넌트(_portal/MemberPortal)가 그린다.
 * 이 파일이 하는 일:
 *   ① 세션 인증 (requireMemberSession) — 없으면 로그인 화면 안내
 *   ② mustChange 강제 — 임시 비밀번호로 들어온 회원은 먼저 비밀번호부터 만들게 한다
 */
export const metadata: Metadata = {
  title: "내 정보",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MyHomePage() {
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
          <Stack>
            <GuardDenied
              message={e.message}
              howToFix={e.howToFix}
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <LinkButton href={ROUTES.login} variant="primary">
                    회원 로그인
                  </LinkButton>
                  <LinkButton href={ROUTES.join}>회원 가입하기</LinkButton>
                </div>
              }
            />
          </Stack>
        </PageContainer>
      );
    }
    throw e;
  }

  // 임시 비밀번호(mustChange)면 본인 비밀번호를 만들 때까지 포털을 열지 않는다.
  const cred = await prisma.memberCredential.findUnique({
    where: { memberNo: me.memberNo },
    select: { mustChange: true },
  });
  if (cred?.mustChange) redirect(ROUTES.mePassword);

  return <MemberPortal memberNo={me.memberNo} mode="session" />;
}

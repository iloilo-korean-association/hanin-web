import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GuardDenied, LinkButton, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { nextPortalGate } from "@/lib/domain";
import { isGuardError, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { MemberPortal } from "./_portal/MemberPortal";

/**
 * /me — 세션 기반 회원 홈 (P1).
 *
 * 본문은 매직링크(/me/[token])와 같은 컴포넌트(_portal/MemberPortal)가 그린다.
 * 이 파일이 하는 일:
 *   ① 세션 인증 (requireMemberSession) — 없으면 로그인 화면 안내
 *   ② 관문 (domain/portalGate.ts) — 순서대로
 *      · mustChange: 임시 비밀번호로 들어온 회원은 먼저 비밀번호부터 만들게 한다 (/me/password)
 *      · 영문 이름이 비어 있는 회원은 먼저 영문 이름을 등록하게 한다 (/me/name-en, 2026-11-01)
 *      /me/password 성공 → /me 로 돌아오므로 두 번째 관문에 자연히 걸린다.
 */
export const metadata: Metadata = {
  title: "내 정보",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MyHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const year = Array.isArray(sp.year) ? sp.year[0] : sp.year;

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

  // 임시 비밀번호(mustChange)면 본인 비밀번호를, 영문 이름이 비어 있으면 영문 이름을
  // 먼저 받는다 — 둘 다 끝나기 전에는 포털을 열지 않는다.
  const cred = await prisma.memberCredential.findUnique({
    where: { memberNo: me.memberNo },
    select: { mustChange: true },
  });
  const gate = nextPortalGate({ mustChange: cred?.mustChange ?? false, nameEn: me.nameEn });
  if (gate === "password") redirect(ROUTES.mePassword);
  if (gate === "name-en") redirect(ROUTES.meNameEn);

  return <MemberPortal memberNo={me.memberNo} mode="session" year={year} />;
}

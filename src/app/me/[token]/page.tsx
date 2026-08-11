import type { Metadata } from "next";

import {
  Alert,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { isGuardError, requireMember } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { MemberPortal } from "../_portal/MemberPortal";
import { SessionBridge } from "./SessionBridge";

/**
 * /me/[token] — 매직링크 회원 화면.
 *
 * 본문은 세션 로그인(/me)과 **같은 컴포넌트**(../_portal/MemberPortal)가 그린다.
 * 이 파일이 하는 일은 두 가지뿐이다:
 *   ① 토큰 인증 (requireMember)
 *   ② 세션 동시 발급 (SessionBridge) — 링크로 들어온 회원도 다음부터는
 *      /me 로 다닐 수 있게 세션 쿠키를 심어 둔다 (P1).
 *
 * ★ 비공개 화면이다. 검색엔진에 절대 들어가면 안 된다.
 *   robots 메타 + next.config.ts 의 X-Robots-Tag + Referrer-Policy: no-referrer 3중으로 막는다.
 *   (Referrer 가 나가면 외부 링크를 누르는 순간 토큰이 통째로 새어 나간다.)
 */
export const metadata: Metadata = {
  title: "내 정보",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const year = Array.isArray(sp.year) ? sp.year[0] : sp.year;

  // 토큰 문자셋은 대문자뿐이다. 소문자로 옮겨 적으신 분도 들어올 수 있게 올려 준다.
  const normalized = decodeURIComponent(token).trim().toUpperCase();

  let me;
  try {
    me = await requireMember(normalized);
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원 조회 링크를 확인해 주십시오"
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
                  <LinkButton href={ROUTES.help}>총무에게 문의하기</LinkButton>
                </div>
              }
            />
            <Alert tone="info" title="링크는 이런 모양입니다">
              <p>
                가입 환영 메일이나 영수증 메일 안에 있는 <code>/me/ABCD2345</code> 형태의 주소입니다.
                8자리이고 대문자와 숫자만 들어갑니다(헷갈리는 0 · O · 1 · I · L 은 쓰지 않습니다).
                비밀번호를 만드셨다면 회원번호(아이디)로 로그인하실 수도 있습니다.
              </p>
            </Alert>
          </Stack>
        </PageContainer>
      );
    }
    throw e;
  }

  return (
    <>
      {/* 링크로 열어도 세션을 함께 심는다 — 화면 렌더 중에는 쿠키를 못 쓰므로 클라이언트에서 1회 호출 */}
      <SessionBridge token={me.linkToken} />
      <MemberPortal memberNo={me.memberNo} mode="token" year={year} />
    </>
  );
}

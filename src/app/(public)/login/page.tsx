import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { currentMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { MemberLoginForm } from "./MemberLoginForm";

export const metadata: Metadata = {
  title: "회원 로그인",
  description: "일로일로 한인회 회원 로그인. 회원번호(아이디) 또는 이메일과 비밀번호로 로그인합니다.",
  alternates: { canonical: ROUTES.login },
};

export const dynamic = "force-dynamic";

/**
 * /login — 회원 로그인 (P1, 대표 결정: 비밀번호 방식).
 *
 * 이미 로그인돼 있으면 /me 로 보낸다. 기존 매직링크(/me/<토큰>)는 그대로 살아 있다 —
 * 이 화면은 링크를 잃어버린 회원과 비밀번호를 만든 회원을 위한 정문이다.
 */
export default async function MemberLoginPage() {
  const me = await currentMemberSession();
  if (me) redirect(ROUTES.meHome);

  return (
    <PageContainer>
      <PageHeader
        title="회원 로그인"
        titleEn="Member Sign in"
        description="회원번호(아이디) 또는 이메일과 비밀번호로 로그인하시면 회비 납부 내역과 영수증을 보실 수 있습니다."
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack>
        <Card>
          <CardBody>
            <MemberLoginForm />
          </CardBody>
        </Card>

        <Card as="aside">
          <CardHeader title="처음이신가요?" headingLevel={2} />
          <CardBody>
            <p className="text-ink-soft">
              아직 회원이 아니시면 가입 신청부터 해 주십시오. 가입하실 때 비밀번호를 함께 정하시면
              바로 로그인하실 수 있습니다.
            </p>
            <div className="mt-3">
              <LinkButton href={ROUTES.join} variant="primary">
                회원 가입하기
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Alert tone="info" title="가입 안내 메일의 '내 정보' 링크도 계속 쓰실 수 있습니다">
          <p>
            <code>/me/ABCD2345</code> 형태의 본인 전용 링크를 가지고 계시면 비밀번호 없이 그 링크로
            들어가셔도 됩니다. 비밀번호를 잊으셨다면{" "}
            <Link href={ROUTES.loginForgot} className="link-ika">
              비밀번호 재설정 안내
            </Link>
            를 확인해 주십시오.
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}

import type { Metadata } from "next";
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
import { devToolsEnabled } from "@/lib/auth";
import { currentOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "임원 로그인",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/login — 이메일 + 비밀번호.
 *
 * 회원(60대 포함)은 비밀번호가 없다(매직링크). 임원은 매일 쓰는 사람이라 비밀번호가 빠르다.
 * 이미 로그인돼 있으면 대시보드로 보낸다.
 */
export default async function OfficerLoginPage() {
  const me = await currentOfficer();
  if (me) redirect(ROUTES.officer);

  const dev = devToolsEnabled();

  return (
    <PageContainer>
      <PageHeader
        title="임원 로그인"
        titleEn="Officer Sign in"
        description="한인회 임원 전용 화면입니다. 일반 회원은 회원 로그인(/login) 또는 가입 안내 메일의 '내 정보' 링크를 이용하십시오."
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack>
        <Card>
          <CardBody>
            <LoginForm defaultEmail="" />
          </CardBody>
        </Card>

        {dev ? (
          <Card>
            <CardHeader
              title="로컬 프로토타입 계정"
              description="이 안내는 개발 모드에서만 보입니다. 프로덕션 빌드에서는 나오지 않습니다."
              headingLevel={2}
            />
            <CardBody>
              <p className="mb-3">
                시드된 임원 5명의 비밀번호는 <code className="font-mono font-bold">npm run db:reset</code> 실행 시 콘솔에 한 번 출력됩니다. 고정하려면 <code className="font-mono">SEED_PASSWORD</code> 환경변수를 주십시오.
              </p>
              <ul className="mb-4 flex flex-col gap-1 text-sm text-ink-soft">
                <li>president@ika-iloilo.org — 박정우 회장 (승인권·조회권 / 한도 ₱30,000)</li>
                <li>vp@ika-iloilo.org — 이서연 부회장 (승인권·조회권 / 한도 ₱10,000)</li>
                <li>treasurer@ika-iloilo.org — 정도현 총무 (입력권·조회권 / 한도 ₱3,000)</li>
                <li>auditor@ika-iloilo.org — 최수아 감사 (조회권 / 읽기 전용)</li>
                <li>auditor2@ika-iloilo.org — 강예린 감사 (승인권·조회권 / 한도 ₱50,000)</li>
              </ul>
              <LinkButton href={ROUTES.devLogin} variant="secondary">
                비밀번호 없이 계정 전환 (/dev/login)
              </LinkButton>
            </CardBody>
          </Card>
        ) : null}

        <Alert tone="info" title="로그인해도 할 수 있는 일은 직책마다 다릅니다">
          <p>
            감사는 어떤 화면에서도 저장할 수 없고, 총무는 결재할 수 없으며, 이해관계가 있는 임원은
            그 건의 승인 버튼이 잠깁니다. 화면에서 버튼을 숨기는 것이 아니라 서버가 거부합니다.
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}

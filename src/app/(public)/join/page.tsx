import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, CardBody, CardHeader, formatPeso, PageContainer, PageHeader, Stack } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, duesTableFrom, loadSettings } from "@/lib/domain";
import { ORG_NAME, ROUTES } from "@/lib/site";

import { PrivacyConsentFull, type DpoContact } from "../_consent";
import { newFormToken } from "../_shared";
import { JoinForm } from "./JoinForm";

export const metadata: Metadata = {
  title: "회원 가입",
  description:
    "일로일로 한인회 회원 가입 신청. 이름·연락처·이메일·비밀번호 4가지만 적으시면 됩니다. 여권번호·ACR I-Card·주민등록번호는 수집하지 않습니다.",
  alternates: { canonical: ROUTES.join },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: ORG_NAME,
    title: `회원 가입 · ${ORG_NAME}`,
    description: "이름·연락처·이메일·비밀번호 4가지면 끝납니다. 회원번호와 본인 전용 조회 링크를 바로 받으실 수 있습니다.",
    url: ROUTES.join,
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다.
    //   images 를 빼면 카톡에 링크를 붙여도 썸네일 카드가 뜨지 않는다(curl 로 확인).
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 회원 가입` }],
  },
};

/**
 * ★ force-dynamic 인 이유는 두 가지다.
 *   ① 회비 단가·개인정보 보호책임자 연락처를 DB(00_설정 · 12_임원)에서 읽는다.
 *      빌드 시점에 구워 두면 총무가 바뀌어도 화면이 안 바뀐다.
 *   ② 이중 제출 방지 키(formToken)를 **요청마다** 새로 내려야 한다.
 *      정적으로 구우면 모든 방문자가 같은 키를 들고 오게 되어, 두 번째 사람의 가입이
 *      첫 번째 사람의 결과로 되돌아온다.
 */
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const [settings, officers] = await Promise.all([
    loadSettings(prisma),
    prisma.officer.findMany({
      where: { status: "ACTIVE" },
      select: { role: true, email: true, phone: true },
    }),
  ]);

  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const treasurer = officers.find((o) => o.role === "총무");
  const auditor = officers.find((o) => o.role === "감사");

  // 동의서 제9항(개인정보 보호책임자)의 빈칸. 원문이 "여기에 적으세요" 라고 지시한 자리다.
  const contact: DpoContact = {
    treasurerEmail: treasurer?.email || contactEmail || "[확인 필요]",
    treasurerPhone: treasurer?.phone || "[확인 필요]",
    auditorEmail: auditor?.email || "[확인 필요]",
  };

  // 가입자는 전원 정회원이다(2026-10-22). 화면의 금액은 설정값을 그대로 보여 준다 — 하드코딩 금지.
  // 설정에 키가 없으면 null 로 넘겨 금액 없이 안내한다(없는 금액을 지어내지 않는다).
  const duesTable = duesTableFrom(settings);
  const regularFee = "정회원" in duesTable ? duesTable["정회원"] : null;

  return (
    <PageContainer>
      <PageHeader
        title="회원 가입"
        titleEn="Join"
        description={
          // 회원 구분을 고르지 않는 대신 한 줄로 알린다. 금액은 설정값(회비단가.정회원).
          regularFee !== null
            ? `이름·연락처·이메일·비밀번호 4가지만 적으시면 됩니다. 가입하시면 정회원(연회비 ${formatPeso(regularFee)})으로 등록됩니다. 학생·사업회원 등은 총무에게 말씀해 주십시오.`
            : "이름·연락처·이메일·비밀번호 4가지만 적으시면 됩니다. 가입하시면 정회원으로 등록됩니다. 학생·사업회원 등은 총무에게 말씀해 주십시오."
        }
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      {/* 폼을 맨 위에 둔다 — 모바일에서 첫 화면에 입력 칸이 보이도록. 안내는 폼 아래로 내렸다. */}
      <Stack gap="md">
        <JoinForm
          formToken={newFormToken()}
          contactEmail={contact.treasurerEmail}
          consentSlot={<PrivacyConsentFull contact={contact} />}
        />

        <Alert tone="info" title="신청하시면 이렇게 됩니다">
          <ol className="ml-5 list-decimal space-y-1">
            <li>
              회원번호가 결번 없이 발급됩니다 (M0001 형식). 로그인은 <b>회원번호 또는 이메일</b>과 가입
              때 정하신 <b>비밀번호</b>로 바로 하실 수 있습니다.
            </li>
            <li>올해 정회원 연회비 고지가 자동으로 만들어집니다.</li>
            <li>
              <b>본인 전용 조회 링크</b>도 함께 받으십니다(링크로는 비밀번호 없이 들어가실 수 있습니다).
            </li>
            <li>회비·행사 알림 수신과 회원 명부 공개는 가입 후 &apos;내 정보&apos; 화면에서 켜실 수 있습니다.</li>
          </ol>
        </Alert>

        <Card as="aside">
          <CardHeader
            title="받지 않는 정보"
            description="필요 없는 것은 애초에 받지 않습니다. 받아 두면 언젠가 사고가 납니다."
          />
          <CardBody>
            <ul className="ml-5 list-disc space-y-1 text-ink-soft">
              <li>주민등록번호 · 여권번호 · ACR I-Card 번호 — 칸 자체가 없습니다.</li>
              <li>은행 계좌번호 · 신용카드 정보.</li>
              <li>건강 · 종교 · 정치성향 등 민감정보 (RA 10173 sensitive personal information).</li>
            </ul>
            <p className="mt-3 text-sm text-ink-muted">
              누가 얼마를 냈는지는 공개하지 않습니다. 한인회가 얼마를 어디에 썼는지는{" "}
              <Link href={ROUTES.ledger} className="link-ika">
                공개 회계
              </Link>{" "}
              에서 건별로 전액 공개합니다.
            </p>
          </CardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}

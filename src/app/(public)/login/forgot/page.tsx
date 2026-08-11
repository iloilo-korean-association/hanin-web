import type { Metadata } from "next";

import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatLine,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, hotlineFrom, loadSettings } from "@/lib/domain";
import { mailSendingEnabled } from "@/lib/mail-sender";
import { ROUTES } from "@/lib/site";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  description: "일로일로 한인회 회원 비밀번호 재설정 안내.",
  alternates: { canonical: ROUTES.loginForgot },
};

export const dynamic = "force-dynamic";

/**
 * /login/forgot — 비밀번호 재설정 안내 (P1).
 *
 * Resend(메일 실발송)·도메인이 **보류**인 동안에는 재설정 메일을 보낼 수 없다
 * (대표 결정 2026-08-11). 그동안은 총무가 임원 화면에서 임시 비밀번호를 수동
 * 발급한다 — 이 화면은 그 절차를 안내한다.
 *
 * 키가 생기면: MAGIC_PURPOSES 의 "PASSWORD_RESET" 으로 매직링크를 발급하는
 * 셀프 재설정 흐름을 이 자리에 붙인다 (purpose 는 미리 정의돼 있다).
 * mailSendingEnabled() 가 true 인데도 이 안내가 보이면 그 전환 작업이 남은 것이다.
 */
export default async function ForgotPasswordPage() {
  const [settings, treasurers] = await Promise.all([
    loadSettings(prisma),
    // 총무 연락처는 12_임원이 정본이다 — 사람이 바뀌면 화면도 그날부터 바뀐다.
    prisma.officer.findMany({
      where: { status: "ACTIVE", role: "총무" },
      select: { name: true, email: true, phone: true },
    }),
  ]);

  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const hotline = hotlineFrom(settings);
  const treasurer = treasurers[0] ?? null;
  const mailReady = mailSendingEnabled();

  return (
    <PageContainer>
      <PageHeader
        title="비밀번호 재설정"
        titleEn="Reset Password"
        description="비밀번호를 잊으셨어도 걱정하지 마십시오. 총무가 임시 비밀번호를 발급해 드립니다."
        breadcrumb={[
          { href: ROUTES.home, label: "홈" },
          { href: ROUTES.login, label: "회원 로그인" },
        ]}
      />

      <Stack>
        {mailReady ? (
          <Alert tone="warn" title="메일 재설정 전환 작업이 남아 있습니다">
            <p>
              메일 발송이 켜져 있지만 셀프 재설정 흐름은 아직 연결되지 않았습니다. 당분간은 아래
              절차(총무 수동 재설정)를 이용해 주십시오.
            </p>
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title="총무에게 연락해 주십시오"
            description="지금은 이메일 재설정을 지원하지 않습니다. 본인 확인 후 총무가 임시 비밀번호를 발급해 드립니다."
          />
          <CardBody>
            <div className="flex flex-col gap-3">
              {treasurer ? (
                <>
                  <StatLine label="총무" value={treasurer.name} />
                  {treasurer.email ? (
                    <StatLine
                      label="이메일"
                      value={
                        <a className="link-ika break-all" href={`mailto:${treasurer.email}`}>
                          {treasurer.email}
                        </a>
                      }
                    />
                  ) : null}
                  {treasurer.phone ? (
                    <StatLine
                      label="연락처"
                      value={
                        <a className="link-ika tnum" href={`tel:${treasurer.phone.replace(/\s/g, "")}`}>
                          {treasurer.phone}
                        </a>
                      }
                    />
                  ) : null}
                </>
              ) : (
                <p className="text-ink-soft">
                  총무 연락처가 아직 등록되지 않았습니다. 아래 대표 문의처로 연락해 주십시오.
                </p>
              )}
              {contactEmail ? (
                <StatLine
                  label="대표 문의"
                  value={
                    <a className="link-ika break-all" href={`mailto:${contactEmail}`}>
                      {contactEmail}
                    </a>
                  }
                />
              ) : null}
              {hotline.ready && hotline.number ? (
                <StatLine
                  label="한인회 핫라인"
                  value={
                    <a className="link-ika tnum" href={`tel:${hotline.number.replace(/\s/g, "")}`}>
                      {hotline.number}
                    </a>
                  }
                />
              ) : null}
            </div>

            <ol className="mt-4 ml-5 list-decimal space-y-1 text-ink-soft">
              <li>총무에게 성함과 회원번호(모르시면 성함·연락처)를 알려 주십시오.</li>
              <li>총무가 본인 확인 후 <b>임시 비밀번호</b>를 발급해 알려 드립니다.</li>
              <li>
                임시 비밀번호로 로그인하시면 <b>새 비밀번호를 만드는 화면</b>이 바로 나옵니다. 새
                비밀번호를 정하시면 임시 비밀번호는 더 이상 쓸 수 없습니다.
              </li>
            </ol>
          </CardBody>
        </Card>

        <Alert tone="info" title="왜 이메일로 재설정 링크를 보내 드리지 않나요?">
          <p>
            한인회 명의의 메일 발송 시스템(도메인 인증)이 아직 준비 중입니다. 준비가 끝나면 이
            화면에서 바로 재설정 링크를 받아보실 수 있게 됩니다.
          </p>
        </Alert>

        <div>
          <LinkButton href={ROUTES.login} variant="secondary">
            ← 로그인 화면으로
          </LinkButton>
        </div>
      </Stack>
    </PageContainer>
  );
}

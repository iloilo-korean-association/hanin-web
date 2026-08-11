import type { Metadata } from "next";

import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { PrintButton } from "../../officer/_components/PrintButton";
import { loadMemberCardData } from "../_portal/card-data";
import { MemberIdCard } from "../_portal/MemberIdCard";

/**
 * /me/card — 디지털 회원증 단독 화면 (P3).
 *
 * 왜 따로 두는가: 포털에는 납부 내역표가 길게 붙어 있어서 그대로 인쇄하면
 * 카드 한 장을 얻으려고 A4 여러 장이 나온다. 이 화면은 카드 하나만 있고
 * 나머지는 no-print 라, 인쇄하면 **오려서 지갑에 넣을 카드 한 장**이 나온다.
 *
 * 인증: 세션(P1 비밀번호 로그인)이 기본. 매직링크로 들어오신 분을 위해 ?token= 도 받는다
 * — /me/<토큰> 에서 넘어올 때 쓴다. 어느 쪽이든 **가드가 돌려준 회원번호로만** 조회한다.
 *
 * ★ 유효/무효는 볼 때마다 다시 센다. 회비가 미납으로 돌아서면 그 순간부터
 *   이 화면에도 카드가 나오지 않는다(domain/memberCard.ts).
 */
export const metadata: Metadata = {
  title: "디지털 회원증",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MemberCardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tokenRaw = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const token = (tokenRaw ?? "").trim().toUpperCase();

  let me;
  try {
    me = token ? await requireMember(token) : await requireMemberSession();
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
                <LinkButton href={ROUTES.login} variant="primary">
                  회원 로그인
                </LinkButton>
              }
            />
          </Stack>
        </PageContainer>
      );
    }
    throw e;
  }

  const data = await loadMemberCardData(me.memberNo);
  const backHref = token ? ROUTES.me(token) : ROUTES.meHome;

  return (
    <PageContainer>
      <PageHeader
        title="디지털 회원증"
        titleEn="Membership Card"
        breadcrumb={[{ href: backHref, label: "내 정보" }]}
        description={`${data.fiscalYear}년 회비 납부 회원에게 발급됩니다.`}
        actions={data.verdict.valid ? <PrintButton label="회원증 인쇄" /> : null}
      />

      <Stack gap="md">
        {data.verdict.valid ? (
          <>
            <MemberIdCard
              name={data.member.name}
              memberNo={data.member.memberNo}
              memberType={data.member.memberType}
              fiscalYear={data.fiscalYear}
              photoViewUrl={data.photoViewUrl}
              verifyUrl={data.verifyUrl}
            />

            <Card as="aside" className="no-print">
              <CardHeader title="인쇄하실 때" headingLevel={2} />
              <CardBody>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-soft">
                  <li>
                    종이 크기는 A4 그대로 두시면 됩니다. 카드는 <b>실물 회원증 크기(85.6 × 54mm)</b>
                    로 찍히니 <b>테두리 선을 따라 오리시면</b> 지갑에 들어갑니다.
                  </li>
                  <li>
                    브라우저 인쇄 설정에서 <b>&quot;배율 100%&quot;</b> 인지 확인해 주십시오. 자동
                    맞춤(fit to page)으로 두면 크기가 달라집니다.
                  </li>
                  <li>
                    흑백으로 뽑으셔도 됩니다. QR 과 사진만 또렷하면 확인에 문제가 없습니다.
                  </li>
                  <li>
                    회비가 미납으로 바뀌면 QR 확인 결과가 <b>무효</b>로 바뀝니다 — 종이 카드가
                    남아 있어도 마찬가지입니다.
                  </li>
                </ul>
              </CardBody>
            </Card>
          </>
        ) : (
          <Alert tone="info" title="아직 회원증을 발급해 드릴 수 없습니다">
            <ul className="list-disc pl-5">
              {data.verdict.blockers.map((b) => (
                <li key={b.code}>
                  <b>{b.message}</b> — {b.howToFix}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              <LinkButton href={backHref} size="sm">
                내 정보로 돌아가기
              </LinkButton>
            </p>
          </Alert>
        )}
      </Stack>
    </PageContainer>
  );
}

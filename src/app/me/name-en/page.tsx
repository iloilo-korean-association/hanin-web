import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Alert,
  Button,
  Card,
  CardBody,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { nextPortalGate } from "@/lib/domain";
import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { memberLogoutAction } from "../../(public)/login/actions";
import { NameEnForm } from "./NameEnForm";

/**
 * /me/name-en — 영문 이름 등록 관문 (2026-11-01, 대표 요청).
 *
 * 영문 이름(성명_영문)이 비어 있는 회원은 포털(/me · /me/[token])을 열기 전에 여기로 온다.
 * 기존 회원 49명이 전원 비어 있어, 임시 비밀번호 변경(/me/password)과 같은 방식의 강제 관문으로 받는다.
 *
 * 인증: 세션(P1)이 기본. 매직링크로 들어오신 분은 ?token= 으로 — /me/card 와 같은 방식.
 *   어느 쪽이든 **가드가 돌려준 회원번호로만** 저장한다(actions.ts).
 * 순서: 세션이면 임시 비밀번호(mustChange)가 먼저다 — 그 경우 /me/password 로 보낸다(domain/portalGate.ts).
 *   이미 등록된 회원이 직접 이 주소를 열면 포털로 돌려보낸다(정정은 총무).
 * "나중에" 는 없다 — 필수 관문. 단 로그아웃(세션) / 홈(토큰)은 열어 둔다.
 */
export const metadata: Metadata = {
  title: "영문 이름 등록",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NameEnPage({
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

  // 세션이면 임시 비밀번호 관문이 먼저. 매직링크에는 비밀번호가 없다.
  let mustChange = false;
  if (!token) {
    const cred = await prisma.memberCredential.findUnique({
      where: { memberNo: me.memberNo },
      select: { mustChange: true },
    });
    mustChange = cred?.mustChange ?? false;
  }
  const portalHref = token ? ROUTES.me(me.linkToken) : ROUTES.meHome;
  const gate = nextPortalGate({ mustChange, nameEn: me.nameEn });
  if (gate === "password") redirect(ROUTES.mePassword);
  if (gate === null) redirect(portalHref); // 이미 등록됨 — 정정은 총무

  return (
    <PageContainer>
      <PageHeader
        title="영문 이름 등록"
        titleEn="Name in English"
        description={`${me.name}님 (${me.memberNo})`}
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack>
        <Alert tone="warn" title="영문 이름을 한 번만 등록해 주십시오 — 그 다음 내 정보 화면이 열립니다">
          <p>
            회원 명부에 한글 성명과 함께 <b>여권의 영문 표기</b>를 함께 보관합니다. 현지 기관·영사 협조가 필요한
            긴급 상황에서 본인 확인에 쓰입니다. 등록 뒤에는 본인 화면에서 바꿀 수 없고, 정정이 필요하면 총무에게
            말씀해 주십시오.
          </p>
        </Alert>

        <Card>
          <CardBody>
            <NameEnForm token={token ? me.linkToken : ""} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {token ? (
            <LinkButton href={ROUTES.home} variant="secondary">
              ← 홈으로
            </LinkButton>
          ) : (
            <form action={memberLogoutAction}>
              <Button type="submit" variant="secondary">
                로그아웃
              </Button>
            </form>
          )}
          <p className="text-sm text-ink-muted">
            디지털 회원증과 QR 진위 확인은 영문 이름 없이도 그대로 쓰실 수 있습니다.
          </p>
        </div>
      </Stack>
    </PageContainer>
  );
}

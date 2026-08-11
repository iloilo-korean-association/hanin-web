import "server-only";

import { prisma } from "@/lib/db";
import { cfgNum, evaluateMemberCard, loadSettings, todayManila, type CardVerdict } from "@/lib/domain";
import { absoluteUrl, ROUTES } from "@/lib/site";

import { toViewUrl } from "../../officer/_lib/evidence-view";

/**
 * 회원 한 명의 사진·회원증 상태를 읽어 온다 (P3).
 *
 * ★ 인자로 받은 회원번호는 **가드가 돌려준 값**이어야 한다.
 *   이 함수는 그것을 확인할 방법이 없다 — 호출 화면이 requireMember(토큰) 또는
 *   requireMemberSession() 을 통과한 뒤에만 부른다. 폼·쿼리스트링에서 온 회원번호를
 *   여기에 넣으면 남의 사진 서명 URL 이 발급된다.
 *
 * ★ 서명 URL 은 여기서 만든다. 비공개 Blob 원본 URL 은 화면으로 내보내지 않는다 —
 *   원본이 HTML 에 박히면 그 문자열이 그대로 남의 손에 넘어갈 수 있다(서명은 10분짜리다).
 *
 * 회원증 유효/무효는 저장하지 않고 부를 때마다 다시 센다(domain/memberCard.ts 주석 참조).
 */
export type MemberCardData = {
  member: {
    memberNo: string;
    name: string;
    memberType: string;
    status: string;
    linkToken: string;
  };
  /** 아직 사진을 한 장도 올리지 않았으면 null */
  card: {
    photoStatus: string;
    photoRejectReason: string;
    photoUploadedAt: Date | null;
    photoConsentAt: Date | null;
    verifyToken: string;
  } | null;
  /** 당해연도 회비 (06_회비고지) — 없으면 null */
  dues: { status: string; billedAmount: number; paidAmount: number; unpaidAmount: number } | null;
  verdict: CardVerdict;
  /** 본인에게만 보여 줄 사진. 서명 URL(10분). 사진이 없으면 "" */
  photoViewUrl: string;
  /** QR 이 가리킬 절대 주소. 사진(=카드 행)이 없으면 "" */
  verifyUrl: string;
  fiscalYear: number;
};

export async function loadMemberCardData(memberNo: string): Promise<MemberCardData> {
  const settings = await loadSettings(prisma);
  const fiscalYear = cfgNum(settings, "회계연도", Number(todayManila().slice(0, 4)));

  const [member, card, dues] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { memberNo },
      select: { memberNo: true, name: true, memberType: true, status: true, linkToken: true },
    }),
    prisma.memberCard.findUnique({
      where: { memberNo },
      select: {
        photoUrl: true,
        photoStatus: true,
        photoRejectReason: true,
        photoUploadedAt: true,
        photoConsentAt: true,
        verifyToken: true,
      },
    }),
    prisma.duesInvoice.findUnique({
      where: { fiscalYear_memberNo: { fiscalYear, memberNo } },
      select: { status: true, billedAmount: true, paidAmount: true, unpaidAmount: true },
    }),
  ]);

  const verdict = evaluateMemberCard({
    memberStatus: member.status,
    photoStatus: card?.photoStatus ?? "",
    dues,
    fiscalYear,
  });

  return {
    member,
    card: card
      ? {
          photoStatus: card.photoStatus,
          photoRejectReason: card.photoRejectReason,
          photoUploadedAt: card.photoUploadedAt,
          photoConsentAt: card.photoConsentAt,
          verifyToken: card.verifyToken,
        }
      : null,
    dues,
    verdict,
    photoViewUrl: card?.photoUrl ? await toViewUrl(card.photoUrl) : "",
    verifyUrl: card ? absoluteUrl(ROUTES.verify(card.verifyToken)) : "",
    fiscalYear,
  };
}

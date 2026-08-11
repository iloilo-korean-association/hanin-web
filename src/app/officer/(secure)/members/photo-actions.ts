"use server";

import { revalidatePath } from "next/cache";

import { prisma, type Tx } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { firstIssue, memberPhotoReviewSchema } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";

/**
 * 회원 사진 검수 — 승인 / 반려 (P3).
 *
 * ★ 첫 줄 가드: requireOfficer({ permissions: ["회원관리"], write: true }).
 *   write:true 를 빼면 감사 계정이 통과한다 — 감사가 회원 사진을 승인하면
 *   감사의 독립성이 깨진다(READ_ONLY 로 서버가 거부한다).
 *
 * ★ 반려는 **사유가 필수**다(memberPhotoReviewSchema). 사유 없는 반려는
 *   회원이 무엇을 고쳐야 할지 알 수 없어 결국 총무에게 전화가 온다.
 *
 * ★ 검수는 사진 파일을 지우지 않는다. 반려된 사진도 회원이 다시 올릴 때
 *   교체되면서 정리된다(photo-actions.ts). 여기서 지우면 "왜 반려했는지"
 *   확인할 근거가 즉시 사라진다.
 *
 * ★ 모든 판정은 16_감사로그에 남는다. 남의 얼굴 사진을 다루는 조작이다.
 */

/** 목록 화면이 다시 그려져야 하는 경로들. 회원 본인 화면도 함께 무효화한다. */
async function revalidateAll(linkToken: string): Promise<void> {
  revalidatePath(`${ROUTES.officer}/members`);
  revalidatePath(`${ROUTES.officer}/members/photos`);
  revalidatePath(ROUTES.meHome);
  revalidatePath(ROUTES.meCard);
  if (linkToken) revalidatePath(`/me/${linkToken}`);
}

export async function reviewMemberPhotoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // ★ 첫 줄.
    const me = await requireOfficer({
      permissions: ["회원관리"],
      write: true,
      screen: "회원 사진 검수",
    });

    const parsed = memberPhotoReviewSchema.safeParse({
      decision: fdStr(formData, "decision"),
      memberNo: fdStr(formData, "memberNo"),
      rejectReason: fdStr(formData, "rejectReason"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    const card = await prisma.memberCard.findUnique({
      where: { memberNo: input.memberNo },
      select: {
        photoStatus: true,
        photoUrl: true,
        member: { select: { name: true, status: true, linkToken: true } },
      },
    });
    if (!card) {
      return fail(
        `${input.memberNo} 회원이 올린 사진이 없습니다.`,
        "회원이 사진을 올리기 전이거나, 다른 임원이 이미 처리했을 수 있습니다. 목록을 새로고침해 주십시오.",
      );
    }
    if (!card.photoUrl) {
      return fail(
        `${card.member.name}(${input.memberNo}) 님의 사진 파일이 없습니다.`,
        "회원에게 사진을 다시 올려 달라고 안내해 주십시오.",
      );
    }

    const now = new Date();
    const nextStatus = input.decision;
    const rejectReason = input.decision === "반려" ? input.rejectReason : "";

    await prisma.$transaction(async (tx: Tx) => {
      await tx.memberCard.update({
        where: { memberNo: input.memberNo },
        data: {
          photoStatus: nextStatus,
          photoReviewedBy: me.email,
          photoReviewedAt: now,
          photoRejectReason: rejectReason,
        },
      });

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "MemberCard",
        recordKey: input.memberNo,
        fieldName: "photoStatus",
        beforeValue: card.photoStatus,
        afterValue: nextStatus,
        changeType: "EDIT",
        // 승인은 회원증 발급으로 이어지는 판정이라 INFO 로는 부족하다.
        severity: "WARN",
        relatedKey: card.member.name,
        note:
          `회원 사진 ${nextStatus}: ${me.name}(${me.role}) → ${card.member.name}(${input.memberNo})` +
          (rejectReason ? ` / 사유: ${rejectReason}` : ""),
      });
    });

    await revalidateAll(card.member.linkToken);

    return input.decision === "승인"
      ? ok(
          `${card.member.name}(${input.memberNo}) 님의 사진을 승인했습니다. ` +
            "당해연도 회비가 납부되어 있으면 회원 화면에 회원증이 바로 나타납니다.",
        )
      : ok(
          `${card.member.name}(${input.memberNo}) 님의 사진을 반려했습니다. ` +
            "회원 화면에 사유가 표시되고 다시 올리실 수 있습니다.",
        );
  } catch (e) {
    return toActionError(e);
  }
}

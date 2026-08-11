"use server";

import { revalidatePath } from "next/cache";

import { appendAuditLog } from "@/lib/audit";
import { hashPassword, newTempPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { zMemberNo } from "@/lib/validators";

import { fail, fdStr, toActionError } from "../../_lib/server-utils";

/**
 * 회원 비밀번호 재설정 — 총무 수동 발급 (P1).
 *
 * Resend(메일 실발송)·도메인 보류 기간의 유일한 재설정 경로다:
 * 회원이 비밀번호를 잊으면 총무에게 연락 → 본인 확인 → 여기서 임시 비밀번호 발급.
 *
 * ★ 첫 줄 가드: "회원관리" + write — 감사 계정은 서버가 거부한다.
 * ★ 임시 비밀번호는 이 응답에 **한 번만** 실려 나간다. DB 에는 해시만 남는다(mustChange=true).
 *   회원이 그 값으로 로그인하면 즉시 본인 비밀번호로 바꾸도록 강제된다(/me/password).
 * ★ 모든 발급은 16_감사로그 WARN 으로 남는다 — 계정 탈취 통로가 될 수 있는 조작이다.
 */

/**
 * ★ "use server" 파일은 async 함수만 export 할 수 있다 — 초기 상태 상수(RESET_IDLE)는
 *   ResetPasswordButton.tsx(클라이언트)에 있다. 타입은 type-only 라 여기 둬도 된다.
 */
export type ResetPasswordState = {
  /** null = 아직 실행 전 */
  ok: boolean | null;
  message: string;
  howToFix: string | null;
  /** 성공 시 화면에 1회 표시할 임시 비밀번호. 저장하지 마라. */
  tempPassword?: string;
  memberNo?: string;
  memberName?: string;
  at: number;
};

export async function resetMemberPasswordAction(
  _prev: ResetPasswordState,
  fd: FormData,
): Promise<ResetPasswordState> {
  try {
    const me = await requireOfficer({
      permissions: ["회원관리"],
      write: true,
      screen: "회원 비밀번호 재설정",
    });

    const memberNoRaw = fdStr(fd, "memberNo");
    const parsed = zMemberNo.safeParse(memberNoRaw);
    if (!parsed.success) return { ...fail("대상 회원번호가 올바르지 않습니다."), at: Date.now() };
    const memberNo = parsed.data;

    const member = await prisma.member.findUnique({
      where: { memberNo },
      select: {
        memberNo: true,
        name: true,
        status: true,
        credential: { select: { mustChange: true } },
      },
    });
    if (!member) return { ...fail(`회원 ${memberNo} 를 찾을 수 없습니다.`), at: Date.now() };
    if (member.status === "WITHDRAWN") {
      return {
        ...fail(
          "탈퇴 처리된 회원입니다.",
          "탈퇴 회원에게는 비밀번호를 발급하지 않습니다. 재가입 절차를 안내해 주십시오.",
        ),
        at: Date.now(),
      };
    }

    // 평문은 이 함수 밖으로 저장되지 않는다 — 응답으로 한 번 나가고 끝이다.
    const tempPassword = newTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const before = member.credential
      ? member.credential.mustChange
        ? "임시 비밀번호(mustChange)"
        : "본인 설정 비밀번호"
      : "미설정";

    await prisma.$transaction(async (tx) => {
      await tx.memberCredential.upsert({
        where: { memberNo },
        create: {
          memberNo,
          passwordHash,
          mustChange: true,
          updatedBy: me.email,
        },
        update: {
          passwordHash,
          mustChange: true,
          failedCount: 0,
          lockedUntil: null,
          updatedBy: me.email,
        },
      });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "MemberCredential",
        recordKey: memberNo,
        fieldName: "passwordHash",
        beforeValue: before,
        afterValue: "임시 비밀번호(mustChange) 발급",
        changeType: "EDIT",
        severity: "WARN",
        relatedKey: member.name,
        note: `임시 비밀번호 발급: ${me.name}(${me.role}) → ${member.name}(${memberNo}). 잠금·실패횟수 초기화.`,
      });
    });

    revalidatePath("/officer/members");

    return {
      ok: true,
      message: `${member.name}(${memberNo})님의 임시 비밀번호를 발급했습니다.`,
      howToFix: null,
      tempPassword,
      memberNo: member.memberNo,
      memberName: member.name,
      at: Date.now(),
    };
  } catch (e) {
    const mapped = toActionError(e);
    return { ok: false, message: mapped.message, howToFix: mapped.howToFix, at: Date.now() };
  }
}

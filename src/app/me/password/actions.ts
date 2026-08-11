"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appendAuditLog } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isGuardError, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { memberPasswordChangeSchema } from "@/lib/validators";

import {
  fail,
  textOf,
  zodFieldErrors,
  zodSummary,
  type FormResult,
} from "../../(public)/_shared";

/**
 * /me/password — 회원 본인 비밀번호 변경 (P1).
 *
 * · 첫 줄 가드: requireMemberSession — 세션 쿠키의 회원만, 폼의 어떤 값도 신원에 쓰지 않는다.
 * · 임시 비밀번호(mustChange) 회원의 강제 변경과 일반 자발 변경이 같은 액션을 쓴다.
 * · 현재 비밀번호를 반드시 다시 받는다 — 세션 탈취자가 비밀번호를 갈아타는 것을 막는 최소 장치.
 * · 성공하면 mustChange=false · 실패카운트/잠금 초기화, 감사로그 WARN 기록.
 */

export type PasswordChangeState = FormResult<{ done: true }>;

export async function changeMyPasswordAction(
  _prev: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  let me;
  try {
    me = await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) return fail(e.message, e.howToFix);
    throw e;
  }

  const parsed = memberPasswordChangeSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    newPasswordConfirm: String(formData.get("newPasswordConfirm") ?? ""),
  });
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const cred = await prisma.memberCredential.findUnique({
    where: { memberNo: me.memberNo },
    select: { passwordHash: true, mustChange: true },
  });
  if (!cred) {
    return fail(
      "이 계정에는 아직 비밀번호가 없습니다.",
      "총무에게 임시 비밀번호 발급을 요청해 주십시오.",
    );
  }

  const good = await verifyPassword(input.currentPassword, cred.passwordHash);
  if (!good) {
    return fail("현재 비밀번호가 맞지 않습니다.", null, {
      currentPassword: "지금 로그인에 쓰신 비밀번호를 그대로 입력해 주십시오.",
    });
  }

  if (input.currentPassword === input.newPassword) {
    return fail("새 비밀번호가 현재 비밀번호와 같습니다.", "다른 비밀번호를 정해 주십시오.", {
      newPassword: "현재 비밀번호와 다른 값을 정해 주십시오.",
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.memberCredential.update({
        where: { memberNo: me.memberNo },
        data: {
          passwordHash,
          mustChange: false,
          failedCount: 0,
          lockedUntil: null,
          updatedBy: me.memberNo,
        },
      });
      await appendAuditLog(tx, {
        actor: `${me.memberNo} (본인)`,
        tableName: "MemberCredential",
        recordKey: me.memberNo,
        fieldName: "passwordHash",
        beforeValue: cred.mustChange ? "임시 비밀번호(mustChange)" : "본인 설정 비밀번호",
        afterValue: "본인 설정 비밀번호",
        changeType: "EDIT",
        severity: "WARN",
        note: "회원 본인이 /me/password 에서 비밀번호 변경",
      });
    });
  } catch (e) {
    console.error("[me/password] 변경 실패", e);
    return fail(
      "비밀번호를 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  revalidatePath(ROUTES.meHome);
  // redirect 는 예외로 동작한다 — try 밖에서 부른다(서버 액션 공통 규칙).
  redirect(ROUTES.meHome);
}

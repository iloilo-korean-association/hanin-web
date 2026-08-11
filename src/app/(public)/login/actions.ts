"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clearMemberSession, signInMember } from "@/lib/auth";
import { ROUTES } from "@/lib/site";

import { fail, textOf, type ErrorState, type IdleState } from "../_shared";

/**
 * /login — 회원 로그인 서버 액션 (P1).
 *
 * ★ redirect() 는 예외를 던져 동작한다. try 로 감싸면 성공한 로그인이
 *   "알 수 없는 오류" 로 삼켜진다 — 임원 로그인과 같은 이유로 try 를 쓰지 않는다.
 * ★ 실패 사유(없는 회원/비밀번호 미설정/틀림)를 화면에서 구분하지 않는다.
 *   남은 시도 횟수도 알려주지 않는다 — 잠금 판정은 전부 서버(signInMember)가 한다.
 */

export type MemberLoginState = IdleState | ErrorState;

export async function memberLoginAction(
  _prev: MemberLoginState,
  formData: FormData,
): Promise<MemberLoginState> {
  const loginId = textOf(formData, "loginId");
  const password = String(formData.get("password") ?? "");

  if (!loginId || !password) {
    return fail("아이디(회원번호 또는 이메일)와 비밀번호를 모두 입력해 주십시오.");
  }

  const result = await signInMember(loginId, password);
  if (!result.ok) {
    return fail(
      result.message,
      result.howToFix ??
        "비밀번호를 잊으셨으면 아래 '비밀번호를 잊으셨나요' 안내를 따라 총무에게 재설정을 요청하십시오.",
    );
  }

  revalidatePath(ROUTES.meHome);
  // 임시 비밀번호(총무 발급)로 들어왔으면 먼저 본인 비밀번호부터 만들게 한다.
  redirect(result.mustChange ? ROUTES.mePassword : ROUTES.meHome);
}

export async function memberLogoutAction(): Promise<void> {
  await clearMemberSession();
  revalidatePath(ROUTES.meHome);
  redirect(ROUTES.home);
}

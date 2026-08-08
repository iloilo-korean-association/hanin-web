"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { clearOfficerSession, signInOfficer } from "@/lib/auth";
import { ROUTES } from "@/lib/site";

import type { ActionState } from "../_lib/action-state";
import { fail, fdStr } from "../_lib/server-utils";

/**
 * 임원 로그인.
 *
 * ★ redirect() 는 예외를 던져 동작한다. try/catch 로 감싸면 성공한 로그인이
 *   "알 수 없는 오류" 로 삼켜진다. 그래서 여기서는 try 를 쓰지 않는다.
 * ★ 실패 사유를 구분해서 알려주지 않는다 — signInOfficer 가 이미 같은 문장을 준다.
 *   좁은 한인 커뮤니티에서 "이 이메일은 임원이다" 는 그 자체로 민감하다.
 */
export async function officerLoginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = fdStr(formData, "email");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return fail("이메일과 비밀번호를 모두 입력해 주십시오.");
  }

  const result = await signInOfficer(email, password);
  if (!result.ok) {
    return fail(
      result.message,
      "비밀번호를 잊으셨으면 총무에게 재설정을 요청하십시오. (로컬 시드 계정의 공통 비밀번호는 화면 아래에 적혀 있습니다.)",
    );
  }

  revalidatePath(ROUTES.officer);
  redirect(ROUTES.officer);
}

export async function officerLogoutAction(): Promise<void> {
  await clearOfficerSession();
  revalidatePath(ROUTES.officer);
  redirect(ROUTES.officerLogin);
}

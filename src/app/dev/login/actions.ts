"use server";

import { revalidatePath } from "next/cache";

import { clearOfficerSession, devSignInOfficer, devToolsEnabled } from "@/lib/auth";

/**
 * /dev/login 의 서버 액션.
 *
 * ★ 두 함수 모두 첫 줄에서 devToolsEnabled() 를 다시 확인한다.
 *   레이아웃이 404 를 내는 것만으로는 부족하다 — 서버 액션은 자기 자신의 엔드포인트라
 *   페이지를 거치지 않고 직접 POST 될 수 있다. 통제는 액션 안에 있어야 한다.
 */

function assertDev(): void {
  if (!devToolsEnabled()) {
    throw new Error("[차단] 개발용 로그인은 프로덕션에서 사용할 수 없습니다.");
  }
}

export async function devLoginAction(formData: FormData): Promise<void> {
  assertDev();
  const officerId = String(formData.get("officerId") ?? "");
  if (!officerId) throw new Error("임원ID 가 없습니다.");

  const result = await devSignInOfficer(officerId);
  if (!result.ok) throw new Error(result.message);

  revalidatePath("/dev/login");
  revalidatePath("/officer");
}

export async function devLogoutAction(): Promise<void> {
  assertDev();
  await clearOfficerSession();
  revalidatePath("/dev/login");
  revalidatePath("/officer");
}

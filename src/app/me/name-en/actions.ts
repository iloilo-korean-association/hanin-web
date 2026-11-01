"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appendAuditLog } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { zNameEn } from "@/lib/validators";

import { fail, textOf, zodFieldErrors, zodSummary, type FormResult } from "../../(public)/_shared";

/**
 * /me/name-en — 회원 본인의 영문 이름 등록 (관문, 2026-11-01).
 *
 * · 첫 줄 가드: 세션(requireMemberSession) 또는 매직링크 토큰(requireMember). 폼의 어떤 값도 신원에 쓰지 않는다 —
 *   update 의 where 는 가드가 돌려준 memberNo 뿐이다.
 * · **한 번만** 등록한다. 이미 값이 있으면 거부 — 이후 정정은 한글 성명처럼 임원(총무)이 한다
 *   (/officer/members/[회원번호]). 본인 '내 정보' 폼에도 영문 이름 칸은 두지 않는다.
 * · 저장값은 zNameEn 이 정규화한 대문자. 감사로그 INFO 1건.
 * · 성공하면 포털로 redirect — 토큰으로 왔으면 /me/<토큰>, 세션이면 /me.
 */

export type NameEnState = FormResult<{ done: true }>;

const schema = z.object({ nameEn: zNameEn });

export async function saveMyNameEnAction(_prev: NameEnState, formData: FormData): Promise<NameEnState> {
  const token = textOf(formData, "token");

  let me;
  try {
    me = token ? await requireMember(token.toUpperCase()) : await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) return fail(e.message, e.howToFix);
    throw e;
  }

  const parsed = schema.safeParse({ nameEn: textOf(formData, "nameEn") });
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const nameEn = parsed.data.nameEn;

  // 가드가 읽은 값(me.nameEn)은 요청 시점 스냅샷이다. 저장 직전에 다시 읽어 "한 번만" 을 지킨다.
  const before = await prisma.member.findUnique({
    where: { memberNo: me.memberNo },
    select: { nameEn: true },
  });
  if (!before) return fail("회원 정보를 찾을 수 없습니다.", "총무에게 문의해 주십시오.");
  if (before.nameEn !== "") {
    return fail(
      `영문 이름은 이미 등록되어 있습니다 (${before.nameEn}).`,
      "여권 표기와 다르면 총무에게 정정을 요청해 주십시오. 본인 화면에서는 바꿀 수 없습니다.",
    );
  }

  try {
    await prisma.$transaction(async (tx: Tx) => {
      await tx.member.update({
        where: { memberNo: me.memberNo }, // ★ 폼 값이 아니라 가드(세션·토큰)에서 나온 값
        data: { nameEn },
      });
      await appendAuditLog(tx, {
        actor: token ? `${me.memberNo} (본인 링크)` : `${me.memberNo} (본인)`,
        tableName: "Member",
        recordKey: me.memberNo,
        fieldName: "성명_영문",
        beforeValue: "",
        afterValue: nameEn,
        changeType: "EDIT",
        severity: "INFO",
        relatedKey: me.name,
        note: "회원 본인이 영문 이름 등록 (/me/name-en 관문)",
      });
    });
  } catch (e) {
    console.error("[me/name-en] 저장 실패", e);
    return fail(
      "영문 이름을 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  revalidatePath(ROUTES.meHome);
  revalidatePath(ROUTES.me(me.linkToken));
  revalidatePath(`${ROUTES.officer}/members`);
  revalidatePath(`${ROUTES.officer}/members/${me.memberNo}`);

  // redirect 는 예외로 동작한다 — try 밖에서 부른다(서버 액션 공통 규칙).
  redirect(token ? ROUTES.me(me.linkToken) : ROUTES.meHome);
}

"use server";

import { revalidatePath } from "next/cache";

import { setMemberSession } from "@/lib/auth";
import { prisma, type Tx } from "@/lib/db";
import { phoneLast4 } from "@/lib/domain";
import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { memberSelfUpdateSchema } from "@/lib/validators";

import { boolOf, fail, textOf, zodFieldErrors, zodSummary, type FormResult } from "../../(public)/_shared";

/**
 * /me/[token] — 회원 본인 정보 수정.
 *
 * ★ 회원을 특정하는 것은 **오직 링크토큰**이다.
 *   폼에 실려 온 회원번호는 쳐다보지도 않는다. M0001 은 순차라서 옆 사람 것을 넣어보는 데 3초면 된다.
 *   requireMember(token) 이 돌려준 memberNo 로만 update 한다.
 *
 * ★ 본인이 고칠 수 있는 것은 연락처·이메일·지역·동의 두 가지뿐이다(memberSelfUpdateSchema).
 *   회비등급·상태·회원번호는 폼에 보내도 무시된다 — 스키마에 칸이 없다.
 *
 * ★ 바뀐 값은 16_감사로그에 append 한다. "모든 데이터 변경은 감사로그에 기록된다" 는
 *   개인정보 동의서 제10항의 약속이다.
 */

export interface MeUpdateOk {
  /** 실제로 바뀐 항목의 한글 이름. 하나도 안 바뀌었으면 빈 배열 */
  changed: string[];
}

export type MeUpdateState = FormResult<MeUpdateOk>;

/** 화면에 보여줄 한글 라벨. 감사로그의 열이름도 이 값을 쓴다. */
const LABEL: Record<string, string> = {
  phone: "연락처",
  email: "이메일",
  region: "주소_지역",
  rosterConsent: "명부공개동의",
  notifyConsent: "알림수신동의",
};

export async function updateMyInfo(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const token = textOf(formData, "token");

  // 본인 특정은 두 경로뿐이다: 링크토큰(기존) 또는 세션 쿠키(P1 비밀번호 로그인).
  // 어느 쪽이든 폼에 실려 온 회원번호 따위는 쳐다보지 않는다.
  let me;
  try {
    me = token ? await requireMember(token.toUpperCase()) : await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) return fail(e.message, e.howToFix);
    throw e;
  }

  const parsed = memberSelfUpdateSchema.safeParse({
    phone: textOf(formData, "phone"),
    email: textOf(formData, "email"),
    region: textOf(formData, "region"),
    rosterConsent: boolOf(formData, "rosterConsent"),
    notifyConsent: boolOf(formData, "notifyConsent"),
  });
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const before = await prisma.member.findUnique({
    where: { memberNo: me.memberNo },
    select: { phone: true, email: true, region: true, rosterConsent: true, notifyConsent: true },
  });
  if (!before) {
    return fail("회원 정보를 찾을 수 없습니다.", "총무에게 문의해 주십시오.");
  }

  // 무엇이 실제로 바뀌었는지 먼저 계산한다. 안 바뀐 것을 감사로그에 남기면 로그가 쓰레기가 된다.
  const diffs: Array<{ field: string; before: string; after: string }> = [];
  const pushIf = (field: string, b: string, a: string) => {
    if (b !== a) diffs.push({ field, before: b, after: a });
  };
  pushIf("phone", before.phone, input.phone ?? before.phone);
  pushIf("email", before.email, input.email ?? before.email);
  pushIf("region", before.region, input.region ?? before.region);
  pushIf("rosterConsent", yn(before.rosterConsent), yn(input.rosterConsent ?? before.rosterConsent));
  pushIf("notifyConsent", yn(before.notifyConsent), yn(input.notifyConsent ?? before.notifyConsent));

  if (diffs.length === 0) {
    return { status: "ok", changed: [] };
  }

  try {
    await prisma.$transaction(async (tx: Tx) => {
      const newPhone = input.phone ?? before.phone;
      await tx.member.update({
        where: { memberNo: me.memberNo }, // ★ 폼 값이 아니라 토큰에서 나온 값
        data: {
          phone: newPhone,
          // 중복 검사 키다. 번호를 바꾸면 함께 다시 뽑아야 한다.
          phoneLast4: phoneLast4(newPhone),
          email: input.email ?? before.email,
          region: input.region ?? before.region,
          rosterConsent: input.rosterConsent ?? before.rosterConsent,
          notifyConsent: input.notifyConsent ?? before.notifyConsent,
        },
      });

      let seq = await lastAuditSeq(tx);
      for (const d of diffs) {
        seq += 1;
        await tx.auditLog.create({
          data: {
            logId: "AU-" + String(seq).padStart(6, "0"),
            actor: `${me.memberNo} (본인 링크)`,
            tableName: "Member",
            recordKey: me.memberNo,
            fieldName: LABEL[d.field] ?? d.field,
            beforeValue: d.before,
            afterValue: d.after,
            changeType: "EDIT",
            severity: "INFO",
            relatedKey: "",
            note: "회원 본인이 /me 화면에서 수정",
          },
        });
      }
    });
  } catch (e) {
    console.error("[me] 수정 실패", e);
    return fail(
      "정보를 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  revalidatePath(`/me/${me.linkToken}`);
  revalidatePath(ROUTES.meHome);

  return { status: "ok", changed: diffs.map((d) => LABEL[d.field] ?? d.field) };
}

/**
 * 매직링크로 들어온 회원에게 세션 쿠키를 심는다 (P1 — SessionBridge 가 1회 호출).
 *
 * ★ 첫 줄 가드: 토큰이 유효한 회원일 때만 세션이 나간다. 아무 문자열로 불러도
 *   requireMember 가 던진다. 실패는 조용히 무시된다 — 토큰 화면은 세션 없이도 완전하다.
 */
export async function adoptSessionFromToken(token: string): Promise<void> {
  let me;
  try {
    me = await requireMember(String(token ?? "").trim().toUpperCase());
  } catch {
    return; // 형식 오류·폐기 토큰 — 세션을 심지 않는다
  }
  await setMemberSession({ sub: me.memberNo, name: me.name });
}

function yn(v: boolean): string {
  return v ? "Y" : "N";
}

/** 16_감사로그는 append-only 라 최대값 + 1 로 충분하다. 트랜잭션 안에서 부른다. */
async function lastAuditSeq(tx: Tx): Promise<number> {
  const last = await tx.auditLog.findFirst({ orderBy: { logId: "desc" }, select: { logId: true } });
  if (!last) return 0;
  const n = Number(last.logId.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { SIGNUP_STATUSES, type SignupStatus } from "@/lib/validators";

import type { ActionState } from "../../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../../_lib/server-utils";

/**
 * 행사 참가 신청 상태 변경 (접수 ↔ 확정 ↔ 취소).
 *
 * ★ 신청 행을 지우는 경로는 만들지 않는다. 참가비 거래(05_거래)가 이 행을 참조한다 —
 *   지우면 그 돈이 무엇이었는지 설명할 수 없게 된다. 취소는 상태 '취소' 로 남긴다.
 * ★ 취소를 접수·확정으로 되살릴 때는 **정원을 다시 검사**한다.
 *   공개 신청 화면(/events)의 정원 검사가 "취소 제외 totalPeople 합" 기준이므로
 *   여기서 같은 규칙을 쓰지 않으면 정원 초과가 임원 화면으로 뚫린다.
 */
export async function setSignupStatusAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["행사관리"],
      write: true,
      screen: "행사 참가자 명단",
    });

    const signupId = fdStr(fd, "signupId").trim();
    const nextRaw = fdStr(fd, "nextStatus").trim();
    if (!SIGNUP_STATUSES.includes(nextRaw as SignupStatus)) {
      return fail("허용되지 않는 상태입니다. (접수/확정/취소만 가능합니다)");
    }
    const next = nextRaw as SignupStatus;

    const signup = await prisma.eventSignup.findUnique({
      where: { signupId },
      include: { event: { select: { eventId: true, title: true, capacity: true } } },
    });
    if (!signup) return fail(`신청 ${signupId} 를 찾을 수 없습니다.`);
    if (signup.status === next) return ok("바뀐 내용이 없습니다.");

    type TxResult = { kind: "ok" } | { kind: "fail"; message: string; howToFix: string | null };

    const result: TxResult = await prisma.$transaction(async (tx) => {
      // 취소 → 접수/확정 되살리기: 정원 재검사 (취소 제외 totalPeople 합 기준)
      if (signup.status === "취소" && next !== "취소" && signup.event.capacity > 0) {
        const agg = await tx.eventSignup.aggregate({
          where: { eventId: signup.eventId, status: { not: "취소" } },
          _sum: { totalPeople: true },
        });
        const taken = agg._sum.totalPeople ?? 0;
        if (taken + signup.totalPeople > signup.event.capacity) {
          return {
            kind: "fail",
            message: `정원이 부족해 되살릴 수 없습니다. 현재 ${taken}명 / 정원 ${signup.event.capacity}명 · 이 신청 ${signup.totalPeople}명.`,
            howToFix: "정원을 늘리시거나 다른 신청을 정리한 뒤 다시 시도해 주십시오.",
          };
        }
      }

      await tx.eventSignup.update({ where: { signupId }, data: { status: next } });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "EventSignup",
        recordKey: signupId,
        fieldName: "status",
        beforeValue: signup.status,
        afterValue: next,
        changeType: "EDIT",
        // 신청 취소는 사람(과 이미 낸 참가비)에 영향이 간다 → 경고로 남긴다
        severity: next === "취소" ? "WARN" : "INFO",
        relatedKey: signup.eventId,
        note: `행사신청 상태 변경 by ${me.name}(${me.role}) · ${signup.event.title} · ${signup.totalPeople}명${signup.paid ? " · 참가비 납부됨" : ""}`,
      });
      return { kind: "ok" };
    });

    if (result.kind === "fail") return fail(result.message, result.howToFix);

    revalidatePath(`/officer/events/${signup.eventId}`);
    revalidatePath("/officer/events");
    revalidatePath("/events"); // 공개 화면의 "남은 자리" 는 취소 제외 합계로 계산된다

    if (next === "취소" && signup.paid) {
      // 참가비를 이미 낸 신청이다. 환불 여부는 화면이 대신 결정하지 않는다 — 사람에게 알린다.
      return ok(`${signupId} 을(를) 취소했습니다.`, {
        howToFix:
          "이 신청은 참가비가 이미 납부되어 있습니다. 환불이 필요하면 지출 요청으로 처리하고 영수증번호를 남기십시오.",
      });
    }
    return ok(
      next === "취소"
        ? `${signupId} 을(를) 취소했습니다.`
        : `${signupId} 상태를 "${next}" 로 바꿨습니다.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

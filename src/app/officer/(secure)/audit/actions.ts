"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";

/**
 * 감사 확인 도장.
 *
 * ── 왜 이 액션이 사전 승인을 대신하는가 ────────────────────────────────
 * 결재 절차를 없앤 대가로, 총무 한 사람이 혼자서 큰 금액을 적을 수 있게 됐다.
 * 그것을 막는 것은 이제 "적기 전의 버튼" 이 아니라 "적은 뒤에 누가 봤다는 기록" 이다.
 * 그 기록이 여기서 남는다.
 *
 * ── 이 액션이 **하지 않는** 것 ─────────────────────────────────────────
 * 금액·과목·상대방·상태·계좌를 건드리지 않는다. reviewedBy / reviewedAt 두 칸만 쓴다.
 * 감사가 장부를 고칠 수 있으면 감사가 아니기 때문이다.
 * 그래서 requireOfficer 에 allowAuditorAttestation 을 켤 수 있다 —
 * 이 옵션을 다른 액션에 복사해 붙이면 그 전제가 깨진다.
 *
 * ── 도장을 스스로에게 찍지 못하게 ───────────────────────────────────────
 * 자기가 적은 거래를 자기가 확인하면 2인 원칙이 형식만 남는다. 서버가 막는다.
 */
export async function reviewTransactionAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["확인권"],
      write: true,
      allowAuditorAttestation: true,
      screen: "감사 확인",
    });

    const receiptNo = fdStr(fd, "receiptNo").trim();
    if (!receiptNo) return fail("어느 거래인지 지정되지 않았습니다.");
    const note = fdStr(fd, "note").trim().slice(0, 200);

    const row = await prisma.transaction.findUnique({ where: { receiptNo } });
    if (!row) return fail(`거래 ${receiptNo} 를 찾을 수 없습니다.`);

    if (row.enteredBy.trim().toLowerCase() === me.email.trim().toLowerCase()) {
      return fail(
        "본인이 적은 거래는 본인이 확인할 수 없습니다.",
        "혼자 적고 혼자 확인한 것은 확인이 아닙니다. 다른 임원에게 요청하십시오.",
      );
    }
    if (row.status === "VOIDED") {
      return fail("무효 처리된 거래입니다. 확인할 대상이 아닙니다.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { receiptNo },
        data: { reviewedBy: me.email, reviewedAt: new Date() },
      });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: receiptNo,
        fieldName: "reviewedBy",
        beforeValue: row.reviewedBy || "(미확인)",
        afterValue: me.email,
        changeType: "EDIT",
        severity: "INFO",
        note: `감사 확인 (${me.officerId} ${me.role})` + (note ? ` — ${note}` : ""),
      });
    });

    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(`${ROUTES.officer}/book`);
    revalidatePath(ROUTES.ledger);
    return ok(`${receiptNo} 를 확인했습니다.`);
  } catch (e) {
    return toActionError(e);
  }
}

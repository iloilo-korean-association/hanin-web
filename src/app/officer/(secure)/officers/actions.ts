"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { PERMISSIONS, type Permission } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";

/**
 * 임원 권한 위임.
 *
 * ★ 이 화면이 시스템에서 가장 위험한 화면이다. 여기서 권한을 주면 돈이 움직인다.
 *   그래서 세 가지를 강제한다:
 *
 *   ① **본인 권한은 못 고친다.** 스스로 승인한도를 올리거나 임원관리 권한을 붙이는 것을 막는다.
 *      이걸 허용하면 "권한 위임" 이 아니라 "무한 자기증식" 이 된다.
 *   ② **마지막 임원관리자를 없앨 수 없다.** 아무도 권한을 못 주는 상태가 되면 복구 불가다.
 *   ③ **모든 변경은 감사로그에 CRITICAL 로 남는다.** 누가 누구에게 무엇을 줬는지 추적된다.
 */

export async function savePermissionsAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["임원관리"],
      write: true,
      screen: "임원 권한 관리",
    });

    const officerId = fdStr(fd, "officerId").trim();
    if (!officerId) return fail("대상 임원이 지정되지 않았습니다.");

    const target = await prisma.officer.findUnique({ where: { officerId } });
    if (!target) return fail(`임원 ${officerId} 를 찾을 수 없습니다.`);

    // ① 본인 금지
    if (target.email.toLowerCase() === me.email.toLowerCase()) {
      return fail(
        "본인의 권한은 스스로 바꿀 수 없습니다.",
        "다른 임원관리 권한자에게 요청하십시오. 스스로 권한을 올릴 수 있으면 위임이 아니라 무제한이 됩니다.",
      );
    }

    // 체크된 권한 수집
    const next: Permission[] = PERMISSIONS.filter((p) => fdStr(fd, `perm_${p}`) === "on");

    const limitRaw = fdStr(fd, "approvalLimit").trim().replace(/[,\s]/g, "");
    const approvalLimit = limitRaw === "" ? 0 : Math.trunc(Number(limitRaw));
    if (!Number.isFinite(approvalLimit) || approvalLimit < 0) {
      return fail("승인한도는 0 이상의 숫자로 적어 주십시오.");
    }
    // 승인권이 없는데 한도만 있는 것은 의미가 없다. 헷갈리게 두지 않는다.
    if (!next.includes("승인권") && approvalLimit > 0) {
      return fail(
        "승인권이 없는데 승인한도가 설정돼 있습니다.",
        "승인권을 함께 주시거나 한도를 0 으로 두십시오.",
      );
    }

    const status = fdStr(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";

    // ② 마지막 임원관리자 보호
    const losingAdmin =
      target.permissions.includes("임원관리") &&
      (!next.includes("임원관리") || status === "INACTIVE");
    if (losingAdmin) {
      const others = await prisma.officer.count({
        where: {
          status: "ACTIVE",
          permissions: { contains: "임원관리" },
          officerId: { not: officerId },
        },
      });
      if (others === 0) {
        return fail(
          "마지막 남은 임원관리 권한자입니다. 권한을 뺄 수 없습니다.",
          "먼저 다른 임원에게 임원관리 권한을 준 뒤에 이 계정에서 빼십시오. 아무도 권한이 없으면 되돌릴 방법이 없습니다.",
        );
      }
    }

    const before = `${target.permissions || "(없음)"} / 한도 ${target.approvalLimit} / ${target.status}`;
    const after = `${next.join(",") || "(없음)"} / 한도 ${approvalLimit} / ${status}`;
    if (before === after) return ok("바뀐 내용이 없습니다.");

    await prisma.$transaction(async (tx) => {
      await tx.officer.update({
        where: { officerId },
        data: { permissions: next.join(","), approvalLimit, status },
      });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Officer",
        recordKey: officerId,
        fieldName: "permissions",
        beforeValue: before,
        afterValue: after,
        changeType: "EDIT",
        // ③ 권한 변경은 언제나 CRITICAL. 돈이 움직이는 문의 열쇠를 바꾼 것이다.
        severity: "CRITICAL",
        relatedKey: target.email,
        note: `권한 변경: ${me.name}(${me.role}) → ${target.name}(${target.role})`,
      });
    });

    revalidatePath("/officer/officers");
    revalidatePath("/about");
    return ok(
      `${target.name}(${target.role}) 권한을 바꿨습니다. → ${next.join(", ") || "권한 없음"}`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

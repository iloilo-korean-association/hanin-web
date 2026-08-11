/**
 * 16_감사로그 append — 유일한 쓰기 진입점.
 *
 * 원래 officer/_lib/server-utils.ts 에 있던 것을 lib 로 내렸다(P1).
 * 이유: 회원 로그인 잠금·비밀번호 변경도 감사로그를 남겨야 하는데,
 * lib/auth.ts 가 officer/_lib 를 import 하면 guard → auth → server-utils → guard
 * 순환이 생긴다. 이 파일은 db 타입 말고는 아무것도 모른다.
 *
 * ★ append-only. update·delete 를 만들지 마라.
 */
import "server-only";

import type { Db } from "@/lib/db";

export type AuditInput = {
  actor: string;
  tableName: string;
  recordKey?: string;
  fieldName?: string;
  beforeValue?: string;
  afterValue?: string;
  changeType: "EDIT" | "INSERT" | "DELETE_ATTEMPT" | "SCRIPT" | "OTHER";
  severity?: "INFO" | "WARN" | "CRITICAL";
  relatedKey?: string;
  note?: string;
};

/**
 * 16_감사로그에 한 줄 append. **update·delete 는 하지 않는다.**
 *
 * 번호는 최대값 + 1 로 충분하다 — append-only 라 중간에 빈 자리가 생기지 않고,
 * 쓰기 경로는 전부 $transaction 안이라 같은 번호가 두 번 나오지 않는다.
 */
export async function appendAuditLog(db: Db, input: AuditInput): Promise<string> {
  const last = await db.auditLog.findFirst({ orderBy: { logId: "desc" }, select: { logId: true } });
  const n = last ? Number(last.logId.replace(/\D/g, "")) + 1 : 1;
  const logId = "AU-" + String(n).padStart(6, "0");
  await db.auditLog.create({
    data: {
      logId,
      actor: input.actor,
      tableName: input.tableName,
      recordKey: input.recordKey ?? "",
      fieldName: input.fieldName ?? "",
      beforeValue: trunc(input.beforeValue ?? "", 500),
      afterValue: trunc(input.afterValue ?? "", 500),
      changeType: input.changeType,
      severity: input.severity ?? "INFO",
      relatedKey: input.relatedKey ?? "",
      note: trunc(input.note ?? "", 500),
    },
  });
  return logId;
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

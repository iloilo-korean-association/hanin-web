/**
 * 임원 서버 액션 공용 유틸 — FormData 읽기 · 에러 매핑 · 감사로그 · 채번.
 *
 * ★ server-only. 클라이언트에서 import 하면 빌드가 깨진다(그게 의도다).
 */
import "server-only";

import { ZodError } from "zod";

import type { Db } from "@/lib/db";
import { InvariantError } from "@/lib/domain";
import { isGuardError, type OfficerContext } from "@/lib/guard";
import type { OfficerRow } from "@/lib/domain/conflict";
import { firstIssue } from "@/lib/validators";

import type { ActionState } from "./action-state";

/* ───────────────────────── FormData ───────────────────────── */

export function fdStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** 체크박스. 안 걸린 체크박스는 FormData 에 아예 없다. */
export function fdBool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

/* ───────────────────────── 결과 ───────────────────────── */

export function ok(message: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: true, message, howToFix: null, at: Date.now(), ...extra };
}

export function fail(message: string, howToFix: string | null = null): ActionState {
  return { ok: false, message, howToFix, at: Date.now() };
}

/**
 * 예외를 화면에 보여줄 문장으로.
 *
 * ★ next/navigation 의 redirect()·notFound() 는 예외로 동작한다.
 *   그래서 이 프로젝트의 서버 액션은 try 블록 안에서 redirect 를 부르지 않는다.
 *   (부르면 여기서 잡혀 "알 수 없는 오류" 로 삼켜진다)
 */
export function toActionError(e: unknown): ActionState {
  if (isGuardError(e)) return fail(e.message, e.howToFix);
  if (e instanceof InvariantError) return fail(`[${e.invariant}] ${e.message}`);
  if (e instanceof ZodError) return fail(firstIssue(e));
  if (e instanceof Error) return fail(e.message);
  return fail("알 수 없는 오류가 발생했습니다. 화면을 새로고침한 뒤 다시 시도해 주십시오.");
}

/* ───────────────────────── 임원 행 변환 ───────────────────────── */

/**
 * OfficerContext(가드가 준 것) → OfficerRow(도메인 판정 함수가 받는 것).
 *
 * permissions 가 배열 ↔ 쉼표 문자열로 형태가 다르다. 두 곳에서 각자 변환하면
 * 반드시 어긋나므로 여기 한 곳에서만 바꾼다.
 * status 를 'ACTIVE' 로 고정해도 되는 이유: requireOfficer 가 이미 ACTIVE 와 임기를 확인했다.
 */
export function toOfficerRow(me: OfficerContext): OfficerRow {
  return {
    officerId: me.officerId,
    memberNo: me.memberNo,
    name: me.name,
    role: me.role,
    email: me.email,
    approvalLimit: me.approvalLimit,
    permissions: me.permissions.join(","),
    status: "ACTIVE",
  };
}

/* ───────────────────────── 감사로그 (append-only) ───────────────────────── */

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

/* ───────────────────────── 승인ID 채번 ───────────────────────── */

/**
 * AP-2026-0001 다음 번호. **반드시 $transaction 안에서** 부른다.
 *
 * 영수증번호(I2)와 달리 승인번호에는 결번 금지 불변식이 없다 —
 * 그래서 전용 카운터 테이블 없이 "그 해 최대값 + 1" 로 둔다.
 * 4자리 0 패딩이라 문자열 내림차순 = 숫자 내림차순이 성립한다(9999건까지).
 */
export async function nextApprovalId(db: Db, fiscalYear: number): Promise<string> {
  const prefix = `AP-${fiscalYear}-`;
  const last = await db.approval.findFirst({
    where: { approvalId: { startsWith: prefix } },
    orderBy: { approvalId: "desc" },
    select: { approvalId: true },
  });
  const n = last ? Number(last.approvalId.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(4, "0");
}

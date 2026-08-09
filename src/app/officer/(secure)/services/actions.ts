"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";
import { firstIssue, serviceInputSchema } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import {
  appendAuditLog,
  fail,
  fdBool,
  fdStr,
  ok,
  toActionError,
} from "../../_lib/server-utils";

/**
 * 한인회 서비스 관리.
 *
 * ★ 물리 삭제를 만들지 않는다(다른 관리 화면과 같은 규칙).
 *   내리려면 isPublic=false(공개 내리기) 또는 status='중단' 을 쓴다.
 * ★ 이 내용은 공개 페이지(/services)에 그대로 나간다 — 서버가 zod 로 다시 검증한다.
 */

async function nextServiceId(): Promise<string> {
  const last = await prisma.service.findFirst({
    orderBy: { serviceId: "desc" },
    select: { serviceId: true },
  });
  const n = last ? Number(last.serviceId.replace(/\D/g, "")) + 1 : 1;
  return "SV" + String(n).padStart(2, "0");
}

export async function saveServiceAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["서비스관리"],
      write: true,
      screen: "서비스 관리",
    });

    const serviceId = fdStr(fd, "serviceId").trim();

    const parsed = serviceInputSchema.safeParse({
      title: fdStr(fd, "title"),
      category: fdStr(fd, "category"),
      description: fdStr(fd, "description"),
      howToApply: fdStr(fd, "howToApply"),
      contactName: fdStr(fd, "contactName"),
      contactPhone: fdStr(fd, "contactPhone"),
      fee: fdStr(fd, "fee") || "0",
      status: fdStr(fd, "status"),
      isPublic: fdBool(fd, "isPublic"),
      sortOrder: fdStr(fd, "sortOrder") || "0",
      note: fdStr(fd, "note"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const data = parsed.data;

    const isNew = !serviceId;
    const id = isNew ? await nextServiceId() : serviceId;
    const before = isNew ? null : await prisma.service.findUnique({ where: { serviceId: id } });
    if (!isNew && !before) return fail(`서비스 ${id} 를 찾을 수 없습니다.`);

    await prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.service.create({ data: { serviceId: id, ...data } });
      } else {
        await tx.service.update({ where: { serviceId: id }, data });
      }
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Service",
        recordKey: id,
        changeType: isNew ? "INSERT" : "EDIT",
        severity: "INFO",
        beforeValue: before
          ? `${before.title} / ${before.category} / ${before.status} / 공개 ${before.isPublic ? "Y" : "N"}`
          : "",
        afterValue: `${data.title} / ${data.category} / ${data.status} / 공개 ${data.isPublic ? "Y" : "N"}`,
        note: `서비스 ${isNew ? "등록" : "수정"} by ${me.name}(${me.role})`,
      });
    });

    revalidatePath("/services");
    revalidatePath("/officer/services");
    return ok(`${id} ${data.title} — ${isNew ? "등록했습니다" : "수정했습니다"}.`);
  } catch (e) {
    return toActionError(e);
  }
}

/** 공개 내리기 ↔ 다시 올리기. 삭제 대신 이것을 쓴다. */
export async function toggleServiceAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["서비스관리"],
      write: true,
      screen: "서비스 관리",
    });
    const id = fdStr(fd, "serviceId").trim();
    const s = await prisma.service.findUnique({ where: { serviceId: id } });
    if (!s) return fail(`서비스 ${id} 를 찾을 수 없습니다.`);

    const next = !s.isPublic;
    await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { serviceId: id }, data: { isPublic: next } });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Service",
        recordKey: id,
        fieldName: "isPublic",
        beforeValue: s.isPublic ? "Y" : "N",
        afterValue: next ? "Y" : "N",
        changeType: "EDIT",
        severity: "INFO",
        note: `서비스 ${next ? "공개" : "비공개"} by ${me.name}(${me.role})`,
      });
    });

    revalidatePath("/services");
    revalidatePath("/officer/services");
    return ok(
      next
        ? `${s.title} 을(를) 다시 공개했습니다. 상태가 "운영중" 이어야 공개 페이지에 뜹니다.`
        : `${s.title} 을(를) 공개 페이지에서 내렸습니다. 기록은 그대로 남습니다.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

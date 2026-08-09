"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOfficer } from "@/lib/guard";

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
 * 행사 관리.
 *
 * 삭제 대신 상태를 '취소' 로 바꾼다 — 이미 신청한 회원이 있고, 참가비를 낸 거래가
 * 이 행사를 참조하고 있다. 행을 지우면 그 돈이 무엇이었는지 설명할 수 없게 된다.
 */

const STATUSES = ["준비", "접수중", "마감", "완료", "취소"] as const;
const KINDS = ["정기총회", "체육대회", "명절", "봉사", "기타"] as const;

/** 'yyyy-MM-dd' 또는 'yyyy-MM-ddTHH:mm' 을 마닐라 기준 Date 로. */
function toDate(s: string, endOfDay = false): Date | null {
  const t = s.trim();
  if (!t) return null;
  const iso = t.includes("T") ? `${t}:00+08:00` : `${t}T${endOfDay ? "23:59:00" : "00:00:00"}+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function nextEventId(fy: number): Promise<string> {
  const prefix = `EV-${fy}-`;
  const last = await prisma.event.findFirst({
    where: { eventId: { startsWith: prefix } },
    orderBy: { eventId: "desc" },
    select: { eventId: true },
  });
  const n = last ? Number(last.eventId.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(2, "0");
}

export async function saveEventAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["행사관리"],
      write: true,
      screen: "행사 관리",
    });

    const eventId = fdStr(fd, "eventId").trim();
    const title = fdStr(fd, "title").trim().slice(0, 100);
    if (!title) return fail("행사명을 입력해 주십시오.");

    const startsAt = toDate(fdStr(fd, "startsAt"));
    if (!startsAt) return fail("시작일을 입력해 주십시오.");
    const endsAt = toDate(fdStr(fd, "endsAt") || fdStr(fd, "startsAt"), true);
    if (!endsAt) return fail("종료일이 올바르지 않습니다.");
    if (endsAt < startsAt) return fail("종료일이 시작일보다 빠릅니다.");

    const num = (k: string) => {
      const v = fdStr(fd, k).trim();
      if (!v) return 0;
      const n = Math.trunc(Number(v.replace(/[,\s]/g, "")));
      return Number.isFinite(n) && n >= 0 ? n : -1;
    };
    const capacity = num("capacity");
    const fee = num("fee");
    const budget = num("budget");
    if (capacity < 0 || fee < 0 || budget < 0) {
      return fail("정원·참가비·예산은 0 이상의 숫자만 적어 주십시오. 쉼표는 괜찮습니다.");
    }

    const status = STATUSES.includes(fdStr(fd, "status") as never)
      ? fdStr(fd, "status")
      : "준비";
    const deadline = fdStr(fd, "signupDeadline").trim() || null;

    // 접수중인데 마감일이 지났으면 신청 화면에서 혼란이 생긴다. 미리 잡아 준다.
    if (status === "접수중" && deadline) {
      const dl = toDate(deadline, true);
      if (dl && dl < new Date()) {
        return fail(
          `신청 마감일(${deadline})이 이미 지났는데 상태가 "접수중" 입니다.`,
          '마감일을 미루시거나 상태를 "마감" 으로 바꿔 주십시오.',
        );
      }
    }

    const data = {
      title,
      kind: KINDS.includes(fdStr(fd, "kind") as never) ? fdStr(fd, "kind") : "기타",
      startsAt,
      endsAt,
      place: fdStr(fd, "place").trim().slice(0, 120),
      capacity,
      fee,
      currency: "PHP",
      budget,
      ownerEmail: fdStr(fd, "ownerEmail").trim().slice(0, 120),
      signupDeadline: deadline,
      status,
      isPublic: fdBool(fd, "isPublic"),
      note: fdStr(fd, "note").trim().slice(0, 300),
    };

    const isNew = !eventId;
    const id = isNew ? await nextEventId(startsAt.getFullYear()) : eventId;
    const before = isNew ? null : await prisma.event.findUnique({ where: { eventId: id } });
    if (!isNew && !before) return fail(`행사 ${id} 를 찾을 수 없습니다.`);

    // 정원을 이미 신청한 인원보다 적게 줄이면 초과 신청자가 생긴다.
    if (!isNew && capacity > 0) {
      const signed = await prisma.eventSignup.count({ where: { eventId: id } });
      if (signed > capacity) {
        return fail(
          `이미 ${signed}명이 신청했는데 정원을 ${capacity}명으로 줄이려 합니다.`,
          "정원을 신청 인원 이상으로 두시거나, 먼저 신청을 정리해 주십시오.",
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.event.create({ data: { eventId: id, settlementReceiptNos: "", ...data } });
      } else {
        await tx.event.update({ where: { eventId: id }, data });
      }
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Event",
        recordKey: id,
        changeType: isNew ? "INSERT" : "EDIT",
        severity: "INFO",
        beforeValue: before ? `${before.title} / ${before.status} / 정원 ${before.capacity}` : "",
        afterValue: `${title} / ${status} / 정원 ${capacity}`,
        note: `행사 ${isNew ? "등록" : "수정"} by ${me.name}(${me.role})`,
      });
    });

    revalidatePath("/events");
    revalidatePath("/ledger");
    revalidatePath("/officer/events");
    return ok(`${id} ${title} — ${isNew ? "등록했습니다" : "수정했습니다"}.`);
  } catch (e) {
    return toActionError(e);
  }
}

/** 취소 ↔ 준비 토글. 삭제 대신 쓴다. */
export async function toggleEventAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["행사관리"],
      write: true,
      screen: "행사 관리",
    });
    const id = fdStr(fd, "eventId").trim();
    const ev = await prisma.event.findUnique({ where: { eventId: id } });
    if (!ev) return fail(`행사 ${id} 를 찾을 수 없습니다.`);

    if (ev.status === "완료") {
      return fail(
        "완료된 행사는 취소할 수 없습니다.",
        "이미 정산이 끝난 행사입니다. 정정이 필요하면 감사와 상의해 별도 기록을 남기십시오.",
      );
    }

    const next = ev.status === "취소" ? "준비" : "취소";
    const signed = await prisma.eventSignup.count({ where: { eventId: id } });

    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { eventId: id }, data: { status: next } });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Event",
        recordKey: id,
        fieldName: "status",
        beforeValue: ev.status,
        afterValue: next,
        changeType: "EDIT",
        // 신청자가 있는 행사를 취소하는 것은 사람에게 영향이 간다 → 경고로 남긴다
        severity: next === "취소" && signed > 0 ? "WARN" : "INFO",
        note: `행사 ${next} by ${me.name}(${me.role}) · 신청 ${signed}명`,
      });
    });

    revalidatePath("/events");
    revalidatePath("/officer/events");
    return ok(
      next === "취소"
        ? `${ev.title} 을(를) 취소했습니다.${signed > 0 ? ` 신청자 ${signed}명에게 직접 알려 주십시오 — 자동 통보는 아직 없습니다.` : ""}`
        : `${ev.title} 을(를) 되살렸습니다. 상태는 "준비" 입니다.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

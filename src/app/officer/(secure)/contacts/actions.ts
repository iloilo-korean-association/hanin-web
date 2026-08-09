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
 * 긴급 연락처 관리.
 *
 * ★ 이 표는 사람 목숨과 직결된다. 원본 코드 파일의 원칙을 그대로 강제한다:
 *     "번호를 지어내지 않는다. 긴급 상황에서 틀린 번호는 사람을 죽인다."
 *
 * 그래서 다른 관리 화면과 달리 검증을 세게 건다:
 *   ① 번호를 적었으면 검증등급이 pending 이면 안 된다 (어디서 확인했는지 말하라)
 *   ② pending 이 아니면 출처 URL 과 확인 날짜가 **필수**
 *   ③ 번호가 없으면 무조건 pending 으로 강등 → 화면에 "확인 중" 으로 뜬다
 *   ④ 117 은 2016년 폐기됐다. 입력을 거부한다.
 */

const GROUPS = [
  { id: "national", title: "전국 긴급" },
  { id: "consular", title: "공관 (대사관·분관)" },
  { id: "police", title: "경찰·소방" },
  { id: "rescue", title: "구조·재난·해경" },
  { id: "hospital", title: "병원" },
  { id: "civil", title: "행정·생활" },
] as const;

const GRADES = ["verified", "secondary", "pending"] as const;

async function nextContactId(): Promise<string> {
  const last = await prisma.emergencyContact.findFirst({
    orderBy: { contactId: "desc" },
    select: { contactId: true },
  });
  const n = last ? Number(last.contactId.replace(/\D/g, "")) + 1 : 1;
  return "EC-" + String(n).padStart(4, "0");
}

/** 번호 목록 정리. 표기는 사람이 읽는 그대로 두되 빈 항목만 걷어낸다. */
function cleanNumbers(raw: string): string[] {
  return raw
    .split(/[|\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveContactAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["연락처관리"],
      write: true,
      screen: "긴급 연락처 관리",
    });

    const contactId = fdStr(fd, "contactId").trim();
    const name = fdStr(fd, "name").trim().slice(0, 100);
    if (!name) return fail("기관·창구 이름을 입력해 주십시오.");

    const groupId = GROUPS.find((g) => g.id === fdStr(fd, "groupId"))?.id ?? "civil";
    const groupTitle = GROUPS.find((g) => g.id === groupId)!.title;

    const numbers = cleanNumbers(fdStr(fd, "numbers"));

    // ④ 폐기된 번호 차단
    const dead = numbers.find((n) => n.replace(/\D/g, "") === "117");
    if (dead) {
      return fail(
        "117 은 2016년 8월 폐기되어 911 로 통합됐습니다.",
        "필리핀 전국 긴급번호는 911 입니다. 117 을 안내하면 연결되지 않습니다.",
      );
    }

    let grade = GRADES.includes(fdStr(fd, "grade") as never) ? fdStr(fd, "grade") : "pending";
    const sourceUrl = fdStr(fd, "sourceUrl").trim().slice(0, 300);
    const verifiedOn = fdStr(fd, "verifiedOn").trim();

    // ③ 번호가 없으면 확인할 것이 없다 → 무조건 pending
    if (numbers.length === 0) grade = "pending";

    // ①② 번호가 있는데 "확인됐다" 고 주장하려면 근거를 대야 한다
    if (numbers.length > 0 && grade !== "pending") {
      if (!sourceUrl) {
        return fail(
          "검증등급을 '확인됨' 으로 두려면 출처 URL 이 필요합니다.",
          "어디서 확인했는지 적어 주십시오(기관 공식 홈페이지 등). 아직 확인 전이면 검증등급을 '확인 중' 으로 두십시오 — 화면에는 번호 대신 '확인 중' 이 표시됩니다.",
        );
      }
      if (!/^https?:\/\//i.test(sourceUrl)) {
        return fail("출처는 http:// 또는 https:// 로 시작하는 주소여야 합니다.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) {
        return fail(
          "마지막 확인 날짜를 입력해 주십시오.",
          "언제 확인한 번호인지 모르면 6개월 뒤에 아무도 신뢰할 수 없습니다.",
        );
      }
    }

    const data = {
      groupId,
      groupTitle,
      sortOrder: Math.max(0, Math.trunc(Number(fdStr(fd, "sortOrder") || "0")) || 0),
      name,
      nameEn: fdStr(fd, "nameEn").trim().slice(0, 120),
      numbers: numbers.join("|"),
      note: fdStr(fd, "note").trim().slice(0, 300),
      hours: fdStr(fd, "hours").trim().slice(0, 100),
      email: fdStr(fd, "email").trim().slice(0, 120),
      address: fdStr(fd, "address").trim().slice(0, 200),
      emphasis: fdBool(fd, "emphasis"),
      grade,
      sourceUrl: grade === "pending" ? sourceUrl : sourceUrl,
      verifiedOn: grade === "pending" ? verifiedOn : verifiedOn,
      isActive: fdStr(fd, "isActive") !== "false",
      updatedBy: me.email,
    };

    const isNew = !contactId;
    const id = isNew ? await nextContactId() : contactId;
    const before = isNew
      ? null
      : await prisma.emergencyContact.findUnique({ where: { contactId: id } });
    if (!isNew && !before) return fail(`연락처 ${id} 를 찾을 수 없습니다.`);

    await prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.emergencyContact.create({ data: { contactId: id, ...data } });
      } else {
        await tx.emergencyContact.update({ where: { contactId: id }, data });
      }
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "EmergencyContact",
        recordKey: id,
        changeType: isNew ? "INSERT" : "EDIT",
        // 긴급 연락처 변경은 전부 WARN 이상으로 남긴다. 나중에 "누가 언제 번호를 바꿨나" 를
        // 반드시 추적할 수 있어야 한다.
        severity: "WARN",
        beforeValue: before ? `${before.name} / ${before.numbers} / ${before.grade}` : "",
        afterValue: `${name} / ${data.numbers} / ${grade}`,
        note: `긴급연락처 ${isNew ? "등록" : "수정"} by ${me.name}(${me.role})${data.sourceUrl ? ` · 출처 ${data.sourceUrl}` : ""}`,
      });
    });

    revalidatePath("/sos");
    revalidatePath("/");
    revalidatePath("/officer/contacts");

    return ok(
      `${name} — ${isNew ? "등록했습니다" : "수정했습니다"}.` +
        (grade === "pending"
          ? " 검증등급이 '확인 중' 이라 화면에는 번호가 표시되지 않습니다."
          : ""),
    );
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleContactAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["연락처관리"],
      write: true,
      screen: "긴급 연락처 관리",
    });
    const id = fdStr(fd, "contactId").trim();
    const c = await prisma.emergencyContact.findUnique({ where: { contactId: id } });
    if (!c) return fail(`연락처 ${id} 를 찾을 수 없습니다.`);

    // 전국 긴급번호(911)는 내릴 수 없다. 이게 사라지면 긴급 화면의 의미가 없다.
    if (c.groupId === "national") {
      return fail(
        "전국 긴급번호는 목록에서 내릴 수 없습니다.",
        "911 은 이 화면의 존재 이유입니다. 내용을 고치실 수는 있습니다.",
      );
    }

    const next = !c.isActive;
    await prisma.$transaction(async (tx) => {
      await tx.emergencyContact.update({
        where: { contactId: id },
        data: { isActive: next, updatedBy: me.email },
      });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "EmergencyContact",
        recordKey: id,
        fieldName: "isActive",
        beforeValue: String(c.isActive),
        afterValue: String(next),
        changeType: "EDIT",
        severity: "WARN",
        note: `긴급연락처 ${next ? "복구" : "내림"} by ${me.name}(${me.role}) — ${c.name}`,
      });
    });

    revalidatePath("/sos");
    revalidatePath("/officer/contacts");
    return ok(
      next ? `${c.name} 을(를) 다시 올렸습니다.` : `${c.name} 을(를) 목록에서 내렸습니다.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

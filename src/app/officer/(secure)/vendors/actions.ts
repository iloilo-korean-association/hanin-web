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
 * 업소 관리.
 *
 * ★ 물리 삭제를 만들지 않는다. 과거 지출이 이 업소를 상대방으로 참조하고 있어서,
 *   행을 지우면 공개 장부에서 "누구에게 지급했는지" 가 사라진다. 불변식 I1 과 같은 이유다.
 *   대신 status='INACTIVE' 로 바꿔 목록에서 뺀다.
 */

const MAX = { name: 80, aliases: 300, owner: 60, industry: 40, phone: 40, addr: 120, note: 300 };

async function nextVendorId(): Promise<string> {
  const last = await prisma.vendor.findFirst({
    orderBy: { vendorId: "desc" },
    select: { vendorId: true },
  });
  const n = last ? Number(last.vendorId.replace(/\D/g, "")) + 1 : 1;
  return "VD" + String(n).padStart(3, "0");
}

export async function saveVendorAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["업소관리"],
      write: true,
      screen: "업소 관리",
    });

    const vendorId = fdStr(fd, "vendorId").trim();
    const name = fdStr(fd, "name").trim().slice(0, MAX.name);
    if (!name) return fail("업소명을 입력해 주십시오.");

    const relatedParty = fdBool(fd, "relatedParty");
    const pctRaw = fdStr(fd, "ownershipPct").trim();
    const ownershipPct = pctRaw === "" ? null : Math.trunc(Number(pctRaw));
    if (ownershipPct !== null && (!Number.isFinite(ownershipPct) || ownershipPct < 0 || ownershipPct > 100)) {
      return fail("지분율은 0~100 사이의 숫자로 적어 주십시오.");
    }
    const relatedMemberNo = fdStr(fd, "relatedMemberNo").trim() || null;

    // 이해관계 업체라고 표시했으면 관련 회원(임원)을 반드시 지정해야 한다.
    // 누가 관련됐는지 모르면 승인 회피(recusal)를 걸 대상이 없어 통제가 빈다.
    if (relatedParty && !relatedMemberNo) {
      return fail(
        "이해관계 업체로 표시하셨습니다. 관련 임원(회원번호)을 지정해 주십시오.",
        "누가 관련됐는지 지정해야 그 사람의 승인 버튼을 막을 수 있습니다. 지정하지 않으면 배지만 뜨고 회피는 동작하지 않습니다.",
      );
    }
    if (relatedMemberNo) {
      const exists = await prisma.member.findUnique({ where: { memberNo: relatedMemberNo } });
      if (!exists) return fail(`회원번호 ${relatedMemberNo} 를 찾을 수 없습니다.`);
    }

    const data = {
      name,
      // 로마자 상호 등 다른 표기. 이게 비어 있으면 "OTON Hardware" 같은 표기로
      // 이해상충 판정을 빠져나간다(실제로 재현된 우회다).
      aliases: fdStr(fd, "aliases").trim().slice(0, MAX.aliases),
      ownerName: fdStr(fd, "ownerName").trim().slice(0, MAX.owner),
      industry: fdStr(fd, "industry").trim().slice(0, MAX.industry),
      phone: fdStr(fd, "phone").trim().slice(0, MAX.phone),
      address: fdStr(fd, "address").trim().slice(0, MAX.addr),
      relatedParty,
      relatedMemberNo,
      ownershipPct,
      note: fdStr(fd, "note").trim().slice(0, MAX.note),
      status: fdStr(fd, "status").trim() === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    };

    const isNew = !vendorId;
    const id = isNew ? await nextVendorId() : vendorId;
    const before = isNew ? null : await prisma.vendor.findUnique({ where: { vendorId: id } });
    if (!isNew && !before) return fail(`업소 ${id} 를 찾을 수 없습니다.`);

    await prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.vendor.create({ data: { vendorId: id, since: null, tin: "", ...data } });
      } else {
        await tx.vendor.update({ where: { vendorId: id }, data });
      }
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Vendor",
        recordKey: id,
        changeType: isNew ? "INSERT" : "EDIT",
        // 이해관계 여부가 바뀌는 것은 공개 회계 배지와 승인 회피를 동시에 바꾼다 → 경고로 남긴다
        severity: before && before.relatedParty !== data.relatedParty ? "WARN" : "INFO",
        beforeValue: before
          ? `${before.name} / 이해관계 ${before.relatedParty ? "Y" : "N"} / 지분 ${before.ownershipPct ?? "-"}`
          : "",
        afterValue: `${data.name} / 이해관계 ${data.relatedParty ? "Y" : "N"} / 지분 ${data.ownershipPct ?? "-"}`,
        note: `업소 ${isNew ? "등록" : "수정"} by ${me.name}(${me.role})`,
      });
    });

    revalidatePath("/biz");
    revalidatePath("/ledger");
    revalidatePath("/officer/vendors");
    return ok(`${id} ${name} — ${isNew ? "등록했습니다" : "수정했습니다"}.`);
  } catch (e) {
    return toActionError(e);
  }
}

/** 비활성 ↔ 활성 토글. 삭제 대신 이것을 쓴다. */
export async function toggleVendorAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["업소관리"],
      write: true,
      screen: "업소 관리",
    });
    const id = fdStr(fd, "vendorId").trim();
    const v = await prisma.vendor.findUnique({ where: { vendorId: id } });
    if (!v) return fail(`업소 ${id} 를 찾을 수 없습니다.`);

    const next = v.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { vendorId: id }, data: { status: next } });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Vendor",
        recordKey: id,
        fieldName: "status",
        beforeValue: v.status,
        afterValue: next,
        changeType: "EDIT",
        severity: "INFO",
        note: `업소 ${next === "INACTIVE" ? "비활성" : "활성"} by ${me.name}(${me.role})`,
      });
    });

    revalidatePath("/biz");
    revalidatePath("/officer/vendors");
    return ok(
      next === "INACTIVE"
        ? `${v.name} 을(를) 목록에서 내렸습니다. 과거 거래 기록은 그대로 남습니다.`
        : `${v.name} 을(를) 다시 목록에 올렸습니다.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

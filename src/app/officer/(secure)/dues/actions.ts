"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  assertFyOpen,
  formatInvoiceId,
  formatMoney,
  loadSettings,
  maxInvoiceSeq,
  todayManila,
  DUES_BATCH_NOTE,
} from "@/lib/domain";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { duesIssueSchema, firstIssue } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";
import { duesContextFrom, loadDuesPlan } from "./plan-data";

/**
 * 회비고지 일괄 생성 — 그 해 고지가 없는 활동 회원에게 06_회비고지를 한 번에 만든다.
 *
 * ── 지키는 것 ───────────────────────────────────────────────────────────
 *  ★ 기존 고지는 절대 덮어쓰지 않는다. 대상은 "고지가 없는" 회원뿐이고,
 *    (회계연도, 회원번호) 유니크가 두 번 눌러도 중복을 막는다(멱등).
 *  ★ 화면이 보낸 명단을 믿지 않는다. 트랜잭션 안에서 다시 계산하고,
 *    미리보기와 다르면(지문 불일치) 만들지 않고 새로고침을 요청한다.
 *  ★ 단가표에 없는 등급은 만들지 않는다 — 결과 메시지에 이름과 함께 남긴다.
 *  ★ 고지 없이 먼저 받은 회비(회원 연결된 POSTED 수납)는 납부금액에 반영한다.
 *  I5 마감된 회계연도에는 만들지 않는다(assertFyOpen).
 *
 * ── 하지 않는 것 ────────────────────────────────────────────────────────
 *  메일을 보내지 않는다. 고지 메일·독촉은 이 화면의 일이 아니다.
 */
export async function issueDuesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "회비고지 생성" });

    const settings = await loadSettings(prisma);
    const ctx = duesContextFrom(settings, todayManila());

    const shownFy = Number(fdStr(fd, "fiscalYear"));
    const shownFingerprint = fdStr(fd, "fingerprint");
    if (!shownFingerprint || shownFy !== ctx.fiscalYear) {
      return fail(
        "미리보기 이후 회계연도 설정이 바뀌었거나 미리보기 정보가 없습니다.",
        "화면을 새로고침(F5)해 대상 명단을 다시 확인한 뒤 눌러 주십시오. 아무것도 만들지 않았습니다.",
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        await assertFyOpen(tx, `${ctx.fiscalYear}-01-01`); // I5

        const { plan, existingInvoiceIds } = await loadDuesPlan(tx, ctx);

        // 만들 것이 없으면 아무것도 쓰지 않고 끝낸다. 두 번 누른 경우가 여기로 온다(멱등).
        if (plan.toCreate.length === 0) return { plan, firstId: "", lastId: "" };

        // 설정 '회비.납기일' 이 날짜 형식이 아니면 여기서 끊는다 — 이상한 납기일이 고지에 박히지 않게.
        const dates = duesIssueSchema.safeParse({
          fiscalYear: plan.fiscalYear,
          billedOn: plan.billedOn,
          dueOn: plan.dueOn,
        });
        if (!dates.success) {
          throw new Error(
            `고지일·납기일을 정하지 못했습니다(${firstIssue(dates.error)}). 설정 '회비.납기일' 을 2026-02-28 형식으로 고쳐 주십시오.`,
          );
        }

        if (plan.fingerprint !== shownFingerprint) {
          throw new Error(
            "미리보기 이후 대상 회원·단가·수납 내역이 바뀌었습니다. 화면을 새로고침(F5)해 명단을 다시 확인한 뒤 눌러 주십시오. 아무것도 만들지 않았습니다.",
          );
        }

        const startSeq = maxInvoiceSeq(existingInvoiceIds) + 1;
        const rows = plan.toCreate.map((p, i) => ({
          invoiceId: formatInvoiceId(plan.fiscalYear, startSeq + i),
          fiscalYear: plan.fiscalYear,
          memberNo: p.memberNo,
          memberName: p.memberName,
          duesGrade: p.duesGrade,
          billedAmount: p.billedAmount,
          currency: "PHP",
          billedOn: p.billedOn,
          dueOn: p.dueOn,
          paidAmount: p.paidAmount,
          unpaidAmount: p.unpaidAmount,
          status: p.status,
          lastReceiptNo: p.lastReceiptNo,
          lastPaidOn: p.lastPaidOn,
          exemptReason: p.exemptReason,
          note: p.note,
          // 회원 기간 — 완납·면제로 만들어지는 고지만(계획에서 계산, 미리보기와 같은 값)
          validFrom: p.validFrom,
          validUntil: p.validUntil,
        }));

        // skipDuplicates — 같은 순간 다른 창에서 같은 버튼을 눌렀다면 (회계연도, 회원번호) 유니크에서
        // 걸러진다. 그때 만든 건수가 계획과 다르면 통째로 되돌린다(반쪽만 만들어진 상태를 남기지 않는다).
        const created = await tx.duesInvoice.createMany({ data: rows, skipDuplicates: true });
        if (created.count !== rows.length) {
          throw new Error(
            `같은 시각에 다른 고지 작업이 겹쳤습니다(계획 ${rows.length}건 중 ${created.count}건만 가능). 아무것도 만들지 않았습니다. 화면을 새로고침한 뒤 다시 눌러 주십시오.`,
          );
        }

        const firstId = rows[0].invoiceId;
        const lastId = rows[rows.length - 1].invoiceId;
        const count = (s: string) => plan.toCreate.filter((p) => p.status === s).length;
        const withPeriod = plan.toCreate.filter((p) => p.validFrom);

        await appendAuditLog(tx, {
          actor: me.email,
          tableName: "DuesInvoice",
          recordKey: rows.length === 1 ? firstId : `${firstId}…${lastId}`,
          changeType: "INSERT",
          severity: "INFO",
          afterValue:
            `${plan.fiscalYear}년 ${rows.length}건 (미납 ${count("미납")} / 부분납 ${count("부분납")} / 완납 ${count("완납")} / 면제 ${count("면제")}) ` +
            `고지 ₱${formatMoney(plan.totals.billed)} · 기존 수납 반영 ₱${formatMoney(plan.totals.paid)} · 납기 ${plan.dueOn}` +
            (withPeriod.length
              ? ` · 회원 기간 부여 ${withPeriod.length}건(${withPeriod.map((p) => `${p.memberNo} ${p.validFrom}~${p.validUntil}`).join(", ")})`
              : ""),
          note:
            `${DUES_BATCH_NOTE} (${me.officerId} ${me.role}) — 기존 고지 ${plan.alreadyInvoiced}명 건너뜀` +
            (plan.skippedNoRate.length
              ? `, 단가 없음 ${plan.skippedNoRate.length}명 건너뜀(${plan.skippedNoRate.map((s) => `${s.memberNo} ${s.duesGrade}`).join(", ")})`
              : ""),
        });

        return { plan, firstId, lastId };
      },
      { timeout: 20_000 },
    );

    revalidatePath(ROUTES.officer);
    revalidatePath(`${ROUTES.officer}/dues`);
    revalidatePath(`${ROUTES.officer}/members`);
    revalidatePath(`${ROUTES.officer}/members/photos`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.meHome);
    revalidatePath(ROUTES.meCard);
    revalidatePath("/me/[token]", "page");
    revalidatePath("/verify/[token]", "page");

    const { plan } = result;
    const skipNote = plan.skippedNoRate.length
      ? ` ⚠ 단가표에 없는 등급이라 만들지 않은 회원 ${plan.skippedNoRate.length}명: ` +
        plan.skippedNoRate.map((s) => `${s.name}(${s.memberNo}, ${s.duesGrade})`).join(", ") +
        ". 설정에 '회비단가.<등급>' 을 넣거나 회원의 회비등급을 고친 뒤 다시 눌러 주십시오."
      : "";

    if (plan.toCreate.length === 0) {
      return ok(
        `${plan.fiscalYear}년 회비고지를 새로 만들 회원이 없습니다. 활동 회원 ${plan.alreadyInvoiced}명은 이미 고지가 있습니다.` +
          skipNote,
      );
    }

    const paidNote =
      plan.totals.paid > 0
        ? ` 고지 전에 받은 회비 ₱${formatMoney(plan.totals.paid)} 를 납부금액에 반영했습니다.`
        : "";
    const periodCount = plan.toCreate.filter((p) => p.validFrom).length;
    const periodNote = periodCount
      ? ` 완납·면제로 만들어진 ${periodCount}건에는 회원 기간(납부일·면제일부터 1년)을 함께 정했습니다.`
      : "";
    return ok(
      `${plan.fiscalYear}년 회비고지 ${plan.toCreate.length}건을 만들었습니다(${result.firstId}` +
        (plan.toCreate.length > 1 ? ` ~ ${result.lastId}` : "") +
        `). 고지 합계 ₱${formatMoney(plan.totals.billed)}, 납기 ${plan.dueOn}.` +
        paidNote +
        periodNote +
        ` 기존 고지 ${plan.alreadyInvoiced}명은 건드리지 않았습니다. 메일은 보내지 않았습니다.` +
        skipNote,
    );
  } catch (e) {
    return toActionError(e);
  }
}

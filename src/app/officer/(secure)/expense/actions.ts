"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  approvalConfigFrom,
  computeFinalStatus,
  conflictBadgeText,
  decideApprovalRoute,
  evaluateConflict,
  fiscalYearOf,
  formatPeso,
  fxTableFrom,
  loadSettings,
  rateFor,
  toPeso,
  todayManila,
} from "@/lib/domain";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { approvalRequestSchema, firstIssue } from "@/lib/validators";
import type { ApprovalResult } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import {
  appendAuditLog,
  fail,
  fdStr,
  nextApprovalId,
  ok,
  toActionError,
} from "../../_lib/server-utils";
import { saveDataUrl } from "../../_lib/upload";

/**
 * 지출 사전 요청 접수 → 11_승인 한 행.
 *
 * ★ 여기서는 돈이 나가지 않는다. 장부(05_거래)에 들어가는 것은 승인 화면의 "집행" 뿐이다.
 *   요청 → 결재 → 집행을 분리하는 것이 이 시스템의 통제 구조다.
 *
 * ★ 수취인(counterpartyName)은 **전용 필드**로 받는다. 사유 텍스트에 묻지 않는다.
 *   예전에는 사유에서 정규식으로 수취인을 꺼냈는데 "- 오톤 하드웨어" 처럼 하이픈으로 시작하면
 *   캡처값이 공백 한 칸이 되어 이해상충 판정이 통째로 건너뛰어졌다.
 *   (근거: 02_노코드MVP/AppsScript/13_웹앱_임원.gs 승인상대방열_ 주석)
 *
 * ★ 판정 불가(undetermined)는 "이해관계 없음" 이 아니다. 접수하지 않는다.
 */
export async function requestExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "지출 요청",
    });

    const parsed = approvalRequestSchema.safeParse({
      kind: fdStr(formData, "kind") || "지출",
      amount: fdStr(formData, "amount"),
      currency: fdStr(formData, "currency") || "PHP",
      fundId: fdStr(formData, "fundId"),
      categoryCode: fdStr(formData, "categoryCode"),
      reason: fdStr(formData, "reason"),
      counterpartyName: fdStr(formData, "counterpartyName"),
      vendorId: fdStr(formData, "vendorId") || undefined,
      quoteUrl: "", // 파일 저장 후 채운다
      note: fdStr(formData, "note"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    const settings = await loadSettings(prisma);
    const cfg = approvalConfigFrom(settings);
    const fxTable = fxTableFrom(settings);

    let fxRate: number;
    try {
      fxRate = rateFor(input.currency, fxTable);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "환율 설정을 읽지 못했습니다.");
    }
    const amountPhp = toPeso(input.amount, input.currency, fxRate, fxTable);

    /* ── 이해상충 판정 (서버가 정본. 화면 표시는 안내일 뿐이다) ── */
    const [vendors, conflicts, officers] = await Promise.all([
      prisma.vendor.findMany(),
      prisma.conflictOfInterest.findMany(),
      prisma.officer.findMany(),
    ]);
    const verdict = evaluateConflict(
      { counterpartyName: input.counterpartyName, vendorId: input.vendorId ?? null },
      vendors,
      conflicts,
      officers,
    );
    if (verdict.undetermined) {
      return fail(
        "수취인 정보로 이해상충을 판정할 수 없어 접수하지 않았습니다: " +
          (verdict.reasons.join(" / ") || "(원인 미상)"),
        "수취인을 상호 또는 이름 그대로 정확히 적어 주십시오. 판정하지 못한 건은 결재도 집행도 할 수 없습니다.",
      );
    }

    const route = decideApprovalRoute(amountPhp, verdict.related, cfg);

    /* ── 견적 첨부 ── */
    const today = todayManila();
    const quoteData = fdStr(formData, "quoteDataUrl");
    let quoteUrl = "";
    if (quoteData) {
      const saved = await saveDataUrl(quoteData, "quotes", today);
      if (!saved.ok) return fail(saved.message);
      quoteUrl = saved.url;
    }

    // 견적이 필요한 구간인데 첨부가 없으면 **면제 사유를 반드시 적게 한다**.
    // 규정상 견적 면제는 사전 승인 사항이고 사후 인정되지 않는다(승인한도표 제4조 ⑤).
    // 그렇다고 무조건 막으면 긴급구호(견적 면제 대상)를 접수할 수 없어진다.
    let note = input.note;
    if (route.quotesRequired > 0 && !quoteUrl) {
      if (!note) {
        return fail(
          `이 금액 구간(${route.band})은 견적서 ${route.quotesRequired}곳이 필요합니다.`,
          "견적서를 첨부하시거나, 비고 칸에 견적 면제 사유(긴급·독점공급·법정가격 등)를 적어 주십시오. 사유는 결재 화면과 감사 화면에 그대로 남습니다.",
        );
      }
      note = `[견적면제 사유] ${note}`;
    }

    /* ── 접수 ── */
    const stages = route.requiredStages;
    const result1: ApprovalResult = stages === 0 ? "불필요" : "대기";
    const result2: ApprovalResult = stages >= 2 ? "대기" : "불필요";
    const finalStatus = computeFinalStatus(stages, result1, result2, false);

    const created = await prisma.$transaction(async (tx) => {
      const fy = fiscalYearOf(today);

      const [fund, category] = await Promise.all([
        tx.fund.findUnique({ where: { fundId: input.fundId } }),
        tx.category.findUnique({ where: { code: input.categoryCode } }),
      ]);
      if (!fund) throw new Error(`03_기금에 없는 기금ID 입니다: ${input.fundId}`);
      if (!category) throw new Error(`04_과목에 없는 과목코드입니다: ${input.categoryCode}`);
      if (category.majorType !== "지출") {
        throw new Error(`"${category.name}" 은 수입 과목입니다. 지출 요청에는 쓸 수 없습니다.`);
      }

      // 업소ID 는 외래키다. 판정에서 나온 값이든 화면에서 고른 값이든 실재해야 한다.
      let vendorId: string | null = verdict.vendorId ?? input.vendorId ?? null;
      if (vendorId) {
        const v = await tx.vendor.findUnique({ where: { vendorId }, select: { vendorId: true } });
        if (!v) vendorId = null;
      }
      let conflictId: string | null = verdict.conflictId;
      if (conflictId) {
        const c = await tx.conflictOfInterest.findUnique({
          where: { conflictId },
          select: { conflictId: true },
        });
        if (!c) conflictId = null;
      }

      const approvalId = await nextApprovalId(tx, fy);

      await tx.approval.create({
        data: {
          approvalId,
          requestedBy: me.email,
          kind: input.kind,
          amount: input.amount,
          currency: input.currency,
          amountPhp,
          fundId: fund.fundId,
          categoryCode: category.code,
          reason: input.reason,
          relatedParty: verdict.related,
          conflictId,
          quoteUrl,
          requiredStages: stages,
          approver1: "",
          result1,
          approver2: "",
          result2,
          finalStatus,
          note,
          // ★ 이해상충 판정 전용 구조화 열. 승인·집행은 오직 이 두 열만 읽는다.
          counterpartyName: input.counterpartyName,
          vendorId,
        },
      });

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Approval",
        recordKey: approvalId,
        changeType: "INSERT",
        severity: verdict.related ? "WARN" : "INFO",
        afterValue: `${formatPeso(amountPhp)} / ${input.counterpartyName} / 단계 ${stages} / ${finalStatus}`,
        note:
          `지출 요청 접수 (${me.officerId} ${me.role}) — 결재선: ${route.route}` +
          (verdict.related ? ` / 이해관계자: ${conflictBadgeText(verdict)}` : ""),
      });

      return { approvalId };
    });

    revalidatePath(ROUTES.officer);
    revalidatePath(`${ROUTES.officer}/expense`);
    revalidatePath(`${ROUTES.officer}/approve`);
    revalidatePath(`${ROUTES.officer}/audit`);

    const head =
      stages === 0
        ? `${created.approvalId} 로 접수했습니다. 전결 구간이라 결재 없이 바로 집행할 수 있습니다.`
        : `${created.approvalId} 로 접수했습니다. ${stages}단계 결재가 필요합니다 — ${route.route}.`;

    return ok(
      head +
        (verdict.related
          ? ` ★ 이해관계자 거래입니다(${conflictBadgeText(verdict)}). 해당 임원은 결재·집행 모두에서 빠집니다.`
          : ""),
      { approvalId: created.approvalId },
    );
  } catch (e) {
    return toActionError(e);
  }
}

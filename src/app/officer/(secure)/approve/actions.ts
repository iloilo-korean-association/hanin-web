"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  approvalConfigFrom,
  assertFyOpen,
  canOfficerApprove,
  cashThresholdFrom,
  cfgStr,
  checkApprovalTrail,
  computeFinalStatus,
  conflictBadgeText,
  decideApprovalRoute,
  evaluateConflict,
  evaluateTxState,
  formatPeso,
  isRecused,
  loadSettings,
  manilaDateTimeStr,
  nextReceiptNo,
  publicPolicyFrom,
  todayManila,
} from "@/lib/domain";
import { assertNotRecused, requireOfficer } from "@/lib/guard";
import { queueMail } from "@/lib/mail";
import { ROUTES } from "@/lib/site";
import {
  approvalDecisionSchema,
  firstIssue,
  zAccountId,
  zApprovalId,
  zCounterpartyType,
  zDateStr,
  zEmail,
  zOptText,
  zPayMethod,
  type ApprovalResult,
} from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import {
  appendAuditLog,
  fail,
  fdBool,
  fdStr,
  ok,
  toActionError,
  toOfficerRow,
} from "../../_lib/server-utils";
import { saveDataUrl } from "../../_lib/upload";

/**
 * 승인이 시작됐다가 끝나지 않은 과도 상태.
 *
 * ★ APPROVAL_FINAL_STATUSES(대기/승인/반려/집행완료)에 없는 값이다. 일부러 그렇다 —
 *   정상 흐름에서는 어느 트랜잭션 경계에서도 이 값이 커밋된 채로 남지 않는다.
 *   그럼에도 선점 단계를 두는 이유는 아래 executeApprovalAction 주석에 적었다.
 */
const EXECUTING = "집행중";

/* ════════════════════════════════════════════════════════════════════════
 * 1) 결재 — 승인 / 반려
 * ════════════════════════════════════════════════════════════════════════ */

export async function decideApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["승인권"],
      write: true,
      screen: "지출 결재",
    });

    const parsed = approvalDecisionSchema.safeParse({
      approvalId: fdStr(formData, "approvalId"),
      decision: fdStr(formData, "decision"),
      stage: Number(fdStr(formData, "stage")),
      comment: fdStr(formData, "comment"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    const meRow = toOfficerRow(me);

    const result = await prisma.$transaction(async (tx) => {
      const ap = await tx.approval.findUnique({ where: { approvalId: input.approvalId } });
      if (!ap) throw new Error(`승인번호 ${input.approvalId} 를 찾을 수 없습니다.`);

      // ★ 이해상충을 **트랜잭션 안에서 다시** 판정한다.
      //   화면이 그린 판정은 오래됐을 수 있고, 폼은 화면을 거치지 않고 직접 POST 될 수 있다.
      const [vendors, conflicts, officers] = await Promise.all([
        tx.vendor.findMany(),
        tx.conflictOfInterest.findMany(),
        tx.officer.findMany(),
      ]);
      const verdict = evaluateConflict(
        { counterpartyName: ap.counterpartyName, vendorId: ap.vendorId },
        vendors,
        conflicts,
        officers,
      );

      // 판정 불가는 "이해관계 없음" 이 아니다 — 안전한 쪽(회피)으로 기울인다.
      assertNotRecused(
        me,
        isRecused(meRow, verdict) || verdict.undetermined,
        verdict.undetermined ? "수취인 정보로 이해상충을 판정할 수 없습니다" : conflictBadgeText(verdict),
      );

      const gate = canOfficerApprove(meRow, ap, verdict);
      if (!gate.canApprove) throw new Error(gate.blockedReason || "이 건은 지금 결재할 수 없습니다.");
      if (gate.stage !== input.stage) {
        throw new Error(
          `화면이 오래되었습니다. 지금 필요한 결재는 ${gate.stage ?? "없음"}차인데 ${input.stage}차로 들어왔습니다. 새로고침한 뒤 다시 시도해 주십시오.`,
        );
      }

      // 단독 결재로 확정되는 건(전결 제외 1단계)만 개인 승인한도를 적용한다.
      // 2단계 건의 각 차수는 "이사회 의결의 일부" 라 개인 한도로 판단하는 대상이 아니다
      // (승인한도표 제3조). canOfficerApprove 도 같은 기준으로 계산한다.
      if (ap.requiredStages === 1 && input.decision === "승인" && me.approvalLimit > 0) {
        if (ap.amountPhp > me.approvalLimit) {
          throw new Error(
            `승인한도를 초과합니다. 요청 ${formatPeso(ap.amountPhp)} > 한도 ${formatPeso(me.approvalLimit)}.`,
          );
        }
      }

      const now = new Date();
      const stamp = input.comment ? ` — ${input.comment}` : "";
      const data =
        input.stage === 1
          ? {
              approver1: me.email,
              approvedAt1: now,
              result1: input.decision,
            }
          : {
              approver2: me.email,
              approvedAt2: now,
              result2: input.decision,
            };

      const result1 = (input.stage === 1 ? input.decision : ap.result1) as ApprovalResult;
      const result2 = (input.stage === 2 ? input.decision : ap.result2) as ApprovalResult;
      const finalStatus = computeFinalStatus(ap.requiredStages, result1, result2, false);

      await tx.approval.update({
        where: { approvalId: ap.approvalId },
        data: {
          ...data,
          finalStatus,
          note: `${ap.note}${ap.note ? " || " : ""}${manilaDateTimeStr(now)} ${input.stage}차 ${input.decision} ${me.name}(${me.role})${stamp}`.slice(
            0,
            1500,
          ),
        },
      });

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Approval",
        recordKey: ap.approvalId,
        fieldName: input.stage === 1 ? "result1" : "result2",
        beforeValue: input.stage === 1 ? ap.result1 : ap.result2,
        afterValue: input.decision,
        changeType: "EDIT",
        severity: ap.relatedParty ? "WARN" : "INFO",
        relatedKey: ap.counterpartyName,
        note:
          `${input.stage}차 결재 (${me.officerId} ${me.role}) → 최종상태 ${finalStatus}` +
          (ap.relatedParty ? ` / 이해관계자 건 · 회피 대상 아님으로 확인됨` : "") +
          (input.comment ? ` / 의견: ${input.comment}` : ""),
      });

      return { finalStatus };
    });

    revalidatePath(ROUTES.officer);
    revalidatePath(`${ROUTES.officer}/approve`);
    revalidatePath(`${ROUTES.officer}/audit`);

    return ok(
      `${input.approvalId} ${input.stage}차 ${input.decision} 처리했습니다. 최종상태: ${result.finalStatus}.` +
        (result.finalStatus === "승인"
          ? " 이제 집행(장부 기입) 단계입니다 — 아래 집행 대기 목록에 나타납니다."
          : ""),
      { approvalId: input.approvalId },
    );
  } catch (e) {
    return toActionError(e);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 2) 집행 — 승인이 끝난 지출을 장부에 넣는 **유일한** 경로
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 집행 입력.
 *
 * ★ 금액·수취인·과목·기금은 클라이언트에게 묻지 않는다(수취인·과목·기금은 승인 행에서 읽고,
 *   금액은 승인액을 넘을 수 없다). 그래서 공용 expenseInputSchema 대신
 *   "집행자가 실제로 결정할 수 있는 것" 만 담은 스키마를 여기에 둔다.
 */
const executeInputSchema = z.object({
  approvalId: zApprovalId,
  date: zDateStr,
  method: zPayMethod,
  accountId: zAccountId,
  counterpartyType: zCounterpartyType,
  /** 실제 지급액. 비우면 승인 금액 그대로. 승인액을 넘을 수 없다. */
  amount: z.string().trim().default(""),
  externalRef: zOptText(60),
  memo: zOptText(200),
  verifiedBy: zEmail.or(z.literal("")).default(""),
  ackNoEvidence: z.boolean().default(false),
  /**
   * 승인 행에 견적서가 빠져 있을 때 **집행 시점에 그 문서를 붙인다**(사진 또는 PDF).
   *
   * 왜 "면제 체크박스" 가 아니라 문서 첨부인가:
   *   결재 흔적 검증(checkApprovalTrail)은 quoteUrl 이 비었는지만 본다. 체크박스로 우회하면
   *   그 승인 건은 prisma/verify.ts 의 "집행완료 승인의 결재 흔적 정상" 검사에서 **영구히 빨간 줄**로
   *   남고, 지울 방법이 없다. 반대로 문서를 붙이면 규정이 요구하는 서면 기록(승인한도표 제4조 ⑤ —
   *   "긴급 상황은 사유·긴급성을 서면 기록")이 실제로 생기고 검산도 통과한다.
   *   긴급구호처럼 견적 자체가 없는 건은 **견적 면제 사유서**를 찍어 올리면 된다.
   */
  quoteDataUrl: z.string().trim().default(""),
});

export async function executeApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // 결재는 승인권, 집행(장부 기입)은 입력권이다. 결재한 사람이 돈까지 내주고 적으면
    // 2인 원칙이 형식만 남는다.
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "지출 집행",
    });

    const parsed = executeInputSchema.safeParse({
      approvalId: fdStr(formData, "approvalId"),
      date: fdStr(formData, "date"),
      method: fdStr(formData, "method"),
      accountId: fdStr(formData, "accountId"),
      counterpartyType: fdStr(formData, "counterpartyType"),
      amount: fdStr(formData, "amount"),
      externalRef: fdStr(formData, "externalRef"),
      memo: fdStr(formData, "memo"),
      verifiedBy: fdStr(formData, "verifiedBy"),
      ackNoEvidence: fdBool(formData, "ackNoEvidence"),
      quoteDataUrl: fdStr(formData, "quoteDataUrl"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    if (input.date > todayManila()) return fail("미래 날짜로는 지출을 기록할 수 없습니다.");
    if (input.verifiedBy && input.verifiedBy === me.email.trim().toLowerCase()) {
      return fail(
        "확인자는 지급한 사람(귀하)과 다른 사람이어야 합니다.",
        "혼자 내주고 혼자 확인한 것은 2인 확인이 아닙니다(I4).",
      );
    }
    // ★ 확인자는 **실재하는 현직 임원**이어야 한다. 이메일 형식만 검사하면
    //   아무 주소나 적어 2인 확인을 만들어 낼 수 있다(수납 화면과 같은 구멍이었다).
    if (input.verifiedBy) {
      const verifier = await prisma.officer.findFirst({
        where: { email: input.verifiedBy },
        select: { officerId: true, status: true },
      });
      if (!verifier || verifier.status !== "ACTIVE") {
        return fail(
          `확인자 "${input.verifiedBy}" 는 현직 임원이 아닙니다.`,
          "확인자는 12_임원에 등록된 활동(ACTIVE) 중인 임원이어야 합니다. 아래 목록에서 골라 주십시오.",
        );
      }
    }

    /* 증빙은 트랜잭션 밖에서 저장한다 — 파일 I/O 로 DB 락을 잡고 있지 않는다. */
    const photo = fdStr(formData, "photoDataUrl");
    let evidenceUrl = "";
    let lateQuoteUrl = "";
    if (input.quoteDataUrl) {
      const savedQuote = await saveDataUrl(input.quoteDataUrl, "quotes", input.date);
      if (!savedQuote.ok) return fail(savedQuote.message);
      lateQuoteUrl = savedQuote.url;
    }
    if (photo) {
      const saved = await saveDataUrl(photo, "expenses", input.date);
      if (!saved.ok) return fail(saved.message);
      evidenceUrl = saved.url;
    } else if (!input.ackNoEvidence) {
      return fail(
        "지출 영수증 사진이 없습니다. 사진을 첨부하시거나 “사진 없이 임시(DRAFT)로 기록”에 체크해 주십시오.",
        "증빙 없는 지출은 POSTED 가 될 수 없고(I3) 공개 회계에도 뜨지 않습니다.",
      );
    }

    const settings = await loadSettings(prisma);
    const cfg = approvalConfigFrom(settings);
    const cashThreshold = cashThresholdFrom(settings);
    const receiptPrefix = publicPolicyFrom(settings).receiptPrefix;
    const defaultFund = cfgStr(settings, "기본.기금ID", "FD01");
    const meRow = toOfficerRow(me);

    const outcome = await prisma.$transaction(async (tx) => {
      // ★ 클라이언트가 보낸 금액·수취인은 하나도 믿지 않는다. 승인ID 로 다시 읽는다.
      const ap = await tx.approval.findUnique({ where: { approvalId: input.approvalId } });
      if (!ap) throw new Error(`승인번호 ${input.approvalId} 를 찾을 수 없습니다.`);

      if (ap.finalStatus === EXECUTING) {
        throw new Error(
          `이 건은 집행이 시작됐다가 중단된 상태입니다(집행영수증번호 ${ap.executedReceiptNo ?? "(미발급)"}). ` +
            `05_거래에 그 번호의 행이 실제로 있는지 감사와 함께 확인하십시오. 같은 돈을 두 번 내주지 않기 위해 자동으로 풀지 않습니다.`,
        );
      }
      if (ap.finalStatus !== "승인") {
        throw new Error(
          `최종상태가 "${ap.finalStatus || "(빈칸)"}" 입니다. 결재가 끝난(승인) 건만 집행할 수 있습니다.`,
        );
      }

      // ★ 이중 집행 차단. 읽기와 쓰기가 같은 트랜잭션 안이라 두 사람이 동시에 눌러도
      //   뒤에 온 쪽이 여기서 막힌다.
      if (ap.executedReceiptNo) {
        throw new Error(
          `이 건은 이미 ${ap.executedReceiptNo} 로 집행되었습니다. 같은 돈을 두 번 내주지 마십시오. ` +
            `금액이 달랐다면 그 거래를 VOIDED 로 바꾸고 정정 거래를 새로 만드십시오(I1).`,
        );
      }

      /* ★ 이해상충 재판정을 **결재 흔적 검증보다 먼저** 한다.
         이유(적대 점검에서 실증): 11_승인.이해관계여부는 *요청 시점*에 굳은 값이다.
         요청 뒤에 그 업체가 이해관계 업체로 등록되면(임원이 뒤늦게 신고하는 정상적인 순서다)
         낡은 false 로 결재선을 계산하게 되어, 이사회 2단계·견적 2곳이 필요한 건이
         1단계·견적 0곳으로 집행됐다. 지금 시점의 판정으로 다시 계산한다.
         구조화 열(수취인명·업소ID)만 읽는다 — 사유 텍스트는 보지 않는다. */
      const [vendors, conflicts, officers] = await Promise.all([
        tx.vendor.findMany(),
        tx.conflictOfInterest.findMany(),
        tx.officer.findMany(),
      ]);
      const verdict = evaluateConflict(
        { counterpartyName: ap.counterpartyName, vendorId: ap.vendorId },
        vendors,
        conflicts,
        officers,
      );
      if (verdict.undetermined) {
        throw new Error(
          "수취인 정보로 이해상충을 판정할 수 없어 집행할 수 없습니다: " +
            (verdict.reasons.join(" / ") || "(원인 미상)"),
        );
      }
      // 결재에서 회피한 사람이 돈을 내주고 장부까지 적으면 회피가 형식만 남는다.
      assertNotRecused(me, isRecused(meRow, verdict), conflictBadgeText(verdict));

      /** 지금 이 순간 기준의 이해관계 여부. 결재선·견적 요구는 이 값으로 계산한다. */
      const relatedNow = ap.relatedParty || verdict.related;

      /* 승인 행에 견적서가 빠져 있고 집행자가 지금 문서를 붙였다면, **승인 행에 먼저 기록**한다.
         이렇게 해야 결재 흔적 검증(checkApprovalTrail)이 진짜 문서를 근거로 통과하고,
         나중에 감사가 그 문서를 열어 볼 수 있다. 붙이지 않았으면 아래에서 평소대로 막힌다. */
      const route = decideApprovalRoute(ap.amountPhp, relatedNow, cfg);
      const quoteMissing = route.quotesRequired > 0 && !String(ap.quoteUrl ?? "").trim();
      let effectiveQuoteUrl = ap.quoteUrl;
      if (lateQuoteUrl) {
        if (!quoteMissing) {
          throw new Error(
            "이 승인 건에는 이미 견적서가 첨부돼 있습니다. 승인 단계의 문서를 집행 단계에서 바꿀 수 없습니다.",
          );
        }
        effectiveQuoteUrl = lateQuoteUrl;
        await tx.approval.update({
          where: { approvalId: ap.approvalId },
          data: { quoteUrl: lateQuoteUrl },
        });
        await appendAuditLog(tx, {
          actor: me.email,
          tableName: "Approval",
          recordKey: ap.approvalId,
          fieldName: "quoteUrl",
          beforeValue: "(없음)",
          afterValue: lateQuoteUrl,
          changeType: "EDIT",
          severity: "WARN",
          note:
            `집행 단계에서 견적서(또는 견적 면제 사유서)를 첨부함 (${me.officerId} ${me.role}). ` +
            `이 구간은 견적 ${route.quotesRequired}곳이 필요한데 결재 시점에 첨부가 없었습니다 — 감사 확인 대상입니다.`,
        });
      }

      // ★ 최종상태 셀 하나만 믿지 않는다. 결재 흔적을 다시 검증한다.
      //   (전결 0단계는 별도 처리 — checkApprovalTrail 이 폴백 없이 0 을 0 으로 다룬다)
      const trail = checkApprovalTrail(
        {
          approvalId: ap.approvalId,
          amountPhp: ap.amountPhp,
          // ★ 낡은 ap.relatedParty 가 아니라 지금 판정으로 검증한다(위 주석 참조).
          relatedParty: relatedNow,
          // 이해관계 건인데 요청 시점 계산이 1단계 이하로 굳어 있으면, 지금 규정이 요구하는
          // 단계 수로 올려 검증한다. 결재 흔적이 그만큼 없으면 여기서 막힌다.
          requiredStages: Math.max(ap.requiredStages, route.requiredStages),
          approver1: ap.approver1,
          result1: ap.result1,
          approver2: ap.approver2,
          result2: ap.result2,
          finalStatus: ap.finalStatus,
          quoteUrl: effectiveQuoteUrl,
        },
        cfg,
      );
      if (!trail.ok) {
        throw new Error(
          trail.reason +
            (quoteMissing
              ? " 아래 “견적서 첨부” 칸에 견적서를 올리면 승인 기록에 남고 집행할 수 있습니다. 긴급구호처럼 견적 자체가 없는 건이라면 견적 면제 사유서를 찍어 올리십시오(승인한도표 제4조 ⑤ — 사유·긴급성을 서면 기록)."
              : ""),
        );
      }

      // 승인 금액이 0/공란이면 아래 상한 검사가 통째로 건너뛰어져 임의 금액을 집행할 수 있다.
      if (ap.amountPhp <= 0) {
        throw new Error(
          `${ap.approvalId} 의 승인 금액이 비어 있거나 0 입니다. 얼마를 승인받았는지 알 수 없는 건은 집행할 수 없습니다.`,
        );
      }

      /* 이해상충 재판정·회피 강제는 이 트랜잭션 맨 앞에서 이미 끝냈다(relatedNow 참조). */

      /* 마스터 검증 */
      const [account, category] = await Promise.all([
        tx.account.findUnique({ where: { accountId: input.accountId } }),
        ap.categoryCode
          ? tx.category.findUnique({ where: { code: ap.categoryCode } })
          : Promise.resolve(null),
      ]);
      if (!account) throw new Error(`02_계좌에 없는 계좌ID 입니다: ${input.accountId}`);
      if (account.status !== "ACTIVE") throw new Error(`${account.name} 계좌는 이미 폐쇄되었습니다.`);
      if (input.date < account.openedOn) {
        throw new Error(
          `${account.name} 계좌의 개시일(${account.openedOn}) 이전 날짜로는 기록할 수 없습니다.`,
        );
      }
      if (!category) {
        throw new Error(
          `${ap.approvalId} 의 과목코드("${ap.categoryCode ?? "(빈칸)"}")가 04_과목에 없습니다. 과목이 없으면 공개 회계에서 분류할 수 없습니다.`,
        );
      }
      const fundId = ap.fundId ?? defaultFund;
      const fund = await tx.fund.findUnique({ where: { fundId } });
      if (!fund) throw new Error(`03_기금에 없는 기금ID 입니다: ${fundId}`);

      /* 실제 지급액 */
      const raw = input.amount.replace(/[,\s₱P]/gi, "");
      const paid = raw === "" ? ap.amountPhp : Math.round(Number(raw));
      if (!Number.isFinite(paid) || paid <= 0) {
        throw new Error("실제 지급액을 숫자만으로 적어 주십시오.");
      }
      if (paid > ap.amountPhp) {
        throw new Error(
          `실제 지급액 ${formatPeso(paid)} 이 승인 금액 ${formatPeso(ap.amountPhp)} 를 넘습니다. 초과분은 사전 승인을 새로 받아야 합니다.`,
        );
      }

      const fy = await assertFyOpen(tx, input.date); // I5

      // I2 — 채번은 트랜잭션 안에서.
      const { receiptNo, seq } = await nextReceiptNo(tx, fy, receiptPrefix);

      /* ★ 선점(자물쇠)을 먼저 건다.
         거래를 먼저 쓰고 승인행 갱신이 실패하면 집행영수증번호가 비어 있어 그 건이
         '집행 대기' 목록에 다시 떠서 같은 돈을 두 번 내주게 된다.
         순서를 뒤집으면 최악의 경우가 "선점만 남고 거래가 없음" 이 되는데, 이건 재집행이
         막힌 채 사람이 조사할 수 있는 **안전한** 상태다.
         ※ 이 세 단계는 하나의 DB 트랜잭션 안이라 중간 실패는 통째로 롤백된다 —
           정상 경로에서 '집행중' 이 커밋된 채로 남지는 않는다. 그럼에도 순서를 이렇게 두는 이유는
           (a) 나중에 Postgres 로 옮겨 재시도·부분 커밋이 생겨도 안전한 쪽으로 실패하고
           (b) 시트 시절과 같은 복구 절차(감사와 함께 확인)를 코드가 계속 지시하기 때문이다. */
      await tx.approval.update({
        where: { approvalId: ap.approvalId },
        data: { executedReceiptNo: receiptNo, finalStatus: EXECUTING },
      });

      // I3 + I4 — 수납과 **같은 판정기**를 쓴다. 두 벌로 구현하면 두 벌이 어긋난다.
      const state = evaluateTxState(
        {
          evidenceUrl,
          method: input.method,
          amount: paid,
          currency: "PHP",
          fxRate: 1,
          enteredBy: me.email,
          verifiedBy: input.verifiedBy,
        },
        cashThreshold,
      );

      const memo = [
        category.name,
        ap.counterpartyName || "(수취인 미기재)",
        input.memo,
        `(${ap.approvalId})`,
        state.status === "DRAFT" ? `[보류: ${state.reason}]` : "",
      ]
        .filter(Boolean)
        .join(" / ")
        .slice(0, 200);

      await tx.transaction.create({
        data: {
          receiptNo,
          seq,
          fiscalYear: fy,
          date: input.date,
          direction: "OUT",
          amount: paid,
          currency: "PHP",
          fxRate: 1,
          amountPhp: paid,
          accountId: account.accountId,
          fundId: fund.fundId,
          categoryCode: category.code,
          counterpartyType: input.counterpartyType,
          counterpartyMemberNo: null,
          counterpartyName: ap.counterpartyName,
          method: input.method,
          memo,
          externalRef: input.externalRef,
          status: state.status,
          // ★ 공개 회계의 "임원 관련 거래" 배지가 이 값 하나로 뜬다.
          relatedParty: relatedNow,
          approvalId: ap.approvalId,
          enteredBy: me.email,
          verifiedBy: input.verifiedBy,
          verifiedAt: input.verifiedBy ? new Date() : null,
          evidenceUrl,
        },
      });

      await tx.approval.update({
        where: { approvalId: ap.approvalId },
        data: {
          finalStatus: "집행완료",
          note: `${ap.note}${ap.note ? " || " : ""}${manilaDateTimeStr(new Date())} 집행 ${receiptNo} ${formatPeso(paid)} / ${input.method} / ${account.accountId} by ${me.email}${
            lateQuoteUrl ? ` [견적서 집행시 첨부: ${lateQuoteUrl}]` : ""
          }${state.status === "POSTED" ? "" : ` [${state.status}: ${state.reason}]`}`.slice(0, 1500),
        },
      });

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: receiptNo,
        changeType: "INSERT",
        severity:
          relatedNow || lateQuoteUrl ? "WARN" : state.status === "POSTED" ? "INFO" : "WARN",
        afterValue: `OUT ${paid} PHP / ${input.method} / ${account.accountId} / ${state.status}`,
        relatedKey: ap.approvalId,
        note:
          `지출 집행 (${me.officerId} ${me.role}) — 수취인 ${ap.counterpartyName}` +
          (relatedNow ? " / 이해관계자 거래" : "") +
          (lateQuoteUrl ? ` / 견적서를 집행 단계에서 첨부(${lateQuoteUrl})` : "") +
          (state.reason ? ` [${state.reason}]` : ""),
      });

      return {
        receiptNo,
        status: state.status,
        reason: state.reason,
        paid,
        approved: ap.amountPhp,
        counterparty: ap.counterpartyName,
        relatedParty: relatedNow,
        badge: verdict.related ? conflictBadgeText(verdict) : "",
        lateQuote: lateQuoteUrl,
      };
    });

    /* 집행 통지 — 실제 메일은 보내지 않는다. 발송함(/dev/outbox)에서 확인한다. */
    try {
      const to = cfgStr(settings, "알림수신.감사", "");
      if (to) {
        await queueMail({
          kind: "경고",
          toEmail: to,
          subject: `[일로일로 한인회] 지출 집행 ${outcome.receiptNo} (${formatPeso(outcome.paid)})`,
          bodyHtml:
            `승인번호 <b>${input.approvalId}</b> 이(가) 집행되었습니다.<br><br>` +
            `영수증번호: <b>${outcome.receiptNo}</b><br>` +
            `일자: ${input.date}<br>` +
            `금액: <b>${formatPeso(outcome.paid)}</b> (승인 ${formatPeso(outcome.approved)})<br>` +
            `수취인: ${outcome.counterparty}<br>` +
            `수단·계좌: ${input.method} / ${input.accountId}<br>` +
            `상태: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ""}<br>` +
            (outcome.relatedParty ? `<br><b>★ 이해관계자 거래입니다 (${outcome.badge})</b><br>` : "") +
            `<br>집행자: ${me.name} (${me.email})`,
          relatedId: outcome.receiptNo,
          trigger: "executeApprovalAction",
        });
      }
    } catch {
      // 통지 실패로 집행을 되돌리지 않는다. 돈은 이미 나갔고 장부에도 들어갔다.
    }

    revalidatePath(ROUTES.officer);
    revalidatePath(`${ROUTES.officer}/approve`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.ledger);

    const head =
      outcome.status === "POSTED"
        ? `집행을 기록했습니다. 영수증번호 ${outcome.receiptNo} (${formatPeso(outcome.paid)}).`
        : `집행을 기록했으나 미확정(DRAFT)입니다. 영수증번호 ${outcome.receiptNo}. ${outcome.reason}`;
    const partial =
      outcome.paid < outcome.approved
        ? ` 승인 ${formatPeso(outcome.approved)} 중 ${formatPeso(outcome.paid)} 을 집행했습니다 — 잔여분은 별도 승인이 필요합니다.`
        : "";
    const quoteNote = outcome.lateQuote
      ? " ★ 견적서를 집행 단계에서 첨부했습니다 — 결재 시점에 없던 문서이므로 감사로그에 WARN 으로 남았습니다."
      : "";

    return ok(head + partial + quoteNote, {
      receiptNo: outcome.receiptNo,
      status: outcome.status,
      reason: outcome.reason,
      approvalId: input.approvalId,
    });
  } catch (e) {
    return toActionError(e);
  }
}

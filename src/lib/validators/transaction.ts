import { z } from "zod";
import {
  zAccountId,
  zAmount,
  zCategoryCode,
  zDateStr,
  zEmail,
  zEvidenceUrl,
  zFundId,
  zOptText,
  zReceiptNo,
  zText,
  zVendorId,
} from "./common";
import { zCounterpartyType, zCurrency, zPayMethod } from "./enums";

/**
 * 05_거래 쓰기 경로의 입력 검증.
 *
 * ★ 여기 통과했다고 POSTED 가 되는 게 아니다.
 *   최종 상태는 서버가 domain/invariants.ts 의 evaluateTxState 로 정한다(I3/I4).
 *   클라이언트가 status 를 보내오면 **무시해라.** 그래서 이 스키마에 status 가 없다.
 */

/** 수납(수입) 1건. 총무가 그 자리에서 기록한다. */
export const receiptInputSchema = z.object({
  /** 납부자 — 회원번호(M0007) 또는 성명 */
  payer: zText(60, "납부자"),
  /** 회원번호를 특정했으면 함께 보낸다 */
  memberNo: z.string().trim().regex(/^M\d{4,}$/).optional(),
  amount: zAmount,
  currency: zCurrency.default("PHP"),
  method: zPayMethod,
  categoryCode: zCategoryCode,
  fundId: zFundId,
  accountId: zAccountId.optional(),
  date: zDateStr,
  externalRef: zOptText(60),
  memo: zOptText(200),
  /** 확인자 이메일 — 현금 고액이면 필수(I4). 입력자와 달라야 한다 */
  verifiedBy: zEmail.or(z.literal("")).default(""),
  evidenceUrl: zEvidenceUrl,
  /** 사진 없이 임시(DRAFT)로 기록하겠다는 명시적 확인 */
  ackNoEvidence: z.boolean().default(false),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

/** 지출 1건. 반드시 승인(approvalId)이 붙어야 POSTED 가 될 수 있다. */
export const expenseInputSchema = z.object({
  approvalId: z.string().trim().regex(/^AP-\d{4}-\d{4,}$/, "승인ID는 AP-2026-0001 형식입니다."),
  amount: zAmount,
  currency: zCurrency.default("PHP"),
  method: zPayMethod,
  categoryCode: zCategoryCode,
  fundId: zFundId,
  accountId: zAccountId,
  date: zDateStr,
  counterpartyType: zCounterpartyType,
  /** 수취인 — ★ 이해상충 판정의 유일한 입력. 자유 텍스트에 묻지 마라 */
  counterpartyName: zText(80, "수취인"),
  /** 매칭된 업소가 있으면 ID */
  vendorId: zVendorId.optional(),
  externalRef: zOptText(60),
  memo: zOptText(200),
  verifiedBy: zEmail.or(z.literal("")).default(""),
  evidenceUrl: zEvidenceUrl,
  ackNoEvidence: z.boolean().default(false),
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/**
 * 무효 처리 (I1).
 * ★ 삭제가 아니다. 원 거래는 VOIDED 로 남고 역분개가 새 번호로 하나 더 생긴다.
 */
export const voidInputSchema = z.object({
  receiptNo: zReceiptNo,
  reason: zText(200, "무효사유"),
  /** 역분개를 기록할 날짜. 마감 연도면 서버가 거부한다(I5) */
  reversalDate: zDateStr,
});
export type VoidInput = z.infer<typeof voidInputSchema>;

/** DRAFT → POSTED 승격 (확인자를 채워 넣는 경로). */
export const confirmInputSchema = z.object({
  receiptNo: zReceiptNo,
  verifiedBy: zEmail,
  evidenceUrl: zEvidenceUrl,
});
export type ConfirmInput = z.infer<typeof confirmInputSchema>;

/** 현금실사 1건 (17_현금실사). 실사자 두 명은 서로 달라야 한다. */
export const cashCountInputSchema = z
  .object({
    accountId: zAccountId,
    countedBalance: z.union([z.string(), z.number()]).transform((v) => Math.round(Number(String(v).replace(/[,\s₱P]/gi, "")))),
    diffReason: zOptText(200),
    counter1: zEmail,
    counter2: zEmail,
    photoUrl: zEvidenceUrl,
  })
  .refine((v) => v.counter1 !== v.counter2, {
    message: "실사자 두 명은 서로 다른 사람이어야 합니다. 혼자 세고 혼자 확인한 것은 실사가 아닙니다.",
    path: ["counter2"],
  });
export type CashCountInput = z.infer<typeof cashCountInputSchema>;

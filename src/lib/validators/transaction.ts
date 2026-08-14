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
import { zCounterpartyType, zCurrency, zDirection, zPayMethod } from "./enums";

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

/* ── [추가] 직접 입력 장부 (/officer/book) ─────────────────────────────── */

/**
 * 장부 한 줄. 수입·지출을 같은 스키마로 받는다.
 *
 * 예전 receiptInputSchema / expenseInputSchema 와 다른 점:
 *   · direction 을 명시한다 (한 화면에서 둘 다 적으므로)
 *   · approvalId 가 없다 — 사전 승인 절차를 없앴다
 *   · ackNoEvidence 가 없다 — 증빙이 없어도 확정되고 배지가 붙는다
 *     (예전에는 "사진 없이 임시로 기록하겠습니다" 를 체크해야 통과했다.
 *      돈이 실제로 움직인 사실을 사람의 체크박스에 의존해 기록하던 셈이라 없앤다)
 *
 * ★ status 는 여기에도 없다. 직접 입력 경로는 서버가 언제나 POSTED 로 적는다.
 */
export const bookEntrySchema = z.object({
  direction: zDirection,
  date: zDateStr,
  amount: zAmount,
  currency: zCurrency.default("PHP"),
  method: zPayMethod,
  categoryCode: zCategoryCode,
  fundId: zFundId,
  accountId: zAccountId,
  /** 상대방 — 지출이면 수취인, 수입이면 납부자. ★ 이해상충 판정의 유일한 입력 */
  counterpartyName: zText(80, "상대방"),
  counterpartyType: zCounterpartyType.default("비회원"),
  /** 회원을 특정했으면 함께 보낸다 (회비 대사에 쓰인다) */
  memberNo: z.string().trim().regex(/^M\d{4,}$/).optional(),
  /** 매칭된 업소가 있으면 ID */
  vendorId: zVendorId.optional(),
  /** 행사 정산에 묶을 때 (Event.settlementReceiptNos 에 붙는다) */
  eventId: z.string().trim().regex(/^EV\d{2,}$/, "행사ID는 EV01 형식입니다.").optional(),
  externalRef: zOptText(60),
  memo: zOptText(200),
  /** 현금 고액이면 채우기를 권한다. 비어도 저장은 되고 '미확인현금' 배지가 붙는다 */
  verifiedBy: zEmail.or(z.literal("")).default(""),
  evidenceUrl: zEvidenceUrl,
});
export type BookEntryInput = z.infer<typeof bookEntrySchema>;

/** 이미 적은 줄을 고칠 때. 영수증번호는 바뀌지 않는다(I2). */
export const bookEditSchema = bookEntrySchema.extend({
  receiptNo: zReceiptNo,
});
export type BookEditInput = z.infer<typeof bookEditSchema>;

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

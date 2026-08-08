import { z } from "zod";
import {
  zAmount,
  zApprovalId,
  zCategoryCode,
  zEvidenceUrl,
  zFundId,
  zOptText,
  zText,
  zVendorId,
} from "./common";
import { zApprovalKind, zCurrency } from "./enums";

/**
 * 11_승인 입력 검증.
 *
 * ★ counterpartyName(수취인) 은 **필수**다.
 *   예전에는 수취인을 사유 텍스트에 묻어두고 정규식으로 꺼냈는데,
 *   "- 오톤 하드웨어" 처럼 하이픈으로 시작하면 캡처값이 공백 한 칸이 되어
 *   이해관계자 판정이 통째로 건너뛰어졌다. 임원이 자기 업체에 발주하고 스스로 승인할 수 있었다.
 *   → 전용 필드로 받는다. 비어 있으면 접수하지 않는다.
 */

export const approvalRequestSchema = z.object({
  kind: zApprovalKind.default("지출"),
  amount: zAmount,
  currency: zCurrency.default("PHP"),
  fundId: zFundId,
  categoryCode: zCategoryCode,
  reason: zText(300, "사유"),
  /** ★ 이해상충 판정의 유일한 입력 */
  counterpartyName: zText(80, "수취인"),
  vendorId: zVendorId.optional(),
  quoteUrl: zEvidenceUrl,
  note: zOptText(200),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/**
 * 승인/반려 처리.
 * ★ stage 를 클라이언트가 보내오지만 서버는 믿지 않는다 —
 *   canOfficerApprove 가 계산한 stage 와 다르면 거부한다.
 */
export const approvalDecisionSchema = z.object({
  approvalId: zApprovalId,
  decision: z.enum(["승인", "반려"]),
  stage: z.union([z.literal(1), z.literal(2)]),
  comment: zOptText(300),
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/** 이해상충 신고 (13_이해상충). */
export const conflictDeclareSchema = z.object({
  declarerMemberNo: z.string().trim().regex(/^M\d{4,}$/),
  counterpartyType: z.enum(["업소", "법인", "개인"]),
  counterpartyName: zText(80, "상대방명"),
  relationType: z.enum(["본인", "가족", "사업파트너", "지분보유", "기타"]),
  vendorId: zVendorId.optional(),
  detail: zOptText(500),
  /** 지분율 0~100. 모르면 보내지 마라 — 0 과 "모름" 은 다르다 */
  ownershipPct: z.number().int().min(0).max(100).optional(),
  disclosed: z.boolean().default(true),
});
export type ConflictDeclare = z.infer<typeof conflictDeclareSchema>;

import { z } from "zod";
import { zAccountId, zAmount, zDateStr, zEmail, zFundId, zOptText, zPhone, zText } from "./common";
import { zAttendance, zCurrency, zDonorType, zPayMethod } from "./enums";

/**
 * 07_기부 · 10_행사신청 입력 검증.
 *
 * ★ 기부자 실명은 **공개동의(publicConsent)=true 이고 익명(isAnonymous)=false 일 때만**
 *   공개 목록에 나간다. 그것도 publicDisplayName(본인이 정한 표기)으로만.
 */

export const donationInputSchema = z
  .object({
    donorType: zDonorType,
    donorMemberNo: z.string().trim().regex(/^M\d{4,}$/).optional(),
    donorName: zOptText(40),
    donorPhone: zPhone.or(z.literal("")).default(""),
    donorEmail: zEmail.or(z.literal("")).default(""),
    amount: zAmount,
    currency: zCurrency.default("PHP"),
    method: zPayMethod,
    accountId: zAccountId.optional(),
    receivedOn: zDateStr,

    /** 지정기부면 기금을 반드시 고른다 — 목적외 사용을 막는 축이다 */
    isDesignated: z.boolean().default(false),
    fundId: zFundId.optional(),
    designatedPurpose: zOptText(200),

    isAnonymous: z.boolean().default(false),
    publicConsent: z.boolean().default(false),
    /** 공개동의 시 화면에 나갈 표기. '김OO' '아무개 가족' 처럼 본인이 정한다 */
    publicDisplayName: zOptText(40),
    note: zOptText(200),
  })
  .refine((v) => !v.isDesignated || !!v.fundId, {
    message: "지정 기부는 어느 기금에 넣을지 반드시 골라야 합니다(목적외 사용 금지).",
    path: ["fundId"],
  })
  .refine((v) => v.donorType === "익명" || !!v.donorName, {
    message: "기부자명을 적어 주십시오. 이름을 남기고 싶지 않으시면 기부자구분을 '익명' 으로 골라 주십시오.",
    path: ["donorName"],
  })
  .refine((v) => !v.publicConsent || !v.isAnonymous, {
    message: "익명 기부는 공개 목록에 표기할 수 없습니다. 둘 중 하나만 고르십시오.",
    path: ["publicConsent"],
  });
export type DonationInput = z.infer<typeof donationInputSchema>;

/** 08_기부사용 — 지정기금이 어디에 쓰였는지. */
export const donationUseSchema = z.object({
  donationId: z.string().trim().regex(/^DN-\d{4}-\d{4}$/).optional(),
  fundId: zFundId,
  usedOn: zDateStr,
  amount: zAmount,
  currency: zCurrency.default("PHP"),
  receiptNo: z.string().trim().regex(/^[A-Z]+-\d{4}-\d{6,}$/).optional(),
  purposeText: zText(200, "용도설명"),
  evidenceUrl: zOptText(500),
  approvalId: z.string().trim().regex(/^AP-\d{4}-\d{4,}$/).optional(),
});
export type DonationUseInput = z.infer<typeof donationUseSchema>;

/** 10_행사신청 */
export const eventSignupSchema = z.object({
  eventId: z.string().trim().regex(/^EV-\d{4}-\d{2}$/, "행사ID는 EV-2026-01 형식입니다."),
  memberNo: z.string().trim().regex(/^M\d{4,}$/).optional(),
  applicantName: zText(20, "신청자명"),
  phone: zPhone,
  guests: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v) || 0)
    .refine((n) => n >= 0 && n <= 20, "동반 인원은 0~20명 사이로 적어 주십시오."),
  specialNote: zOptText(200),
});
export type EventSignupInput = z.infer<typeof eventSignupSchema>;

/** 참석 처리 (임원). */
export const eventAttendanceSchema = z.object({
  signupId: z.string().trim().min(1),
  attendance: zAttendance,
});
export type EventAttendanceInput = z.infer<typeof eventAttendanceSchema>;

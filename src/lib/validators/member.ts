import { z } from "zod";
import { zDateStr, zEmail, zOptText, zPhone, zText } from "./common";
import { zDuesGrade, zGender, zHouseholdRole, zMemberStatus, zMemberType } from "./enums";

/**
 * 01_회원 입력 검증.
 *
 * ★ 여권번호·ACR I-Card·주민번호는 **수집하지 않는다.** 필드 자체가 없다.
 *   "나중에 필요할지 모르니 받아 두자" 가 개인정보 사고의 시작이다.
 */

/** 공개 가입 폼 (/join). 임원이 아니라 본인이 낸다. */
export const joinInputSchema = z.object({
  name: zText(20, "성명"),
  nameEn: zOptText(60),
  birthYear: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n >= 1920 && n <= new Date().getFullYear(), "출생연도를 4자리로 적어 주십시오.")
    .optional(),
  gender: zGender.default("미기재"),
  phone: zPhone,
  email: zEmail,
  region: zOptText(60),
  householdRole: zHouseholdRole.default("본인"),
  memberType: zMemberType.default("정회원"),
  duesGrade: zDuesGrade.default("정회원"),

  /** 명부공개동의 — 기본 false. 동의하지 않으면 로그인한 회원에게도 이름이 안 보인다 */
  rosterConsent: z.boolean().default(false),
  /** 알림수신동의 — false 면 독촉·안내를 보내지 않는다 */
  notifyConsent: z.boolean().default(true),
  /**
   * 개인정보 수집·이용 동의. ★ 반드시 true 여야 접수한다.
   * 필리핀 DPA(RA 10173)·한국 PIPA 상 동의 시각을 남겨야 하므로 서버가 privacyConsentAt 을 찍는다.
   */
  privacyConsent: z.literal(true, {
    message: "개인정보 수집·이용에 동의하셔야 가입 신청을 접수할 수 있습니다.",
  }),
  note: zOptText(200),
});
export type JoinInput = z.infer<typeof joinInputSchema>;

/** 임원이 회원 정보를 고칠 때. */
export const memberUpdateSchema = z.object({
  memberNo: z.string().trim().regex(/^M\d{4,}$/),
  name: zText(20, "성명").optional(),
  nameEn: zOptText(60).optional(),
  phone: zPhone.optional(),
  email: zEmail.or(z.literal("")).optional(),
  region: zOptText(60).optional(),
  districtTeam: zOptText(40).optional(),
  householdRole: zHouseholdRole.optional(),
  memberType: zMemberType.optional(),
  status: zMemberStatus.optional(),
  duesGrade: zDuesGrade.optional(),
  rosterConsent: z.boolean().optional(),
  notifyConsent: z.boolean().optional(),
  note: zOptText(200).optional(),
});
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

/** 본인 확인 링크로 들어온 회원이 스스로 고칠 수 있는 것만. 등급·상태는 못 고친다. */
export const memberSelfUpdateSchema = z.object({
  phone: zPhone.optional(),
  email: zEmail.or(z.literal("")).optional(),
  region: zOptText(60).optional(),
  rosterConsent: z.boolean().optional(),
  notifyConsent: z.boolean().optional(),
});
export type MemberSelfUpdate = z.infer<typeof memberSelfUpdateSchema>;

/** 링크 토큰 — /me/[token]. 헷갈리는 글자(0 O 1 I L)는 애초에 생성하지 않는다. */
export const zLinkToken = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, "본인 확인 링크가 올바르지 않습니다.");

/** 회비 고지 생성 (연 1회). */
export const duesIssueSchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  billedOn: zDateStr,
  dueOn: zDateStr,
});
export type DuesIssueInput = z.infer<typeof duesIssueSchema>;

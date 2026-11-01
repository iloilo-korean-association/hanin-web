import { z } from "zod";
import { zDateStr, zEmail, zMemberNo, zOptText, zPhone, zText } from "./common";
import { zDuesGrade, zGender, zHouseholdRole, zMemberStatus, zMemberType } from "./enums";

/**
 * 01_회원 입력 검증.
 *
 * ★ 여권번호·ACR I-Card·주민번호는 **수집하지 않는다.** 필드 자체가 없다.
 *   "나중에 필요할지 모르니 받아 두자" 가 개인정보 사고의 시작이다.
 */

/* ── 영문 이름 (성명_영문 — 선택 항목, 2026-11-01) ───────────────────────
 *  대표 결정 2026-11-01: 영문 이름은 **선택**이다. 적으면 회원증(/me/card·PNG)에 한글 이름 아래
 *  한 줄로 찍히고, 비어 있으면 회원증에 한글 이름만 보인다. 필수로 받거나 관문으로 막지 않는다. */

export const NAME_EN_MAX = 60;

/**
 * 영문 이름 정규화 — trim → 연속 공백 1개 → **대문자**.
 * 여권 영문 표기 관례(대문자)에 맞춘다. 회원이 소문자로 쳐도 저장은 대문자다.
 * 가입·본인 수정(/me)·임원 수정이 모두 이 함수를 거친 값을 저장·비교한다.
 */
export function normalizeNameEn(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** 한글 음절·자모가 하나라도 섞여 있나 (오류 문장을 "영문자만" 으로 고르기 위해 따로 본다). */
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;
/** 허용 문자: 영문자·공백·하이픈·어포스트로피·마침표. 첫 글자는 영문자. (정규화 뒤라 대문자만 본다) */
const NAME_EN_RE = /^[A-Z][A-Z .'-]*$/;

/**
 * 정규화된 **비어 있지 않은** 영문 이름의 문제점. 없으면 null.
 * 빈 값은 여기 오기 전에 zNameEnOrEmpty 가 "선택 — 통과" 로 가른다.
 */
export function nameEnProblem(normalized: string): string | null {
  if (HANGUL_RE.test(normalized)) return "영문자만 적어 주십시오. 예: HONG GILDONG";
  if (normalized.length < 2) return "영문 이름은 2자 이상 적어 주십시오.";
  if (normalized.length > NAME_EN_MAX) return `영문 이름은 ${NAME_EN_MAX}자 이내로 적어 주십시오.`;
  if (!NAME_EN_RE.test(normalized)) {
    return "영문 이름은 영문자·공백·하이픈(-)·어포스트로피(')·마침표(.)만 쓸 수 있고, 첫 글자는 영문자여야 합니다. 예: HONG GILDONG";
  }
  return null;
}

/**
 * 영문 이름 — **선택(빈 값 허용)**. 가입(joinInputSchema)·본인 수정(memberSelfUpdateSchema)·
 * 임원 수정(memberUpdateSchema)이 전부 이 하나를 쓴다.
 * 비우면 "" 로 저장(회원증에 영문 줄이 안 그려진다). 적으면 대문자로 정규화해 문자 규칙을 본다.
 */
export const zNameEnOrEmpty = z
  .string()
  .transform(normalizeNameEn)
  .superRefine((s, ctx) => {
    if (s === "") return;
    const problem = nameEnProblem(s);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/**
 * 공개 가입 폼 (/join). 임원이 아니라 본인이 낸다.
 * 폼이 받는 것은 성명·연락처·이메일(+비밀번호·개인정보 동의) 4칸이고, 영문 이름은 **선택** 칸이다
 * (2026-10-22 4칸 — 대표 결정, 영문 이름 선택 칸은 2026-11-01).
 * 회원구분·회비등급·동의 두 가지는 actions.ts 가 고정값을 넣고, 나머지는 기본값으로 채운다.
 */
export const joinInputSchema = z.object({
  name: zText(20, "이름"), // 가입 폼 라벨이 '이름' 이다(2026-10-22)
  /** 여권 영문 표기. 선택 — 비우면 "". 적으면 대문자로 정규화해 저장한다(zNameEnOrEmpty) */
  nameEn: zNameEnOrEmpty,
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

/**
 * 임원이 회원 정보를 고칠 때 (/officer/members/[회원번호], 2026-10-22).
 *
 * 받는 칸 = 가입 칸(이름·영문 이름·연락처·이메일 — 비밀번호는 [비밀번호 재설정] 버튼) +
 *   가입에서 뺀 칸(출생연도·거주 지역·회비등급·비고·명부공개/알림수신 동의) + 상태.
 * 회원구분은 받지 않는다 — 회비등급을 따라간다(domain/memberEdit.ts memberTypeForGrade).
 * 회원번호·가입일·링크토큰은 읽기 전용이라 칸이 없다.
 *
 * ★ 연락처·이메일은 **비워도 된다.** 장부 임포트로 들어온 회원 대부분이 연락처·이메일 없이
 *   등록돼 있어서(2026-10-22 운영 DB 49명 중 44명), 가입처럼 필수로 두면 그 회원들의
 *   회비등급 하나 고치는 저장도 막힌다. 적으면 형식은 가입과 같은 규칙으로 본다.
 * ★ 이메일은 zEmail 이 trim·소문자로 바꿔 저장한다(가입·로그인과 같은 형태).
 * ★ 영문 이름은 어디서나 **선택**이다(zNameEnOrEmpty — 가입·본인 수정과 같은 규칙, 대문자 저장).
 *   2026-11-01 운영 49명 전원 빈 값. 비어 있으면 회원증에 한글 이름만 나간다.
 */
export const memberUpdateSchema = z.object({
  memberNo: zMemberNo,
  name: zText(20, "이름"),
  nameEn: zNameEnOrEmpty,
  phone: z
    .string()
    .trim()
    .max(30, "연락처는 30자 이내로 적어 주십시오.")
    .refine((s) => s === "" || s.replace(/\D/g, "").length >= 7, "전화번호를 확인해 주십시오(숫자 7자리 이상). 모르면 비워 두십시오."),
  email: zEmail.max(100, "이메일은 100자 이내로 적어 주십시오.").or(z.literal("")),
  /** 비우면 null. 적으면 4자리 연도 */
  birthYear: z
    .string()
    .trim()
    .refine(
      (s) => s === "" || (/^\d{4}$/.test(s) && Number(s) >= 1920 && Number(s) <= new Date().getFullYear()),
      "출생연도는 4자리 숫자로 적거나 비워 두십시오(예: 1965).",
    )
    .transform((s) => (s === "" ? null : Number(s))),
  region: zOptText(60),
  duesGrade: zDuesGrade,
  status: zMemberStatus,
  note: zOptText(200),
  rosterConsent: z.boolean(),
  notifyConsent: z.boolean(),
});
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

/**
 * 본인(/me · /me/[token])이 스스로 고칠 수 있는 것만. 한글 성명·등급·상태는 못 고친다.
 * 영문 이름은 본인이 넣고 고칠 수 있다(2026-11-01, 선택) — 저장되면 회원증에 바로 반영된다.
 */
export const memberSelfUpdateSchema = z.object({
  /** 선택. 비우면 "" (회원증에서 영문 줄이 사라진다). 적으면 가입·임원 수정과 같은 규칙으로 대문자 저장 */
  nameEn: zNameEnOrEmpty.optional(),
  phone: zPhone.optional(),
  email: zEmail.or(z.literal("")).optional(),
  region: zOptText(60).optional(),
  rosterConsent: z.boolean().optional(),
  notifyConsent: z.boolean().optional(),
});
export type MemberSelfUpdate = z.infer<typeof memberSelfUpdateSchema>;

/* ── 회원 비밀번호 (P1) ────────────────────────────────────────────────── */

/**
 * 비밀번호 규칙 — 8자 이상.
 * 상한 72자는 bcrypt 가 72바이트 이후를 조용히 잘라 버리기 때문이다(초과분은 검증에 안 쓰인다).
 * 복잡도 규칙(특수문자 강제 등)은 두지 않는다 — 60대 회원이 대상이고,
 * 길이 제한 + 5회 잠금이 실질 방어다.
 */
export const zMemberPassword = z
  .string()
  .min(8, "비밀번호는 8자 이상으로 정해 주십시오.")
  .max(72, "비밀번호는 72자 이내로 정해 주십시오.");

/**
 * 가입 폼의 비밀번호. joinInputSchema 와 별도로 parse 한다(기존 소비처 불변).
 * 확인 칸은 없다(대표 결정 2026-10-22 — 가입은 4칸). 대신 폼에 '보기' 토글이 있다.
 * /me/password 변경(memberPasswordChangeSchema)은 확인 칸을 그대로 받는다.
 */
export const joinPasswordSchema = z.object({
  password: zMemberPassword,
});
export type JoinPasswordInput = z.infer<typeof joinPasswordSchema>;

/** 로그인한 회원 본인의 비밀번호 변경 (/me/password). */
export const memberPasswordChangeSchema = z
  .object({
    /** 임시 비밀번호로 들어온 경우에도 "지금 로그인에 쓴 그 비밀번호" 를 다시 받는다. */
    currentPassword: z.string().min(1, "현재 비밀번호를 입력해 주십시오."),
    newPassword: zMemberPassword,
    newPasswordConfirm: z.string(),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirm, {
    path: ["newPasswordConfirm"],
    message: "새 비밀번호 확인이 일치하지 않습니다.",
  });
export type MemberPasswordChangeInput = z.infer<typeof memberPasswordChangeSchema>;

/** 링크 토큰 — /me/[token]. 헷갈리는 글자(0 O 1 I L)는 애초에 생성하지 않는다. */
export const zLinkToken = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, "본인 확인 링크가 올바르지 않습니다.");

/* ── 회원 사진 · 디지털 회원증 (P3) ────────────────────────────────────── */

/**
 * 회원 본인의 사진 업로드.
 *
 * ★ photoConsent 는 **반드시 true** 여야 한다. 명부공개동의(rosterConsent)와 별개의
 *   독립 동의다 — 수집 목적이 다르다(회원증 발급 및 본인 확인). 필리핀 DPA(RA 10173)
 *   상 목적별 동의와 그 시각을 남겨야 하므로 서버가 photoConsentAt 을 찍는다.
 *   업로드 1회 = 수집 1회이므로 재업로드 때도 다시 받는다.
 *
 * ★ 사진 데이터(dataURL)는 여기서 검증하지 않는다. 형식·크기·MIME 검사는
 *   저장 어댑터(_lib/upload.ts)가 한 곳에서 한다 — 두 군데서 검사하면 반드시 어긋난다.
 */
export const memberPhotoUploadSchema = z.object({
  photoConsent: z.literal(true, {
    message:
      "사진 수집·이용(회원증 발급 및 본인 확인)에 동의하셔야 사진을 올리실 수 있습니다.",
  }),
});
export type MemberPhotoUploadInput = z.infer<typeof memberPhotoUploadSchema>;

/**
 * 총무의 사진 검수.
 * 반려는 사유가 **필수**다. 사유 없는 반려는 회원이 무엇을 고쳐야 할지 알 수 없어
 * 총무에게 전화가 오고, 결국 검수가 멈춘다.
 */
export const memberPhotoReviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("승인"),
    memberNo: zMemberNo,
  }),
  z.object({
    decision: z.literal("반려"),
    memberNo: zMemberNo,
    rejectReason: zText(200, "반려 사유"),
  }),
]);
export type MemberPhotoReviewInput = z.infer<typeof memberPhotoReviewSchema>;

/** 회비 고지 생성 (연 1회). */
export const duesIssueSchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  billedOn: zDateStr,
  dueOn: zDateStr,
});
export type DuesIssueInput = z.infer<typeof duesIssueSchema>;

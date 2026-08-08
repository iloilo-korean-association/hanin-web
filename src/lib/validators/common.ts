import { z } from "zod";

/**
 * 여기저기서 쓰는 기본 검증 조각들.
 *
 * ★ 클라이언트 검증만 믿지 마라. 모든 쓰기 경로에서 서버가 다시 parse 한다.
 *   화면에서 버튼을 숨기는 것은 통제가 아니다.
 */

/** 'yyyy-MM-dd'. 실제로 존재하는 날짜인지까지 본다(2026-02-30 을 거른다). */
export const zDateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 연-월-일(2026-03-15) 형식이어야 합니다.")
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "존재하지 않는 날짜입니다.");

export const zOptionalDateStr = zDateStr.or(z.literal("")).transform((v) => (v === "" ? null : v));

/** 소문자로 정규화된 이메일. 빈 값 허용이 필요하면 .or(z.literal("")) 를 붙인다. */
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("이메일 주소 형식이 올바르지 않습니다.");

/**
 * 필리핀·한국 전화번호. 형식을 엄격하게 잡지 않는다 —
 * 60대 회원이 '0917 123 4567' 로도 '+639171234567' 로도 적는다. 숫자 7자리 이상이면 받는다.
 */
export const zPhone = z
  .string()
  .trim()
  .refine((s) => s.replace(/\D/g, "").length >= 7, "전화번호를 확인해 주십시오(숫자 7자리 이상).");

/**
 * 금액. 쉼표·₱·공백이 섞여 들어와도 정수로 만든다.
 * ★ 소수점은 버림이 아니라 반올림한다(원본 toInt_ 과 동일).
 */
export const zAmount = z
  .union([z.string(), z.number()])
  .transform((v) => {
    if (typeof v === "number") return Math.round(v);
    const n = Number(String(v).replace(/[,\s₱P]/gi, ""));
    return Number.isFinite(n) ? Math.round(n) : Number.NaN;
  })
  .refine((n) => Number.isFinite(n), "금액을 숫자로 적어 주십시오.")
  .refine((n) => n > 0, "금액은 0보다 커야 합니다.");

/** 0 도 허용하는 금액(예산·목표금액 등). */
export const zAmount0 = z
  .union([z.string(), z.number()])
  .transform((v) => {
    if (typeof v === "number") return Math.round(v);
    const n = Number(String(v).replace(/[,\s₱P]/gi, ""));
    return Number.isFinite(n) ? Math.round(n) : Number.NaN;
  })
  .refine((n) => Number.isFinite(n) && n >= 0, "금액은 0 이상의 숫자여야 합니다.");

/** 비어 있으면 안 되는 짧은 텍스트. */
export const zText = (max: number, label: string) =>
  z.string().trim().min(1, `${label}을(를) 적어 주십시오.`).max(max, `${label}은(는) ${max}자 이내로 적어 주십시오.`);

/** 비어도 되는 텍스트. null 대신 빈 문자열로 통일한다(DB 기본값이 "" 이다). */
export const zOptText = (max: number) => z.string().trim().max(max).default("");

/** 회원번호 M0001 */
export const zMemberNo = z.string().trim().regex(/^M\d{4,}$/, "회원번호는 M0001 형식입니다.");

/** 영수증번호 IKA-2026-000001 */
export const zReceiptNo = z
  .string()
  .trim()
  .regex(/^[A-Z]+-\d{4}-\d{6,}$/, "영수증번호는 IKA-2026-000001 형식입니다.");

/** 업소ID VD001 */
export const zVendorId = z.string().trim().regex(/^VD\d{3,}$/, "업소ID는 VD001 형식입니다.");

/** 계좌ID AC01 */
export const zAccountId = z.string().trim().regex(/^AC\d{2,}$/, "계좌ID는 AC01 형식입니다.");

/** 기금ID FD01 */
export const zFundId = z.string().trim().regex(/^FD\d{2,}$/, "기금ID는 FD01 형식입니다.");

/** 과목코드 R100 / E200 */
export const zCategoryCode = z.string().trim().regex(/^[RE]\d{3}$/, "과목코드는 R100 · E200 형식입니다.");

/** 승인ID AP-2026-0001 */
export const zApprovalId = z.string().trim().regex(/^AP-\d{4}-\d{4,}$/, "승인ID는 AP-2026-0001 형식입니다.");

/**
 * URL. 로컬 프로토타입은 실제 파일 업로드를 하지 않으므로
 * '/uploads/…' 같은 상대 경로도 증빙으로 인정한다.
 */
export const zEvidenceUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^(https?:\/\/|\/)/.test(s), "증빙 주소는 http(s):// 또는 / 로 시작해야 합니다.")
  .default("");

/** Y/N 문자열도 boolean 도 받는다. 시트에서 옮겨올 때 필요하다. */
export const zYesNo = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : String(v).trim().toUpperCase() === "Y"));

/** zod 실패 메시지를 사람이 읽을 한 줄로. */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "입력값을 확인해 주십시오.";
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  return path + i.message;
}

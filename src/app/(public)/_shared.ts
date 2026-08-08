/**
 * 공개 신청 폼 4종(/join · /donate · /events · /help)이 함께 쓰는 작은 조각들.
 *
 * ★ 이 파일은 클라이언트 컴포넌트에서도 import 된다(상태 타입 때문에).
 *   그래서 zod·prisma·server-only 를 **런타임으로** 끌어오지 않는다.
 *   ZodError 는 `import type` 이라 컴파일 후 사라진다.
 */
import type { ZodError } from "zod";

/** 필드명 → 그 필드에 붙일 오류 문장. Field 컴포넌트의 error 로 그대로 넘어간다. */
export type FieldErrors = Record<string, string>;

export type IdleState = { readonly status: "idle" };

export type ErrorState = {
  readonly status: "error";
  /** 화면 상단 Alert 에 그대로 나가는 문장. "오류가 발생했습니다" 로 끝내지 마라. */
  readonly message: string;
  /** 그래서 무엇을 하면 되는가. 없으면 사용자는 총무에게 전화한다. */
  readonly howToFix?: string | null;
  readonly fields?: FieldErrors;
};

/** 서버 액션 결과 = 대기 / 실패 / 성공(T). useActionState 의 상태 타입이다. */
export type FormResult<T> = IdleState | ErrorState | ({ readonly status: "ok" } & T);

export const IDLE: IdleState = { status: "idle" };

export function fail(
  message: string,
  howToFix?: string | null,
  fields?: FieldErrors,
): ErrorState {
  return { status: "error", message, howToFix: howToFix ?? null, fields };
}

/** FormData 문자열 하나. 파일이 들어와도 빈 문자열이 된다. */
export function textOf(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** 체크박스. 브라우저는 체크됐을 때만 값을 보낸다("on"). */
export function boolOf(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "Y" || v === "1";
}

/**
 * zod 실패를 필드별 문장으로 흩뿌린다.
 * 경로가 없는 오류(.refine 을 객체 전체에 건 경우)는 "_form" 키로 모은다.
 */
export function zodFieldErrors(err: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** 화면 상단에 띄울 대표 문장 한 줄. */
export function zodSummary(err: ZodError): string {
  const first = err.issues[0];
  return first?.message ?? "입력값을 확인해 주십시오.";
}

/**
 * 이중 제출 방지 키.
 *
 * 브라우저 새로고침·따닥 클릭·뒤로가기 후 재전송은 **같은 폼을 두 번 저장한다.**
 * 폼을 그릴 때 난수를 하나 심어 두고(hidden), 저장할 때 그 값을 레코드에 남긴다.
 * 두 번째 요청은 같은 키를 가진 레코드를 먼저 찾아 첫 번째 결과를 그대로 돌려준다.
 *
 * 01_회원.폼응답ID / 10_행사신청.폼응답ID 가 원래 이 용도의 열이다(구글폼 응답ID).
 * 웹에서 들어온 것은 접두사 WEB! 로 구분한다.
 */
export const IDEMPOTENCY_PREFIX = "WEB!";

export function idempotencyKey(token: string): string {
  return IDEMPOTENCY_PREFIX + token;
}

/** 폼 1회분 난수. 서버 컴포넌트에서 만들어 hidden 으로 내린다. */
export function newFormToken(): string {
  // 서버 컴포넌트에서만 불린다. crypto 는 Node 18+ 전역.
  return crypto.randomUUID();
}

/** 숫자만 남긴다. */
export function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/**
 * 같은 사람의 같은 번호인가를 판정하는 키.
 *
 * ★ 숫자만 남기는 것으로는 부족하다. 같은 휴대폰을 이렇게들 적는다:
 *     '0917 222 3344'  → 09172223344   (11자리, 국내표기)
 *     '+63 917 222 3344' → 639172223344 (12자리, 국가번호)
 *   앞자리가 달라 문자열 비교로는 다른 번호가 된다(실제로 중복 신청이 통과하는 것을 확인했다).
 *   필리핀·한국 모두 가입자 번호가 뒤쪽 10자리에 들어가므로 **뒤 10자리**로 비교한다.
 *     0917 2223344 → 9172223344   /  +63 917 2223344 → 9172223344   ✔ 일치
 *     010 1234 5678 → 1012345678  /  +82 10 1234 5678 → 1012345678  ✔ 일치
 *   10자리가 안 되면(유선 등) 있는 그대로 비교한다.
 */
export function phoneKey(s: string): string {
  const d = digitsOnly(s);
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * 거주 지역 선택지 — 구글폼 F1 문항 5 그대로.
 *
 * 원문의 `Iloilo City (Proper)` 는 원장에 이미 들어 있는 표기 `Iloilo City Proper` 로 통일했다.
 * 같은 지역이 두 가지 문자열로 쌓이면 지역반 집계가 갈라진다.
 *
 * 가입 폼과 회원 본인 수정 화면이 **같은 목록**을 써야 한다. 두 군데에 적으면 반드시 어긋난다.
 */
export const REGIONS = [
  "Iloilo City Proper",
  "Jaro",
  "Mandurriao",
  "La Paz",
  "Molo",
  "Arevalo",
  "Lapuz",
  "Oton",
  "Pavia",
  "Santa Barbara",
  "기타 (일로일로 외곽)",
] as const;

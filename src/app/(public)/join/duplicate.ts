import { phoneKey } from "../_shared";

/**
 * /join 중복 가입 판정 — 순수 함수(DB 를 모른다). 후보는 actions.ts 가 읽어 넘긴다.
 *
 * 기준 (대표 결정 2026-10-22): 이미 가입된(WITHDRAWN 제외) **연락처 또는 이메일**이면 거부.
 *   예전 기준 "성명 + 출생연도 + 연락처 뒷4자리" 는 가입 폼에서 출생연도를 빼면서 버렸다.
 *
 * · 연락처 — phoneKey(숫자만 남기고 뒤 10자리)로 비교한다. 행사 신청 중복 검사와 같은 함수다.
 *     '0917 123 4567' · '+63 917-123-4567' · '09171234567' → 전부 9171234567 로 같은 번호.
 *   숫자가 7자리 미만이면(빈 값 포함) 비교하지 않는다 — 빈 번호끼리 '같다' 고 판정하면 안 된다.
 * · 이메일 — trim + 소문자로 비교한다. 빈 값은 비교하지 않는다.
 * · status 가 WITHDRAWN 인 후보는 무시한다(쿼리에서도 거르지만 여기서도 한 번 더 본다).
 */

export interface JoinDupCandidate {
  phone: string;
  email: string;
  status: string;
}

export interface JoinDupHit {
  phone: boolean;
  email: boolean;
}

export function normalizeJoinEmail(e: unknown): string {
  return String(e ?? "").trim().toLowerCase();
}

/** 걸리면 무엇이 겹쳤는지, 안 걸리면 null. 어느 회원과 겹쳤는지는 돌려주지 않는다. */
export function findJoinDuplicate(
  candidates: readonly JoinDupCandidate[],
  input: { phone: string; email: string },
): JoinDupHit | null {
  const myPhone = phoneKey(input.phone);
  const myEmail = normalizeJoinEmail(input.email);
  let phone = false;
  let email = false;
  for (const c of candidates) {
    if (c.status === "WITHDRAWN") continue;
    if (myPhone.length >= 7 && phoneKey(c.phone) === myPhone) phone = true;
    if (myEmail && normalizeJoinEmail(c.email) === myEmail) email = true;
  }
  return phone || email ? { phone, email } : null;
}

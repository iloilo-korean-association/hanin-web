/**
 * 회원 연락처·이메일 중복 판정 — 순수 함수(DB 를 모른다). 후보는 호출자가 읽어 넘긴다.
 *
 * 쓰는 곳 세 군데가 **같은 규칙**이어야 한다 — 갈라지면 한쪽이 우회로가 된다.
 *   ① 가입 (/join)                         — 이미 가입된 연락처·이메일이면 거부
 *   ② 임원 회원 정보 수정 (/officer/members/[회원번호])
 *   ③ 회원 본인 '내 정보' 수정 (/me/[token], /me)
 *   (원래 src/app/(public)/join/duplicate.ts 에 있던 것을 2026-10-22 여기로 옮겼다)
 *
 * 기준 (대표 결정 2026-10-22): 이미 가입된(WITHDRAWN 제외) **연락처 또는 이메일**이면 거부.
 *
 * · 연락처 — phoneKey(숫자만 남기고 뒤 10자리)로 비교한다. 행사 신청 중복 검사와 같은 함수다.
 *     '0917 123 4567' · '+63 917-123-4567' · '09171234567' → 전부 9171234567 로 같은 번호.
 *   숫자가 7자리 미만이면(빈 값 포함) 비교하지 않는다 — 빈 번호끼리 '같다' 고 판정하면 안 된다.
 * · 이메일 — trim + 소문자로 비교한다. 빈 값은 비교하지 않는다.
 * · status 가 WITHDRAWN 인 후보는 무시한다(쿼리에서도 거르지만 여기서도 한 번 더 본다).
 * · excludeMemberNo — 정보 **수정**일 때 자기 자신은 후보에서 뺀다.
 *
 * ★ 이 파일은 import 가 하나도 없다. (public)/_shared.ts 가 phoneKey 를 여기서 다시 내보내고,
 *   _shared.ts 는 클라이언트 번들에도 들어가기 때문이다. 무거운 모듈을 끌어오지 마라.
 */

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

/** 이메일 비교·저장 키 — trim + 소문자. */
export function normalizeMemberEmail(e: unknown): string {
  return String(e ?? "").trim().toLowerCase();
}

export interface MemberDupCandidate {
  /** 수정 경로에서 자기 자신을 빼려면 채운다. 가입 경로는 없어도 된다. */
  memberNo?: string;
  phone: string;
  email: string;
  status: string;
}

export interface MemberDupHit {
  phone: boolean;
  email: boolean;
}

/** 걸리면 무엇이 겹쳤는지, 안 걸리면 null. 어느 회원과 겹쳤는지는 돌려주지 않는다. */
export function findMemberDuplicate(
  candidates: readonly MemberDupCandidate[],
  input: { phone: string; email: string; excludeMemberNo?: string },
): MemberDupHit | null {
  const myPhone = phoneKey(input.phone);
  const myEmail = normalizeMemberEmail(input.email);
  let phone = false;
  let email = false;
  for (const c of candidates) {
    if (c.status === "WITHDRAWN") continue;
    if (input.excludeMemberNo && c.memberNo === input.excludeMemberNo) continue;
    if (myPhone.length >= 7 && phoneKey(c.phone) === myPhone) phone = true;
    if (myEmail && normalizeMemberEmail(c.email) === myEmail) email = true;
  }
  return phone || email ? { phone, email } : null;
}

/**
 * 정보 **수정**에서 중복 검사가 필요한 값. 검사할 필요가 없으면 그 칸은 "".
 *
 * 바뀐 값만 검사한다 — 바꾸지도 않은 연락처 때문에 지역·동의 같은 다른 칸의 저장이 막히면 안 된다.
 *   · 연락처: phoneKey 가 달라졌을 때만 (표기만 바꾼 '0917…' → '+63 917…' 은 같은 번호라 검사 안 함)
 *   · 이메일: trim·소문자 기준으로 달라졌을 때만
 *   · 탈퇴(WITHDRAWN) → 다른 상태로 **되돌릴 때**는 둘 다 검사한다. 탈퇴해 있는 동안
 *     같은 번호·이메일로 다른 회원이 가입했을 수 있다(중복 검사는 WITHDRAWN 을 무시하므로).
 *   · 수정 결과가 WITHDRAWN 이면 검사하지 않는다 — 탈퇴 회원은 어차피 중복 판정에서 빠진다.
 */
export function duplicateCheckTargets(
  before: { phone: string; email: string; status: string },
  after: { phone: string; email: string; status: string },
): { phone: string; email: string } {
  if (after.status === "WITHDRAWN") return { phone: "", email: "" };
  const reinstating = before.status === "WITHDRAWN";
  const phoneChanged = phoneKey(before.phone) !== phoneKey(after.phone);
  const emailChanged = normalizeMemberEmail(before.email) !== normalizeMemberEmail(after.email);
  return {
    phone: (reinstating || phoneChanged) && phoneKey(after.phone).length >= 7 ? after.phone : "",
    email: (reinstating || emailChanged) && normalizeMemberEmail(after.email) ? after.email : "",
  };
}

/**
 * 회원 포털 관문 — 포털(/me · /me/[token])을 열기 전에 먼저 해결해야 할 것. 순수 함수.
 *
 * 순서(대표 결정 2026-11-01):
 *   ① 임시 비밀번호(mustChange) → 본인 비밀번호부터 만든다 (/me/password)
 *   ② 영문 이름이 비어 있다     → 영문 이름부터 등록한다 (/me/name-en)
 *   ③ 둘 다 아니면 포털을 연다
 *
 * 매직링크(/me/[token])에는 비밀번호가 없으므로 호출자가 mustChange: false 를 넘긴다 → ②만 본다.
 * 회원증(/me/card · /me/card/image)·진위 확인(/verify)은 이 관문을 **타지 않는다** —
 * 회원증은 영문 이름을 쓰지 않고, 관문 때문에 제휴 업소 앞에서 카드가 안 열리면 안 된다.
 */
export type PortalGate = "password" | "name-en";

export function nextPortalGate(input: { mustChange: boolean; nameEn: string }): PortalGate | null {
  if (input.mustChange) return "password";
  if (input.nameEn.trim() === "") return "name-en";
  return null;
}

/**
 * /help 접수 폼의 선택지.
 *
 * 원본: 04_운영SOP/24시간_긴급대응_SOP.md §5 "접수 로그 — 구글폼 문항".
 * 이 값들은 원장 20탭의 열거값이 아니라 SOP 전용이라 validators/enums.ts 에 없다.
 *
 * ★ "use server" 파일에서는 비동기 함수만 내보낼 수 있다. 상수를 actions.ts 에 두면
 *   클라이언트에서 배열이 아닌 프록시가 잡혀 `.map is not a function` 으로 터진다.
 */

/** SOP §5 문항 5. */
export const SITUATION_TYPES = [
  "①강도·폭행",
  "②교통사고",
  "③체포·구금",
  "④입원·응급",
  "⑤사망",
  "⑥실종",
  "⑦사기·분쟁",
  "⑧태풍·재난",
  "⑨기타",
] as const;

/** SOP §5 문항 4. 판단이 어려우면 **높게** 잡는다. */
export const SEVERITIES = ["L1 경미", "L2 중대", "L3 최중대"] as const;

/** SOP §5 문항 12. */
export const INJURIES = ["없음", "경상", "중상", "사망", "불명"] as const;

/** SOP §5 문항 10. ⚠ 대응 수준에 영향 없음 — 통계 목적만. */
export const MEMBERSHIPS = ["회원", "비회원", "불명"] as const;

/**
 * SOP §5 문항 13 — 이해상충 체크 (R-4).
 * 순서를 바꾸지 마라. '대표 사업체 관계자' 가 회피 트리거다.
 */
export const CONFLICT_CHOICES = [
  "해당 없음",
  "대표 사업체 관계자",
  "임원 본인·가족",
  "판단 보류",
] as const;

/** SOP §5 문항 23. */
export const CONSENT_CHOICES = [
  "당사자에게 고지하고 동의받음",
  "긴급상황으로 사후 고지 예정",
] as const;

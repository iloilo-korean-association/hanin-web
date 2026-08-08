/**
 * /join 의 상수.
 *
 * ★ "use server" 파일에서는 **비동기 함수만** 내보낼 수 있다.
 *   상수를 actions.ts 에 두면 클라이언트 쪽에서 배열이 아닌 프록시가 잡혀
 *   `JOIN_GRADES.map is not a function` 으로 터진다(실제로 터뜨려 보고 옮겼다).
 *   그래서 값은 이 평범한 모듈에 둔다.
 */

/**
 * 공개 폼에서 스스로 고를 수 있는 회원 구분.
 * '명예' 는 한인회가 부여하는 등급이라(회비규정 제6조 ② 고령·공로 회원 면제) 목록에 없다.
 */
export const JOIN_GRADES = ["정회원", "준회원", "학생", "법인"] as const;
export type JoinGrade = (typeof JOIN_GRADES)[number];

/** 회비등급 → 01_회원.회원구분. '학생' 은 회비등급에만 있고 회원구분에는 없다. */
export function memberTypeOf(grade: JoinGrade): "정회원" | "준회원" | "법인" {
  if (grade === "학생") return "준회원";
  if (grade === "법인") return "법인";
  if (grade === "준회원") return "준회원";
  return "정회원";
}

/** 선택지 옆에 붙는 설명 (구글폼 F1 문항 6 설명 그대로). */
export const GRADE_HINT: Record<string, string> = {
  정회원: "세대주",
  준회원: "배우자 · 성인 자녀",
  학생: "재학 중",
  법인: "한인 업소 · 법인",
};

/**
 * 클래스 이름 합치기. clsx 를 넣지 않은 이유는 의존성 하나라도 줄이기 위해서다
 * (오프라인·느린 회선 원칙).
 *
 * 문자열이 아닌 값은 전부 버린다. JSX 에서 흔히 쓰는
 *   cn("base", isOpen && "open", count && "has-items")
 * 같은 식은 false·0·"" 를 낳는데, 그게 클래스로 새어 나가면 안 된다.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

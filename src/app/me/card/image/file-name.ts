import { ORG_NAME } from "@/lib/site";

/**
 * 회원증 PNG 파일명. 예: 일로일로한인회_회원증_M0001_2026.png
 * 라우트(Content-Disposition)와 화면 버튼(<a download>)이 같은 이름을 쓴다.
 * route.ts 에 두지 않는 이유: Next 는 route 파일의 추가 export 를 타입 검사에서 거부한다.
 */
export function memberCardFileName(memberNo: string, fiscalYear: number): string {
  return `${ORG_NAME.replace(/\s+/g, "")}_회원증_${memberNo}_${fiscalYear}.png`;
}

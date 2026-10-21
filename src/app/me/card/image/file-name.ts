import { ORG_NAME } from "@/lib/site";

/**
 * 회원증 PNG 파일명. 예: 일로일로한인회_회원증_M0001_2027-10-14.png
 * 끝의 날짜는 **유효기간 만료일**이다(대표 결정 2026-10-21 — 유효기간 = 회비 납부일부터 1년).
 * 갱신하면 만료일이 바뀌므로 새 파일이 옛 파일을 덮어쓰지 않고, 갤러리에서 어느 것이 최신인지 보인다.
 * 라우트(Content-Disposition)와 화면 버튼(<a download>)이 같은 이름을 쓴다.
 * route.ts 에 두지 않는 이유: Next 는 route 파일의 추가 export 를 타입 검사에서 거부한다.
 */
export function memberCardFileName(memberNo: string, validUntil: string): string {
  return `${ORG_NAME.replace(/\s+/g, "")}_회원증_${memberNo}_${validUntil}.png`;
}

/** Content-Disposition 의 ASCII 폴백 이름. 예: member-card_M0001_2027-10-14.png */
export function memberCardAsciiFileName(memberNo: string, validUntil: string): string {
  return `member-card_${memberNo}_${validUntil}.png`;
}

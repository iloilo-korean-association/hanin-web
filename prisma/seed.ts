/* eslint-disable no-console */
/**
 * 시드 — 대표가 열었을 때 **살아있는 시스템**처럼 보여야 한다.
 *
 * 넣는 것
 *   · 00_설정 전 키 (02_노코드MVP/시트스키마/00_설정_초기값.md 그대로. CHANGE_ME 는 로컬 값으로)
 *   · 계좌 4 · 기금 4 · 과목 13
 *   · 회원 60 · 임원 5 · 업소 12 · 이해상충 8
 *   · 회계연도 2025(마감) / 2026(진행)
 *   · 거래 120건 (회비·기부·행사·이자 수입 / 임차료·행사비·구호비·장학금 지출)
 *     - 일부 DRAFT (증빙 없음 I3, 현금 고액 확인자 없음 I4)
 *     - 1건 VOIDED + 정정 재집행
 *     - 이해관계자 거래 포함 (대표의 7개 사업 중 2곳)
 *   · 회비고지 60 · 기부 8 + 사용 5 · 행사 3(1건 정산완료) · 승인 6 · 현금실사 3
 *   · 인수인계 4(I6 증거) · 대사 8 · 감사로그 · 알림로그 + 발송함(/dev/outbox)
 *
 * ★ 마지막에 **잔액 검산**을 돌리고 결과를 표로 찍는다. 하나라도 실패하면 exit 1.
 *
 * 실행: npm run db:seed  (또는 npm run db:reset)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import {
  auditBalances,
  accountBalancesAsOf,
  buildPublicLedger,
  checkOpeningBalance,
  evaluateConflict,
  evaluateTxState,
  formatMoney,
  formatPeso,
  isExactRealName,
  buildRealNameList,
  formatReceiptNo,
  toSettingMap,
  publicPolicyFrom,
  renderFromSettings,
  queueMail,
  issueMagicLink,
  resetNotifySeqCache,
  memberLinkPath,
  newLinkToken,
  FALLBACK_TEMPLATES,
  PUBLIC_LEDGER_PATH,
  type TxRow,
  type AccountRow,
  type FundRow,
  type CategoryRow,
} from "../src/lib/domain";
import { absoluteUrl } from "../src/lib/site";

const prisma = new PrismaClient();

/* ════════════════════════════════════════════════════════════════════════
 * 0. 고정 상수
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * [확인 필요] 대표(회장)의 실명을 모른다.
 *   시드에서는 아래 이름을 쓴다. **이 한 줄만 고치면** 회원·임원·이해상충·업소가 전부 따라 바뀐다.
 */
const PRESIDENT_NAME = "박정우";

const FY = 2026;
const PREV_FY = 2025;
/** 시드 기준 '오늘'. 브리프 작성 시점(2026-08-08) 기준으로 고정한다 — 매번 데이터가 달라지면 검산이 흔들린다. */
const TODAY = "2026-08-08";
const RECEIPT_PREFIX = "IKA";
const DOMAIN = "ika-iloilo.org";

const EMAIL = {
  president: `president@${DOMAIN}`,
  vp: `vp@${DOMAIN}`,
  treasurer: `treasurer@${DOMAIN}`,
  auditor1: `auditor@${DOMAIN}`,
  auditor2: `auditor2@${DOMAIN}`,
} as const;

/** 개시잔액 — 전기(2025) 마감잔액과 같아야 한다 (I6) */
const OPENING = {
  AC01: 18_500,
  AC02: 24_300,
  AC03: 3_200,
  AC04: 402_000,
} as const;
const OPENING_TOTAL = Object.values(OPENING).reduce((a, b) => a + b, 0); // 448,000

const FUND_OPENING = {
  FD01: 300_000,
  FD02: 88_000,
  FD03: 55_000,
  FD04: 5_000,
} as const;

/* ── 결정적 난수 (mulberry32) — 매번 같은 데이터가 나와야 검산이 재현된다 ── */
let _seed = 20260808;
function rnd(): number {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function dateBetween(from: string, to: string): string {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  const t = a + Math.floor(rnd() * (b - a));
  return new Date(t).toISOString().slice(0, 10);
}
function at(dateStr: string, hh = 10, mm = 0): Date {
  // 마닐라(UTC+8) 기준 시각을 UTC 로 환산해 저장한다.
  return new Date(Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`));
}

/* ════════════════════════════════════════════════════════════════════════
 * 1. 00_설정
 * ════════════════════════════════════════════════════════════════════════ */

type SettingSeed = { key: string; value: string; description: string; group: string };

const SETTINGS: SettingSeed[] = [
  { key: "회계연도", value: String(FY), description: "현재 진행 중인 회계연도", group: "회계연도" },
  { key: "회계연도_시작일", value: `${FY}-01-01`, description: "회계연도 개시일", group: "회계연도" },
  { key: "회계연도_종료일", value: `${FY}-12-31`, description: "회계연도 종료일", group: "회계연도" },
  { key: "마감회계연도목록", value: String(PREV_FY), description: "여기 적힌 연도의 거래는 입력·수정 불가 (I5)", group: "회계연도" },
  { key: "타임존", value: "Asia/Manila", description: "모든 날짜·시각의 기준 시간대", group: "회계연도" },
  { key: "기준통화", value: "PHP", description: "모든 집계는 페소환산 기준", group: "회계연도" },

  { key: "회비단가.정회원", value: "1200", description: "연회비. 세대주 기준", group: "회비" },
  { key: "회비단가.준회원", value: "600", description: "배우자·성인 자녀", group: "회비" },
  { key: "회비단가.학생", value: "300", description: "재학 증명 제출자", group: "회비" },
  { key: "회비단가.명예", value: "0", description: "고령·공로 회원. 고지는 만들되 금액 0", group: "회비" },
  { key: "회비단가.법인", value: "5000", description: "한인 업소·법인 회원", group: "회비" },
  { key: "회비.고지일", value: `${FY}-01-15`, description: "연회비 고지 발송 기준일", group: "회비" },
  { key: "회비.납기일", value: `${FY}-02-28`, description: "이 날짜 다음날부터 독촉 D+N 계산 시작", group: "회비" },
  { key: "회비.신규가입_일할계산", value: "N", description: "Y면 가입월 기준 월할 계산", group: "회비" },

  { key: "현금2인확인_임계액", value: "3000", description: "현금이 이 값을 넘으면 확인자 ≠ 입력자여야 POSTED (I4)", group: "승인" },
  { key: "승인한도.총무", value: "3000", description: "총무 단독 전결 한도(페소)", group: "승인" },
  { key: "승인한도.회장", value: "30000", description: "회장 승인으로 집행 가능한 한도", group: "승인" },
  { key: "승인한도.2차필요기준", value: "30000", description: "페소환산이 이 값을 넘으면 필요승인단계=2", group: "승인" },
  { key: "승인.이해관계자_2차강제", value: "Y", description: "이해관계자면 금액과 무관하게 2차 승인 강제", group: "승인" },

  { key: "환율.KRW_PHP", value: "0.0417", description: "원화 1원당 페소", group: "환율" },
  { key: "환율.USD_PHP", value: "58.5", description: "미화 1달러당 페소", group: "환율" },
  { key: "환율_기준일", value: `${FY}-01-01`, description: "위 환율을 갱신한 날", group: "환율" },
  { key: "환율.허용오차경고", value: "10", description: "직전 기준 대비 이 %를 넘게 바뀌면 경고", group: "환율" },

  { key: "독촉.1차일수", value: "7", description: "납기일 경과 후 N일에 1차 발송", group: "알림" },
  { key: "독촉.2차일수", value: "30", description: "2차 발송 시점", group: "알림" },
  { key: "독촉.3차일수", value: "60", description: "3차(마지막) 발송 시점", group: "알림" },
  { key: "독촉.최대회수", value: "3", description: "스팸 방지 상한", group: "알림" },
  { key: "독촉.최소간격일", value: "14", description: "단계 사이 최소 간격", group: "알림" },
  { key: "독촉.배치크기", value: "200", description: "1회 실행에서 보낼 최대 통수", group: "알림" },
  { key: "독촉.금지월", value: "6,7,8,9,10,11", description: "태풍 시즌에는 독촉을 보내지 않는다 (회비규정 제10조)", group: "알림" },
  { key: "독촉.중단", value: "N", description: "Y면 즉시 중단", group: "알림" },
  { key: "독촉.중단해제일", value: "", description: "이 날짜가 지나면 스스로 재개", group: "알림" },
  { key: "독촉.중단시작일", value: "", description: "중단을 세운 날", group: "알림" },
  { key: "독촉.중단사유", value: "", description: "태풍 상륙 / 지역 정전 / 총회 결의 등", group: "알림" },
  { key: "독촉.중단경고일", value: "30", description: "해제일 없이 이만큼 중단되면 매일 경고", group: "알림" },
  { key: "메일.일일한도", value: "300", description: "하루 최대 발송 통수", group: "알림" },
  { key: "메일.예약분", value: "50", description: "긴급 경고용으로 남겨둘 통수", group: "알림" },
  { key: "메일.발신자명", value: "일로일로 한인회", description: "수신자에게 보이는 발신자 이름", group: "알림" },
  { key: "메일.회신주소", value: EMAIL.treasurer, description: "회신 주소", group: "알림" },
  { key: "알림수신.회장", value: EMAIL.president, description: "경고·월결산 수신", group: "알림" },
  { key: "알림수신.총무", value: EMAIL.treasurer, description: "수납·오류 수신", group: "알림" },
  { key: "알림수신.감사", value: EMAIL.auditor1, description: "무결성 검사·행삭제 경고 수신", group: "알림" },
  { key: "알림.행삭제경고_수신", value: "알림수신.회장,알림수신.감사", description: "행 삭제 감지 시 수신 대상", group: "알림" },
  { key: "알림.무결성_수신", value: "알림수신.감사,알림수신.회장", description: "주간 무결성 검사 결과 수신", group: "알림" },
  { key: "알림.월결산_수신", value: "알림수신.회장,알림수신.총무,알림수신.감사", description: "월결산 수신", group: "알림" },

  // 로컬 프로토타입은 구글 드라이브를 쓰지 않는다. 증빙은 /uploads 경로 문자열로만 둔다.
  { key: "드라이브.증빙폴더ID", value: "", description: "로컬 프로토타입에서는 사용하지 않음", group: "드라이브" },
  { key: "드라이브.결산폴더ID", value: "", description: "로컬 프로토타입에서는 사용하지 않음", group: "드라이브" },
  { key: "증빙.공개링크허용", value: "N", description: "영수증에 개인정보가 찍힐 수 있으므로 기본 N", group: "드라이브" },
  { key: "결산PDF.공개링크허용", value: "Y", description: "월간 결산 PDF 공개 여부", group: "드라이브" },

  { key: "영수증번호.접두", value: RECEIPT_PREFIX, description: "영수증번호 형식: 접두-회계연도-6자리. 연중 변경 금지", group: "채번" },
  { key: "영수증번호.자릿수", value: "6", description: "0으로 채우는 자릿수", group: "채번" },
  { key: "회원번호.접두", value: "M", description: "회원번호 형식", group: "채번" },
  { key: "회원번호.자릿수", value: "4", description: "0으로 채우는 자릿수", group: "채번" },

  { key: "기본.기금ID", value: "FD01", description: "기금을 고르지 않았을 때 쓰는 기본 기금", group: "기본값" },
  { key: "기본.계좌ID.CASH", value: "AC01", description: "수단=CASH일 때 기본 계좌", group: "기본값" },
  { key: "기본.계좌ID.GCASH", value: "AC02", description: "수단=GCASH일 때 기본 계좌", group: "기본값" },
  { key: "기본.계좌ID.MAYA", value: "AC03", description: "수단=MAYA일 때 기본 계좌", group: "기본값" },
  { key: "기본.계좌ID.BANK", value: "AC04", description: "수단=BANK일 때 기본 계좌", group: "기본값" },
  { key: "기본.과목코드.회비", value: "R100", description: "회비 수납의 기본 과목", group: "기본값" },
  { key: "기본.과목코드.기부", value: "R200", description: "기부 접수의 기본 과목", group: "기본값" },
  { key: "기본.과목코드.행사수입", value: "R300", description: "행사 참가비의 기본 과목", group: "기본값" },
  { key: "기본.과목코드.기타", value: "R900", description: "어느 항목에도 해당하지 않을 때", group: "기본값" },

  { key: "검사.실사차액_허용오차", value: "100", description: "장부잔액과 실사잔액 차이 허용치", group: "검사" },
  { key: "검사.실사경과일_경고", value: "45", description: "마지막 실사가 이 일수를 넘으면 경고", group: "검사" },
  { key: "검사.증빙없는POSTED_경고", value: "Y", description: "주간 검사 항목 on/off", group: "검사" },

  { key: "템플릿.환영.제목", value: FALLBACK_TEMPLATES.환영.subject, description: "{{}} 안은 서버가 치환", group: "템플릿" },
  { key: "템플릿.환영.본문", value: FALLBACK_TEMPLATES.환영.body, description: "HTML 사용 가능", group: "템플릿" },
  { key: "템플릿.영수증.제목", value: FALLBACK_TEMPLATES.영수증.subject, description: "수납 즉시 발송", group: "템플릿" },
  { key: "템플릿.영수증.본문", value: FALLBACK_TEMPLATES.영수증.body, description: "{{미납안내}}는 잔액이 있을 때만", group: "템플릿" },
  { key: "템플릿.독촉1.제목", value: FALLBACK_TEMPLATES.독촉1.subject, description: "D+7. 부드러운 안내", group: "템플릿" },
  { key: "템플릿.독촉1.본문", value: FALLBACK_TEMPLATES.독촉1.body, description: "", group: "템플릿" },
  { key: "템플릿.독촉2.제목", value: FALLBACK_TEMPLATES.독촉2.subject, description: "D+30", group: "템플릿" },
  { key: "템플릿.독촉2.본문", value: FALLBACK_TEMPLATES.독촉2.body, description: "", group: "템플릿" },
  { key: "템플릿.독촉3.제목", value: FALLBACK_TEMPLATES.독촉3.subject, description: "D+60. 마지막 발송", group: "템플릿" },
  { key: "템플릿.독촉3.본문", value: FALLBACK_TEMPLATES.독촉3.body, description: "", group: "템플릿" },
  { key: "템플릿.감사장.제목", value: FALLBACK_TEMPLATES.감사장.subject, description: "기부 접수 시", group: "템플릿" },
  { key: "템플릿.감사장.본문", value: FALLBACK_TEMPLATES.감사장.body, description: "", group: "템플릿" },
  { key: "템플릿.월결산.제목", value: FALLBACK_TEMPLATES.월결산.subject, description: "매월 1일 발송", group: "템플릿" },
  { key: "템플릿.월결산.본문", value: FALLBACK_TEMPLATES.월결산.body, description: "", group: "템플릿" },
  { key: "템플릿.경고.제목", value: "[긴급][한인회 원장] {{제목}}", description: "행삭제·금액변조 등 CRITICAL 경고", group: "템플릿" },

  { key: "공개장부URL", value: "/ledger", description: "메일 템플릿의 {{공개장부URL}} 자리", group: "링크" },
  { key: "원장파일ID", value: "", description: "구글 시트 시절 잔재. 로컬에서는 비워 둔다", group: "링크" },
  { key: "공개파일ID", value: "", description: "구글 시트 시절 잔재", group: "링크" },
  { key: "최근_월결산_PDF", value: "", description: "월마감이 자동 갱신", group: "자동갱신" },
  { key: "최근_무결성검사", value: "", description: "주간검사가 자동 갱신", group: "자동갱신" },

  { key: "웹앱.PUBLIC_URL", value: "http://localhost:3000", description: "공개 화면 기준 주소", group: "웹앱" },
  { key: "웹앱.OFFICER_URL", value: "http://localhost:3000/officer", description: "임원 화면 기준 주소", group: "웹앱" },
  { key: "웹앱.문의이메일", value: EMAIL.treasurer, description: "화면 하단·접수 제한 안내에 찍히는 문의처", group: "웹앱" },
  // ★ 지어내지 않는다. 실제 당번 번호를 모르므로 비워 둔다 →
  //   화면은 "핫라인 준비 중 — 지금 위급하면 911" 로 정직하게 표시된다.
  { key: "웹앱.긴급핫라인", value: "", description: "[확인 필요] 24시간 당번 임원 전화번호 미확정. 필리핀 전국 긴급번호는 911", group: "웹앱" },
  { key: "웹앱.단체명", value: "일로일로 한인회", description: "모든 화면 머리말과 브라우저 제목", group: "웹앱" },
  { key: "웹앱.페이스북", value: "https://www.facebook.com/ILOILOKOREANS", description: "긴급연락처 화면의 공지 채널", group: "웹앱" },
  { key: "웹앱.공지1", value: `${FY}-08-01|8월 정기 이사회 안내|8월 15일(토) 오후 3시, 한인회 사무실에서 정기 이사회를 엽니다. 회원 누구나 방청하실 수 있습니다.`, description: "홈 공지 1", group: "웹앱" },
  { key: "웹앱.공지2", value: `${FY}-07-18|태풍철 회비 독촉 중단|회비규정 제10조에 따라 6~11월에는 회비 독촉을 자동 발송하지 않습니다.`, description: "홈 공지 2", group: "웹앱" },
  { key: "웹앱.공지3", value: `${FY}-06-30|상반기 결산 공개|1~6월 수입·지출 전액을 공개 장부에 올렸습니다. 지출은 건별로 모두 보실 수 있습니다.`, description: "홈 공지 3", group: "웹앱" },
  { key: "웹앱.점검모드", value: "N", description: "Y 로 두면 전체가 점검 화면으로 잠긴다", group: "웹앱" },
  { key: "웹앱.업로드최대MB", value: "8", description: "영수증·견적서 업로드 한 건 최대 크기", group: "웹앱" },
  { key: "웹앱.토큰만료일수", value: "0", description: "회원 본인확인 링크 유효 일수. 0 이면 무기한", group: "웹앱" },
  { key: "웹앱.토큰실패경고", value: "200", description: "한 시간 내 토큰 오조회가 이 횟수면 경고", group: "웹앱" },
  { key: "웹앱.명부최대", value: "400", description: "명부 화면에 한 번에 그리는 최대 인원", group: "웹앱" },
  { key: "웹앱.긴급메일_시간당", value: "20", description: "긴급 요청 알림의 시간당 상한. 접수 자체는 막지 않는다", group: "웹앱" },
  { key: "웹앱.제한.가입_개인", value: "5", description: "같은 이메일·연락처의 시간당 가입 신청 상한", group: "웹앱" },
  { key: "웹앱.제한.가입_시간당", value: "30", description: "가입 신청 전체의 시간당 상한", group: "웹앱" },
  { key: "웹앱.제한.기부_개인", value: "5", description: "같은 사람의 시간당 기부 접수 상한", group: "웹앱" },
  { key: "웹앱.제한.기부_시간당", value: "40", description: "기부 접수 전체의 시간당 상한", group: "웹앱" },
  { key: "웹앱.제한.행사_개인", value: "6", description: "같은 사람의 시간당 행사 신청 상한", group: "웹앱" },
  { key: "웹앱.제한.행사_시간당", value: "40", description: "행사 신청 전체의 시간당 상한", group: "웹앱" },
  { key: "웹앱.제한.재발급_개인", value: "3", description: "같은 이메일의 시간당 링크 재발급 상한", group: "웹앱" },
  { key: "웹앱.제한.재발급_시간당", value: "20", description: "링크 재발급 전체의 시간당 상한", group: "웹앱" },
  { key: "웹앱.제한.접수_시간당", value: "100", description: "익명 접수 전체의 시간당 합산 상한", group: "웹앱" },

  { key: "개시선언.기준일시", value: `${FY}-01-01 00:00`, description: "공개 원장의 개시 시점 (개시잔액 선언서 제3조)", group: "웹앱" },
  { key: "공개.적요공개", value: "Y", description: "공개 지출 목록에 적요를 보여줄지", group: "웹앱" },
  { key: "공개.적요_실명마스킹", value: "Y", description: "★ 끄지 마라. 끄면 회원 실명이 익명 화면에 그대로 나간다", group: "웹앱" },
  { key: "공개.수취인_개인표기", value: "마스킹", description: "마스킹 / 전체 / 숨김", group: "웹앱" },
  { key: "공개.업소_대표자명공개", value: "N", description: "Y 로 켜면 개인 이름이 공개된다. TIN 은 어떤 설정으로도 공개되지 않는다", group: "웹앱" },
  { key: "공개.업소디렉터리", value: "Y", description: "한인 업소 안내 페이지를 열지", group: "웹앱" },
  { key: "공개.지출목록_최대", value: "300", description: "공개 회계 한 화면의 지출 행 최대 수", group: "웹앱" },
  { key: "공개.캐시초", value: "300", description: "공개 회계 집계 캐시 유효시간(초)", group: "웹앱" },

  { key: "결재선.총무단독한도", value: "2000", description: "승인한도표 1번 표의 총무 단독 전결 상한", group: "웹앱" },
  { key: "결재선.회장승인한도", value: "10000", description: "총무 기안 → 회장 승인만으로 집행 가능한 상한", group: "웹앱" },
  { key: "결재선.감사통보기준", value: "20000", description: "회장 승인 + 감사 사전 통보 구간의 상한", group: "웹앱" },
  { key: "결재선.이사회과반한도", value: "50000", description: "이사회 과반 의결 구간의 상한", group: "웹앱" },
  { key: "결재선.이사회23한도", value: "200000", description: "이사회 2/3 의결 구간의 상한", group: "웹앱" },
  { key: "결재선.현금상한", value: "5000", description: "현금으로 지급할 수 있는 한 건의 상한", group: "웹앱" },
  { key: "결재선.공고일수", value: "14", description: "총회 의결 구간의 사전 공개 공고 기간(일)", group: "웹앱" },
];

/* ════════════════════════════════════════════════════════════════════════
 * 2. 기초 데이터
 * ════════════════════════════════════════════════════════════════════════ */

const ACCOUNTS = [
  { accountId: "AC01", name: "총무 현금함", kind: "CASH", bankName: "", accountNoMasked: "", holder: "총무", openingBalance: OPENING.AC01, manager: EMAIL.treasurer, note: "사무실 금고" },
  { accountId: "AC02", name: "GCash 총무폰", kind: "GCASH", bankName: "GCash", accountNoMasked: "****1234", holder: "총무", openingBalance: OPENING.AC02, manager: EMAIL.treasurer, note: "" },
  { accountId: "AC03", name: "Maya 총무폰", kind: "MAYA", bankName: "Maya", accountNoMasked: "****5678", holder: "총무", openingBalance: OPENING.AC03, manager: EMAIL.treasurer, note: "" },
  { accountId: "AC04", name: "BDO 한인회 통장", kind: "BANK", bankName: "BDO", accountNoMasked: "****9012", holder: "일로일로 한인회", openingBalance: OPENING.AC04, manager: EMAIL.president, note: "2인 서명 계좌" },
];

const FUNDS = [
  { fundId: "FD01", name: "일반회계", kind: "일반", purpose: "한인회 일반 운영", targetAmount: 0, openingBalance: FUND_OPENING.FD01, note: "회비·일반기부가 들어오는 기본 기금" },
  { fundId: "FD02", name: "장학기금", kind: "지정", purpose: "한인 자녀 장학금", targetAmount: 100_000, openingBalance: FUND_OPENING.FD02, note: "목적외 사용 금지" },
  { fundId: "FD03", name: "긴급구호기금", kind: "지정", purpose: "재해·사고 교민 지원", targetAmount: 200_000, openingBalance: FUND_OPENING.FD03, note: "목적외 사용 금지" },
  { fundId: "FD04", name: "적립금", kind: "적립", purpose: "회관 마련 등 장기 적립", targetAmount: 0, openingBalance: FUND_OPENING.FD04, note: "" },
];

const CATEGORIES = [
  { code: "R100", name: "회비수입", majorType: "수입", midType: "회비", publicName: "회비", sortOrder: 10, note: "" },
  { code: "R200", name: "기부수입", majorType: "수입", midType: "기부", publicName: "기부금", sortOrder: 20, note: "" },
  { code: "R300", name: "행사수입", majorType: "수입", midType: "행사", publicName: "행사 참가비", sortOrder: 30, note: "" },
  { code: "R400", name: "이자수입", majorType: "수입", midType: "금융", publicName: "이자·기타 금융수입", sortOrder: 40, note: "" },
  { code: "R900", name: "기타수입", majorType: "수입", midType: "기타", publicName: "기타 수입", sortOrder: 90, note: "" },
  { code: "E100", name: "사무비", majorType: "지출", midType: "운영", publicName: "사무 운영비", sortOrder: 110, note: "문구·인쇄·통신" },
  { code: "E110", name: "임차료", majorType: "지출", midType: "운영", publicName: "사무실 임차료", sortOrder: 111, note: "" },
  { code: "E120", name: "회의비", majorType: "지출", midType: "운영", publicName: "회의·총회 비용", sortOrder: 112, note: "" },
  { code: "E200", name: "행사비", majorType: "지출", midType: "행사", publicName: "행사 비용", sortOrder: 120, note: "" },
  { code: "E300", name: "구호비", majorType: "지출", midType: "구호", publicName: "교민 긴급 구호", sortOrder: 130, note: "" },
  { code: "E310", name: "장학금", majorType: "지출", midType: "구호", publicName: "장학금 지급", sortOrder: 131, note: "" },
  { code: "E400", name: "공관협력비", majorType: "지출", midType: "대외", publicName: "영사·공관 협력 활동", sortOrder: 140, note: "" },
  { code: "E900", name: "기타지출", majorType: "지출", midType: "기타", publicName: "기타 지출", sortOrder: 190, note: "" },
];

/** 회원 60명. 임원 5명이 앞의 M0001~M0005 다. */
const MEMBER_NAMES: string[] = [
  PRESIDENT_NAME, "이서연", "정도현", "최수아", "강예린",
  "김민준", "박지훈", "조현우", "윤하은", "장민석",
  "임채원", "한지우", "오세훈", "서다인", "신재호",
  "권나윤", "황재민", "안소율", "송기훈", "유가은",
  "홍성재", "전미라", "고준영", "문해린", "배상철",
  "백지원", "허정민", "남우진", "심유나", "노태경",
  "하은서", "곽동현", "성지아", "차영수", "주민경",
  "우상혁", "구본철", "민서현", "표정훈", "진다혜",
  "방준호", "손미경", "양승우", "나윤석", "도현수",
  "봉수현", "석지훈", "천경아", "추민호", "태윤정",
  "편성현", "하동규", "함소진", "현민수", "지영호",
  "소재원", "계상훈", "방수현", "반효선", "설주원",
];

const REGIONS = ["Iloilo City Proper", "Jaro", "Mandurriao", "La Paz", "Molo", "Arevalo", "Oton", "Pavia"];
const DISTRICTS = ["1반", "2반", "3반", "4반"];

/* ── 업소 (대표의 7개 사업 포함) ─────────────────────────────────────── */

type VendorSeed = {
  vendorId: string; name: string;
  /** 같은 업소의 다른 표기를 `|` 로 구분. 필리핀 현지는 간판이 로마자인 곳이 많아 실제로 이렇게 적힌다. */
  aliases: string;
  ownerName: string; industry: string; phone: string; address: string;
  tin: string; relatedMemberNo: string | null; relatedParty: boolean; since: string; ownershipPct: number | null; note: string;
};

const VENDORS: VendorSeed[] = [
  { vendorId: "VD001", name: "PIA 필리핀어학원", aliases: "PIA Language Academy|PIA Iloilo|PIA|피아 어학원", ownerName: PRESIDENT_NAME, industry: "어학원", phone: "+63 33 320 1101", address: "Jaro, Iloilo City", tin: "008-111-222-000", relatedMemberNo: "M0001", relatedParty: true, since: "2019-03-01", ownershipPct: 100, note: "회장 본인 운영" },
  { vendorId: "VD002", name: "스픽클 화상영어", aliases: "Speakle|Speakle Online English|스픽클", ownerName: PRESIDENT_NAME, industry: "온라인 교육", phone: "+63 33 320 1102", address: "Mandurriao, Iloilo City", tin: "008-111-223-000", relatedMemberNo: "M0001", relatedParty: true, since: "2021-06-01", ownershipPct: 100, note: "회장 본인 운영" },
  { vendorId: "VD003", name: "에이워크 유학원", aliases: "A-Work|A-Work Study Abroad|AWork|에이워크", ownerName: PRESIDENT_NAME, industry: "유학 알선", phone: "+63 33 320 1103", address: "Jaro, Iloilo City", tin: "008-111-224-000", relatedMemberNo: "M0001", relatedParty: true, since: "2020-01-15", ownershipPct: 100, note: "회장 본인 운영" },
  { vendorId: "VD004", name: "일로일로 한인 법률사무소", aliases: "Korean Legal Office Iloilo|Han-in Law Office|한인 법률사무소|한인로펌", ownerName: "(배우자)", industry: "법률", phone: "+63 33 320 1104", address: "City Proper, Iloilo City", tin: "008-111-225-000", relatedMemberNo: "M0001", relatedParty: true, since: "2022-04-01", ownershipPct: null, note: "회장 배우자 운영. 지분율 미확인 [확인 필요]" },
  { vendorId: "VD005", name: "빌드앤셀 주택개발", aliases: "Build and Sell|Build & Sell|BuildAndSell|빌드앤셀", ownerName: PRESIDENT_NAME, industry: "건설·부동산", phone: "+63 33 320 1105", address: "Pavia, Iloilo", tin: "008-111-226-000", relatedMemberNo: "M0001", relatedParty: true, since: "2023-02-01", ownershipPct: 60, note: "회장 지분 60%" },
  { vendorId: "VD006", name: "일로일로 스테이 (34유닛)", aliases: "Iloilo Stay|Iloilo Stay 34|IloiloStay|일로일로 스테이", ownerName: PRESIDENT_NAME, industry: "숙박", phone: "+63 33 320 1106", address: "Mandurriao, Iloilo City", tin: "008-111-227-000", relatedMemberNo: "M0001", relatedParty: true, since: "2023-09-01", ownershipPct: 100, note: "회장 본인 운영" },
  { vendorId: "VD007", name: "오톤 하드웨어", aliases: "OTON Hardware|Oton Hardware|Oton Hardware Supply|오톤철물|오톤 철물", ownerName: PRESIDENT_NAME, industry: "건축자재·철물", phone: "+63 33 320 1107", address: "Oton, Iloilo", tin: "008-111-228-000", relatedMemberNo: "M0001", relatedParty: true, since: "2024-05-01", ownershipPct: 70, note: "회장 지분 70%" },
  { vendorId: "VD008", name: "자로 한식당", aliases: "Jaro Korean Restaurant|자로 한식", ownerName: "전미라", industry: "요식", phone: "+63 33 321 4410", address: "Jaro, Iloilo City", tin: "", relatedMemberNo: "M0022", relatedParty: false, since: "2021-08-01", ownershipPct: null, note: "일반 회원 운영. 임원 아님" },
  { vendorId: "VD009", name: "SM 시티 일로일로 임대관리", aliases: "SM City Iloilo|SM City Iloilo Leasing", ownerName: "", industry: "부동산 임대", phone: "+63 33 320 8888", address: "Mandurriao, Iloilo City", tin: "004-555-666-000", relatedMemberNo: null, relatedParty: false, since: "2024-01-01", ownershipPct: null, note: "사무실 임대인" },
  { vendorId: "VD010", name: "일로일로 프린트샵", aliases: "Iloilo Print Shop|Iloilo Printshop", ownerName: "", industry: "인쇄", phone: "+63 33 337 2211", address: "City Proper, Iloilo City", tin: "004-777-888-000", relatedMemberNo: null, relatedParty: false, since: "2024-03-01", ownershipPct: null, note: "" },
  { vendorId: "VD011", name: "자로 케이터링", aliases: "Jaro Catering|자로 케이터링 서비스", ownerName: "(총무 배우자)", industry: "케이터링", phone: "+63 33 329 5566", address: "Jaro, Iloilo City", tin: "", relatedMemberNo: "M0003", relatedParty: true, since: "2025-02-01", ownershipPct: null, note: "총무 배우자 운영. 지분율 미확인 [확인 필요]" },
  { vendorId: "VD012", name: "파나이 트랜스포트 렌탈", aliases: "Panay Transport Rental|Panay Transport", ownerName: "", industry: "차량 임대", phone: "+63 33 335 7799", address: "La Paz, Iloilo City", tin: "004-999-111-000", relatedMemberNo: null, relatedParty: false, since: "2025-05-01", ownershipPct: null, note: "" },
];

type ConflictSeed = {
  conflictId: string; vendorId: string; declarerMemberNo: string; relationType: string;
  ownershipPct: number | null; recused: boolean; detail: string;
};

const CONFLICTS: ConflictSeed[] = [
  { conflictId: "CI-0001", vendorId: "VD001", declarerMemberNo: "M0001", relationType: "본인", ownershipPct: 100, recused: true, detail: "회장 본인이 운영하는 어학원. 총회·이사회 장소로 무상 또는 실비 대여하는 경우가 있어 신고합니다." },
  { conflictId: "CI-0002", vendorId: "VD002", declarerMemberNo: "M0001", relationType: "본인", ownershipPct: 100, recused: false, detail: "회장 본인이 운영하는 화상영어 사업." },
  { conflictId: "CI-0003", vendorId: "VD003", declarerMemberNo: "M0001", relationType: "본인", ownershipPct: 100, recused: false, detail: "회장 본인이 운영하는 유학원." },
  { conflictId: "CI-0004", vendorId: "VD004", declarerMemberNo: "M0001", relationType: "가족", ownershipPct: null, recused: false, detail: "회장 배우자가 운영하는 법률사무소. 한인회 법률 자문이 필요한 경우 이해상충이 발생할 수 있습니다. 지분 관계는 없습니다." },
  { conflictId: "CI-0005", vendorId: "VD005", declarerMemberNo: "M0001", relationType: "지분보유", ownershipPct: 60, recused: false, detail: "회장이 지분 60%를 보유한 주택개발 사업." },
  { conflictId: "CI-0006", vendorId: "VD006", declarerMemberNo: "M0001", relationType: "본인", ownershipPct: 100, recused: false, detail: "회장 본인이 운영하는 단기임대(34유닛) 사업." },
  { conflictId: "CI-0007", vendorId: "VD007", declarerMemberNo: "M0001", relationType: "지분보유", ownershipPct: 70, recused: true, detail: "회장이 지분 70%를 보유한 철물·건축자재 상점. 행사 자재 구매 시 이해상충이 발생합니다." },
  { conflictId: "CI-0008", vendorId: "VD011", declarerMemberNo: "M0003", relationType: "가족", ownershipPct: null, recused: true, detail: "총무 배우자가 운영하는 케이터링 업체. 행사 식사 발주 시 이해상충이 발생합니다. 지분 관계는 없습니다." },
];

/* ════════════════════════════════════════════════════════════════════════
 * 3. 거래 계획
 * ════════════════════════════════════════════════════════════════════════ */

type PlannedTx = {
  key: string;
  date: string;
  direction: "IN" | "OUT";
  amount: number;
  currency: "PHP" | "KRW" | "USD";
  fxRate: number;
  accountId: string;
  fundId: string;
  categoryCode: string;
  counterpartyType: string;
  counterpartyMemberNo: string | null;
  counterpartyName: string;
  method: string;
  memo: string;
  externalRef: string;
  relatedParty: boolean;
  approvalId: string | null;
  enteredBy: string;
  verifiedBy: string;
  evidenceUrl: string;
  /** 강제로 VOIDED 로 둘 때만 채운다. 비면 evaluateTxState 가 POSTED/DRAFT 를 정한다 */
  forceVoid?: { reason: string };
  reversalOfKey?: string;
};

const plan: PlannedTx[] = [];
let keySeq = 0;
function addTx(t: Omit<PlannedTx, "key">): PlannedTx {
  const row: PlannedTx = { ...t, key: `T${String(++keySeq).padStart(4, "0")}` };
  plan.push(row);
  return row;
}

function evidence(prefix: string, date: string, tag: string): string {
  // 로컬 프로토타입은 실제 파일을 만들지 않는다. 경로 문자열만 둔다 —
  // 화면은 "증빙 있음" 배지를 보여주고, 클릭하면 파일이 없다는 것이 그대로 드러난다.
  return `/uploads/${prefix}/${date}_${tag}.jpg`;
}

async function main(): Promise<void> {
  console.log("─".repeat(72));
  console.log("일로일로 한인회 — 시드 시작");
  console.log("─".repeat(72));

  resetNotifySeqCache();

  /* ── 3-0. 기존 데이터 삭제 (FK 역순) ─────────────────────────────── */
  await prisma.outboxMail.deleteMany();
  await prisma.magicLink.deleteMany();
  await prisma.notifyLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.reconciliation.deleteMany();
  await prisma.handover.deleteMany();
  await prisma.cashCount.deleteMany();
  await prisma.eventSignup.deleteMany();
  await prisma.donationUse.deleteMany();
  await prisma.donation.deleteMany();
  await prisma.duesInvoice.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.event.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.conflictOfInterest.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.officerCredential.deleteMany();
  await prisma.officer.deleteMany();
  await prisma.member.deleteMany();
  await prisma.category.deleteMany();
  await prisma.fund.deleteMany();
  await prisma.account.deleteMany();
  await prisma.receiptSequence.deleteMany();
  await prisma.fiscalYear.deleteMany();
  await prisma.setting.deleteMany();

  /* ── 3-1. 회계연도 ───────────────────────────────────────────────── */
  await prisma.fiscalYear.createMany({
    data: [
      {
        year: PREV_FY,
        startDate: `${PREV_FY}-01-01`,
        endDate: `${PREV_FY}-12-31`,
        status: "CLOSED",
        closedOn: `${FY}-01-02`,
        closedBy: EMAIL.auditor1,
        closingTotalPhp: OPENING_TOTAL,
        note: "전임 집행부 마감. 마감잔액은 개시잔액 선언서로 인수인계됨 (I6)",
      },
      { year: FY, startDate: `${FY}-01-01`, endDate: `${FY}-12-31`, status: "OPEN", note: "" },
    ],
  });

  /* ── 3-2. 설정 ───────────────────────────────────────────────────── */
  await prisma.setting.createMany({
    data: SETTINGS.map((s) => ({ ...s, updatedBy: "SEED" })),
  });
  const settings = toSettingMap(SETTINGS.map((s) => ({ key: s.key, value: s.value })));

  /* ── 3-3. 계좌 · 기금 · 과목 ─────────────────────────────────────── */
  await prisma.account.createMany({
    data: ACCOUNTS.map((a) => ({ ...a, currency: "PHP", openedOn: `${FY}-01-01`, status: "ACTIVE", isPublic: true })),
  });
  await prisma.fund.createMany({
    data: FUNDS.map((f) => ({ ...f, startOn: `${FY}-01-01`, endOn: null, status: "ACTIVE", isPublic: true })),
  });
  await prisma.category.createMany({
    data: CATEGORIES.map((c) => ({ ...c, isPublic: true, isActive: true })),
  });

  /* ── 3-4. 회원 60 ────────────────────────────────────────────────── */
  const DUES_PRICE: Record<string, number> = { 정회원: 1200, 준회원: 600, 학생: 300, 명예: 0, 법인: 5000 };

  type MemberSeed = {
    memberNo: string; name: string; duesGrade: string; memberType: string; status: string;
    joinedOn: string; email: string; phone: string; region: string; districtTeam: string;
    householdRole: string; gender: string; birthYear: number; rosterConsent: boolean;
    notifyConsent: boolean; linkToken: string; note: string;
  };

  const members: MemberSeed[] = MEMBER_NAMES.map((name, i) => {
    const no = "M" + String(i + 1).padStart(4, "0");
    const isOfficer = i < 5;
    // 등급 분포: 정회원 다수, 준회원(배우자) 일부, 학생 소수, 명예 2, 법인 3
    let grade = "정회원";
    if (i >= 5) {
      const r = rnd();
      if (r < 0.22) grade = "준회원";
      else if (r < 0.30) grade = "학생";
    }
    if (i === 30 || i === 47) grade = "명예";
    if (i === 21 || i === 40 || i === 55) grade = "법인";

    const householdRole = grade === "준회원" ? "배우자" : grade === "학생" ? "자녀" : "본인";
    const memberType = grade === "법인" ? "법인" : grade === "명예" ? "명예" : grade === "준회원" || grade === "학생" ? "준회원" : "정회원";
    const status = i === 52 ? "INACTIVE" : i === 58 ? "WITHDRAWN" : "ACTIVE";

    const officerEmails = [EMAIL.president, EMAIL.vp, EMAIL.treasurer, EMAIL.auditor1, EMAIL.auditor2];
    const email = isOfficer ? officerEmails[i] : `member${String(i + 1).padStart(2, "0")}@example.com`;

    return {
      memberNo: no,
      name,
      duesGrade: grade,
      memberType,
      status,
      joinedOn: i < 20 ? dateBetween("2018-03-01", "2022-12-20") : dateBetween("2023-01-10", `${FY}-07-20`),
      email,
      phone: `+63 9${randInt(10, 99)} ${randInt(100, 999)} ${randInt(1000, 9999)}`,
      region: pick(REGIONS),
      districtTeam: pick(DISTRICTS),
      householdRole,
      gender: rnd() < 0.52 ? "M" : "F",
      birthYear: randInt(1955, 2005),
      // 명부공개동의는 기본이 아니다. 실제로 절반 남짓만 동의한다.
      rosterConsent: isOfficer ? true : rnd() < 0.45,
      notifyConsent: rnd() < 0.9,
      linkToken: newLinkToken(8),
      note: i === 58 ? "2026-04 한국 귀국. 본인 요청으로 탈퇴 처리" : "",
    };
  });

  const memberByNo = new Map(members.map((m) => [m.memberNo, m]));

  await prisma.member.createMany({
    data: members.map((m) => ({
      memberNo: m.memberNo,
      name: m.name,
      nameEn: "",
      birthYear: m.birthYear,
      gender: m.gender,
      phone: m.phone,
      phoneLast4: m.phone.replace(/\D/g, "").slice(-4),
      email: m.email,
      region: m.region,
      districtTeam: m.districtTeam,
      householdRole: m.householdRole,
      joinedOn: m.joinedOn,
      memberType: m.memberType,
      status: m.status,
      duesGrade: m.duesGrade,
      rosterConsent: m.rosterConsent,
      notifyConsent: m.notifyConsent,
      privacyConsentAt: at(m.joinedOn, 9, 30),
      linkToken: m.linkToken,
      note: m.note,
      createdBy: "SYSTEM",
      createdAt: at(m.joinedOn, 9, 30),
      formResponseId: `F1!R${100 + members.indexOf(m)}`,
    })),
  });

  /* ── 3-5. 임원 5 ─────────────────────────────────────────────────── */
  const officers = [
    { officerId: "OF01", memberNo: "M0001", role: "회장", email: EMAIL.president, permissions: "승인권,조회권", approvalLimit: 30_000, note: "이해상충 7건 신고 — 관련 안건 회피(recusal)" },
    { officerId: "OF02", memberNo: "M0002", role: "부회장", email: EMAIL.vp, permissions: "승인권,조회권", approvalLimit: 10_000, note: "회장 회피 시 1차 승인 대행" },
    { officerId: "OF03", memberNo: "M0003", role: "총무", email: EMAIL.treasurer, permissions: "입력권,조회권", approvalLimit: 3_000, note: "이해상충 1건 신고 (배우자 케이터링)" },
    { officerId: "OF04", memberNo: "M0004", role: "감사", email: EMAIL.auditor1, permissions: "조회권", approvalLimit: 0, note: "감사는 입력·승인권 없음" },
    { officerId: "OF05", memberNo: "M0005", role: "감사", email: EMAIL.auditor2, permissions: "승인권,조회권", approvalLimit: 50_000, note: "이사회 2차 승인 담당 감사" },
  ];

  await prisma.officer.createMany({
    data: officers.map((o) => ({
      officerId: o.officerId,
      memberNo: o.memberNo,
      name: memberByNo.get(o.memberNo)!.name,
      role: o.role,
      termStart: `${FY}-01-01`,
      termEnd: `${FY + 1}-12-31`,
      email: o.email,
      phone: memberByNo.get(o.memberNo)!.phone,
      permissions: o.permissions,
      approvalLimit: o.approvalLimit,
      status: "ACTIVE",
      note: o.note,
    })),
  });

  // 로컬 프로토타입 공통 비밀번호. 실제 배포 전에 반드시 바꾼다.
  const DEV_PASSWORD = "ika-2026";
  const hash = await bcrypt.hash(DEV_PASSWORD, 10);
  await prisma.officerCredential.createMany({
    data: officers.map((o) => ({ officerId: o.officerId, passwordHash: hash })),
  });

  /* ── 3-6. 업소 · 이해상충 ────────────────────────────────────────── */
  await prisma.vendor.createMany({ data: VENDORS.map((v) => ({ ...v, status: "ACTIVE" })) });

  await prisma.conflictOfInterest.createMany({
    data: CONFLICTS.map((c) => {
      const v = VENDORS.find((x) => x.vendorId === c.vendorId)!;
      const declarer = memberByNo.get(c.declarerMemberNo)!;
      const officer = officers.find((o) => o.memberNo === c.declarerMemberNo);
      return {
        conflictId: c.conflictId,
        declaredOn: `${FY}-01-08`,
        declarerMemberNo: c.declarerMemberNo,
        declarerName: declarer.name,
        role: officer?.role ?? "",
        counterpartyType: "업소",
        counterpartyName: v.name,
        relationType: c.relationType,
        vendorId: c.vendorId,
        detail: c.detail,
        recused: c.recused,
        resolution: c.recused ? "해당 안건 의결에서 퇴장(recusal). 견적 2곳 이상 확보 후 이사회 의결." : "상시 공시. 거래 발생 시 이사회 의결 대상.",
        disclosed: true,
        reviewer: EMAIL.auditor1,
        reviewedOn: `${FY}-01-12`,
        ownershipPct: c.ownershipPct,
        note: "",
      };
    }),
  });

  /* ── 3-7. 승인 6건 ───────────────────────────────────────────────── */
  type ApprovalSeed = {
    approvalId: string; requestedOn: string; kind: string; amountPhp: number; fundId: string;
    categoryCode: string; reason: string; relatedParty: boolean; conflictId: string | null;
    vendorId: string | null; counterpartyName: string; quoteUrl: string; requiredStages: number;
    approver1: string; result1: string; approvedOn1: string | null;
    approver2: string; result2: string; approvedOn2: string | null;
    finalStatus: string; note: string;
  };

  const APPROVALS: ApprovalSeed[] = [
    {
      approvalId: "AP-2026-0001", requestedOn: `${FY}-01-06`, kind: "지출", amountPhp: 45_500, fundId: "FD01",
      categoryCode: "E110", reason: "2026년 1~7월 사무실 임차료 일괄 승인 (월 6,500 × 7개월)", relatedParty: false,
      conflictId: null, vendorId: "VD009", counterpartyName: "SM 시티 일로일로 임대관리",
      quoteUrl: "/uploads/quotes/2026-01-06_lease.pdf", requiredStages: 2,
      approver1: EMAIL.president, result1: "승인", approvedOn1: `${FY}-01-07`,
      approver2: EMAIL.auditor2, result2: "승인", approvedOn2: `${FY}-01-08`,
      finalStatus: "집행완료", note: "임대차 계약서 첨부",
    },
    {
      approvalId: "AP-2026-0002", requestedOn: `${FY}-02-25`, kind: "지출", amountPhp: 30_000, fundId: "FD02",
      categoryCode: "E310", reason: "2026년 상반기 한인 자녀 장학금 3명 (1인 10,000)", relatedParty: false,
      conflictId: null, vendorId: null, counterpartyName: "장학생 3명 (개별 지급)",
      quoteUrl: "/uploads/quotes/2026-02-25_scholarship-list.pdf", requiredStages: 1,
      approver1: EMAIL.president, result1: "승인", approvedOn1: `${FY}-02-26`,
      approver2: "", result2: "불필요", approvedOn2: null,
      finalStatus: "집행완료", note: "장학기금(FD02) 목적 내 사용",
    },
    {
      approvalId: "AP-2026-0003", requestedOn: `${FY}-04-20`, kind: "지출", amountPhp: 4_200, fundId: "FD01",
      categoryCode: "E200", reason: "제8회 한인 체육대회 천막·부자재 구매", relatedParty: true,
      conflictId: "CI-0007", vendorId: "VD007", counterpartyName: "오톤 하드웨어",
      quoteUrl: "/uploads/quotes/2026-04-20_hardware-2quotes.pdf", requiredStages: 2,
      // ★ 회장이 이해관계 당사자라 1차를 부회장이 처리했다 (승인한도표 제6조 ④)
      approver1: EMAIL.vp, result1: "승인", approvedOn1: `${FY}-04-22`,
      approver2: EMAIL.auditor2, result2: "승인", approvedOn2: `${FY}-04-24`,
      finalStatus: "집행완료", note: "회장 회피(recusal). 견적 2곳 비교 후 최저가 선정",
    },
    {
      approvalId: "AP-2026-0004", requestedOn: `${FY}-04-25`, kind: "지출", amountPhp: 18_000, fundId: "FD01",
      categoryCode: "E200", reason: "제8회 한인 체육대회 중식 케이터링 150인분", relatedParty: true,
      conflictId: "CI-0008", vendorId: "VD011", counterpartyName: "자로 케이터링",
      quoteUrl: "/uploads/quotes/2026-04-25_catering-3quotes.pdf", requiredStages: 2,
      approver1: EMAIL.president, result1: "승인", approvedOn1: `${FY}-04-27`,
      approver2: EMAIL.auditor2, result2: "승인", approvedOn2: `${FY}-04-29`,
      finalStatus: "집행완료", note: "총무 회피(recusal). 견적 3곳 비교",
    },
    {
      approvalId: "AP-2026-0005", requestedOn: `${FY}-07-28`, kind: "지출", amountPhp: 3_000, fundId: "FD01",
      categoryCode: "E120", reason: "하반기 이사회 장소 사용료 (PIA 어학원 대강당 3회)", relatedParty: true,
      conflictId: "CI-0001", vendorId: "VD001", counterpartyName: "PIA 필리핀어학원",
      quoteUrl: "/uploads/quotes/2026-07-28_venue-2quotes.pdf", requiredStages: 2,
      approver1: EMAIL.vp, result1: "승인", approvedOn1: `${FY}-07-30`,
      approver2: EMAIL.auditor2, result2: "승인", approvedOn2: `${FY}-08-03`,
      finalStatus: "승인", note: "회장 회피(recusal). 승인 완료 — 아직 집행 전",
    },
    {
      approvalId: "AP-2026-0006", requestedOn: `${FY}-08-05`, kind: "지출", amountPhp: 15_000, fundId: "FD03",
      categoryCode: "E300", reason: "태풍 피해 교민 2세대 긴급 주거 지원", relatedParty: false,
      conflictId: null, vendorId: null, counterpartyName: "피해 교민 2세대 (개별 지급)",
      quoteUrl: "", requiredStages: 1,
      approver1: "", result1: "대기", approvedOn1: null,
      approver2: "", result2: "불필요", approvedOn2: null,
      finalStatus: "대기", note: "회장 승인 대기 중",
    },
  ];

  await prisma.approval.createMany({
    data: APPROVALS.map((a) => ({
      approvalId: a.approvalId,
      requestedAt: at(a.requestedOn, 11, 15),
      requestedBy: EMAIL.treasurer,
      kind: a.kind,
      amount: a.amountPhp,
      currency: "PHP",
      amountPhp: a.amountPhp,
      fundId: a.fundId,
      categoryCode: a.categoryCode,
      reason: a.reason,
      relatedParty: a.relatedParty,
      conflictId: a.conflictId,
      quoteUrl: a.quoteUrl,
      requiredStages: a.requiredStages,
      approver1: a.approver1,
      approvedAt1: a.approvedOn1 ? at(a.approvedOn1, 14, 5) : null,
      result1: a.result1,
      approver2: a.approver2,
      approvedAt2: a.approvedOn2 ? at(a.approvedOn2, 16, 40) : null,
      result2: a.result2,
      finalStatus: a.finalStatus,
      executedReceiptNo: null,
      note: a.note,
      counterpartyName: a.counterpartyName,
      vendorId: a.vendorId,
    })),
  });

  /* ── 3-8. 행사 3 ─────────────────────────────────────────────────── */
  const EVENTS = [
    { eventId: "EV-2026-01", title: `${FY}년 정기총회`, kind: "정기총회", start: `${FY}-02-21`, end: `${FY}-02-21`, place: "PIA 어학원 대강당 (Jaro)", capacity: 120, fee: 0, budget: 12_000, deadline: `${FY}-02-18`, status: "완료" },
    { eventId: "EV-2026-02", title: "제8회 한인 체육대회", kind: "체육대회", start: `${FY}-05-09`, end: `${FY}-05-09`, place: "Iloilo Sports Complex (La Paz)", capacity: 150, fee: 300, budget: 60_000, deadline: `${FY}-05-02`, status: "완료" },
    { eventId: "EV-2026-03", title: `${FY} 추석 한마당`, kind: "명절", start: `${FY}-09-26`, end: `${FY}-09-26`, place: "Jaro Plaza", capacity: 200, fee: 250, budget: 45_000, deadline: `${FY}-09-18`, status: "접수중" },
  ];

  /* ────────────────────────────────────────────────────────────────
   * 3-9. 거래 계획 세우기
   * ──────────────────────────────────────────────────────────────── */

  const T = EMAIL.treasurer;

  /* (a) 회비 수입 ------------------------------------------------- */
  type DuesPlan = { memberNo: string; billed: number; paid: number; txKeys: string[]; status: string };
  const duesPlans: DuesPlan[] = [];

  for (const m of members) {
    const billed = DUES_PRICE[m.duesGrade] ?? 0;
    const plan0: DuesPlan = { memberNo: m.memberNo, billed, paid: 0, txKeys: [], status: "미납" };

    if (billed === 0) {
      plan0.status = "면제";
      duesPlans.push(plan0);
      continue;
    }
    if (m.status === "WITHDRAWN") {
      plan0.status = "미납";
      duesPlans.push(plan0);
      continue;
    }

    const r = rnd();
    // 완납 70% · 부분납 10% · 미납 20%
    if (r < 0.7) plan0.paid = billed;
    else if (r < 0.8) plan0.paid = Math.round(billed / 2 / 100) * 100;
    else plan0.paid = 0;

    duesPlans.push(plan0);
  }

  let duesTxCount = 0;
  let corporateCashCount = 0;
  for (const dp of duesPlans) {
    if (dp.paid <= 0) continue;
    const m = memberByNo.get(dp.memberNo)!;
    const date = dateBetween(`${FY}-01-20`, `${FY}-07-25`);
    duesTxCount++;

    // 법인 회원(₱5,000)은 반드시 현금으로 받는 것으로 둔다 — I4(현금 2인 확인) 시연용.
    const isCorporate = m.duesGrade === "법인" && dp.paid > 3000;
    let method: string;
    if (isCorporate) {
      method = "CASH";
      corporateCashCount++;
    } else {
      const r = rnd();
      // Maya 는 실제로도 소수가 쓴다 — 5% 정도. 계좌가 통째로 비어 있으면 화면에서 죽은 칸처럼 보인다.
      method = r < 0.05 ? "MAYA" : r < 0.55 ? "GCASH" : r < 0.85 ? "CASH" : "BANK";
    }
    const accountId =
      method === "GCASH" ? "AC02" : method === "MAYA" ? "AC03" : method === "CASH" ? "AC01" : "AC04";

    // 증빙 없이 들어온 건 2개 → I3 로 DRAFT 가 된다
    const noEvidence = duesTxCount === 7 || duesTxCount === 23;
    // 현금 임계(3,000) 초과 건. 첫 번째 법인 건만 확인자를 비워 둔다 → I4 로 DRAFT
    const bigCash = method === "CASH" && dp.paid > 3000;
    const skipVerifier = isCorporate && corporateCashCount === 1;

    const t = addTx({
      date,
      direction: "IN",
      amount: dp.paid,
      currency: "PHP",
      fxRate: 1,
      accountId,
      fundId: "FD01",
      categoryCode: "R100",
      counterpartyType: "회원",
      counterpartyMemberNo: m.memberNo,
      counterpartyName: m.name,
      method,
      memo:
        `${FY}년 연회비 ${dp.paid === dp.billed ? "완납" : "일부 납부"}` +
        (skipVerifier ? " (현금 고액 — 확인자 미기재로 임시 보관)" : ""),
      externalRef: method === "GCASH" ? `GC${randInt(100000000, 999999999)}` : method === "MAYA" ? `MY${randInt(10000000, 99999999)}` : "",
      relatedParty: false,
      approvalId: null,
      enteredBy: T,
      verifiedBy: bigCash && !skipVerifier ? EMAIL.vp : "",
      evidenceUrl: noEvidence ? "" : evidence("receipts", date, m.memberNo),
    });
    dp.txKeys.push(t.key);
  }

  /* (b) 기부 8건 ------------------------------------------------- */
  type DonationSeed = {
    donationId: string; date: string; donorType: string; donorMemberNo: string | null; donorName: string;
    amount: number; currency: "PHP" | "KRW" | "USD"; fxRate: number; amountPhp: number;
    isDesignated: boolean; fundId: string; purpose: string; method: string; accountId: string;
    isAnonymous: boolean; publicConsent: boolean; publicDisplayName: string; txKey: string;
  };

  const donationSpecs: Omit<DonationSeed, "txKey" | "donationId">[] = [
    { date: `${FY}-01-28`, donorType: "회원", donorMemberNo: "M0007", donorName: memberByNo.get("M0007")!.name, amount: 20_000, currency: "PHP", fxRate: 1, amountPhp: 20_000, isDesignated: true, fundId: "FD02", purpose: "한인 자녀 장학금", method: "BANK", accountId: "AC04", isAnonymous: false, publicConsent: true, publicDisplayName: "박OO 회원" },
    { date: `${FY}-02-14`, donorType: "법인", donorMemberNo: null, donorName: "자로 한식당", amount: 15_000, currency: "PHP", fxRate: 1, amountPhp: 15_000, isDesignated: false, fundId: "FD01", purpose: "", method: "GCASH", accountId: "AC02", isAnonymous: false, publicConsent: true, publicDisplayName: "자로 한식당" },
    { date: `${FY}-03-03`, donorType: "익명", donorMemberNo: null, donorName: "", amount: 5_000, currency: "PHP", fxRate: 1, amountPhp: 5_000, isDesignated: true, fundId: "FD03", purpose: "재해 교민 지원", method: "CASH", accountId: "AC01", isAnonymous: true, publicConsent: false, publicDisplayName: "" },
    { date: `${FY}-03-27`, donorType: "비회원", donorMemberNo: null, donorName: "정승호", amount: 500, currency: "USD", fxRate: 58.5, amountPhp: 29_250, isDesignated: true, fundId: "FD03", purpose: "태풍 피해 교민 긴급 구호", method: "BANK", accountId: "AC04", isAnonymous: false, publicConsent: true, publicDisplayName: "미국 거주 교민 J" },
    { date: `${FY}-04-11`, donorType: "회원", donorMemberNo: "M0013", donorName: memberByNo.get("M0013")!.name, amount: 20_000, currency: "PHP", fxRate: 1, amountPhp: 20_000, isDesignated: true, fundId: "FD02", purpose: "한인 자녀 장학금", method: "BANK", accountId: "AC04", isAnonymous: false, publicConsent: false, publicDisplayName: "" },
    { date: `${FY}-05-19`, donorType: "회원", donorMemberNo: "M0026", donorName: memberByNo.get("M0026")!.name, amount: 3_000, currency: "PHP", fxRate: 1, amountPhp: 3_000, isDesignated: false, fundId: "FD01", purpose: "", method: "GCASH", accountId: "AC02", isAnonymous: false, publicConsent: true, publicDisplayName: "백OO 회원" },
    { date: `${FY}-06-08`, donorType: "비회원", donorMemberNo: null, donorName: "한국 부산 향우회", amount: 1_000_000, currency: "KRW", fxRate: 0.0417, amountPhp: 41_700, isDesignated: false, fundId: "FD01", purpose: "", method: "BANK", accountId: "AC04", isAnonymous: false, publicConsent: true, publicDisplayName: "부산 향우회" },
    { date: `${FY}-07-15`, donorType: "회원", donorMemberNo: "M0035", donorName: memberByNo.get("M0035")!.name, amount: 2_500, currency: "PHP", fxRate: 1, amountPhp: 2_500, isDesignated: false, fundId: "FD01", purpose: "", method: "CASH", accountId: "AC01", isAnonymous: false, publicConsent: false, publicDisplayName: "" },
  ];

  const donations: DonationSeed[] = donationSpecs.map((d, i) => {
    const donationId = `DN-${FY}-${String(i + 1).padStart(4, "0")}`;
    const t = addTx({
      date: d.date,
      direction: "IN",
      amount: d.amount,
      currency: d.currency,
      fxRate: d.fxRate,
      accountId: d.accountId,
      fundId: d.fundId,
      categoryCode: "R200",
      counterpartyType: d.donorType === "익명" ? "익명" : d.donorType === "법인" ? "법인" : d.donorMemberNo ? "회원" : "비회원",
      counterpartyMemberNo: d.donorMemberNo,
      counterpartyName: d.isAnonymous ? "" : d.donorName,
      method: d.method,
      memo: d.isDesignated ? `지정기부 — ${d.purpose}` : "일반 기부",
      externalRef: d.method === "GCASH" ? `GC${randInt(100000000, 999999999)}` : "",
      relatedParty: false,
      approvalId: null,
      enteredBy: T,
      verifiedBy: d.method === "CASH" && d.amountPhp > 3000 ? EMAIL.vp : "",
      evidenceUrl: evidence("donations", d.date, donationId),
    });
    return { ...d, donationId, txKey: t.key };
  });

  /* (c) 행사 참가비 ---------------------------------------------- */
  type SignupSeed = { signupId: string; eventId: string; memberNo: string; guests: number; feeTotal: number; paid: boolean; txKey: string | null; attendance: string };
  const signups: SignupSeed[] = [];
  let signupSeq = 0;

  function addSignups(eventId: string, fee: number, count: number, paidCount: number, eventDate: string, attendanceDefault: string) {
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      let m = members[randInt(0, members.length - 1)];
      let guard = 0;
      while ((used.has(m.memberNo) || m.status !== "ACTIVE") && guard++ < 50) m = members[randInt(0, members.length - 1)];
      used.add(m.memberNo);
      const guests = randInt(0, 3);
      const feeTotal = fee * (1 + guests);
      const paid = fee > 0 && i < paidCount;
      let txKey: string | null = null;
      if (paid && feeTotal > 0) {
        const d = dateBetween(`${eventDate.slice(0, 8)}01`, eventDate);
        const t = addTx({
          date: d,
          direction: "IN",
          amount: feeTotal,
          currency: "PHP",
          fxRate: 1,
          accountId: rnd() < 0.6 ? "AC02" : "AC01",
          fundId: "FD01",
          categoryCode: "R300",
          counterpartyType: "회원",
          counterpartyMemberNo: m.memberNo,
          counterpartyName: m.name,
          method: rnd() < 0.6 ? "GCASH" : "CASH",
          memo: `행사 참가비 (${eventId}) ${1 + guests}명`,
          externalRef: "",
          relatedParty: false,
          approvalId: null,
          enteredBy: T,
          verifiedBy: "",
          evidenceUrl: evidence("events", d, `${eventId}-${m.memberNo}`),
        });
        txKey = t.key;
      }
      signups.push({
        signupId: `EA-${String(++signupSeq).padStart(4, "0")}`,
        eventId,
        memberNo: m.memberNo,
        guests,
        feeTotal,
        paid,
        txKey,
        attendance: attendanceDefault,
      });
    }
  }

  addSignups("EV-2026-01", 0, 20, 0, `${FY}-02-20`, "참석");
  addSignups("EV-2026-02", 300, 14, 10, `${FY}-05-08`, "참석");
  addSignups("EV-2026-03", 250, 8, 5, `${FY}-08-05`, "예정");

  /* (d) 이자·기타 수입 ------------------------------------------- */
  for (const [d, amt] of [
    [`${FY}-03-31`, 312],
    [`${FY}-06-30`, 341],
  ] as const) {
    addTx({
      date: d, direction: "IN", amount: amt, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD01",
      categoryCode: "R400", counterpartyType: "법인", counterpartyMemberNo: null, counterpartyName: "BDO Unibank",
      method: "BANK", memo: "예금 이자", externalRef: "", relatedParty: false, approvalId: null,
      enteredBy: T, verifiedBy: "", evidenceUrl: evidence("bank", d, "interest"),
    });
  }
  addTx({
    date: `${FY}-04-05`, direction: "IN", amount: 1_500, currency: "PHP", fxRate: 1, accountId: "AC01", fundId: "FD01",
    categoryCode: "R900", counterpartyType: "비회원", counterpartyMemberNo: null, counterpartyName: "총회 현장 판매",
    method: "CASH", memo: "총회 기념품 판매 잔액", externalRef: "", relatedParty: false, approvalId: null,
    enteredBy: T, verifiedBy: "", evidenceUrl: evidence("receipts", `${FY}-04-05`, "misc"),
  });

  /* (e) 지출 ------------------------------------------------------ */

  // 임차료 7개월 — AP-2026-0001
  for (let mth = 1; mth <= 7; mth++) {
    const d = `${FY}-${String(mth).padStart(2, "0")}-05`;
    addTx({
      date: d, direction: "OUT", amount: 6_500, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD01",
      categoryCode: "E110", counterpartyType: "업소", counterpartyMemberNo: null,
      counterpartyName: "SM 시티 일로일로 임대관리", method: "BANK",
      memo: `${mth}월 사무실 임차료`, externalRef: `BDO${randInt(100000, 999999)}`, relatedParty: false,
      approvalId: "AP-2026-0001", enteredBy: T, verifiedBy: "", evidenceUrl: evidence("expenses", d, "rent"),
    });
  }

  // 장학금 3건 — AP-2026-0002 (FD02)
  for (const [i, d] of [`${FY}-03-02`, `${FY}-03-02`, `${FY}-03-03`].entries()) {
    const studentNo = ["M0015", "M0029", "M0044"][i];
    addTx({
      date: d, direction: "OUT", amount: 10_000, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD02",
      categoryCode: "E310", counterpartyType: "회원", counterpartyMemberNo: studentNo,
      counterpartyName: memberByNo.get(studentNo)!.name, method: "BANK",
      memo: "2026 상반기 한인 자녀 장학금", externalRef: `BDO${randInt(100000, 999999)}`, relatedParty: false,
      approvalId: "AP-2026-0002", enteredBy: T, verifiedBy: "", evidenceUrl: evidence("expenses", d, `scholar${i + 1}`),
    });
  }

  // 이해관계자 거래 2건
  addTx({
    date: `${FY}-04-28`, direction: "OUT", amount: 4_200, currency: "PHP", fxRate: 1, accountId: "AC02", fundId: "FD01",
    categoryCode: "E200", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "오톤 하드웨어",
    method: "GCASH", memo: "체육대회 천막·부자재 (견적 2곳 비교, 회장 회피)", externalRef: `GC${randInt(100000000, 999999999)}`,
    relatedParty: true, approvalId: "AP-2026-0003", enteredBy: T, verifiedBy: "",
    evidenceUrl: evidence("expenses", `${FY}-04-28`, "hardware"),
  });
  addTx({
    date: `${FY}-05-09`, direction: "OUT", amount: 18_000, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD01",
    categoryCode: "E200", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "자로 케이터링",
    method: "BANK", memo: "체육대회 중식 150인분 (견적 3곳 비교, 총무 회피)", externalRef: `BDO${randInt(100000, 999999)}`,
    relatedParty: true, approvalId: "AP-2026-0004", enteredBy: EMAIL.vp, verifiedBy: "",
    evidenceUrl: evidence("expenses", `${FY}-05-09`, "catering"),
  });

  // 사무비 8건 (전결)
  const officeItems = [
    ["복사용지·문구", 850], ["프린터 토너", 2_400], ["사무실 인터넷 3월분", 1_800],
    ["회원 안내문 인쇄 200부", 2_800], ["사무실 인터넷 5월분", 1_800], ["명찰·현수막 제작", 2_200],
    ["사무실 인터넷 7월분", 1_800], ["우편·택배", 350],
  ] as const;
  officeItems.forEach(([label, amt], i) => {
    const d = dateBetween(`${FY}-01-10`, `${FY}-07-31`);
    addTx({
      date: d, direction: "OUT", amount: amt, currency: "PHP", fxRate: 1,
      accountId: i % 3 === 0 ? "AC01" : "AC02", fundId: "FD01",
      categoryCode: "E100", counterpartyType: "업소", counterpartyMemberNo: null,
      counterpartyName: i % 2 === 0 ? "일로일로 프린트샵" : "PLDT Home",
      method: i % 3 === 0 ? "CASH" : "GCASH", memo: String(label), externalRef: "",
      relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: "",
      // 1건은 증빙 없음 → I3 로 DRAFT
      evidenceUrl: i === 5 ? "" : evidence("expenses", d, `office${i + 1}`),
    });
  });

  // 회의비 5건
  const meetingItems = [
    ["1월 이사회 다과", 900], ["정기총회 음료·다과", 2_900], ["4월 이사회 다과", 1_100],
    ["6월 이사회 다과", 1_050], ["임원 워크숍 간식", 1_600],
  ] as const;
  meetingItems.forEach(([label, amt], i) => {
    const d = dateBetween(`${FY}-01-15`, `${FY}-07-20`);
    addTx({
      date: d, direction: "OUT", amount: amt, currency: "PHP", fxRate: 1, accountId: "AC01", fundId: "FD01",
      categoryCode: "E120", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "자로 한식당",
      method: "CASH", memo: String(label), externalRef: "", relatedParty: false, approvalId: null,
      enteredBy: T, verifiedBy: "", evidenceUrl: evidence("expenses", d, `meeting${i + 1}`),
    });
  });

  // 행사비 8건 (전결)
  const eventItems = [
    ["정기총회 현수막", 1_400, `${FY}-02-18`], ["정기총회 음향 대여", 2_500, `${FY}-02-20`],
    ["체육대회 상품 구입", 2_900, `${FY}-05-02`], ["체육대회 생수·얼음", 1_650, `${FY}-05-09`],
    ["체육대회 차량 임대", 2_800, `${FY}-05-09`], ["체육대회 구급함·의약품", 980, `${FY}-05-07`],
    ["추석 한마당 홍보물", 1_900, `${FY}-07-22`], ["추석 한마당 장소 예약금", 2_500, `${FY}-07-30`],
  ] as const;
  eventItems.forEach(([label, amt, d], i) => {
    addTx({
      date: String(d), direction: "OUT", amount: amt, currency: "PHP", fxRate: 1,
      accountId: i % 2 === 0 ? "AC02" : "AC01", fundId: "FD01",
      categoryCode: "E200", counterpartyType: "업소", counterpartyMemberNo: null,
      counterpartyName: i === 4 ? "파나이 트랜스포트 렌탈" : i === 6 ? "일로일로 프린트샵" : "일반 상점",
      method: i % 2 === 0 ? "GCASH" : "CASH", memo: String(label), externalRef: "",
      relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: "",
      evidenceUrl: evidence("expenses", String(d), `event${i + 1}`),
    });
  });

  // 구호비 4건 (FD03, 전결. 수취인이 자연인 → 공개 화면에서 마스킹된다)
  const reliefItems = [
    ["M0019", 2_500, `${FY}-02-09`, "화재 피해 세대 생활비 긴급 지원"],
    ["M0037", 3_000, `${FY}-04-14`, "입원 교민 병원비 일부 지원"],
    ["M0048", 2_500, `${FY}-06-12`, "태풍 피해 지붕 수리비 지원"],
    ["M0053", 2_000, `${FY}-07-19`, "실직 교민 생활비 긴급 지원"],
  ] as const;
  reliefItems.forEach(([memberNo, amt, d, label]) => {
    addTx({
      date: String(d), direction: "OUT", amount: amt, currency: "PHP", fxRate: 1, accountId: "AC01", fundId: "FD03",
      categoryCode: "E300", counterpartyType: "회원", counterpartyMemberNo: String(memberNo),
      counterpartyName: memberByNo.get(String(memberNo))!.name, method: "CASH",
      memo: String(label), externalRef: "", relatedParty: false, approvalId: null,
      enteredBy: T, verifiedBy: EMAIL.vp, evidenceUrl: evidence("expenses", String(d), `relief-${memberNo}`),
    });
  });

  // 공관협력비 2건
  for (const [d, amt, label] of [
    [`${FY}-03-18`, 1_500, "주세부 대한민국 총영사관 순회영사 지원 (다과·인쇄)"],
    [`${FY}-06-24`, 2_400, "순회영사 행사 장소 임차 분담금"],
  ] as const) {
    addTx({
      date: d, direction: "OUT", amount: amt, currency: "PHP", fxRate: 1, accountId: "AC02", fundId: "FD01",
      categoryCode: "E400", counterpartyType: "공공", counterpartyMemberNo: null,
      counterpartyName: "주세부 대한민국 총영사관", method: "GCASH", memo: label, externalRef: "",
      relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: "",
      evidenceUrl: evidence("expenses", d, "consulate"),
    });
  }

  // 기타지출 3건
  for (const [d, amt, label] of [
    [`${FY}-01-22`, 500, "은행 송금 수수료"],
    [`${FY}-05-27`, 1_800, "회계 프로그램 연간 이용료"],
    [`${FY}-07-08`, 750, "사무실 소모품"],
  ] as const) {
    addTx({
      date: d, direction: "OUT", amount: amt, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD01",
      categoryCode: "E900", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "기타 상점",
      method: "BANK", memo: label, externalRef: "", relatedParty: false, approvalId: null,
      enteredBy: T, verifiedBy: "", evidenceUrl: evidence("expenses", d, "misc"),
    });
  }

  // 내부이체 — 현금함 → BDO 통장 (계좌만 옮기고 기금은 그대로)
  addTx({
    date: `${FY}-06-02`, direction: "OUT", amount: 10_000, currency: "PHP", fxRate: 1, accountId: "AC01", fundId: "FD01",
    categoryCode: "E900", counterpartyType: "내부이체", counterpartyMemberNo: null, counterpartyName: "BDO 한인회 통장",
    method: "CASH", memo: "현금함 → 통장 입금 (현금 보유 축소)", externalRef: "IT-2026-01",
    relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: EMAIL.vp,
    evidenceUrl: evidence("bank", `${FY}-06-02`, "deposit"),
  });
  addTx({
    date: `${FY}-06-02`, direction: "IN", amount: 10_000, currency: "PHP", fxRate: 1, accountId: "AC04", fundId: "FD01",
    categoryCode: "R900", counterpartyType: "내부이체", counterpartyMemberNo: null, counterpartyName: "총무 현금함",
    method: "BANK", memo: "현금함 → 통장 입금 (현금 보유 축소)", externalRef: "IT-2026-01",
    relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: EMAIL.vp,
    evidenceUrl: evidence("bank", `${FY}-06-02`, "deposit"),
  });

  /* (f) VOIDED + 정정 재집행 (I1) --------------------------------- */
  const wrong = addTx({
    date: `${FY}-05-21`, direction: "OUT", amount: 2_900, currency: "PHP", fxRate: 1, accountId: "AC02", fundId: "FD01",
    categoryCode: "E100", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "일로일로 프린트샵",
    method: "GCASH", memo: "회원 명부 인쇄비", externalRef: `GC${randInt(100000000, 999999999)}`,
    relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: "",
    evidenceUrl: evidence("expenses", `${FY}-05-21`, "print-wrong"),
    forceVoid: { reason: "금액 오기입 (2,900 → 실제 1,900). 행을 지우지 않고 무효 처리하고 정정 건을 새로 기록함 (I1)" },
  });
  addTx({
    date: `${FY}-05-22`, direction: "OUT", amount: 1_900, currency: "PHP", fxRate: 1, accountId: "AC02", fundId: "FD01",
    categoryCode: "E100", counterpartyType: "업소", counterpartyMemberNo: null, counterpartyName: "일로일로 프린트샵",
    method: "GCASH", memo: "회원 명부 인쇄비 (무효 건 정정 재집행)", externalRef: `GC${randInt(100000000, 999999999)}`,
    relatedParty: false, approvalId: null, enteredBy: T, verifiedBy: "",
    evidenceUrl: evidence("expenses", `${FY}-05-22`, "print-fixed"),
    reversalOfKey: wrong.key,
  });

  /* ────────────────────────────────────────────────────────────────
   * 3-10. 채번 · 상태 판정 · 잔액 가드
   * ──────────────────────────────────────────────────────────────── */

  // 날짜 → 삽입순 으로 안정 정렬한 뒤 1번부터 결번 없이 채번한다.
  const ordered = plan
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => (a.t.date !== b.t.date ? (a.t.date < b.t.date ? -1 : 1) : a.idx - b.idx))
    .map((x) => x.t);

  const cashThreshold = 3000;
  const accBal: Record<string, number> = { AC01: OPENING.AC01, AC02: OPENING.AC02, AC03: OPENING.AC03, AC04: OPENING.AC04 };
  const receiptByKey = new Map<string, string>();
  const guardMoves: string[] = [];

  type FinalTx = PlannedTx & { receiptNo: string; seq: number; status: string; voidReason: string };
  const finalTxs: FinalTx[] = [];

  ordered.forEach((t, i) => {
    const seq = i + 1;
    const receiptNo = formatReceiptNo(RECEIPT_PREFIX, FY, seq, 6);
    receiptByKey.set(t.key, receiptNo);

    let status: string;
    let voidReason = "";
    if (t.forceVoid) {
      status = "VOIDED";
      voidReason = t.forceVoid.reason;
    } else {
      const verdict = evaluateTxState(
        {
          evidenceUrl: t.evidenceUrl,
          method: t.method,
          amount: t.amount,
          currency: t.currency,
          fxRate: t.fxRate,
          enteredBy: t.enteredBy,
          verifiedBy: t.verifiedBy,
        },
        cashThreshold,
      );
      status = verdict.status;
    }

    // 잔액 가드 — POSTED 지출이 계좌를 음수로 만들면 BDO 통장으로 돌린다.
    const amountPhp = Math.round(t.amount * t.fxRate);
    if (status === "POSTED") {
      if (t.direction === "OUT") {
        if (accBal[t.accountId] < amountPhp && t.accountId !== "AC04") {
          guardMoves.push(`${receiptNo} ${t.accountId}→AC04 (${formatMoney(amountPhp)})`);
          t.accountId = "AC04";
        }
        accBal[t.accountId] -= amountPhp;
      } else {
        accBal[t.accountId] += amountPhp;
      }
    }

    finalTxs.push({ ...t, receiptNo, seq, status, voidReason });
  });

  /* ── 3-11. 행사 · 거래 쓰기 ──────────────────────────────────────── */
  await prisma.event.createMany({
    data: EVENTS.map((e) => ({
      eventId: e.eventId,
      title: e.title,
      kind: e.kind,
      startsAt: at(e.start, e.eventId === "EV-2026-02" ? 8 : 14, 0),
      endsAt: at(e.end, e.eventId === "EV-2026-02" ? 16 : 17, 0),
      place: e.place,
      capacity: e.capacity,
      fee: e.fee,
      currency: "PHP",
      budget: e.budget,
      ownerEmail: EMAIL.vp,
      signupDeadline: e.deadline,
      status: e.status,
      isPublic: true,
      settlementReceiptNos: "",
      note: "",
    })),
  });

  // 자기참조(reversalOfReceiptNo) 때문에 seq 순서대로 하나씩 넣는다.
  for (const t of finalTxs) {
    await prisma.transaction.create({
      data: {
        receiptNo: t.receiptNo,
        date: t.date,
        direction: t.direction,
        amount: t.amount,
        currency: t.currency,
        fxRate: t.fxRate,
        amountPhp: Math.round(t.amount * t.fxRate),
        accountId: t.accountId,
        fundId: t.fundId,
        categoryCode: t.categoryCode,
        counterpartyType: t.counterpartyType,
        counterpartyMemberNo: t.counterpartyMemberNo,
        counterpartyName: t.counterpartyName,
        method: t.method,
        memo: t.memo,
        externalRef: t.externalRef,
        status: t.status,
        relatedParty: t.relatedParty,
        approvalId: t.approvalId,
        enteredBy: t.enteredBy,
        enteredAt: at(t.date, randInt(9, 17), randInt(0, 59)),
        verifiedBy: t.verifiedBy,
        verifiedAt: t.verifiedBy ? at(t.date, 18, 0) : null,
        evidenceUrl: t.evidenceUrl,
        voidReason: t.voidReason,
        fiscalYear: FY,
        seq: t.seq,
        reversalOfReceiptNo: t.reversalOfKey ? receiptByKey.get(t.reversalOfKey)! : null,
      },
    });
  }

  await prisma.receiptSequence.create({ data: { fiscalYear: FY, lastSeq: finalTxs.length } });

  // 승인의 집행영수증번호 채우기
  for (const a of APPROVALS) {
    const first = finalTxs.find((t) => t.approvalId === a.approvalId);
    if (first) {
      await prisma.approval.update({
        where: { approvalId: a.approvalId },
        data: { executedReceiptNo: first.receiptNo },
      });
    }
  }

  // 행사 결산영수증번호 (체육대회 1건만 정산 완료)
  const sportsReceipts = finalTxs
    .filter((t) => t.direction === "OUT" && t.status === "POSTED" && /체육대회/.test(t.memo))
    .map((t) => t.receiptNo);
  await prisma.event.update({
    where: { eventId: "EV-2026-02" },
    data: { settlementReceiptNos: sportsReceipts.join(","), note: `정산 완료 — 지출 ${sportsReceipts.length}건` },
  });

  /* ── 3-12. 회비고지 ──────────────────────────────────────────────── */
  const billedOn = `${FY}-01-15`;
  const dueOn = `${FY}-02-28`;
  const duesRows = duesPlans.map((dp, i) => {
    const m = memberByNo.get(dp.memberNo)!;
    const lastKey = dp.txKeys[dp.txKeys.length - 1];
    const lastReceiptNo = lastKey ? receiptByKey.get(lastKey)! : null;
    const lastTx = lastKey ? finalTxs.find((t) => t.key === lastKey)! : null;
    const unpaid = dp.billed - dp.paid;
    let status: string;
    if (dp.billed === 0) status = "면제";
    else if (dp.paid >= dp.billed) status = "완납";
    else if (dp.paid > 0) status = "부분납";
    else status = "미납";

    // 독촉은 납기일(2/28) 이후 7/30/60일. 6~11월은 태풍철이라 자동 발송이 멈춘다.
    const d1 = status === "미납" || status === "부분납" ? `${FY}-03-07` : null;
    const d2 = status === "미납" && i % 3 === 0 ? `${FY}-03-30` : null;
    const d3 = status === "미납" && i % 7 === 0 ? `${FY}-04-29` : null;

    return {
      invoiceId: `DU-${FY}-${String(i + 1).padStart(4, "0")}`,
      fiscalYear: FY,
      memberNo: dp.memberNo,
      memberName: m.name,
      duesGrade: m.duesGrade,
      billedAmount: dp.billed,
      currency: "PHP",
      billedOn,
      dueOn,
      paidAmount: dp.paid,
      unpaidAmount: unpaid,
      status,
      lastReceiptNo,
      lastPaidOn: lastTx ? lastTx.date : null,
      dunning1On: d1,
      dunning2On: d2,
      dunning3On: d3,
      exemptReason: dp.billed === 0 ? "명예회원 (회비규정 제6조 ② 고령·공로 회원 면제)" : "",
      note: m.status === "WITHDRAWN" ? "탈퇴 처리. 미납분은 결손 처리 예정" : "",
    };
  });
  await prisma.duesInvoice.createMany({ data: duesRows });

  /* ── 3-13. 기부 · 기부사용 ───────────────────────────────────────── */
  await prisma.donation.createMany({
    data: donations.map((d) => ({
      donationId: d.donationId,
      receivedOn: d.date,
      donorType: d.donorType,
      donorMemberNo: d.donorMemberNo,
      donorName: d.isAnonymous ? "" : d.donorName,
      donorPhone: "",
      amount: d.amount,
      currency: d.currency,
      amountPhp: d.amountPhp,
      isDesignated: d.isDesignated,
      fundId: d.isDesignated ? d.fundId : null,
      designatedPurpose: d.purpose,
      method: d.method,
      accountId: d.accountId,
      receiptNo: receiptByKey.get(d.txKey)!,
      isAnonymous: d.isAnonymous,
      publicConsent: d.publicConsent,
      publicDisplayName: d.publicDisplayName,
      thanksSentOn: d.isAnonymous ? null : d.date,
      status: "확인",
      note: "",
    })),
  });

  // 지정기부 사용 내역 — 장학금 3건 + 구호비 2건
  const scholarshipTxs = finalTxs.filter((t) => t.categoryCode === "E310");
  const reliefTxs = finalTxs.filter((t) => t.categoryCode === "E300" && t.fundId === "FD03").slice(0, 2);
  const donationUses = [
    ...scholarshipTxs.map((t, i) => ({
      useId: `DU-USE-${String(i + 1).padStart(4, "0")}`,
      donationId: `DN-${FY}-0001`,
      fundId: "FD02",
      usedOn: t.date,
      amount: t.amount,
      currency: "PHP",
      amountPhp: t.amount,
      receiptNo: t.receiptNo,
      purposeText: "2026 상반기 한인 자녀 장학금 지급",
      evidenceUrl: t.evidenceUrl,
      approvalId: "AP-2026-0002",
      status: "집행",
      enteredBy: EMAIL.treasurer,
      enteredAt: at(t.date, 15, 0),
    })),
    ...reliefTxs.map((t, i) => ({
      useId: `DU-USE-${String(scholarshipTxs.length + i + 1).padStart(4, "0")}`,
      donationId: `DN-${FY}-0004`,
      fundId: "FD03",
      usedOn: t.date,
      amount: t.amount,
      currency: "PHP",
      amountPhp: t.amount,
      receiptNo: t.receiptNo,
      purposeText: t.memo,
      evidenceUrl: t.evidenceUrl,
      approvalId: null,
      status: "집행",
      enteredBy: EMAIL.treasurer,
      enteredAt: at(t.date, 15, 0),
    })),
  ];
  await prisma.donationUse.createMany({ data: donationUses });

  /* ── 3-14. 행사신청 ──────────────────────────────────────────────── */
  await prisma.eventSignup.createMany({
    data: signups.map((s) => {
      const m = memberByNo.get(s.memberNo)!;
      return {
        signupId: s.signupId,
        eventId: s.eventId,
        appliedAt: at(dateBetween(`${FY}-01-20`, `${FY}-08-04`), randInt(8, 21), randInt(0, 59)),
        memberNo: s.memberNo,
        applicantName: m.name,
        phone: m.phone,
        guests: s.guests,
        totalPeople: 1 + s.guests,
        feeTotal: s.feeTotal,
        paid: s.paid,
        receiptNo: s.txKey ? receiptByKey.get(s.txKey)! : null,
        attendance: s.attendance,
        specialNote: s.guests > 2 ? "어린이 동반 — 아동 식사 요청" : "",
        status: s.eventId === "EV-2026-03" ? "접수" : "확정",
        formResponseId: `F5!R${s.signupId}`,
      };
    }),
  });

  /* ── 3-15. 현금실사 3 · 인수인계 4 · 대사 8 ─────────────────────── */
  const txRowsForBalance: TxRow[] = finalTxs.map((t) => ({
    receiptNo: t.receiptNo,
    date: t.date,
    direction: t.direction,
    amountPhp: Math.round(t.amount * t.fxRate),
    accountId: t.accountId,
    fundId: t.fundId,
    categoryCode: t.categoryCode,
    counterpartyType: t.counterpartyType,
    counterpartyName: t.counterpartyName,
    method: t.method,
    memo: t.memo,
    status: t.status,
    relatedParty: t.relatedParty,
    evidenceUrl: t.evidenceUrl,
    voidReason: t.voidReason,
    fiscalYear: FY,
    seq: t.seq,
  }));

  const accountRows: AccountRow[] = ACCOUNTS.map((a) => ({
    accountId: a.accountId, name: a.name, kind: a.kind, status: "ACTIVE",
    openedOn: `${FY}-01-01`, openingBalance: a.openingBalance, isPublic: true,
  }));
  const fundRows: FundRow[] = FUNDS.map((f) => ({
    fundId: f.fundId, name: f.name, kind: f.kind, purpose: f.purpose,
    startOn: `${FY}-01-01`, openingBalance: f.openingBalance, isPublic: true,
  }));
  const categoryRows: CategoryRow[] = CATEGORIES.map((c) => ({
    code: c.code, publicName: c.publicName, name: c.name, majorType: c.majorType, isPublic: true, sortOrder: c.sortOrder,
  }));

  function bookBalanceAt(accountId: string, asOf: string): number {
    return accountBalancesAsOf(accountRows, txRowsForBalance, asOf).find((a) => a.accountId === accountId)!.balance;
  }

  const cashCountSpecs = [
    { countId: `CC-${FY}-01`, date: `${FY}-03-31`, accountId: "AC01", diff: 0, reason: "" },
    { countId: `CC-${FY}-02`, date: `${FY}-05-31`, accountId: "AC01", diff: -200, reason: "체육대회 현장 잔돈 정산 누락 추정. 총무가 자비로 보전, 6월 재실사 예정" },
    { countId: `CC-${FY}-03`, date: `${FY}-06-30`, accountId: "AC02", diff: 0, reason: "" },
  ];
  await prisma.cashCount.createMany({
    data: cashCountSpecs.map((c) => {
      const book = bookBalanceAt(c.accountId, c.date);
      return {
        countId: c.countId,
        countedAt: at(c.date, 17, 30),
        accountId: c.accountId,
        bookBalance: book,
        countedBalance: book + c.diff,
        diff: c.diff,
        diffReason: c.reason,
        counter1: EMAIL.treasurer,
        counter2: EMAIL.auditor1,
        photoUrl: `/uploads/cashcount/${c.date}_${c.accountId}.jpg`,
        status: c.diff === 0 ? "정상" : "차액발생",
        followUp: c.diff === 0 ? "" : "6월 실사에서 재확인. 반복되면 현금 보유 한도를 낮춘다",
        createdAt: at(c.date, 18, 0),
      };
    }),
  });

  // I6 증거 — 전기 마감잔액을 계좌별로 인수인계한 기록
  await prisma.handover.createMany({
    data: ACCOUNTS.map((a, i) => ({
      handoverId: `HO-${FY}-${String(i + 1).padStart(2, "0")}`,
      date: `${FY}-01-02`,
      kind: "연도마감",
      fromEmail: "prev-treasurer@example.com",
      toEmail: EMAIL.treasurer,
      role: "총무",
      items: `${a.name} (${a.kind})`,
      balanceBefore: a.openingBalance,
      balanceAfter: a.openingBalance,
      accountId: a.accountId,
      signatureUrl: `/uploads/handover/${FY}-01-02_${a.accountId}_sign.jpg`,
      attachmentUrl: `/uploads/handover/${FY}-01-02_개시잔액선언서.pdf`,
      verifier: EMAIL.auditor1,
      status: "완료",
      note: `${PREV_FY} 마감잔액을 그대로 인수 (I6)`,
    })),
  });

  // GCash 대사 — 5~6월분 명세를 붙여넣고 장부와 대조한 결과
  type ReconRow = {
    reconId: string; reconDate: string; accountId: string; externalAt: Date; externalRef: string;
    externalAmount: number; externalDirection: string; externalMemo: string;
    matchedReceiptNo: string | null; matchStatus: string; diff: number;
    handledBy: string; handledAt: Date; note: string;
  };
  const gcash56 = finalTxs.filter(
    (t) => t.accountId === "AC02" && (t.date.startsWith(`${FY}-05`) || t.date.startsWith(`${FY}-06`)) && t.status === "POSTED",
  );
  const reconRows: ReconRow[] = gcash56.slice(0, 9).map((t, i) => ({
    reconId: `RC-${FY}06-${String(i + 1).padStart(3, "0")}`,
    reconDate: `${FY}-07-03`,
    accountId: "AC02",
    externalAt: at(t.date, 12, 0),
    externalRef: t.externalRef || `GC${randInt(100000000, 999999999)}`,
    externalAmount: Math.round(t.amount * t.fxRate),
    externalDirection: t.direction,
    externalMemo: t.memo.slice(0, 40),
    matchedReceiptNo: t.receiptNo,
    matchStatus: "MATCHED",
    diff: 0,
    handledBy: EMAIL.treasurer,
    handledAt: at(`${FY}-07-03`, 16, 0),
    note: "",
  }));
  reconRows.push({
    reconId: `RC-${FY}06-999`,
    reconDate: `${FY}-07-03`,
    accountId: "AC02",
    externalAt: at(`${FY}-06-18`, 19, 22),
    externalRef: `GC${randInt(100000000, 999999999)}`,
    externalAmount: 500,
    externalDirection: "IN",
    externalMemo: "입금자 미상",
    matchedReceiptNo: null,
    matchStatus: "UNMATCHED_EXT",
    diff: 500,
    handledBy: EMAIL.treasurer,
    handledAt: at(`${FY}-07-03`, 16, 10),
    note: "명세서에는 있는데 장부에 없다. 입금자 확인 중 — 확인되면 수납 기록으로 올린다",
  });
  await prisma.reconciliation.createMany({ data: reconRows });

  /* ── 3-16. 감사로그 ──────────────────────────────────────────────── */
  const voidedTx = finalTxs.find((t) => t.status === "VOIDED")!;
  const auditRows = [
    { logId: "AU-000001", occurredAt: at(`${FY}-01-02`, 9, 0), actor: EMAIL.auditor1, tableName: "FiscalYear", recordKey: String(PREV_FY), fieldName: "status", beforeValue: "OPEN", afterValue: "CLOSED", changeType: "SCRIPT", severity: "INFO", relatedKey: "", note: "2025 회계연도 마감. 이후 이 연도에는 쓰기 불가 (I5)" },
    { logId: "AU-000002", occurredAt: at(`${FY}-01-08`, 10, 12), actor: EMAIL.president, tableName: "ConflictOfInterest", recordKey: "CI-0001", fieldName: "-", beforeValue: "", afterValue: "신규 신고 7건", changeType: "INSERT", severity: "INFO", relatedKey: "", note: "회장 본인 사업 7건 일괄 신고" },
    { logId: "AU-000003", occurredAt: at(`${FY}-04-22`, 14, 5), actor: EMAIL.vp, tableName: "Approval", recordKey: "AP-2026-0003", fieldName: "result1", beforeValue: "대기", afterValue: "승인", changeType: "EDIT", severity: "WARN", relatedKey: "VD007", note: "이해관계 건 — 회장 회피로 부회장이 1차 승인" },
    { logId: "AU-000004", occurredAt: at(`${FY}-04-24`, 16, 40), actor: EMAIL.auditor2, tableName: "Approval", recordKey: "AP-2026-0003", fieldName: "result2", beforeValue: "대기", afterValue: "승인", changeType: "EDIT", severity: "WARN", relatedKey: "VD007", note: "이사회 2차 승인" },
    { logId: "AU-000005", occurredAt: at(`${FY}-05-21`, 17, 20), actor: EMAIL.treasurer, tableName: "Transaction", recordKey: voidedTx.receiptNo, fieldName: "status", beforeValue: "POSTED", afterValue: "VOIDED", changeType: "EDIT", severity: "CRITICAL", relatedKey: voidedTx.receiptNo, note: "금액 오기입 무효 처리. 행은 지우지 않았다 (I1)" },
    { logId: "AU-000006", occurredAt: at(`${FY}-05-22`, 9, 15), actor: EMAIL.treasurer, tableName: "Transaction", recordKey: "-", fieldName: "-", beforeValue: "", afterValue: "정정 재집행 1,900", changeType: "INSERT", severity: "INFO", relatedKey: voidedTx.receiptNo, note: "무효 건의 정정 재집행" },
    { logId: "AU-000007", occurredAt: at(`${FY}-05-31`, 18, 5), actor: EMAIL.auditor1, tableName: "CashCount", recordKey: `CC-${FY}-02`, fieldName: "diff", beforeValue: "", afterValue: "-200", changeType: "INSERT", severity: "WARN", relatedKey: "AC01", note: "현금 실사 차액 발생" },
    { logId: "AU-000008", occurredAt: at(`${FY}-06-02`, 11, 0), actor: EMAIL.treasurer, tableName: "Transaction", recordKey: "-", fieldName: "-", beforeValue: "", afterValue: "내부이체 10,000", changeType: "INSERT", severity: "INFO", relatedKey: "IT-2026-01", note: "현금 보유 축소를 위한 통장 입금" },
    { logId: "AU-000009", occurredAt: at(`${FY}-07-03`, 16, 10), actor: EMAIL.treasurer, tableName: "Reconciliation", recordKey: `RC-${FY}06-999`, fieldName: "matchStatus", beforeValue: "", afterValue: "UNMATCHED_EXT", changeType: "INSERT", severity: "WARN", relatedKey: "AC02", note: "명세서에만 있는 입금 500 — 입금자 확인 중" },
    { logId: "AU-000010", occurredAt: at(`${FY}-08-03`, 16, 40), actor: EMAIL.auditor2, tableName: "Approval", recordKey: "AP-2026-0005", fieldName: "result2", beforeValue: "대기", afterValue: "승인", changeType: "EDIT", severity: "WARN", relatedKey: "VD001", note: "이해관계 건(회장 어학원) — 회장 회피, 이사회 승인" },
  ];
  await prisma.auditLog.createMany({ data: auditRows });

  /* ── 3-17. 알림로그 + 발송함 ─────────────────────────────────────── */
  // 메일 본문 링크는 절대주소여야 한다 — 메일 클라이언트에는 "현재 사이트" 가 없어서
  // /ledger 같은 상대경로는 눌리지 않는 죽은 링크가 된다. (앱의 join·donate·receipt 도 absoluteUrl 을 쓴다)
  const publicLedgerUrl = absoluteUrl(PUBLIC_LEDGER_PATH);

  // 임원 5명 매직링크
  for (const o of officers) {
    await issueMagicLink(prisma, {
      purpose: "OFFICER_LOGIN",
      email: o.email,
      name: memberByNo.get(o.memberNo)!.name,
      officerId: o.officerId,
      memberNo: o.memberNo,
      ttlHours: 24 * 30, // 프로토타입이라 넉넉히 — 대표가 며칠 뒤 열어도 링크가 살아 있어야 한다
      now: at(TODAY, 6, 0),
    });
  }

  // 최근 가입 회원 환영 메일 5통
  const newest = [...members].filter((m) => m.status === "ACTIVE").sort((a, b) => (a.joinedOn < b.joinedOn ? 1 : -1)).slice(0, 5);
  for (const m of newest) {
    const invoice = duesRows.find((d) => d.memberNo === m.memberNo)!;
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      "환영",
      { 성명: m.name, 회원번호: m.memberNo, 회계연도: FY, 고지금액: formatMoney(invoice.billedAmount), 납기일: dueOn, 공개장부URL: publicLedgerUrl },
      { subject: FALLBACK_TEMPLATES.환영.subject, body: FALLBACK_TEMPLATES.환영.body },
    );
    await queueMail(prisma, {
      kind: "환영",
      toEmail: m.email,
      toName: m.name,
      subject,
      // 같은 본문 안에서 공개장부는 절대주소인데 여기만 상대경로면 실제 메일에서 하나만 죽는다.
      bodyHtml:
        bodyHtml +
        `<br><hr><p>본인 확인 링크: <a href="${absoluteUrl(memberLinkPath(m.linkToken))}">${absoluteUrl(memberLinkPath(m.linkToken))}</a></p>`,
      linkPath: memberLinkPath(m.linkToken),
      memberNo: m.memberNo,
      relatedId: invoice.invoiceId,
      trigger: "seed:welcome",
      sentAt: at(m.joinedOn, 9, 35),
    });
  }

  // 최근 수납 영수증 메일 12통
  const recentDues = finalTxs
    .filter((t) => t.categoryCode === "R100" && t.status === "POSTED" && t.counterpartyMemberNo)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 12);
  for (const t of recentDues) {
    const m = memberByNo.get(t.counterpartyMemberNo!)!;
    const invoice = duesRows.find((d) => d.memberNo === m.memberNo)!;
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      "영수증",
      {
        성명: m.name, 영수증번호: t.receiptNo, 일자: t.date, 금액: formatMoney(t.amount), 통화: t.currency,
        과목명: "회비", 수단: t.method, 입력자: t.enteredBy,
        미납안내: invoice.unpaidAmount > 0 ? `현재 미납 잔액이 ${formatMoney(invoice.unpaidAmount)} PHP 남아 있습니다.` : "",
        공개장부URL: publicLedgerUrl,
      },
      { subject: FALLBACK_TEMPLATES.영수증.subject, body: FALLBACK_TEMPLATES.영수증.body },
    );
    await queueMail(prisma, {
      kind: "영수증", toEmail: m.email, toName: m.name, subject, bodyHtml,
      linkPath: memberLinkPath(m.linkToken), memberNo: m.memberNo, relatedId: t.receiptNo,
      trigger: "seed:receipt", sentAt: at(t.date, 18, 10),
    });
  }

  // 독촉 1차 5통 · 2차 3통
  const unpaid = duesRows.filter((d) => d.status === "미납" && d.billedAmount > 0);
  for (const [i, d] of unpaid.slice(0, 8).entries()) {
    const m = memberByNo.get(d.memberNo)!;
    if (!m.notifyConsent) continue;
    const stage = i < 5 ? "독촉1" : "독촉2";
    const tplName = stage;
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      tplName,
      {
        성명: m.name, 회계연도: FY, 고지금액: formatMoney(d.billedAmount), 납부금액: formatMoney(d.paidAmount),
        미납금액: formatMoney(d.unpaidAmount), 납기일: d.dueOn, 공개장부URL: publicLedgerUrl,
      },
      stage === "독촉1"
        ? { subject: FALLBACK_TEMPLATES.독촉1.subject, body: FALLBACK_TEMPLATES.독촉1.body }
        : { subject: FALLBACK_TEMPLATES.독촉2.subject, body: FALLBACK_TEMPLATES.독촉2.body },
    );
    await queueMail(prisma, {
      kind: stage, toEmail: m.email, toName: m.name, subject, bodyHtml,
      linkPath: memberLinkPath(m.linkToken), memberNo: m.memberNo, relatedId: d.invoiceId,
      trigger: "seed:dunning", sentAt: at(stage === "독촉1" ? `${FY}-03-07` : `${FY}-03-30`, 7, 0),
    });
  }

  // 감사장 4통
  for (const d of donations.filter((x) => !x.isAnonymous).slice(0, 4)) {
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      "감사장",
      { 기부자명: d.donorName, 기부ID: d.donationId, 금액: formatMoney(d.amount), 통화: d.currency, 지정용도: d.purpose || "지정 없음(일반회계)", 공개장부URL: publicLedgerUrl },
      { subject: FALLBACK_TEMPLATES.감사장.subject, body: FALLBACK_TEMPLATES.감사장.body },
    );
    await queueMail(prisma, {
      kind: "감사장",
      toEmail: d.donorMemberNo ? memberByNo.get(d.donorMemberNo)!.email : "donor@example.com",
      toName: d.donorName, subject, bodyHtml, memberNo: d.donorMemberNo, relatedId: d.donationId,
      trigger: "seed:thanks", sentAt: at(d.date, 20, 0),
    });
  }

  // 월결산 1통 (7월)
  {
    const julyIn = finalTxs.filter((t) => t.status === "POSTED" && t.direction === "IN" && t.date.startsWith(`${FY}-07`)).reduce((s, t) => s + Math.round(t.amount * t.fxRate), 0);
    const julyOut = finalTxs.filter((t) => t.status === "POSTED" && t.direction === "OUT" && t.date.startsWith(`${FY}-07`)).reduce((s, t) => s + Math.round(t.amount * t.fxRate), 0);
    const endBal = accountBalancesAsOf(accountRows, txRowsForBalance, `${FY}-07-31`).reduce((s, a) => s + a.balance, 0);
    const { subject, bodyHtml } = renderFromSettings(
      settings, "월결산",
      { 연월: `${FY}-07`, 총수입: formatMoney(julyIn), 총지출: formatMoney(julyOut), 잔액: formatMoney(endBal), 공개장부URL: publicLedgerUrl },
      { subject: FALLBACK_TEMPLATES.월결산.subject, body: FALLBACK_TEMPLATES.월결산.body },
    );
    for (const to of [EMAIL.president, EMAIL.treasurer, EMAIL.auditor1]) {
      await queueMail(prisma, { kind: "월결산", toEmail: to, subject, bodyHtml, linkPath: publicLedgerUrl, trigger: "seed:monthlyClose", sentAt: at(`${FY}-08-01`, 7, 0) });
    }
  }

  /* ════════════════════════════════════════════════════════════════
   * 4. 검산
   * ════════════════════════════════════════════════════════════════ */
  console.log("");
  console.log("─".repeat(72));
  console.log("검산");
  console.log("─".repeat(72));

  if (guardMoves.length) {
    console.log(`  [가드] 잔액 부족으로 계좌를 옮긴 지출 ${guardMoves.length}건: ${guardMoves.join(", ")}`);
  }

  const audit = auditBalances(accountRows, fundRows, txRowsForBalance, FY, RECEIPT_PREFIX, TODAY);
  for (const c of audit.checks) {
    console.log(`  ${c.ok ? "OK  " : "FAIL"} ${c.name.padEnd(28)} ${c.detail}`);
  }

  const opening = checkOpeningBalance(accountRows, OPENING_TOTAL);
  console.log(`  ${opening.ok ? "OK  " : "FAIL"} ${"I6 개시잔액 = 전기 마감".padEnd(28)} ${opening.message}`);

  // 공개 화면에 회원 실명이 나가는가 — 0건이어야 한다
  const realNames = buildRealNameList(members.map((m) => m.name));
  const policy = publicPolicyFrom(settings);
  const ledger = buildPublicLedger(txRowsForBalance, accountRows, fundRows, categoryRows, {
    fiscalYear: FY,
    today: TODAY,
    showMemo: policy.showMemo,
    maskNames: policy.maskNames,
    payeePolicy: policy.payeePolicy,
    realNames,
    maxExpenseRows: policy.maxExpenseRows,
    receiptPrefix: policy.receiptPrefix,
  });
  const leaked = ledger.expenses.filter(
    (e) => isExactRealName(e.payee, realNames) || realNames.some((n) => e.memo.includes(n)),
  );
  console.log(`  ${leaked.length === 0 ? "OK  " : "FAIL"} ${"공개 지출목록 회원 실명 노출".padEnd(28)} ${leaked.length}건${leaked.length ? " — " + leaked.map((e) => e.receiptNo).join(",") : ""}`);

  // 이해상충 판정이 실제로 작동하는가
  const vendorRows = VENDORS.map((v) => ({ vendorId: v.vendorId, name: v.name, aliases: v.aliases, industry: v.industry, relatedMemberNo: v.relatedMemberNo, relatedParty: v.relatedParty, ownershipPct: v.ownershipPct }));
  const conflictRows = CONFLICTS.map((c) => {
    const v = VENDORS.find((x) => x.vendorId === c.vendorId)!;
    return { conflictId: c.conflictId, declarerMemberNo: c.declarerMemberNo, declarerName: memberByNo.get(c.declarerMemberNo)!.name, role: officers.find((o) => o.memberNo === c.declarerMemberNo)?.role ?? "", counterpartyName: v.name, relationType: c.relationType, vendorId: c.vendorId, detail: c.detail, disclosed: true, recused: c.recused, ownershipPct: c.ownershipPct };
  });
  const officerRows = officers.map((o) => ({ officerId: o.officerId, memberNo: o.memberNo, name: memberByNo.get(o.memberNo)!.name, role: o.role, email: o.email, approvalLimit: o.approvalLimit, permissions: o.permissions, status: "ACTIVE" }));

  // 우회 시도 — 전부 잡혀야 한다.
  // 한글 난독화는 conflictNormalize(NFKC + 화이트리스트)가 잡고,
  // 로마자 표기는 Vendor.aliases 대조가 잡는다. 정규화만으로는 문자 체계를 못 넘는다.
  const evasions = [
    // 한글 난독화
    "오톤 하드웨어", "- 오톤 하드웨어", "오​톤 하드웨어", "ＰＩＡ 필리핀어학원",
    "—오톤", "오톤|하드웨어", "（오톤）", "오톤：하드웨어", "【오톤】",
    "오톤".normalize("NFD"),
    // 로마자·영문 표기 — 필리핀 현지 간판이 이렇다. 악의 없이도 이렇게 적힌다.
    "OTON Hardware", "Oton Hardware", "oton hardware", "OTON HARDWARE SUPPLY",
    "PIA Language Academy", "A-Work", "Build & Sell", "Speakle", "Iloilo Stay",
    "Han-in Law Office",
  ];
  const missed = evasions.filter((n) => !evaluateConflict({ counterpartyName: n }, vendorRows, conflictRows, officerRows).related);
  console.log(`  ${missed.length === 0 ? "OK  " : "FAIL"} ${"이해상충 우회 표기 탐지".padEnd(28)} ${evasions.length - missed.length}/${evasions.length} 탐지 (한글난독화+로마자)${missed.length ? " ★놓침: " + missed.join(", ") : ""}`);

  const cleanVerdict = evaluateConflict({ counterpartyName: "SM 시티 일로일로 임대관리" }, vendorRows, conflictRows, officerRows);
  console.log(`  ${!cleanVerdict.related && !cleanVerdict.undetermined ? "OK  " : "FAIL"} ${"무관한 업체 오탐 없음".padEnd(28)} SM 시티 임대관리 → 이해관계 ${cleanVerdict.related}`);

  const undet = evaluateConflict({ counterpartyName: "---" }, vendorRows, conflictRows, officerRows);
  console.log(`  ${undet.undetermined ? "OK  " : "FAIL"} ${"부호만 있는 수취인 = 판정불가".padEnd(28)} undetermined=${undet.undetermined}`);

  /* ── 요약 ────────────────────────────────────────────────────────── */
  const counts = {
    설정: await prisma.setting.count(),
    회원: await prisma.member.count(),
    임원: await prisma.officer.count(),
    업소: await prisma.vendor.count(),
    이해상충: await prisma.conflictOfInterest.count(),
    거래: await prisma.transaction.count(),
    회비고지: await prisma.duesInvoice.count(),
    기부: await prisma.donation.count(),
    기부사용: await prisma.donationUse.count(),
    행사: await prisma.event.count(),
    행사신청: await prisma.eventSignup.count(),
    승인: await prisma.approval.count(),
    현금실사: await prisma.cashCount.count(),
    인수인계: await prisma.handover.count(),
    대사: await prisma.reconciliation.count(),
    감사로그: await prisma.auditLog.count(),
    알림로그: await prisma.notifyLog.count(),
    발송함: await prisma.outboxMail.count(),
    매직링크: await prisma.magicLink.count(),
  };

  console.log("");
  console.log("─".repeat(72));
  console.log("적재 결과");
  console.log("─".repeat(72));
  console.log("  " + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log("");
  console.log(`  총수입 ${formatPeso(ledger.totalIncome)} · 총지출 ${formatPeso(ledger.totalExpense)} · 수지 ${formatPeso(ledger.net)}`);
  console.log(`  계좌 잔액 합계 ${formatPeso(ledger.accountTotals.balance)} (개시 ${formatPeso(ledger.accountTotals.openingBalance)})`);
  console.log(`  POSTED ${ledger.metrics.postedCount} · DRAFT ${ledger.metrics.draftCount} · VOIDED ${ledger.metrics.voidedCount} · 증빙첨부율 ${ledger.metrics.evidenceRate}%`);
  console.log(`  이해관계자 거래 ${ledger.metrics.relatedPartyCount}건 ${formatPeso(ledger.metrics.relatedPartyAmount)}`);
  console.log(`  ${ledger.metrics.gaps.message}`);
  console.log("");
  console.log(`  임원 로그인 비밀번호(프로토타입): ${DEV_PASSWORD}  ·  매직링크는 /dev/outbox 에서 클릭`);
  console.log("");

  const allOk = audit.ok && opening.ok && leaked.length === 0 && missed.length === 0 && !cleanVerdict.related && undet.undetermined;
  if (!allOk) {
    console.error("검산 실패 — 위 FAIL 항목을 고쳐라.");
    process.exitCode = 1;
  } else {
    console.log("검산 전부 통과.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

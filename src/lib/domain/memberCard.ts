/**
 * 디지털 회원증 유효 판정 — 순수 함수. DB 를 모른다. (P3)
 *
 * ── 왜 순수 함수 한 곳인가 ───────────────────────────────────────────────
 *  같은 판정을 **세 화면**이 쓴다:
 *    ① 회원 포털  — 회원증을 보여줄까, "무엇이 부족한지" 를 보여줄까
 *    ② /me/card   — 인쇄용 카드
 *    ③ /verify/<토큰> — 제휴 업소가 QR 로 여는 공개 확인 페이지
 *  세 곳이 각자 판정하면 반드시 어긋난다. 포털에서는 유효한데 QR 은 무효로 나오는
 *  순간 회원증은 신뢰를 잃는다. 그래서 규칙은 여기 한 곳에만 둔다.
 *
 * ── 발급 조건 (대표 확정 2026-08-11) ─────────────────────────────────────
 *  "**당해연도 회비 납부 회원만**" + 총무의 **사진 승인**.
 *  근거: 05_의사결정기록/2026-08-11_회원포털_플랜.md §3 P3 · §5 ②
 *
 * ── ★ 상태를 DB 에 굳히지 않는다 ─────────────────────────────────────────
 *  회비는 언제든 미납으로 돌아설 수 있고(고지 정정·무효처리·과오납 환급),
 *  탈퇴도 언제든 일어난다. 발급 시점에 'ISSUED' 를 저장해 두면 그 뒤로 무슨 일이
 *  있어도 회원증은 계속 유효로 보인다. 그래서 **볼 때마다** 이 함수가 다시 센다.
 *
 * ── 회비 완납 판정의 정본은 06_회비고지(DuesInvoice)다 ────────────────────
 *  05_거래(수납 합계)로 세지 않는다. 회비 수납은 recordReceiptAction 이 같은
 *  트랜잭션에서 회비고지에 반영하고(부분납/완납/과납), 면제·고지금액 정정 같은
 *  "돈이 오가지 않은 사실" 은 회비고지에만 있기 때문이다.
 *  (memberPayments.ts 의 회비 소계는 **표시용**이다 — 그 값으로 판정하면
 *   면제 회원이 영원히 미납으로 잡힌다)
 */

/** 06_회비고지에서 판정에 필요한 열만. 고지 자체가 없으면 null. */
export type CardDuesSnapshot = {
  /** 상태 미납/부분납/완납/면제 */
  status: string;
  billedAmount: number;
  paidAmount: number;
  /** 미납금액 = 고지금액 - 납부금액. 음수면 과납(선납) */
  unpaidAmount: number;
} | null;

export type CardInput = {
  /** 01_회원.상태 ACTIVE/INACTIVE/WITHDRAWN/중복확인필요 */
  memberStatus: string;
  /** MemberCard.photoStatus 대기/승인/반려. 아직 한 장도 안 올렸으면 빈 문자열 */
  photoStatus: string;
  /** 당해연도 회비 고지 */
  dues: CardDuesSnapshot;
  /** 유효연도 = 이 회계연도 */
  fiscalYear: number;
};

export type CardBlockerCode =
  | "MEMBER_INACTIVE" // 탈퇴·비활동 회원
  | "NO_PHOTO" // 사진 미제출
  | "PHOTO_PENDING" // 총무 검수 대기
  | "PHOTO_REJECTED" // 반려됨
  | "NO_INVOICE" // 당해연도 회비 고지 자체가 없음
  | "DUES_UNPAID"; // 회비 미납·부분납

export type CardBlocker = {
  code: CardBlockerCode;
  /** 회원 본인 화면에 그대로 보여도 되는 문장 */
  message: string;
  /** 그래서 어떻게 하면 되는가 */
  howToFix: string;
};

export type CardVerdict = {
  /** 회원증을 발급(표시)해도 되는가 */
  valid: boolean;
  /** 막고 있는 것 전부. 하나만 알려 주면 고치고 나서 또 막힌다 */
  blockers: CardBlocker[];
  photoOk: boolean;
  duesOk: boolean;
  memberOk: boolean;
  /** 유효연도 */
  fiscalYear: number;
};

/** 회비 조건 충족인가 — 면제는 "낼 의무가 면제된 것" 이므로 충족으로 본다. */
export function isDuesSatisfied(dues: CardDuesSnapshot): boolean {
  if (!dues) return false;
  // ★ 상태 문자열이 아니라 **금액**을 기준으로 본다.
  //   부분납이 쌓여 완납액을 채웠는데 상태 갱신이 한 박자 늦는 경우가 있고,
  //   그때 "돈은 다 냈는데 회원증이 안 나온다" 는 민원이 총무에게 간다.
  //   면제만 금액과 무관하게 통과시킨다(고지금액이 남아 있어도 낼 의무가 없다).
  if (String(dues.status).trim() === "면제") return true;
  return dues.unpaidAmount <= 0;
}

export function evaluateMemberCard(input: CardInput): CardVerdict {
  const blockers: CardBlocker[] = [];

  const memberOk = String(input.memberStatus).trim().toUpperCase() === "ACTIVE";
  if (!memberOk) {
    blockers.push({
      code: "MEMBER_INACTIVE",
      message: "활동 중인 회원만 회원증을 받으실 수 있습니다.",
      howToFix: "회원 상태 정정이 필요하시면 총무에게 말씀해 주십시오.",
    });
  }

  const photo = String(input.photoStatus).trim();
  const photoOk = photo === "승인";
  if (!photo) {
    blockers.push({
      code: "NO_PHOTO",
      message: "회원증에 넣을 사진이 아직 없습니다.",
      howToFix: "위 “회원증 사진” 칸에서 얼굴이 잘 보이는 사진 한 장을 올려 주십시오.",
    });
  } else if (photo === "대기") {
    blockers.push({
      code: "PHOTO_PENDING",
      message: "올려 주신 사진을 총무가 확인하고 있습니다.",
      howToFix: "확인이 끝나면 이 자리에 회원증이 나타납니다. 따로 하실 일은 없습니다.",
    });
  } else if (photo === "반려") {
    blockers.push({
      code: "PHOTO_REJECTED",
      message: "올려 주신 사진이 반려되었습니다.",
      howToFix: "반려 사유를 보시고 사진을 다시 올려 주십시오.",
    });
  }

  const duesOk = isDuesSatisfied(input.dues);
  if (!input.dues) {
    blockers.push({
      code: "NO_INVOICE",
      message: `${input.fiscalYear}년 회비 고지가 아직 없습니다.`,
      howToFix: "총무에게 올해 회비 고지를 요청해 주십시오.",
    });
  } else if (!duesOk) {
    blockers.push({
      code: "DUES_UNPAID",
      message: `${input.fiscalYear}년 회비가 남아 있습니다(${input.dues.status}).`,
      howToFix: "남은 회비를 납부하시면 회원증이 바로 발급됩니다.",
    });
  }

  return {
    valid: blockers.length === 0,
    blockers,
    photoOk,
    duesOk,
    memberOk,
    fiscalYear: input.fiscalYear,
  };
}

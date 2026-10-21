import {
  formatPeriodDate,
  grantsMembership,
  periodState,
  type MembershipPeriod,
  type PeriodLike,
  type PeriodState,
} from "./membershipPeriod";

/**
 * 디지털 회원증 유효 판정 — 순수 함수. DB 를 모른다. (P3)
 *
 * ── 왜 순수 함수 한 곳인가 ───────────────────────────────────────────────
 *  같은 판정을 **세 화면**이 쓴다:
 *    ① 회원 포털  — 회원증을 보여줄까, "무엇이 부족한지" 를 보여줄까
 *    ② /me/card   — 인쇄용 카드 (+ PNG 저장)
 *    ③ /verify/<토큰> — 제휴 업소가 QR 로 여는 공개 확인 페이지
 *  (+ 임원 사진 검수 화면의 "회원증" 칸)
 *  세 곳이 각자 판정하면 반드시 어긋난다. 포털에서는 유효한데 QR 은 무효로 나오는
 *  순간 회원증은 신뢰를 잃는다. 그래서 규칙은 여기 한 곳에만 둔다.
 *
 * ── 발급 조건 (대표 확정 2026-10-21 — 2026-08-11 결정을 바꿨다) ─────────────
 *  회원 ACTIVE + 총무의 **사진 승인** + **오늘(마닐라 날짜)이 회원 기간 안**.
 *  회원 기간 = 회비 완납일부터 1년(면제는 면제 고지일부터). 기간 중에 다음 회비를 내면
 *  만료일 다음 날부터 이어붙는다. 계산 규칙은 membershipPeriod.ts 한 곳에 있다.
 *  근거: 05_의사결정기록/2026-10-21_회원자격_납부일기준1년.md
 *  (이전: "당해 회계연도 회비 납부 회원만" — 2026-08-11_회원포털_플랜.md §3 P3.
 *   그 방식은 10월에 낸 회원의 회원증이 12월 31일에 끊겼다.)
 *
 * ── ★ 유효/무효를 DB 에 굳히지 않는다 ──────────────────────────────────────
 *  저장하는 것은 **기간 날짜**(DuesInvoice.validFrom/validUntil)뿐이다. "지금 유효한가" 는
 *  볼 때마다 오늘 날짜로 다시 센다. 수납이 무효 처리되면 그 고지의 기간이 지워지고
 *  (book/actions.ts), 탈퇴는 언제든 일어난다 — 발급 시점에 'ISSUED' 를 저장해 두면
 *  그 뒤로 무슨 일이 있어도 회원증은 계속 유효로 보인다.
 *
 * ── 기간의 정본은 06_회비고지(DuesInvoice)다 ──────────────────────────────
 *  05_거래(수납 합계)로 세지 않는다. 면제·고지금액 정정 같은 "돈이 오가지 않은 사실" 은
 *  회비고지에만 있기 때문이다. 그리고 기간은 **완납·면제 고지**에만 붙는다(cardPeriodsFrom).
 */

/** 06_회비고지에서 판정에 필요한 열만. 회원의 고지 전부(연도 무관)를 넘긴다. */
export type CardDuesRow = PeriodLike & {
  /** 상태 미납/부분납/완납/면제 */
  status: string;
  /** 미납금액 = 고지금액 - 납부금액. 음수면 과납(선납) */
  unpaidAmount: number;
};

export type CardInput = {
  /** 01_회원.상태 ACTIVE/INACTIVE/WITHDRAWN/중복확인필요 */
  memberStatus: string;
  /** MemberCard.photoStatus 대기/승인/반려. 아직 한 장도 안 올렸으면 빈 문자열 */
  photoStatus: string;
  /** 회원 기간 목록 — cardPeriodsFrom(고지들) 로 만든다 */
  periods: readonly PeriodLike[];
  /** Asia/Manila 오늘 'yyyy-MM-dd' (todayManila()) */
  today: string;
};

export type CardBlockerCode =
  | "MEMBER_INACTIVE" // 탈퇴·비활동 회원
  | "NO_PHOTO" // 사진 미제출
  | "PHOTO_PENDING" // 총무 검수 대기
  | "PHOTO_REJECTED" // 반려됨
  | "NO_PERIOD" // 회원 기간이 한 번도 없음 — 회비 미납·부분납·고지 없음
  | "PERIOD_EXPIRED" // 회원 기간이 끝남
  | "PERIOD_NOT_STARTED"; // 회원 기간이 아직 시작 전

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
  /** 오늘이 회원 기간 안인가 */
  duesOk: boolean;
  memberOk: boolean;
  /**
   * 오늘 유효한 회원 기간 — 이어붙인 다음 기간이 있으면 그 끝까지 합친 것.
   * 기간 밖이면 null. ★ 회원증·PNG·/verify 에는 valid 일 때만 표시한다.
   */
  period: MembershipPeriod | null;
  /** 오늘 기준 기간 상태(만료일·시작일). 임원 화면·안내문용 */
  periodState: PeriodState;
};

/**
 * 고지 목록 → 회원 기간 목록. **완납·면제이고 금액상으로도 낼 것이 없는** 고지의 기간만.
 * 기간은 완납·면제가 되는 순간에만 쓰이고 미납으로 돌아가면 지워지므로 보통은 같은 결과지만,
 * 어긋난 행(기간은 있는데 미납)이 있으면 회원증을 내주지 않는 쪽으로 넘어진다.
 */
export function cardPeriodsFrom(rows: readonly CardDuesRow[]): PeriodLike[] {
  return rows.filter((r) => isDuesSatisfied(r) && r.validFrom && r.validUntil);
}

/** 회비 조건 충족인가 — 면제는 "낼 의무가 면제된 것" 이므로 충족으로 본다. */
export function isDuesSatisfied(dues: { status: string; unpaidAmount: number } | null): boolean {
  if (!dues) return false;
  if (String(dues.status).trim() === "면제") return true;
  return grantsMembership(dues.status) && dues.unpaidAmount <= 0;
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

  const state = periodState(input.periods, input.today);
  const duesOk = state.kind === "active";
  if (state.kind === "none") {
    blockers.push({
      code: "NO_PERIOD",
      message: "회원증은 회비 납부 후 발급됩니다.",
      howToFix:
        "회비를 납부하시면 납부일부터 1년간 유효한 회원증이 바로 나옵니다. 이미 내셨는데 이 문구가 보이면 총무에게 말씀해 주십시오.",
    });
  } else if (state.kind === "expired") {
    blockers.push({
      code: "PERIOD_EXPIRED",
      message: `회원 기간이 ${formatPeriodDate(state.endedOn)} 에 끝났습니다.`,
      howToFix: "회비를 납부하시면 바로 갱신됩니다(납부일부터 1년).",
    });
  } else if (state.kind === "upcoming") {
    blockers.push({
      code: "PERIOD_NOT_STARTED",
      message: `회원 기간이 ${formatPeriodDate(state.startsOn)} 부터 시작됩니다.`,
      howToFix: "그날부터 회원증이 자동으로 나옵니다. 따로 하실 일은 없습니다.",
    });
  }

  return {
    valid: blockers.length === 0,
    blockers,
    photoOk,
    duesOk,
    memberOk,
    period: state.kind === "active" ? state.period : null,
    periodState: state,
  };
}

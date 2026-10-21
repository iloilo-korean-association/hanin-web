/**
 * 회원 자격 기간 — 회비 완납일부터 1년. 순수 함수. DB 를 모른다.
 *
 * ── 결정 (대표 확정 2026-10-21) ─────────────────────────────────────────
 *  근거: 05_의사결정기록/2026-10-21_회원자격_납부일기준1년.md
 *  ① 기간 = 회비고지가 **완납된 날**(분납이면 누적 납부가 고지금액에 처음 닿은 수납일) S 부터
 *     만료 = S + 1년 - 1일.  예) 2026-10-21 → 2027-10-20
 *  ② 이어붙이기: 완납 시점에 아직 유효한 기간이 있으면 새 기간은 그 만료일 **다음 날**부터.
 *     이미 끝났으면 완납일부터.
 *  ③ 면제(고지금액 0): 면제 고지가 만들어진 날(billedOn)부터 1년. 이어붙이기 규칙은 같다.
 *
 * ── 바뀌지 않는 것 ──────────────────────────────────────────────────────
 *  회계 처리(회비규정 제3조 — 입금일이 속한 회계연도의 수입)와 회비고지가 회계연도별
 *  1건인 구조는 그대로다. 바뀐 것은 "회원 자격이 언제부터 언제까지인가" 하나뿐이다.
 *
 * ── 어디에 쓰나 ─────────────────────────────────────────────────────────
 *  기간을 **정하는** 곳: 장부 수납(book) · 가입(join, 면제) · 회비고지 일괄 생성(dues) ·
 *    납부자 연결 소급(ledger-import/link) · 백필(prisma/backfill-membership-period.ts).
 *    전부 아래 nextPeriod 하나로 계산한다 — 경로마다 규칙이 갈라지면 같은 회원이
 *    어느 화면에서 납부했느냐에 따라 기간이 달라진다.
 *  기간을 **읽는** 곳: 회원증 판정(memberCard.ts) — activePeriod.
 *
 * 날짜는 전부 'yyyy-MM-dd' 문자열(스키마 규약 3번 — Asia/Manila 의 "그 날").
 */
import { addDays, isDateStr } from "./money";

/** 저장된 기간 한 건. DuesInvoice.validFrom / validUntil (둘 다 포함) */
export type MembershipPeriod = { validFrom: string; validUntil: string };

/** DB 에서 읽은 그대로의 모양 — 기간이 없는 고지는 둘 다 null 이다. */
export type PeriodLike = { validFrom: string | null; validUntil: string | null };

/** 이 상태의 고지는 회원 기간을 갖는다. 미납·부분납은 갖지 않는다. */
export function grantsMembership(status: string): boolean {
  const s = String(status).trim();
  return s === "완납" || s === "면제";
}

function assertDate(date: string, what: string): void {
  if (!isDateStr(date)) throw new Error(`${what} 날짜 형식이 올바르지 않습니다: "${date}" (yyyy-MM-dd)`);
  // 2026-02-30 같은 "형식만 맞는" 날짜를 거른다 — Date.UTC 는 조용히 3월로 넘겨 버린다.
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    throw new Error(`${what} 날짜가 달력에 없습니다: "${date}"`);
  }
}

/**
 * 시작일 → 만료일 (시작일부터 1년, 양 끝 포함).
 *
 * 규칙: "다음 해 같은 월·일" 의 **하루 전**.
 *   2026-10-21 → 2027-10-20
 *   2027-03-01 → 2028-02-29   (윤년 2/29 가 기간 안에 들어가므로 366일)
 *   2028-02-29 → 2029-02-28   (다음 해에 2/29 가 없다 → 기념일을 3/1 로 보고 하루 전)
 *   2027-12-31 → 2028-12-30
 * 즉 만료 다음 날이 언제나 "1년 뒤 기념일" 이고, 갱신(이어붙이기) 시작일이 된다.
 */
export function addOneYearMinusOneDay(date: string): string {
  assertDate(date, "회원 기간 시작");
  const [y, m, d] = date.split("-").map(Number);
  // Date.UTC(2029, 1, 29) 는 2029-03-01 로 넘어간다 — 2/29 시작의 기념일 규칙이 그대로 이것이다.
  const anniversary = Date.UTC(y + 1, m - 1, d);
  return new Date(anniversary - 86_400_000).toISOString().slice(0, 10);
}

function validPeriods(periods: readonly PeriodLike[]): MembershipPeriod[] {
  const out: MembershipPeriod[] = [];
  for (const p of periods) {
    if (!p.validFrom || !p.validUntil) continue;
    if (!isDateStr(p.validFrom) || !isDateStr(p.validUntil)) continue;
    if (p.validUntil < p.validFrom) continue; // 깨진 행은 판정에 끼우지 않는다
    out.push({ validFrom: p.validFrom, validUntil: p.validUntil });
  }
  return out;
}

/**
 * 새로 완납·면제된 고지의 기간.
 *
 *   start = completedOn
 *   기존 기간 중 start 를 포함하는 것이 있으면 start = 그 만료일 + 1 — 다시 포함하는 것이
 *   있으면 또 넘어간다(이미 이어붙어 있는 사슬의 끝까지).
 *   validFrom = start, validUntil = addOneYearMinusOneDay(start)
 *
 * ★ "가장 늦은 만료일 뒤" 가 아니라 "완납일을 덮는 사슬의 끝 뒤" 다.
 *   과거 연도 고지를 나중에 소급 기록할 때(장부 임포트 납부자 연결), 2024년에 낸 회비가
 *   2027년 기간 뒤에 붙어 2028년까지 유효해지는 일을 막는다.
 * ★ 알려진 한계: 날짜를 거슬러 적은 수납(backdate)으로 앞선 연도 고지가 **나중에** 완납되면
 *   새 기간이 이미 있는 뒤 기간과 겹칠 수 있다(회원에게 불리한 쪽 — 겹친 만큼 짧아진다).
 *   기존 기간은 절대 고쳐 쓰지 않는다는 원칙을 지키는 대가다. 백필은 완납일 순서로 돌려 이 경우가 없다.
 */
export function nextPeriod(input: {
  completedOn: string;
  existingPeriods: readonly PeriodLike[];
}): MembershipPeriod {
  assertDate(input.completedOn, "완납");
  const periods = validPeriods(input.existingPeriods);
  let start = input.completedOn;
  // 매 회 start 가 엄격히 앞으로 가므로 기간 개수 + 1 번 안에 끝난다(무한 반복 방지 상한).
  for (let i = 0; i <= periods.length; i++) {
    let jumpTo: string | null = null;
    for (const p of periods) {
      if (p.validFrom <= start && start <= p.validUntil) {
        const next = addDays(p.validUntil, 1);
        if (jumpTo === null || next > jumpTo) jumpTo = next;
      }
    }
    if (jumpTo === null) break;
    start = jumpTo;
  }
  return { validFrom: start, validUntil: addOneYearMinusOneDay(start) };
}

/**
 * 오늘이 들어 있는 기간. 없으면 null.
 *
 * ★ 이어붙인 다음 기간이 있으면 **그 끝까지 합쳐서** 돌려준다.
 *   예) 2026-10-15~2027-10-14 중에 다음 해 회비를 미리 내 2027-10-15~2028-10-14 가 붙었으면
 *       → 2026-10-15 ~ 2028-10-14. 회원증은 그 날까지 끊김 없이 유효하기 때문이다.
 *   앞쪽(이미 지나간 기간)은 합치지 않는다 — 시작일은 "지금 기간" 의 시작이다.
 */
export function activePeriod(periods: readonly PeriodLike[], today: string): MembershipPeriod | null {
  const ps = validPeriods(periods);
  const containing = ps.filter((p) => p.validFrom <= today && today <= p.validUntil);
  if (containing.length === 0) return null;
  let validFrom = containing[0].validFrom;
  let validUntil = containing[0].validUntil;
  for (const p of containing) {
    if (p.validFrom < validFrom) validFrom = p.validFrom;
    if (p.validUntil > validUntil) validUntil = p.validUntil;
  }
  for (let i = 0; i <= ps.length; i++) {
    const nextDay = addDays(validUntil, 1);
    let extended = false;
    for (const p of ps) {
      if (p.validFrom <= nextDay && p.validUntil > validUntil) {
        validUntil = p.validUntil;
        extended = true;
      }
    }
    if (!extended) break;
  }
  return { validFrom, validUntil };
}

/** 회원증 판정·임원 화면이 쓰는 "오늘 기준 기간 상태". */
export type PeriodState =
  | { kind: "active"; period: MembershipPeriod }
  /** 기간은 있지만 아직 시작 전 — 이어붙이기로 생긴 다음 기간만 남은 경우 등 */
  | { kind: "upcoming"; startsOn: string }
  /** 전부 끝났다. 가장 늦은 만료일 */
  | { kind: "expired"; endedOn: string }
  /** 기간이 한 번도 없었다(회비 미납·부분납·고지 없음) */
  | { kind: "none" };

export function periodState(periods: readonly PeriodLike[], today: string): PeriodState {
  const active = activePeriod(periods, today);
  if (active) return { kind: "active", period: active };
  const ps = validPeriods(periods);
  const upcoming = ps.filter((p) => p.validFrom > today).map((p) => p.validFrom).sort();
  if (upcoming.length > 0) return { kind: "upcoming", startsOn: upcoming[0] };
  const ended = ps.filter((p) => p.validUntil < today).map((p) => p.validUntil).sort();
  if (ended.length > 0) return { kind: "expired", endedOn: ended[ended.length - 1] };
  return { kind: "none" };
}

/* ════════════════════════════════════════════════════════════════════════
 * 완납일 — "분납이면 완납에 도달한 수납일"
 * ════════════════════════════════════════════════════════════════════════ */

export type DuesReceiptLike = { date: string; seq?: number; amountPhp: number };

/**
 * 수납을 날짜(같은 날이면 일련번호) 순으로 쌓아 **누적이 target 에 처음 닿은 날**.
 * 닿지 못하면 null. target 이 0 이하이면 null(면제는 호출자가 billedOn 을 쓴다).
 *
 *   600(03-01) + 600(05-01) , target 1200 → 05-01
 *   2000(10-15)             , target 1200 → 10-15   (과납이어도 처음 닿은 날)
 *   1200(02-10) + 800(03-10), target 1200 → 02-10   (뒤의 과납 수납은 완납일을 바꾸지 않는다)
 */
export function paidUpOn(receipts: readonly DuesReceiptLike[], target: number): string | null {
  if (!(target > 0)) return null;
  const sorted = [...receipts].sort((a, b) =>
    a.date === b.date ? (a.seq ?? 0) - (b.seq ?? 0) : a.date < b.date ? -1 : 1,
  );
  let sum = 0;
  for (const r of sorted) {
    sum += r.amountPhp;
    if (sum >= target) return r.date;
  }
  return null;
}

export type CompletionSource = "면제(고지일)" | "장부 누적" | "최종수납일" | "고지일";

/**
 * 완납·면제 고지의 기산일. 장부 수납으로 정확히 셀 수 있으면 그 날, 아니면 차선값.
 *   면제            → billedOn (면제 고지가 만들어진 날)
 *   완납 · 장부 누적 → paidUpOn(장부 회비 수납, billedAmount)
 *   완납 · 그 밖     → lastPaidOn ?? billedOn  (장부에 없는 납부 — 임포트 이전 기록 등)
 * 미납·부분납이면 null.
 */
export function completionDateOf(inv: {
  status: string;
  billedAmount: number;
  billedOn: string;
  lastPaidOn: string | null;
  receipts: readonly DuesReceiptLike[];
}): { date: string; source: CompletionSource } | null {
  const status = String(inv.status).trim();
  if (status === "면제") return { date: inv.billedOn, source: "면제(고지일)" };
  if (status !== "완납") return null;
  const fromLedger = paidUpOn(inv.receipts, inv.billedAmount);
  if (fromLedger) return { date: fromLedger, source: "장부 누적" };
  if (inv.lastPaidOn && isDateStr(inv.lastPaidOn)) return { date: inv.lastPaidOn, source: "최종수납일" };
  return { date: inv.billedOn, source: "고지일" };
}

/* ════════════════════════════════════════════════════════════════════════
 * 백필 계획 — 완납·면제인데 기간이 없는 고지 (prisma/backfill-membership-period.ts)
 * ════════════════════════════════════════════════════════════════════════ */

export type BackfillInvoice = {
  invoiceId: string;
  memberNo: string;
  fiscalYear: number;
  status: string;
  billedAmount: number;
  billedOn: string;
  lastPaidOn: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** 그 회원·그 회계연도의 확정(POSTED) 회비 수납 */
  receipts: readonly DuesReceiptLike[];
};

export type BackfillItem = {
  invoiceId: string;
  memberNo: string;
  fiscalYear: number;
  status: string;
  completedOn: string;
  source: CompletionSource;
  period: MembershipPeriod;
  /** 다른 고지의 기간에 이어붙었는가(validFrom ≠ completedOn) */
  chained: boolean;
};

/**
 * 회원별로 **완납일 순서대로** nextPeriod 를 적용한다 — 실제로 그 순서로 완납됐다면 붙었을
 * 기간을 그대로 재현한다. 이미 기간이 있는 고지는 건드리지 않고 이어붙이기의 기준으로만 쓴다.
 */
export function planPeriodBackfill(invoices: readonly BackfillInvoice[]): BackfillItem[] {
  const byMember = new Map<string, BackfillInvoice[]>();
  for (const inv of invoices) {
    const arr = byMember.get(inv.memberNo);
    if (arr) arr.push(inv);
    else byMember.set(inv.memberNo, [inv]);
  }

  const out: BackfillItem[] = [];
  for (const memberNo of [...byMember.keys()].sort()) {
    const rows = byMember.get(memberNo)!;
    const known: PeriodLike[] = rows.filter((r) => r.validFrom && r.validUntil);
    const todo = rows
      .filter((r) => !r.validFrom && grantsMembership(r.status))
      .map((r) => ({ r, c: completionDateOf(r) }))
      .filter((x): x is { r: BackfillInvoice; c: { date: string; source: CompletionSource } } => x.c !== null)
      .sort((a, b) =>
        a.c.date === b.c.date ? a.r.fiscalYear - b.r.fiscalYear : a.c.date < b.c.date ? -1 : 1,
      );
    for (const { r, c } of todo) {
      const period = nextPeriod({ completedOn: c.date, existingPeriods: known });
      known.push(period);
      out.push({
        invoiceId: r.invoiceId,
        memberNo,
        fiscalYear: r.fiscalYear,
        status: r.status,
        completedOn: c.date,
        source: c.source,
        period,
        chained: period.validFrom !== c.date,
      });
    }
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * 표시
 * ════════════════════════════════════════════════════════════════════════ */

/** '2026-10-15' → '2026.10.15' (회원증·확인 페이지 표기) */
export function formatPeriodDate(date: string): string {
  return String(date).replaceAll("-", ".");
}

/** → '2026.10.15 ~ 2027.10.14' */
export function formatPeriod(p: MembershipPeriod): string {
  return `${formatPeriodDate(p.validFrom)} ~ ${formatPeriodDate(p.validUntil)}`;
}

import type { Db } from "../db";
import type { DuesStatus } from "../validators/enums";
import { completionDateOf, nextPeriod, type PeriodLike } from "./membershipPeriod";
import { addDays } from "./money";

/**
 * 06_회비고지 — 연 1회 일괄 고지 계획 + 고지ID 채번.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * 고지는 지금까지 웹 가입(join) 때만 만들어졌다. 기존 회원에게 해마다 고지를 만들
 * 경로가 없어서, 회비를 냈는데도 "올해 회비 고지가 아직 없습니다" 로 회원증이 막혔다.
 * (회원증 판정의 정본은 06_회비고지다 — memberCard.ts 머리말 참조)
 *
 * ── 이 파일이 정하는 것 (전부 순수 함수. DB 를 모른다) ───────────────────
 *   planDuesInvoices — 누구에게 · 얼마를 · 어떤 상태로 고지할지
 *   resolveDueOn     — 납기일 규칙 (join/actions.ts 와 같은 규칙)
 *   duesStatusFor    — 미납/부분납/완납/면제 판정
 *   maxInvoiceSeq · formatInvoiceId — DU-2026-0001 채번 규칙
 *
 * 예외 하나: nextInvoiceId 는 DB 를 읽는다(nextReceiptNo 와 같은 자리).
 *   가입(join) · 납부자 연결(ledger-import/link) · 일괄 고지(officer/dues) 세 곳이
 *   같은 규칙을 쓰게 하려고 여기 한 곳에 둔다.
 */

/* ════════════════════════════════════════════════════════════════════════
 * 고지ID 채번 — DU-2026-0001
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 그 해 고지ID 들 중 가장 큰 일련번호. 없으면 0.
 * 마지막 '-' 뒤를 숫자로 읽는다 — 숫자가 아니면 건너뛴다.
 * (join/actions.ts · ledger-import/link/actions.ts 에 있던 규칙을 그대로 옮겼다)
 */
export function maxInvoiceSeq(invoiceIds: readonly string[]): number {
  let max = 0;
  for (const id of invoiceIds) {
    const n = Number(id.split("-").pop() ?? "");
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** 2026 + 7 → 'DU-2026-0007' */
export function formatInvoiceId(fiscalYear: number, seq: number): string {
  return `DU-${fiscalYear}-${String(seq).padStart(4, "0")}`;
}

/**
 * 다음 고지ID. **반드시 $transaction 안에서** 부르고, 같은 트랜잭션에서 create 한다.
 * 고지ID 에는 결번 금지 불변식이 없다 — 그래서 카운터 테이블 없이 "그 해 최대값 + 1" 이다.
 */
export async function nextInvoiceId(db: Db, fiscalYear: number): Promise<string> {
  const rows = await db.duesInvoice.findMany({
    where: { fiscalYear },
    select: { invoiceId: true },
  });
  return formatInvoiceId(fiscalYear, maxInvoiceSeq(rows.map((r) => r.invoiceId)) + 1);
}

/* ════════════════════════════════════════════════════════════════════════
 * 판정 규칙
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 납기일 — 설정 '회비.납기일' 이 오늘보다 뒤면 그 날, 아니면 오늘 + 30일.
 * join/actions.ts 의 가입 고지와 **같은 규칙**이다. 이미 지난 납기일을 찍으면
 * 고지하는 그 자리에서 '미납 연체' 가 되기 때문이다.
 */
export function resolveDueOn(configuredDue: string, today: string): string {
  return configuredDue > today ? configuredDue : addDays(today, 30);
}

/**
 * 06_회비고지.상태. 면제가 먼저다 — 낼 의무가 없으면 얼마를 냈든 면제다.
 * 장부 수납(book/actions.ts)·무효(voidEntryAction)와 같은 규칙.
 */
export function duesStatusFor(billedAmount: number, paidAmount: number): DuesStatus {
  if (billedAmount === 0) return "면제";
  if (billedAmount - paidAmount <= 0) return "완납";
  return paidAmount > 0 ? "부분납" : "미납";
}

/**
 * M9xxx = 시스템 계정 대역(M9999 관리자 등 — 실제 사람이 아니다).
 * 회원번호 발번(join)·장부 상대방 목록(book/page.tsx)과 같은 기준이다.
 */
export function isSystemMemberNo(memberNo: string): boolean {
  return /^M9\d{3}$/.test(memberNo);
}

/* ════════════════════════════════════════════════════════════════════════
 * 일괄 고지 계획
 * ════════════════════════════════════════════════════════════════════════ */

export type DuesMemberRow = {
  memberNo: string;
  name: string;
  /** 회비등급 — Setting '회비단가.*' 키와 정확히 같아야 한다 */
  duesGrade: string;
  /** ACTIVE/INACTIVE/WITHDRAWN/중복확인필요 */
  status: string;
};

/** 05_거래 한 줄. 아래 조건을 전부 만족하는 것만 '이미 낸 회비' 로 센다. */
export type DuesReceiptRow = {
  receiptNo: string;
  date: string;
  seq: number;
  fiscalYear: number;
  status: string;
  direction: string;
  categoryCode: string;
  counterpartyMemberNo: string | null;
  amountPhp: number;
};

export type DuesPlanInput = {
  fiscalYear: number;
  /** Asia/Manila 오늘 'yyyy-MM-dd' = 고지일 */
  today: string;
  /** Setting '회비.납기일' */
  configuredDue: string;
  /** duesTableFrom(settings) */
  duesTable: Readonly<Record<string, number>>;
  /** Setting '기본.과목코드.회비' */
  duesCategory: string;
  members: readonly DuesMemberRow[];
  /** 그 회계연도에 이미 고지가 있는 회원번호 */
  invoicedMemberNos: Iterable<string>;
  receipts: readonly DuesReceiptRow[];
  /**
   * 이미 기간이 있는 고지(연도 무관) — 완납·면제로 만들어지는 고지의 이어붙이기 기준.
   * 비워 두면 이어붙이기 없이 완납일부터 1년이다.
   */
  existingPeriods?: readonly (PeriodLike & { memberNo: string })[];
};

export type PlannedInvoice = {
  memberNo: string;
  memberName: string;
  duesGrade: string;
  billedAmount: number;
  billedOn: string;
  dueOn: string;
  paidAmount: number;
  /** 고지 - 납부. 음수 = 과납. 0 으로 깎지 않는다 */
  unpaidAmount: number;
  status: DuesStatus;
  exemptReason: string;
  lastReceiptNo: string | null;
  lastPaidOn: string | null;
  /** 반영한 수납 건수 */
  receiptCount: number;
  note: string;
  /**
   * 회원 기간 (대표 결정 2026-10-21) — 완납·면제로 만들어질 때만. 미납·부분납이면 null.
   * 완납 = 고지 전 수납을 날짜순으로 쌓아 고지금액에 처음 닿은 날, 면제 = 고지일. 이어붙이기 포함.
   */
  validFrom: string | null;
  validUntil: string | null;
};

export type DuesSkip = { memberNo: string; name: string; duesGrade: string; reason: string };

export type DuesPlan = {
  fiscalYear: number;
  billedOn: string;
  dueOn: string;
  toCreate: PlannedInvoice[];
  /** 이미 그 해 고지가 있는 활동 회원 수 (건드리지 않는다) */
  alreadyInvoiced: number;
  /** 단가표에 없거나 단가가 잘못된 등급 — 만들지 않고 이름과 함께 보고한다 */
  skippedNoRate: DuesSkip[];
  /** M9xxx 시스템 계정 — 사람이 아니므로 고지하지 않는다 */
  skippedSystem: number;
  byGrade: { duesGrade: string; unitAmount: number; count: number; billedTotal: number }[];
  totals: { count: number; billed: number; paid: number; unpaid: number };
  /** 미리보기와 실제 생성이 같은 계산인지 대조하는 값 */
  fingerprint: string;
};

export const DUES_BATCH_NOTE = "회비고지 일괄 생성";

/**
 * 누구에게 · 얼마를 · 어떤 상태로 고지할지 계산한다. 아무것도 쓰지 않는다.
 *
 * 규칙
 *  ① 대상 = status ACTIVE 이고 그 해 고지가 **없는** 회원. 기존 고지는 절대 덮어쓰지 않는다.
 *  ② 고지금액 = 회비단가표[회비등급]. 0 이면 면제("회비 단가 0원 등급").
 *     ★ 단가표에 없는 등급은 **만들지 않고 보고한다.** 조용히 0원 면제로 만들면
 *       낼 사람이 면제 회원으로 둔갑하고, 아무도 그 사실을 모른다.
 *  ③ 고지 없이 먼저 받은 회비가 장부에 있으면 그 금액을 납부금액으로 반영한다.
 *     (같은 회계연도 · POSTED · IN · 회비 과목 · 상대방회원번호 = 그 회원)
 *     반영하지 않으면 이미 낸 회원이 '미납' 으로 고지되고 독촉 대상이 된다.
 *  ④ 그 결과 완납·면제로 만들어지는 고지에는 회원 기간을 함께 정한다(membershipPeriod.ts).
 *     완납일 = 고지 전 수납이 고지금액에 처음 닿은 날, 면제 = 고지일. 기존 기간이 있으면 이어붙인다.
 */
export function planDuesInvoices(input: DuesPlanInput): DuesPlan {
  const billedOn = input.today;
  const dueOn = resolveDueOn(input.configuredDue, input.today);
  const invoiced = new Set(input.invoicedMemberNos);

  // ③ 회원별 기존 수납 — 조건을 여기서도 다시 건다(쿼리 조건이 바뀌어도 규칙은 여기 그대로 남는다).
  const paidBy = new Map<
    string,
    { sum: number; count: number; last: DuesReceiptRow; list: DuesReceiptRow[] }
  >();
  for (const r of input.receipts) {
    if (r.fiscalYear !== input.fiscalYear) continue;
    if (r.status !== "POSTED" || r.direction !== "IN") continue;
    if (r.categoryCode !== input.duesCategory) continue;
    if (!r.counterpartyMemberNo) continue;
    const cur = paidBy.get(r.counterpartyMemberNo);
    if (!cur) {
      paidBy.set(r.counterpartyMemberNo, { sum: r.amountPhp, count: 1, last: r, list: [r] });
      continue;
    }
    cur.sum += r.amountPhp;
    cur.count += 1;
    cur.list.push(r);
    if (r.date > cur.last.date || (r.date === cur.last.date && r.seq > cur.last.seq)) cur.last = r;
  }

  // ④ 회원별 기존 회원 기간 — 완납·면제 고지의 이어붙이기 기준
  const periodsBy = new Map<string, PeriodLike[]>();
  for (const p of input.existingPeriods ?? []) {
    const arr = periodsBy.get(p.memberNo);
    if (arr) arr.push(p);
    else periodsBy.set(p.memberNo, [p]);
  }

  const toCreate: PlannedInvoice[] = [];
  const skippedNoRate: DuesSkip[] = [];
  let alreadyInvoiced = 0;
  let skippedSystem = 0;

  for (const m of input.members) {
    if (String(m.status).trim().toUpperCase() !== "ACTIVE") continue;
    if (isSystemMemberNo(m.memberNo)) {
      skippedSystem += 1;
      continue;
    }
    if (invoiced.has(m.memberNo)) {
      alreadyInvoiced += 1;
      continue;
    }

    // hasOwn — '회비단가표["constructor"]' 같은 상속 속성을 단가로 잡지 않기 위해서다.
    const rate = Object.prototype.hasOwnProperty.call(input.duesTable, m.duesGrade)
      ? input.duesTable[m.duesGrade]
      : undefined;
    if (rate === undefined) {
      skippedNoRate.push({
        memberNo: m.memberNo,
        name: m.name,
        duesGrade: m.duesGrade,
        reason: `설정에 '회비단가.${m.duesGrade}' 가 없습니다`,
      });
      continue;
    }
    if (!Number.isInteger(rate) || rate < 0) {
      skippedNoRate.push({
        memberNo: m.memberNo,
        name: m.name,
        duesGrade: m.duesGrade,
        reason: `'회비단가.${m.duesGrade}' 값(${rate})이 0 이상의 정수가 아닙니다`,
      });
      continue;
    }

    const paid = paidBy.get(m.memberNo);
    const paidAmount = paid?.sum ?? 0;
    const status = duesStatusFor(rate, paidAmount);
    const lastPaidOn = paid?.last.date ?? null;
    // ⑤ 회원 기간 — 고지하는 그 자리에서 완납(고지 전 수납이 고지금액에 닿음)이거나 면제면 정한다.
    const completion = completionDateOf({
      status,
      billedAmount: rate,
      billedOn,
      lastPaidOn,
      receipts: paid?.list ?? [],
    });
    const period = completion
      ? nextPeriod({ completedOn: completion.date, existingPeriods: periodsBy.get(m.memberNo) ?? [] })
      : null;
    toCreate.push({
      memberNo: m.memberNo,
      memberName: m.name,
      duesGrade: m.duesGrade,
      billedAmount: rate,
      billedOn,
      dueOn,
      paidAmount,
      unpaidAmount: rate - paidAmount,
      status,
      exemptReason: rate === 0 ? "회비 단가 0원 등급" : "",
      lastReceiptNo: paid?.last.receiptNo ?? null,
      lastPaidOn,
      receiptCount: paid?.count ?? 0,
      note: paid ? `${DUES_BATCH_NOTE} · 기존 수납 ${paid.count}건 반영` : DUES_BATCH_NOTE,
      validFrom: period?.validFrom ?? null,
      validUntil: period?.validUntil ?? null,
    });
  }

  const gradeMap = new Map<string, { duesGrade: string; unitAmount: number; count: number; billedTotal: number }>();
  for (const p of toCreate) {
    const g = gradeMap.get(p.duesGrade) ?? {
      duesGrade: p.duesGrade,
      unitAmount: p.billedAmount,
      count: 0,
      billedTotal: 0,
    };
    g.count += 1;
    g.billedTotal += p.billedAmount;
    gradeMap.set(p.duesGrade, g);
  }

  const totals = {
    count: toCreate.length,
    billed: toCreate.reduce((s, p) => s + p.billedAmount, 0),
    paid: toCreate.reduce((s, p) => s + p.paidAmount, 0),
    unpaid: toCreate.reduce((s, p) => s + p.unpaidAmount, 0),
  };

  return {
    fiscalYear: input.fiscalYear,
    billedOn,
    dueOn,
    toCreate,
    alreadyInvoiced,
    skippedNoRate,
    skippedSystem,
    byGrade: [...gradeMap.values()],
    totals,
    fingerprint: planFingerprint(input.fiscalYear, billedOn, dueOn, toCreate),
  };
}

/**
 * 미리보기에서 본 것과 버튼을 누른 순간의 계산이 같은가 — 그 대조용 지문.
 * 미리보기 뒤에 단가·회원·수납이 바뀌었으면 지문이 달라지고, 액션은 만들지 않고 새로고침을 요청한다.
 * (보안용 해시가 아니다. 같은 입력 → 같은 값이면 충분하다. FNV-1a 32bit)
 */
function planFingerprint(
  fiscalYear: number,
  billedOn: string,
  dueOn: string,
  toCreate: readonly PlannedInvoice[],
): string {
  const text = [
    `${fiscalYear}|${billedOn}|${dueOn}`,
    ...toCreate.map(
      (p) =>
        `${p.memberNo}|${p.duesGrade}|${p.billedAmount}|${p.paidAmount}|${p.status}|${p.lastReceiptNo ?? ""}|${p.validFrom ?? ""}`,
    ),
  ].join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${toCreate.length}-${h.toString(16).padStart(8, "0")}`;
}

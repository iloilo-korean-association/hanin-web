import type { Db, Tx } from "../db";
import { toInt, toPeso, formatMoney, fiscalYearOf } from "./money";
import type { TxStatus } from "../validators/enums";

/**
 * 회계 불변식 — 이 시스템의 존재 이유.
 *
 * I1 거래는 삭제되지 않는다 — VOIDED 처리 + 역분개만. DELETE 라우트를 만들지 마라.
 * I2 영수증번호에 결번이 없다 — 회계연도별 gapless 시퀀스. 트랜잭션 안에서 채번.
 * I3 증빙 없이 POSTED 불가 — 증빙 없으면 DRAFT.
 * I4 현금 임계 초과는 2인 확인 — 확인자 ≠ 입력자. 서버에서 강제.
 * I5 마감된 회계연도는 불변.
 * I6 개시잔액 = 전기 마감잔액.
 *
 * 원본: 02_노코드MVP/AppsScript/00_공통_유틸.gs 의 evaluateTxState_ · nextReceiptNo_ · isFyClosed_
 */

export const INVARIANT_LABELS = {
  I1: "거래 삭제 금지 (VOIDED + 역분개만)",
  I2: "영수증번호 결번 없음",
  I3: "증빙 없이 POSTED 불가",
  I4: "현금 고액은 2인 확인",
  I5: "마감 회계연도 불변",
  I6: "개시잔액 = 전기 마감잔액",
} as const;

/* ════════════════════════════════════════════════════════════════════════
 * I3 + I4 — 거래 한 건이 POSTED 가 될 수 있는가
 * ════════════════════════════════════════════════════════════════════════ */

export type TxStateInput = {
  /** 증빙URL. 비면 무조건 DRAFT (I3) */
  evidenceUrl?: string | null;
  /** 수단 CASH/GCASH/… */
  method?: string | null;
  /** 원화폐 금액 */
  amount?: unknown;
  currency?: string | null;
  /** 거래시점 환율 스냅샷. 없으면 통화 기본 환율 */
  fxRate?: number | null;
  /** 입력자 이메일 */
  enteredBy?: string | null;
  /** 확인자 이메일 */
  verifiedBy?: string | null;
};

export type TxStateResult = {
  status: Extract<TxStatus, "POSTED" | "DRAFT">;
  /** DRAFT 로 떨어진 이유. POSTED 면 빈 문자열 */
  reason: string;
  /** 어느 불변식이 막았는가 */
  invariant: "I3" | "I4" | null;
};

/**
 * I3 + I4 판정. 원본 evaluateTxState_ 를 그대로 옮겼다.
 *
 * @param cashThreshold Setting '현금2인확인_임계액' (기본 3000)
 */
export function evaluateTxState(tx: TxStateInput, cashThreshold = 3000): TxStateResult {
  const evidence = String(tx.evidenceUrl ?? "").trim();
  if (!evidence) {
    return { status: "DRAFT", reason: "I3: 증빙URL 이 없어 POSTED 불가", invariant: "I3" };
  }

  // .trim() 필수. ' CASH ' 처럼 공백이 섞여 들어오는 경로가 실재한다.
  // 공백 하나로 이 블록을 건너뛰면 고액 현금이 2인 확인 없이 POSTED 된다 = I4 붕괴.
  const method = String(tx.method ?? "").trim().toUpperCase();
  if (method === "CASH") {
    const peso = toPeso(tx.amount, tx.currency ?? "PHP", tx.fxRate ?? null);
    if (peso > cashThreshold) {
      const enteredBy = String(tx.enteredBy ?? "").trim().toLowerCase();
      const verifiedBy = String(tx.verifiedBy ?? "").trim().toLowerCase();
      if (!verifiedBy) {
        return {
          status: "DRAFT",
          invariant: "I4",
          reason: `I4: 현금 ${formatMoney(peso)}페소(임계 ${formatMoney(cashThreshold)} 초과) — 확인자 미기재`,
        };
      }
      // 입력자를 모르면 "확인자 ≠ 입력자" 를 증명할 수 없다.
      // 빈 값을 통과시키면 한 사람이 자기 이름만 확인자에 적어도 통과해버린다.
      if (!enteredBy || enteredBy === "unknown") {
        return {
          status: "DRAFT",
          invariant: "I4",
          reason: "I4: 현금 고액인데 입력자를 알 수 없어 2인 확인을 검증할 수 없음",
        };
      }
      if (verifiedBy === enteredBy) {
        return {
          status: "DRAFT",
          invariant: "I4",
          reason: `I4: 현금 고액인데 확인자와 입력자가 같음(${verifiedBy})`,
        };
      }
    }
  }
  return { status: "POSTED", reason: "", invariant: null };
}

/* ════════════════════════════════════════════════════════════════════════
 * I2 — 결번 없는 영수증 채번
 * ════════════════════════════════════════════════════════════════════════ */

/** 'IKA' + 2026 + 12 → 'IKA-2026-000012' */
export function formatReceiptNo(prefix: string, fiscalYear: number, seq: number, pad = 6): string {
  return `${prefix}-${fiscalYear}-${String(seq).padStart(pad, "0")}`;
}

/** 'IKA-2026-000012' → { prefix:'IKA', fiscalYear:2026, seq:12 }. 형식이 아니면 null. */
export function parseReceiptNo(
  receiptNo: string,
): { prefix: string; fiscalYear: number; seq: number } | null {
  const m = /^([A-Z]+)-(\d{4})-(\d+)$/.exec(String(receiptNo ?? "").trim());
  if (!m) return null;
  return { prefix: m[1], fiscalYear: Number(m[2]), seq: Number(m[3]) };
}

export type ReceiptNoResult = { receiptNo: string; seq: number; fiscalYear: number };

/**
 * I2 — 다음 영수증번호를 **원자적으로** 채번한다.
 *
 * ★ 반드시 prisma.$transaction 안에서, 그리고 채번 직후 같은 트랜잭션에서 거래를 create 해야 한다.
 *   트랜잭션이 롤백되면 카운터도 함께 되돌아가므로 "번호만 소비되고 거래는 없는" 결번이 안 생긴다.
 *
 *   await prisma.$transaction(async (tx) => {
 *     const { receiptNo, seq, fiscalYear } = await nextReceiptNo(tx, 2026);
 *     await tx.transaction.create({ data: { receiptNo, seq, fiscalYear, ... } });
 *   });
 *
 * 시트 시절에는 "기존 최대값 + 1" 을 스캔했다(nextReceiptNo_). 락으로 막긴 했지만
 * 스캔 비용이 행 수에 비례했고, 락 밖에서 부르면 조용히 중복 번호가 났다.
 */
export async function nextReceiptNo(
  tx: Tx,
  fiscalYear: number,
  prefix = "IKA",
  pad = 6,
): Promise<ReceiptNoResult> {
  const row = await tx.receiptSequence.upsert({
    where: { fiscalYear },
    create: { fiscalYear, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
    select: { lastSeq: true },
  });
  return {
    receiptNo: formatReceiptNo(prefix, fiscalYear, row.lastSeq, pad),
    seq: row.lastSeq,
    fiscalYear,
  };
}

export type GapCheck = {
  ok: boolean;
  /** 발행된 건수 */
  count: number;
  /** 최대 일련번호 */
  max: number;
  /** 빠진 번호들 (최대 50개까지만) */
  missing: number[];
  message: string;
};

/**
 * I2 검산 — 1..max 사이에 빠진 번호가 있는가.
 * 순수 함수. seq 배열만 주면 된다.
 */
export function checkReceiptGaps(seqs: readonly number[]): GapCheck {
  if (seqs.length === 0) {
    return { ok: true, count: 0, max: 0, missing: [], message: "올해 발행된 영수증이 아직 없습니다." };
  }
  const set = new Set(seqs);
  const max = Math.max(...seqs);
  const missing: number[] = [];
  for (let i = 1; i <= max; i++) {
    if (!set.has(i)) {
      missing.push(i);
      if (missing.length >= 50) break;
    }
  }
  if (missing.length === 0 && set.size === max) {
    return {
      ok: true,
      count: set.size,
      max,
      missing: [],
      message: `결번 없음 — 1번부터 ${max}번까지 ${set.size}건이 모두 있습니다.`,
    };
  }
  return {
    ok: false,
    count: set.size,
    max,
    missing,
    message: `결번 의심 — ${max}번까지 발행됐는데 ${set.size}건만 있습니다(${max - set.size}건 누락). 감사에게 문의하세요.`,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * I5 — 마감 회계연도 불변
 * ════════════════════════════════════════════════════════════════════════ */

/** FiscalYear 행 몇 개만 있으면 되는 순수 판정. */
export function isFyClosedIn(
  fiscalYear: number,
  years: readonly { year: number; status: string }[],
): boolean {
  const row = years.find((y) => y.year === fiscalYear);
  // 등록되지 않은 연도는 "열려 있지 않다" 로 본다 — 모르는 연도에 쓰게 두면 안 된다.
  if (!row) return true;
  return String(row.status).toUpperCase() === "CLOSED";
}

/** DB 를 직접 보고 판정. */
export async function isFyClosed(db: Db, fiscalYear: number): Promise<boolean> {
  const row = await db.fiscalYear.findUnique({
    where: { year: fiscalYear },
    select: { status: true },
  });
  if (!row) return true;
  return row.status.toUpperCase() === "CLOSED";
}

/**
 * I5 — 마감 연도면 던진다. 모든 쓰기 경로(서버) 첫 줄에 건다.
 * @param dateStr 거래 일자 'yyyy-MM-dd'
 */
export async function assertFyOpen(db: Db, dateStr: string): Promise<number> {
  const fy = fiscalYearOf(dateStr);
  if (await isFyClosed(db, fy)) {
    throw new InvariantError(
      "I5",
      `${fy} 회계연도는 마감되었습니다. 이 연도에는 거래를 만들거나 고칠 수 없습니다. ` +
        `정정이 필요하면 당해연도 날짜로 반대 분개(역분개)를 새로 만드세요.`,
    );
  }
  return fy;
}

/* ════════════════════════════════════════════════════════════════════════
 * I1 — 거래는 삭제되지 않는다
 * ════════════════════════════════════════════════════════════════════════ */

export type VoidCheck = { ok: true } | { ok: false; reason: string };

/**
 * I1 — 무효 처리가 가능한가.
 * DRAFT 는 무효가 아니라 그냥 미확정이므로 무효 대상이 아니다.
 * 이미 VOIDED 면 두 번 무효로 만들 수 없다.
 */
export function canVoid(current: { status: string }, reason: string): VoidCheck {
  const st = String(current.status).toUpperCase();
  if (st === "VOIDED") return { ok: false, reason: "이미 무효 처리된 거래입니다." };
  if (st === "DRAFT") {
    return {
      ok: false,
      reason: "DRAFT 는 아직 장부에 반영되지 않았습니다. 무효가 아니라 내용을 고치거나 그대로 두십시오.",
    };
  }
  if (!String(reason ?? "").trim()) {
    return { ok: false, reason: "무효사유는 필수입니다. 왜 무효인지 적지 않으면 감사가 재구성할 수 없습니다." };
  }
  return { ok: true };
}

/**
 * I1 의 정정 경로는 **두 가지**다. 잔액 계산(POSTED 만 센다)과 어긋나지 않게 골라 써라.
 *
 *  (A) 당기 정정 — 기본. 원 거래를 VOIDED 로 바꾸면 집계에서 빠진다.
 *      올바른 값으로 새 거래를 하나 만들고 reversalOfReceiptNo 로 원 거래를 가리킨다.
 *      → 시드가 보여주는 경로다. buildReversal 을 쓰지 않는다.
 *
 *  (B) 역분개 — 이미 결산·보고된 기간을 손댈 수 없을 때.
 *      원 거래는 POSTED 로 두고 방향만 뒤집은 상쇄 거래를 새로 만들어 순액을 0 으로 만든다.
 *      → 이때 buildReversal 을 쓴다.
 *
 * ★ (A) 와 (B) 를 섞지 마라. 원 거래를 VOIDED 로 바꾸고 역분개까지 만들면
 *   같은 금액이 두 번 빠져 잔액이 틀어진다.
 */
export function buildReversal(original: {
  date: string;
  direction: string;
  amount: number;
  currency: string;
  fxRate: number;
  amountPhp: number;
  accountId: string;
  fundId: string;
  categoryCode: string;
  counterpartyType: string;
  counterpartyName: string;
  method: string;
  receiptNo: string;
}, reversalDate: string, reason: string) {
  return {
    date: reversalDate,
    direction: original.direction.toUpperCase() === "IN" ? "OUT" : "IN",
    amount: original.amount,
    currency: original.currency,
    fxRate: original.fxRate,
    amountPhp: original.amountPhp,
    accountId: original.accountId,
    fundId: original.fundId,
    categoryCode: original.categoryCode,
    counterpartyType: original.counterpartyType,
    counterpartyName: original.counterpartyName,
    method: original.method,
    memo: `[역분개] ${original.receiptNo} 무효 — ${reason}`,
    reversalOfReceiptNo: original.receiptNo,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * I6 — 개시잔액 = 전기 마감잔액
 * ════════════════════════════════════════════════════════════════════════ */

export type OpeningCheck = {
  ok: boolean;
  openingTotal: number;
  priorClosingTotal: number | null;
  diff: number;
  message: string;
};

/**
 * I6 검산 — 당해 계좌 개시잔액 합계가 전기 마감잔액 합계와 같은가.
 * 전기 기록이 없으면(첫 해) ok=true 로 두되 message 로 알린다.
 */
export function checkOpeningBalance(
  accounts: readonly { openingBalance: number }[],
  priorClosingTotalPhp: number | null,
): OpeningCheck {
  const openingTotal = accounts.reduce((s, a) => s + toInt(a.openingBalance), 0);
  if (priorClosingTotalPhp === null || priorClosingTotalPhp === undefined) {
    return {
      ok: true,
      openingTotal,
      priorClosingTotal: null,
      diff: 0,
      message: `전기 마감 기록이 없습니다(개시 연도). 개시잔액 합계 ${formatMoney(openingTotal)}페소는 개시잔액 선언서로만 뒷받침됩니다.`,
    };
  }
  const diff = openingTotal - priorClosingTotalPhp;
  return {
    ok: diff === 0,
    openingTotal,
    priorClosingTotal: priorClosingTotalPhp,
    diff,
    message:
      diff === 0
        ? `I6 정상 — 개시잔액 합계 ${formatMoney(openingTotal)}페소 = 전기 마감잔액.`
        : `I6 위반 — 개시잔액 합계 ${formatMoney(openingTotal)}페소가 전기 마감잔액 ${formatMoney(priorClosingTotalPhp)}페소와 ${formatMoney(Math.abs(diff))}페소 다릅니다.`,
  };
}

/* ════════════════════════════════════════════════════════════════════════ */

/** 불변식 위반 전용 예외. API 레이어가 이걸 잡아 사용자에게 그대로 보여주면 된다. */
export class InvariantError extends Error {
  readonly invariant: keyof typeof INVARIANT_LABELS;
  constructor(invariant: keyof typeof INVARIANT_LABELS, message: string) {
    super(message);
    this.name = "InvariantError";
    this.invariant = invariant;
  }
}

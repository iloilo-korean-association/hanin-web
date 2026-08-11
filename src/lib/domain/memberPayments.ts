import { isInternalTransfer } from "./ledger";
import { toInt } from "./money";

/**
 * 회원 포털 "내가 낸 돈" 집계 — 순수 함수. DB 를 모른다. (P2)
 *
 * ★ 공개 회계(ledger.ts buildPublicLedger)와 **같은 규칙**으로 센다:
 *   · 합계에는 POSTED 만 넣는다.
 *   · DRAFT(미확정)·VOIDED(무효)는 목록에는 보여 주되 합계에서 뺀다.
 *   · 내부이체는 수입이 아니므로 뺀다. (회원 거래에 나올 일은 거의 없지만 규칙을 똑같이 둔다)
 *   회원 화면과 공개 회계가 서로 다른 규칙으로 세면 두 장부는 반드시 어긋난다.
 *   여기 규칙을 바꾸려면 ledger.ts 와 함께 바꿔라.
 *
 * ★ 구분(회비/행사비/기부)은 04_과목의 중분류(midType)가 근거다.
 *   임원 장부(수입 과목별 집계)가 쓰는 축과 같아야 소계가 임원 화면과 맞아떨어진다.
 *   회비고지·기부·행사신청 원장과의 연결(영수증번호 역참조)은 **표시용 보조 정보**다 —
 *   부분납이면 회비고지의 최종수납영수증(lastReceiptNo)만 연결되어 있어 분류 근거로는 불완전하다.
 */

/** 05_거래에서 회원 화면이 쓰는 열만 뽑은 행. 서버 컴포넌트가 findMany 결과를 이 모양으로 넘긴다. */
export type MemberTxRow = {
  receiptNo: string;
  date: string; // yyyy-MM-dd
  direction: string; // IN/OUT
  amountPhp: number;
  counterpartyType: string;
  method: string;
  memo: string;
  status: string; // DRAFT/POSTED/VOIDED
  voidReason: string;
  fiscalYear: number;
  seq: number;
  /** 04_과목 중분류 (회비/기부/행사/…) — 구분 배지의 근거 */
  categoryMidType: string;
  /** 04_과목 공개표시명 */
  categoryName: string;
};

/**
 * 통합 납부 내역의 구분.
 * 수입(IN)은 과목 중분류로 회비/행사비/기부/기타를 나누고,
 * 지출(OUT — 한인회가 회원에게 지급한 건, 환급 등)은 "지급" 하나로 표시만 한다.
 */
export type PaymentKind = "회비" | "행사비" | "기부" | "기타" | "지급";

/** 납부(IN) 구분 — 소계를 만드는 축. 화면 표기 순서이기도 하다. */
export const PAYMENT_KINDS_IN = ["회비", "행사비", "기부", "기타"] as const;
export type PaymentKindIn = (typeof PAYMENT_KINDS_IN)[number];

export function paymentKindOf(t: { direction: string; categoryMidType: string }): PaymentKind {
  if (String(t.direction).toUpperCase() !== "IN") return "지급";
  switch (String(t.categoryMidType).trim()) {
    case "회비":
      return "회비";
    case "행사":
      return "행사비";
    case "기부":
      return "기부";
    default:
      return "기타";
  }
}

export type MemberPaymentRow = MemberTxRow & {
  kind: PaymentKind;
  /** 합계에 들어간 행인가 — POSTED · IN · 내부이체 아님 */
  counted: boolean;
};

export type MemberPaymentsSummary = {
  /** 확정(POSTED) 납부 합계 — 내부이체 제외 */
  paidTotal: number;
  /** 구분별 소계 (확정 납부만) */
  byKind: Record<PaymentKindIn, number>;
  /** 확정 납부 건수 */
  paidCount: number;
  /** 미확정(DRAFT) 수입 건수 — 합계 제외. 화면이 "빠져 있다" 고 알려 줘야 한다 */
  draftCount: number;
  /** 무효(VOIDED) 건수 — 합계 제외 */
  voidedCount: number;
  /** 지급(OUT) 건수 — 납부가 아니므로 합계 제외 */
  outCount: number;
  /** 확정 납부 중 가장 최근 일자. 없으면 null */
  lastPaidOn: string | null;
};

/**
 * 회원 한 명의 거래 행 배열 → 화면 행(구분·합계포함 여부) + 요약.
 * 정렬은 최신 일자·큰 seq 우선 (기존 화면과 같다).
 */
export function buildMemberPayments(txs: readonly MemberTxRow[]): {
  rows: MemberPaymentRow[];
  summary: MemberPaymentsSummary;
} {
  const rows: MemberPaymentRow[] = [];
  const byKind: Record<PaymentKindIn, number> = { 회비: 0, 행사비: 0, 기부: 0, 기타: 0 };
  let paidTotal = 0;
  let paidCount = 0;
  let draftCount = 0;
  let voidedCount = 0;
  let outCount = 0;
  let lastPaidOn: string | null = null;

  for (const t of txs) {
    const kind = paymentKindOf(t);
    const status = String(t.status).toUpperCase();
    const isIn = String(t.direction).toUpperCase() === "IN";
    const counted = status === "POSTED" && isIn && !isInternalTransfer(t);

    if (counted) {
      const amount = toInt(t.amountPhp);
      paidTotal += amount;
      paidCount += 1;
      if (kind !== "지급") byKind[kind] += amount;
      if (!lastPaidOn || t.date > lastPaidOn) lastPaidOn = t.date;
    } else if (isIn && status === "DRAFT") {
      draftCount += 1;
    }
    if (status === "VOIDED") voidedCount += 1;
    if (!isIn) outCount += 1;

    rows.push({ ...t, kind, counted });
  }

  rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq));

  return {
    rows,
    summary: { paidTotal, byKind, paidCount, draftCount, voidedCount, outCount, lastPaidOn },
  };
}

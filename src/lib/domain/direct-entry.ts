/**
 * 직접 입력 장부(/officer/book) 의 판정 규칙.
 *
 * ── 무엇이 달라졌나 ──────────────────────────────────────────────────────
 * 예전에는 지출 1건에 화면 2개·제출 2~4회·사람 2~3명이 필요했다
 * (요청 → 1차 결재 → 2차 결재 → 집행). 전결이라도 요청·집행 2회는 거쳐야 했다.
 * 이제 총무가 한 줄 적으면 그 자리에서 확정된다.
 *
 * 통제가 사라진 것이 아니라 **자리를 옮겼다** — 입력 전 결재에서 입력 후 감사로.
 * 이 파일이 그 "입력 후" 쪽 규칙이다.
 *
 * ── evaluateTxState 를 왜 안 쓰나 ────────────────────────────────────────
 * invariants.ts 의 evaluateTxState 는 증빙이 없거나 현금 고액에 확인자가 없으면
 * 거래를 DRAFT 로 떨어뜨린다. 그리고 **DRAFT 는 공개 잔액에 안 잡힌다.**
 *
 * 총무가 임차료 ₱12,000 을 현금으로 냈는데 영수증 사진이 없으면,
 * 돈은 실제로 나갔는데 공개 장부 잔액은 그대로다 → 통장과 안 맞는다.
 * "증빙이 없다" 를 "그 돈은 안 나갔다" 로 기록하는 셈이라 오히려 틀리다.
 *
 * 그래서 직접 입력 경로는 **항상 POSTED** 로 적고, 대신 배지를 붙여 감사 큐에 올린다.
 * evaluateTxState 는 임포트 경로(ledger-import)와 감사 판정에서 계속 쓰이므로
 * 손대지 않는다. 두 경로가 서로 다른 규칙을 쓴다는 사실 자체를 감사 화면이 보여준다.
 */
import { toPeso } from "./money";

/* ════════════════════════════════════════════════════════════════════════
 * 배지
 * ════════════════════════════════════════════════════════════════════════ */

export const ENTRY_FLAGS = ["증빙없음", "미확인현금", "이해관계자", "고액", "수정됨"] as const;
export type EntryFlag = (typeof ENTRY_FLAGS)[number];

/** 배지별 한 줄 설명. 화면 툴팁과 감사 큐 사유에 그대로 쓴다. */
export const ENTRY_FLAG_HELP: Record<EntryFlag, string> = {
  증빙없음: "영수증·계좌이체 화면 등 증빙이 붙지 않았습니다.",
  미확인현금: "임계액을 넘는 현금인데 확인자가 없거나 입력자와 같습니다.",
  이해관계자: "임원과 이해관계가 있는 상대방입니다. 금액과 무관하게 감사가 봅니다.",
  고액: "임계액을 넘는 지출입니다.",
  수정됨: "처음 적은 뒤에 내용이 바뀌었습니다.",
};

export type EntryFlagConfig = {
  /** 현금 2인 확인 임계액 (Setting '현금2인확인_임계액', 기본 3000) */
  cashThreshold: number;
  /** 이 금액을 넘는 지출은 금액만으로 감사 큐에 올린다 (Setting '감사확인_고액기준', 기본 30000) */
  largeAmount: number;
};

export const DEFAULT_ENTRY_FLAG_CONFIG: EntryFlagConfig = {
  cashThreshold: 3000,
  largeAmount: 30000,
};

export type EntryRow = {
  direction: string;
  /** 원통화 금액. amountPhp 를 주면 생략해도 된다(공개 장부 행은 페소만 들고 다닌다). */
  amount?: number | null;
  currency?: string | null;
  fxRate?: number | null;
  /** 있으면 이 값을 쓴다. 없으면 amount×fxRate 로 계산한다. */
  amountPhp?: number | null;
  method?: string | null;
  evidenceUrl?: string | null;
  relatedParty?: boolean | null;
  enteredBy?: string | null;
  enteredAt?: Date | string | null;
  verifiedBy?: string | null;
  updatedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  status?: string | null;
};

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function pesoOf(tx: EntryRow): number {
  if (typeof tx.amountPhp === "number" && Number.isFinite(tx.amountPhp)) return tx.amountPhp;
  return toPeso(tx.amount ?? 0, tx.currency ?? "PHP", tx.fxRate ?? null);
}

/**
 * 수정 판정의 허용 오차 (ms).
 *
 * create 한 순간에도 enteredAt 과 updatedAt 이 몇 밀리초 어긋난다.
 * @default(now()) 와 @updatedAt 을 Prisma 가 각각 계산하기 때문이다.
 * 이 여유가 없으면 **방금 적은 거래가 전부 '수정됨' 으로 뜬다.**
 */
const EDIT_TOLERANCE_MS = 2000;

export function wasEdited(tx: EntryRow): boolean {
  const entered = ms(tx.enteredAt);
  const updated = ms(tx.updatedAt);
  if (entered === null || updated === null) return false;
  return updated - entered > EDIT_TOLERANCE_MS;
}

/** 이 거래에 붙는 배지 전부. 순수 함수 — 화면과 서버가 같은 것을 쓴다. */
export function entryFlags(
  tx: EntryRow,
  cfg: EntryFlagConfig = DEFAULT_ENTRY_FLAG_CONFIG,
): EntryFlag[] {
  const flags: EntryFlag[] = [];
  const peso = pesoOf(tx);

  if (!String(tx.evidenceUrl ?? "").trim()) flags.push("증빙없음");

  // .trim().toUpperCase() 는 생략하면 안 된다. ' CASH ' 처럼 공백이 섞여 들어오는
  // 경로가 실재했고, 공백 하나로 이 블록을 건너뛰면 고액 현금이 조용히 통과한다.
  const method = String(tx.method ?? "").trim().toUpperCase();
  if (method === "CASH" && peso > cfg.cashThreshold) {
    const enteredBy = String(tx.enteredBy ?? "").trim().toLowerCase();
    const verifiedBy = String(tx.verifiedBy ?? "").trim().toLowerCase();
    // 입력자를 모르면 "확인자 ≠ 입력자" 를 증명할 방법이 없다 → 미확인으로 본다.
    if (!verifiedBy || !enteredBy || enteredBy === "unknown" || verifiedBy === enteredBy) {
      flags.push("미확인현금");
    }
  }

  if (tx.relatedParty) flags.push("이해관계자");

  if (String(tx.direction ?? "").toUpperCase() === "OUT" && peso > cfg.largeAmount) {
    flags.push("고액");
  }

  if (wasEdited(tx)) flags.push("수정됨");

  return flags;
}

/* ════════════════════════════════════════════════════════════════════════
 * 감사 확인 대기 큐
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 감사가 봐야 하는 거래인가.
 *
 * ★ 이해관계자는 **금액과 무관하게** 항상 올라온다.
 *   사전 승인 시절에는 이해관계 건이 2단계 결재를 강제받았다. 그 방어를 잃지 않으려면
 *   금액 기준을 적용하면 안 된다 — ₱500 짜리도 이해관계면 누군가 봐야 한다.
 *
 * 이미 확인된 건(reviewedAt 있음)은 큐에서 빠진다. 단 **확인 후에 수정되면 다시 올라온다** —
 * 확인 도장은 "그때 그 내용" 에 찍은 것이지 영수증번호에 찍은 것이 아니다.
 */
export function needsReview(
  tx: EntryRow,
  cfg: EntryFlagConfig = DEFAULT_ENTRY_FLAG_CONFIG,
): boolean {
  // 무효 처리된 건은 이미 결론이 난 것이라 큐에 올리지 않는다(무효 자체가 감사로그에 남는다).
  if (String(tx.status ?? "").toUpperCase() === "VOIDED") return false;

  const reviewed = ms(tx.reviewedAt);
  if (reviewed !== null) {
    const updated = ms(tx.updatedAt);
    // 확인 뒤에 손댔으면 도장이 무효다. 다시 봐야 한다.
    return updated !== null && updated - reviewed > EDIT_TOLERANCE_MS;
  }

  return entryFlags(tx, cfg).length > 0;
}

/** 큐에 올라온 이유를 사람 말로. 감사 화면에 그대로 찍는다. */
export function reviewReasons(
  tx: EntryRow,
  cfg: EntryFlagConfig = DEFAULT_ENTRY_FLAG_CONFIG,
): string[] {
  const reviewed = ms(tx.reviewedAt);
  const updated = ms(tx.updatedAt);
  if (reviewed !== null && updated !== null && updated - reviewed > EDIT_TOLERANCE_MS) {
    return ["감사 확인 후에 내용이 수정되었습니다. 다시 확인해 주십시오."];
  }
  return entryFlags(tx, cfg).map((f) => `${f} — ${ENTRY_FLAG_HELP[f]}`);
}

/* ════════════════════════════════════════════════════════════════════════
 * 입력 기본값 — 타이핑을 3칸으로 줄이는 부분
 * ════════════════════════════════════════════════════════════════════════ */

export type AccountLite = { accountId: string; kind: string; currency: string; status: string };

/**
 * 수단에서 계좌를 자동으로 고른다.
 *
 * 현금을 받았는데 계좌를 GCash 로 두면 현금 실사가 통째로 어긋난다.
 * 매번 사람이 고르게 하면 반드시 언젠가 틀리므로, 수단이 정해지면 계좌를 따라가게 한다.
 * (같은 종류가 여러 개면 첫 번째. 화면에서 바꿀 수 있다.)
 */
export function accountForMethod(
  method: string,
  accounts: readonly AccountLite[],
  fallback = "",
): string {
  const m = String(method ?? "").trim().toUpperCase();
  const active = accounts.filter((a) => a.status === "ACTIVE");
  const kind = m === "CASH" ? "CASH" : m === "GCASH" ? "GCASH" : m === "MAYA" ? "MAYA" : m === "BANK" ? "BANK" : null;
  if (kind) {
    const hit = active.find((a) => a.kind === kind);
    if (hit) return hit.accountId;
  }
  // CARD_2C2P·INKIND 는 대응하는 계좌 종류가 없다. 사람이 고르게 둔다.
  return fallback || active[0]?.accountId || "";
}

/** 연속 입력에서 유지할 값과 비울 값. 화면이 이 목록을 그대로 따른다. */
export const STICKY_FIELDS = ["direction", "date", "categoryCode", "fundId", "method", "accountId"] as const;
export const CLEARED_FIELDS = ["counterpartyName", "amount", "memo", "externalRef", "eventId"] as const;

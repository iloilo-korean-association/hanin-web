import type { Currency } from "../validators/enums";

/**
 * 돈 계산 — 전부 순수 함수. DB 를 모른다.
 *
 * 원본: 02_노코드MVP/AppsScript/00_공통_유틸.gs 의 toInt_ · toPeso_ · rateFor_ · money_
 *
 * ★ 페소는 소수점이 없다. 모든 금액은 정수로 저장하고 정수로 계산한다.
 *   Float 로 두면 0.1 + 0.2 문제가 결산 대차에 그대로 나타난다.
 */

/** 통화별 환율의 기본값. 실제 값은 Setting '환율.KRW_PHP' / '환율.USD_PHP' 에서 읽는다. */
export const DEFAULT_FX: Readonly<Record<Currency, number>> = {
  PHP: 1,
  KRW: 0.0417,
  USD: 58.5,
};

/**
 * 사람이 친 문자열을 정수 페소로.
 * '1,200' · ' ₱1200 ' · 'P 1200' 모두 1200. 못 읽으면 0.
 * (원본 toInt_ 과 동일 — 쉼표·공백·₱·P 를 지운 뒤 반올림)
 */
export function toInt(v: unknown): number {
  if (v === "" || v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  const n = Number(String(v).replace(/[,\s₱P]/gi, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** 환율표에서 통화의 환율을 찾는다. 없으면 던진다 — 조용히 1 로 폴백하면 외화가 페소로 둔갑한다. */
export function rateFor(currency: string, table: Partial<Record<string, number>> = DEFAULT_FX): number {
  const c = String(currency || "PHP").toUpperCase();
  if (c === "PHP") return 1;
  const r = table[c];
  if (!r || !Number.isFinite(r)) {
    throw new Error(`환율 설정이 없습니다: "환율.${c}_PHP" 를 채우세요.`);
  }
  return r;
}

/**
 * 원화폐 금액 → 정수 페소.
 * rate 를 주면 그 값을 쓰고(거래시점 스냅샷), 없으면 환율표에서 찾는다.
 */
export function toPeso(
  amount: unknown,
  currency: string,
  rate?: number | null,
  table: Partial<Record<string, number>> = DEFAULT_FX,
): number {
  const r = rate === undefined || rate === null || !Number(rate) ? rateFor(currency, table) : Number(rate);
  return Math.round(toInt(amount) * r);
}

/** 1234567 → "1,234,567". 음수 부호 유지. (원본 money_) */
export function formatMoney(n: unknown): string {
  const v = toInt(n);
  const s = String(Math.abs(v));
  let out = "";
  let rest = s;
  while (rest.length > 3) {
    out = "," + rest.slice(-3) + out;
    rest = rest.slice(0, -3);
  }
  return (v < 0 ? "-" : "") + rest + out;
}

/** 화면 표기용. "₱1,234,567" */
export function formatPeso(n: unknown): string {
  return "₱" + formatMoney(n);
}

/** 외화 병기 표기. "US$100 (₱5,850 · @58.5)" */
export function formatForeign(amount: number, currency: string, fxRate: number, amountPhp: number): string {
  if (currency === "PHP") return formatPeso(amountPhp);
  const sym = currency === "USD" ? "US$" : currency === "KRW" ? "₩" : currency + " ";
  return `${sym}${formatMoney(amount)} (${formatPeso(amountPhp)} · @${fxRate})`;
}

/** 날짜 문자열의 회계연도. 역년(1/1~12/31) 기준. (원본 fyOf_) */
export function fiscalYearOf(dateStr: string): number {
  const m = /^(\d{4})/.exec(String(dateStr || "").trim());
  if (!m) throw new Error(`날짜 형식이 올바르지 않습니다: "${dateStr}" (yyyy-MM-dd 여야 합니다)`);
  return Number(m[1]);
}

/** 'yyyy-MM-dd' 형식인가. */
export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Asia/Manila 기준 오늘 'yyyy-MM-dd'. 서버 TZ 와 무관하게 같은 답을 준다. */
export function todayManila(now: Date = new Date()): string {
  return manilaDateStr(now);
}

/** Date → Asia/Manila 기준 'yyyy-MM-dd' */
export function manilaDateStr(d: Date): string {
  // 마닐라는 UTC+8, 서머타임 없음. Intl 없이도 정확하다.
  const ms = d.getTime() + 8 * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Date → Asia/Manila 기준 'yyyy-MM-dd HH:mm' */
export function manilaDateTimeStr(d: Date): string {
  const ms = d.getTime() + 8 * 3600 * 1000;
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

/** a 에서 b 까지 며칠 (b - a, 달력일 기준). 형식이 틀리면 null. */
export function daysBetween(a: string, b: string): number | null {
  if (!isDateStr(a) || !isDateStr(b)) return null;
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

/** 'yyyy-MM-dd' 에 일수를 더한다. */
export function addDays(dateStr: string, days: number): string {
  const t = Date.parse(dateStr + "T00:00:00Z");
  if (Number.isNaN(t)) throw new Error(`날짜 형식이 올바르지 않습니다: "${dateStr}"`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** 'yyyy-MM-dd' → 'yyyy-MM' */
export function monthOf(dateStr: string): string {
  return String(dateStr).slice(0, 7);
}

/** 2026 → ['2026-01' … '2026-12'] */
export function monthsOfYear(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${fy}-${String(i + 1).padStart(2, "0")}`);
}

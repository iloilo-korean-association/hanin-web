/**
 * 표시 포맷 — 화면 담당자 3명이 같은 함수를 쓰도록 여기에 모은다.
 *
 * 금액 단위 약속:
 *   원장의 금액은 **페소 정수**다(센타보 단위 아님). 05_거래.금액 / 페소환산 모두 정수.
 *   Prisma 스키마도 Int 로 잡혀 있다. 여기 함수들은 그 전제를 따른다.
 *   [확인 필요] 스키마가 소수(Decimal)로 확정되면 이 파일만 고치면 된다.
 */

const PESO = "₱";

/** 1234567 → "₱1,234,567" */
export function formatPeso(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return `${PESO}${Math.round(amount).toLocaleString("en-PH")}`;
}

/** 통화 코드가 PHP 가 아닐 수 있는 자리(기부·외화 계좌)용. 1234, "USD" → "USD 1,234" */
export function formatAmount(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const cur = (currency ?? "PHP").toUpperCase();
  if (cur === "PHP") return formatPeso(amount);
  return `${cur} ${Math.round(amount).toLocaleString("en-PH")}`;
}

/** 부호를 항상 붙인다. 수입/지출 대비표에 쓴다. */
export function formatSignedPeso(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${PESO}${Math.abs(Math.round(amount)).toLocaleString("en-PH")}`;
}

/** 2026-08-08 */
export function formatDate(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 2026년 8월 8일 (금) */
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;
export function formatDateKo(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  const w = WEEKDAY_KO[date.getDay()] ?? "";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${w})`;
}

/** 2026-08-08 14:30 */
export function formatDateTime(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <time dateTime> 속성에 넣을 값. 접근성·검색엔진용. */
export function isoDate(d: Date | string | null | undefined): string | undefined {
  const date = toDate(d);
  return date ? date.toISOString() : undefined;
}

/** 0.152 → "15.2%" */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * 연락처 마스킹. 공개 화면에 번호 전체가 나가면 안 된다.
 * "09171234567" → "0917****567"
 */
export function maskPhone(phone: string | null | undefined): string {
  const s = (phone ?? "").replace(/\s+/g, "");
  if (s.length < 7) return s ? "***" : "—";
  return `${s.slice(0, 4)}****${s.slice(-3)}`;
}

/**
 * 성명 마스킹. 공개 화면에 회원 실명이 0건이어야 하지만,
 * 로그인한 임원 화면의 목록 등에서 축약이 필요할 때 쓴다.
 * "김민수" → "김*수", "이수" → "이*"
 */
export function maskName(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "—";
  if (s.length === 1) return s;
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${"*".repeat(s.length - 2)}${s[s.length - 1]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

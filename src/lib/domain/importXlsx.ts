import ExcelJS from "exceljs";

import type { ImportBlockType } from "../validators/enums";

/**
 * 실제 회계장부 엑셀(『한인회비 내역』 2021~2026 + 금부원 교민지원) 파서.
 *
 * ★ 순수 함수다. DB 를 모른다 — 버퍼를 받아 행 배열과 시트별 대조표를 돌려준다.
 *   저장(ImportRow 생성)과 반영(Transaction 생성)은 L3 화면의 몫이다.
 *
 * ── 시트 구조 (2026-08-13 원본 전 시트 육안 확인) ────────────────────────
 *  · 연도 시트 "YYYY년 한인회비" 6장:
 *      좌측 A~E = 회비·수입 (A 번호, B 이름, C 납부날짜 텍스트, D 원화, E 페소)
 *      우측 G~J = 지출 (G 날짜, H 내역, I 비용₱, J 비고)
 *      헤더 r1~r2. 수입은 '합/합계' 행에서, 지출은 '합계/지출합계/TOTAL' 행에서 끝난다.
 *  · 2022 추가: L~O 에 "사무실 오픈 기부" 블록 — 현금 기부는 **좌측 수입표에 같은
 *    이름·금액으로 중복 기재**돼 있다(전수 대조로 확인). 중복이 확인된 행은 만들지
 *    않고 건수만 세며, 대조 실패 행과 현물(구충제·커피 등)만 행으로 만든다.
 *  · 2023 추가: L~P 는 좌측 수입표의 **번호 매긴 부분 사본**(M 이름 / N 한화 / O 페소).
 *    좌측과 이름·금액이 일치하면 행을 만들지 않고, 불일치만 확인필요로 만든다.
 *  · 2024 추가: K~L 족구대회 후원금(현금·원화 문자열 "50,000원"·현물 "유니폼"),
 *    N~O 체육대회 현금후원 + 현물후원(TV·쿠폰 — 평가액 있음).
 *  · "금부원 교민지원" 시트: 한화 수입 B~C, 페소 수입 E~F, 하단 '지출 내역' B~C,
 *    중간에 페소 지원 항목("6,000페소(생필품)" — 금액이 텍스트 안에 있다).
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 *  · 날짜: "3월5일(BDO 이체)" → 시트 연도 + 월일 → yyyy-MM-dd.
 *    오타 교정 사전(실제 발견분만): 일일→일, 알→일, 읿→일, 웧→월.
 *    누락·해석 불가("한복대여비", "5건", "2023/10~2024/2")·존재하지 않는 날짜(2월30일)는
 *    **임의 해석하지 않고** date=null + 확인필요.
 *  · 수단: 텍스트에 '이체'/'BDO' → BANK, '현장납부' → CASH.
 *    괄호가 없거나 수단이 아니면 CASH 기본 + 경고(수입 행만. 지출 행은 원본에 수단
 *    정보 자체가 없어 경고 없이 CASH 기본 — 검토 화면에서 수정한다).
 *  · 통화: D열=KRW, E열=PHP. 한 행에 둘 다 있으면 행을 2개로 나눈다(참조에 :KRW/:PHP).
 *  · 금액: 정수. 페소 소수점(42835.65 등)은 반올림하고 원본은 raw 에 보존.
 *  · 이름: 원문 그대로(부부 병기 "서태원/김미화", 상호 병기 "정한(강원마트)" 유지).
 *  · externalRef = "XLSX:<시트>:r<행>:<블록태그>[:<통화>]" — 멱등 키. 블록태그는
 *    같은 행 번호의 다른 블록(족구/체육 등)이 충돌하지 않도록 블록마다 다르다.
 */

/* ═══════════════════════ 타입 ═══════════════════════ */

export type ImportCurrency = "PHP" | "KRW";
export type ImportMethod = "CASH" | "BANK" | "INKIND";
/** 파서가 내는 상태 — '제외'/'반영됨' 은 검토 화면에서만 생긴다. */
export type ParsedRowStatus = "정상" | "확인필요";

export interface ParsedRow {
  sheetName: string;
  /** 엑셀 행 번호 (1부터, 원본 그대로) */
  rowNo: number;
  blockType: ImportBlockType;
  /** 멱등 키. ImportRow.externalRef 로 저장한다. */
  externalRef: string;
  /** 원본 셀 값 (열문자 → 표시 문자열, 비어있지 않은 것만). ImportRow.rawJson 으로 저장. */
  raw: Record<string, string>;
  /** 정규화된 날짜 yyyy-MM-dd. 누락·해석 불가면 null */
  date: string | null;
  /** 납부자(수입)·수혜자(지원) 표기 원문 */
  payerName: string;
  /** 내역 (지출 H열, 현물 설명 등) */
  description: string;
  /** 정수 금액. 금액을 못 읽었으면 0 + amountKnown=false */
  amount: number;
  /** 금액을 실제로 읽었는가 — false 면 확인필요 */
  amountKnown: boolean;
  currency: ImportCurrency;
  method: ImportMethod;
  warnings: string[];
  status: ParsedRowStatus;
}

/** 엑셀이 스스로 적어 둔 블록 합계(대조용) */
export interface ExcelDeclaredTotal {
  label: string;
  /** 합계가 적힌 셀 위치 (rN) */
  rowNo: number;
  value: number;
}

export interface SheetSummary {
  sheetName: string;
  /** 연도 시트면 연도, 금부원 시트면 null */
  year: number | null;
  /** 이 시트에서 만든 행 수 */
  rowCount: number;
  needsReview: number;
  /** 우측 사본·중복 블록에서 좌측과 일치가 확인되어 만들지 않은 행 수 */
  duplicatesSkipped: number;
  /** 파서가 계산한 합계 (블록·통화별) */
  parsed: {
    incomeKrw: number; // 회비수입 KRW (금부원이면 금부원수입 KRW)
    incomePhp: number; // 회비수입 PHP (금부원이면 금부원수입 PHP)
    donationKrw: number; // 후원수입 KRW
    donationPhp: number; // 후원수입 PHP
    inkindPhp: number; // 현물후원 평가액 PHP
    /** 지출 합 — 반올림 전(소수 2자리) / 반올림 후 정수 */
    expenseRaw: number;
    expense: number;
    /** 금부원 지원 항목 합 (지출 내역 표 밖 — 시트 자체 합계에 포함되지 않음) */
    fundSupportPhp: number;
  };
  /** 엑셀 합계행에서 읽은 값 (없으면 null) */
  excel: {
    incomeKrw: number | null;
    incomePhp: number | null;
    expense: number | null;
    /** 추가 블록의 자체 합계 (2024 족구 48250 등) */
    blocks: ExcelDeclaredTotal[];
  };
}

export interface ImportParseResult {
  rows: ParsedRow[];
  sheetSummaries: SheetSummary[];
  /** 시트 수준 경고 (사본 블록 제외 내역, 알 수 없는 시트 등) */
  warnings: string[];
}

/* ═══════════════════════ 셀 읽기 ═══════════════════════ */

type WS = ExcelJS.Worksheet;

function displayOf(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join("");
    }
    if ("result" in v) return displayOf((v as { result?: ExcelJS.CellValue }).result ?? "");
    if ("text" in v) return String((v as { text?: unknown }).text ?? "");
    if ("error" in v) return String((v as { error?: unknown }).error ?? "");
  }
  return String(v);
}

/** 원본 표시 문자열 (트림 없음 — rawJson 보존용) */
function rawOf(ws: WS, r: number, c: number): string {
  return displayOf(ws.getRow(r).getCell(c).value);
}

/** 공백 정리한 텍스트 (판정용) */
function textOf(ws: WS, r: number, c: number): string {
  return rawOf(ws, r, c).replace(/\s+/g, " ").trim();
}

/** 숫자로 읽는다. "42,835.65"·수식 결과 포함. 숫자가 아니면 null */
function numOf(ws: WS, r: number, c: number): number | null {
  const t = rawOf(ws, r, c).replace(/[,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 지정한 열들의 원본 셀을 rawJson 용으로 모은다 (비어있지 않은 것만). */
function collectRaw(ws: WS, r: number, cols: readonly [number, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [c, letter] of cols) {
    const v = rawOf(ws, r, c);
    if (v !== "") out[letter] = v;
  }
  return out;
}

/* ═══════════════════════ 날짜·수단 정규화 ═══════════════════════ */

/** 실제 원본에서 발견된 오타만 교정한다. 발견분: 8월9일일 · 2월16알 · 2월28읿 · 1웧15일 */
const DATE_TYPOS: readonly (readonly [RegExp, string])[] = [
  [/일일/g, "일"],
  [/알/g, "일"],
  [/읿/g, "일"],
  [/웧/g, "월"],
];

export interface NormalizedDate {
  date: string | null;
  method: ImportMethod;
  /** 텍스트에서 수단을 실제로 읽었는가 (false 면 CASH 기본값) */
  methodKnown: boolean;
  warnings: string[];
}

/**
 * 날짜 텍스트("3월5일(BDO 이체)") → ISO 날짜 + 수단.
 * 해석 불가면 date=null 로 돌려준다 — 임의 해석은 하지 않는다.
 */
export function normalizeDateText(rawText: string, year: number): NormalizedDate {
  const warnings: string[] = [];
  const t = rawText.replace(/\s+/g, " ").trim();

  // 수단 — 날짜와 무관하게 텍스트 전체에서 찾는다
  let method: ImportMethod = "CASH";
  let methodKnown = false;
  if (/이체|BDO/i.test(t)) {
    method = "BANK";
    methodKnown = true;
  } else if (/현장납부/.test(t)) {
    method = "CASH";
    methodKnown = true;
  }

  if (!t) {
    return { date: null, method, methodKnown, warnings: ["날짜 없음"] };
  }

  // 오타 교정 (날짜 판독용 사본에만 적용 — 원본은 raw 에 남는다)
  let fixed = t;
  for (const [re, rep] of DATE_TYPOS) fixed = fixed.replace(re, rep);
  if (fixed !== t) warnings.push(`날짜 오타 교정: "${t}" → "${fixed}"`);

  const m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일?/.exec(fixed);
  if (!m) {
    warnings.push(`날짜 해석 불가: "${t}"`);
    return { date: null, method, methodKnown, warnings };
  }
  const mo = Number(m[1]);
  const day = Number(m[2]);
  const dt = new Date(Date.UTC(year, mo - 1, day));
  if (mo < 1 || mo > 12 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== day) {
    warnings.push(`존재하지 않는 날짜: "${t}" (${year}년 ${mo}월 ${day}일)`);
    return { date: null, method, methodKnown, warnings };
  }
  const iso = `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date: iso, method, methodKnown, warnings };
}

/* ═══════════════════════ 행 조립 ═══════════════════════ */

interface RowDraft {
  sheetName: string;
  rowNo: number;
  blockType: ImportBlockType;
  /** externalRef 의 블록 태그 — 같은 행 번호의 다른 블록과 충돌하지 않게 블록마다 다르다 */
  refTag: string;
  /** 한 행이 두 통화로 갈라질 때만 ":KRW"/":PHP" 를 붙인다 */
  refCurrencySuffix?: boolean;
  raw: Record<string, string>;
  date: string | null;
  payerName: string;
  description: string;
  amount: number;
  amountKnown: boolean;
  currency: ImportCurrency;
  method: ImportMethod;
  warnings: string[];
}

function buildRow(d: RowDraft): ParsedRow {
  const needsReview = d.date === null || !d.amountKnown;
  const ref =
    `XLSX:${d.sheetName}:r${d.rowNo}:${d.refTag}` + (d.refCurrencySuffix ? `:${d.currency}` : "");

  /* ★ 확인필요인데 사유가 비어 있으면 안 된다.
     날짜 열이 아예 없는 블록(2024 후원·현물, 금부원)은 호출부가 경고를 달지 않으므로
     여기서 채운다 — 검토 화면에서 "왜 확인필요인지" 없이 뜨면 총무가 판단할 수 없다.
     이미 같은 취지의 경고가 있으면 중복해서 붙이지 않는다. */
  const warnings = [...d.warnings];
  if (needsReview) {
    if (d.date === null && !warnings.some((w) => w.includes("날짜"))) {
      warnings.push("날짜 열이 없는 블록 — 반영 전에 날짜를 지정해 주십시오");
    }
    if (!d.amountKnown && !warnings.some((w) => w.includes("금액") || w.includes("평가액"))) {
      warnings.push("금액을 읽지 못했습니다 — 반영 전에 금액을 확인해 주십시오");
    }
  }

  return {
    sheetName: d.sheetName,
    rowNo: d.rowNo,
    blockType: d.blockType,
    externalRef: ref,
    raw: d.raw,
    date: d.date,
    payerName: d.payerName,
    description: d.description,
    amount: d.amount,
    amountKnown: d.amountKnown,
    currency: d.currency,
    method: d.method,
    warnings,
    status: needsReview ? "확인필요" : "정상",
  };
}

/* ═══════════════════════ 중복 대조 (우측 블록 ↔ 좌측 수입표) ═══════════════════════ */

/**
 * 좌측 수입표의 (이름·통화·금액) 멀티셋.
 * 우측 사본·기부 블록의 행이 좌측에 실재하는지 기계적으로 대조한다 —
 * 일치가 확인된 행만 "중복" 으로 건너뛴다. 추측으로 버리는 행은 없다.
 */
class IncomeIndex {
  private map = new Map<string, number[]>();

  private static key(name: string, currency: ImportCurrency, amount: number): string {
    return `${name.replace(/\s+/g, "")}|${currency}|${amount}`;
  }

  add(name: string, currency: ImportCurrency, amount: number, rowNo: number): void {
    const k = IncomeIndex.key(name, currency, amount);
    const arr = this.map.get(k);
    if (arr) arr.push(rowNo);
    else this.map.set(k, [rowNo]);
  }

  /** 일치하는 좌측 행이 있으면 소비하고 그 행 번호를 돌려준다. 없으면 null */
  consume(name: string, currency: ImportCurrency, amount: number): number | null {
    const k = IncomeIndex.key(name, currency, amount);
    const arr = this.map.get(k);
    if (!arr || arr.length === 0) return null;
    return arr.shift() ?? null;
  }
}

/* ═══════════════════════ 시트 파서 ═══════════════════════ */

const INCOME_COLS: readonly [number, string][] = [
  [1, "A"],
  [2, "B"],
  [3, "C"],
  [4, "D"],
  [5, "E"],
];
const EXPENSE_COLS: readonly [number, string][] = [
  [7, "G"],
  [8, "H"],
  [9, "I"],
  [10, "J"],
];

function emptySummary(sheetName: string, year: number | null): SheetSummary {
  return {
    sheetName,
    year,
    rowCount: 0,
    needsReview: 0,
    duplicatesSkipped: 0,
    parsed: {
      incomeKrw: 0,
      incomePhp: 0,
      donationKrw: 0,
      donationPhp: 0,
      inkindPhp: 0,
      expenseRaw: 0,
      expense: 0,
      fundSupportPhp: 0,
    },
    excel: { incomeKrw: null, incomePhp: null, expense: null, blocks: [] },
  };
}

/**
 * 행을 결과에 넣고 시트 합계에 누적한다.
 * skipTotals: 우측 사본 블록의 대조 실패 행처럼 **좌측 표 합계와의 대조를 흐리면
 * 안 되는** 행은 행만 만들고 합계에는 넣지 않는다 (검토 화면에는 그대로 보인다).
 */
function pushRow(
  rows: ParsedRow[],
  summary: SheetSummary,
  row: ParsedRow,
  opts?: { skipTotals?: boolean },
): void {
  rows.push(row);
  summary.rowCount += 1;
  if (row.status === "확인필요") summary.needsReview += 1;
  if (opts?.skipTotals) return;
  const p = summary.parsed;
  switch (row.blockType) {
    case "회비수입":
    case "금부원수입":
      if (row.currency === "KRW") p.incomeKrw += row.amount;
      else p.incomePhp += row.amount;
      break;
    case "후원수입":
      if (row.currency === "KRW") p.donationKrw += row.amount;
      else p.donationPhp += row.amount;
      break;
    case "현물후원":
      p.inkindPhp += row.amount;
      break;
    // 지출·금부원지출은 호출부에서 expenseRaw/fundSupportPhp 를 직접 누적한다
    // (반올림 전 원본 소수 합이 필요해서다).
    default:
      break;
  }
}

/** 합계행 라벨인가 ("합", "합계", "지출합계", "TOTAL") */
function isIncomeTotalLabel(s: string): boolean {
  return s === "합" || s === "합계";
}
function isExpenseTotalLabel(g: string, h: string): boolean {
  return g === "합계" || g === "지출합계" || h === "TOTAL";
}

/** 연도 시트 좌측 수입표 + 우측 지출표 */
function parseYearSheet(
  ws: WS,
  year: number,
  rows: ParsedRow[],
  summary: SheetSummary,
  warnings: string[],
): IncomeIndex {
  const sheetName = ws.name;
  const incomeIndex = new IncomeIndex();

  /* ── 수입 (A~E) ── */
  for (let r = 3; r <= ws.rowCount; r++) {
    const bT = textOf(ws, r, 2);
    const cT = textOf(ws, r, 3);
    if (isIncomeTotalLabel(bT) || isIncomeTotalLabel(cT)) {
      // 엑셀 자체 합계행 — 대조표의 기준값
      summary.excel.incomeKrw = numOf(ws, r, 4);
      summary.excel.incomePhp = numOf(ws, r, 5);
      break;
    }
    if (!bT) continue; // 번호(A)만 있는 빈 행

    const raw = collectRaw(ws, r, INCOME_COLS);
    const nd = normalizeDateText(textOf(ws, r, 3), year);
    const rowWarnings = [...nd.warnings];
    if (!nd.methodKnown && cT) {
      rowWarnings.push("수단 미기재 — CASH 기본값");
    }

    const dN = numOf(ws, r, 4);
    const eN = numOf(ws, r, 5);
    const dText = textOf(ws, r, 4);
    if (dN === null && dText) {
      // 예: 2024 r28 D="떡국행사찬조" — 금액이 아니라 메모다. 원본은 raw 에 남는다.
      rowWarnings.push(`D열이 금액이 아님: "${dText}"`);
    }

    const both = dN !== null && eN !== null;
    const base = {
      sheetName,
      rowNo: r,
      blockType: "회비수입" as const,
      refTag: "회비수입",
      raw,
      date: nd.date,
      payerName: rawOf(ws, r, 2).trim(),
      description: "",
      method: nd.method,
    };

    if (dN === null && eN === null) {
      pushRow(rows, summary, buildRow({
        ...base,
        amount: 0,
        amountKnown: false,
        currency: "PHP",
        warnings: [...rowWarnings, "금액 없음 (D·E 모두 빈칸)"],
      }));
      continue;
    }
    if (dN !== null) {
      const round = Math.round(dN);
      pushRow(rows, summary, buildRow({
        ...base,
        refCurrencySuffix: both,
        amount: round,
        amountKnown: true,
        currency: "KRW",
        warnings: [...rowWarnings],
      }));
      incomeIndex.add(base.payerName, "KRW", round, r);
    }
    if (eN !== null) {
      const round = Math.round(eN);
      const w = [...rowWarnings];
      if (eN !== round) w.push(`페소 소수점 반올림: ${eN} → ${round}`);
      pushRow(rows, summary, buildRow({
        ...base,
        refCurrencySuffix: both,
        amount: round,
        amountKnown: true,
        currency: "PHP",
        warnings: w,
      }));
      incomeIndex.add(base.payerName, "PHP", round, r);
    }
  }

  /* ── 지출 (G~J) ── */
  for (let r = 3; r <= ws.rowCount; r++) {
    const gT = textOf(ws, r, 7);
    const hT = textOf(ws, r, 8);
    const iN = numOf(ws, r, 9);
    if (isExpenseTotalLabel(gT, hT)) {
      summary.excel.expense = numOf(ws, r, 9);
      break;
    }
    if (!gT && !hT && iN === null) continue;

    const raw = collectRaw(ws, r, EXPENSE_COLS);
    const nd = normalizeDateText(gT, year);
    const rowWarnings = [...nd.warnings];
    // 지출 행은 원본에 수단 정보가 없다 — CASH 기본, 경고는 내지 않는다(검토 화면에서 수정).
    if (!hT) rowWarnings.push("내역 없음");

    let amount = 0;
    let amountKnown = false;
    if (iN !== null) {
      amount = Math.round(iN);
      amountKnown = true;
      if (iN !== amount) rowWarnings.push(`페소 소수점 반올림: ${iN} → ${amount}`);
      summary.parsed.expenseRaw += iN;
      summary.parsed.expense += amount;
    } else {
      rowWarnings.push("금액 없음");
    }

    const row = buildRow({
      sheetName,
      rowNo: r,
      blockType: "지출",
      refTag: "지출",
      raw,
      date: nd.date,
      payerName: "",
      description: hT,
      amount,
      amountKnown,
      currency: "PHP",
      method: nd.methodKnown ? nd.method : "CASH",
      warnings: rowWarnings,
    });
    // 내역 없는 지출은 무엇에 쓴 돈인지 알 수 없다 — 확인필요로 올린다.
    if (!hT && row.status === "정상") {
      pushRow(rows, summary, { ...row, status: "확인필요" });
    } else {
      pushRow(rows, summary, row);
    }
  }

  /* ── 연도별 추가 블록 ── */
  if (year === 2022) parse2022DonationBlock(ws, rows, summary, incomeIndex, warnings);
  if (year === 2023) parse2023CopyBlock(ws, rows, summary, incomeIndex, warnings);
  if (year === 2024) parse2024DonationBlocks(ws, rows, summary);

  return incomeIndex;
}

/** "50,000원" → KRW / "6000" → PHP / 그 외 텍스트 → null */
function flexibleAmount(t: string): { amount: number; currency: ImportCurrency } | null {
  const won = /^([\d,]+)\s*원$/.exec(t);
  if (won) return { amount: Math.round(Number(won[1].replace(/,/g, ""))), currency: "KRW" };
  const plain = t.replace(/[,\s]/g, "");
  if (/^\d+(\.\d+)?$/.test(plain)) return { amount: Math.round(Number(plain)), currency: "PHP" };
  return null;
}

/**
 * 2022 L~O "사무실 오픈 기부" 블록.
 * 현금 기부는 좌측 수입표에 같은 이름·금액으로 중복 기재돼 있다(멀티셋 대조로 확인).
 * 일치 행은 만들지 않고 건수만 센다. 불일치·현물만 행으로 만든다.
 */
function parse2022DonationBlock(
  ws: WS,
  rows: ParsedRow[],
  summary: SheetSummary,
  incomeIndex: IncomeIndex,
  warnings: string[],
): void {
  const sheetName = ws.name;
  const COLS: readonly [number, string][] = [
    [12, "L"],
    [13, "M"],
    [14, "N"],
  ];
  let section = "";
  const skipped: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const lT = textOf(ws, r, 12);
    const mT = textOf(ws, r, 13);
    const nT = textOf(ws, r, 14);
    if (mT && !lT && !nT) {
      section = mT; // "소프트 오프닝" / "그랜드 오프닝"
      continue;
    }
    if (!lT) continue;
    if (lT === nT && numOf(ws, r, 14) === null) continue; // 병합 제목 행

    const raw = collectRaw(ws, r, COLS);
    const desc = section ? `사무실 오픈 기부(${section})` : "기부";
    const nN = numOf(ws, r, 14);

    if (nN !== null) {
      const amount = Math.round(nN);
      // 기부 블록 N열에는 통화 표기가 없다 — 좌측 페소(E)와 먼저, 없으면 원화(D)와 대조한다.
      // (박지수 100,000 은 좌측에 원화 100,000 으로 실재 — 원화 폴백이 없으면 놓친다)
      let matchedCurrency: ImportCurrency = "PHP";
      let matchedRow = incomeIndex.consume(lT, "PHP", amount);
      if (matchedRow === null) {
        matchedRow = incomeIndex.consume(lT, "KRW", amount);
        matchedCurrency = "KRW";
      }
      if (matchedRow !== null) {
        summary.duplicatesSkipped += 1;
        skipped.push(`r${r}(좌측 r${matchedRow}·${matchedCurrency})`);
        continue;
      }
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "후원수입",
        refTag: "오픈기부",
        raw,
        date: null,
        payerName: rawOf(ws, r, 12).trim(),
        description: desc,
        amount,
        amountKnown: true,
        currency: "PHP",
        method: "CASH",
        warnings: ["우측 기부 블록 — 좌측 수입표에서 같은 이름·금액을 찾지 못함(중복 여부 확인 필요)"],
      }));
    } else if (nT) {
      // 현물 (구충제 1박스, 맥심커피, 인형전시, 비타민, 김밥·치킨 등) — 평가액 없음
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "현물후원",
        refTag: "오픈기부현물",
        raw,
        date: null,
        payerName: rawOf(ws, r, 12).trim(),
        description: `${desc} 현물: ${nT}`,
        amount: 0,
        amountKnown: false,
        currency: "PHP",
        method: "INKIND",
        warnings: ["현물 후원 — 평가액 미기재"],
      }));
    }
  }

  if (skipped.length > 0) {
    warnings.push(
      `[${sheetName}] 우측 L~N 기부 블록 ${skipped.length}건은 좌측 수입표에 같은 이름·금액이 실재해 중복으로 건너뜀: ${skipped.join(", ")}`,
    );
  }
}

/**
 * 2023 L~P — 좌측 수입표의 번호 매긴 부분 사본 (M 이름 / N 한화 / O 페소 / P 비고).
 * 좌측과 일치하면 행을 만들지 않는다. 불일치만 확인필요로 만든다.
 */
function parse2023CopyBlock(
  ws: WS,
  rows: ParsedRow[],
  summary: SheetSummary,
  incomeIndex: IncomeIndex,
  warnings: string[],
): void {
  const sheetName = ws.name;
  const COLS: readonly [number, string][] = [
    [12, "L"],
    [13, "M"],
    [14, "N"],
    [15, "O"],
    [16, "P"],
  ];
  let matched = 0;

  for (let r = 3; r <= ws.rowCount; r++) {
    const mT = textOf(ws, r, 13);
    if (!mT) continue;
    const entries: readonly [ImportCurrency, number | null][] = [
      ["KRW", numOf(ws, r, 14)],
      ["PHP", numOf(ws, r, 15)],
    ];
    for (const [currency, n] of entries) {
      if (n === null) continue;
      const amount = Math.round(n);
      if (incomeIndex.consume(mT, currency, amount) !== null) {
        matched += 1;
        summary.duplicatesSkipped += 1;
        continue;
      }
      // 대조 실패 행: 원본 데이터 자체의 불일치일 수 있으므로 행은 만들되(확인필요),
      // 좌측 표 합계 대조가 흐려지지 않게 시트 합계에는 넣지 않는다.
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "회비수입",
        refTag: "사본",
        refCurrencySuffix: true,
        raw: collectRaw(ws, r, COLS),
        date: null,
        payerName: rawOf(ws, r, 13).trim(),
        description: textOf(ws, r, 16), // P: "이사회비" 등
        amount,
        amountKnown: true,
        currency,
        method: "CASH",
        warnings: ["우측 사본 블록(L~P) — 좌측 수입표와 이름·금액 대조 실패(중복 여부 확인 필요)"],
      }), { skipTotals: true });
    }
  }

  if (matched > 0) {
    warnings.push(
      `[${sheetName}] 우측 L~P 블록은 좌측 수입표의 부분 사본 — 이름·금액 일치 ${matched}건은 행을 만들지 않음`,
    );
  }
}

/**
 * 2024 추가 블록: K~L 족구대회 후원금, N~O 체육대회 현금후원 + 현물후원.
 * 날짜 열이 없으므로 전부 확인필요가 된다(임의 해석 금지).
 *
 * ★ 2022 기부 블록과 달리 **좌측 수입표와 중복 대조를 하지 않는다.**
 *   족구·체육대회 후원금은 별도 주머니로 관리됐고(좌측에는 '족구대회잔여금' 같은
 *   잔액 이월 행만 들어간다), 엑셀 자체 블록 합계(족구 총 48,250)가 이 행들을
 *   포함한다 — 이름·금액이 좌측 회비 행과 우연히 같아도 다른 돈이다.
 */
function parse2024DonationBlocks(
  ws: WS,
  rows: ParsedRow[],
  summary: SheetSummary,
): void {
  const sheetName = ws.name;

  /* ── 족구대회 후원금 (K~L) ── */
  for (let r = 3; r <= ws.rowCount; r++) {
    const kT = textOf(ws, r, 11);
    const lRaw = textOf(ws, r, 12);
    if (!kT) continue;
    if (kT === "총") {
      const v = numOf(ws, r, 12);
      if (v !== null) summary.excel.blocks.push({ label: "족구대회 후원금", rowNo: r, value: v });
      break;
    }
    const raw = collectRaw(ws, r, [[11, "K"], [12, "L"]]);
    const amt = flexibleAmount(lRaw);
    if (amt !== null) {
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "후원수입",
        refTag: "족구후원",
        raw,
        date: null,
        payerName: rawOf(ws, r, 11).trim(),
        description: "족구대회 후원금",
        amount: amt.amount,
        amountKnown: true,
        currency: amt.currency,
        method: "CASH",
        warnings: amt.currency === "KRW" ? [`원화 표기 금액: "${lRaw}"`] : [],
      }));
    } else if (lRaw) {
      // "유니폼" — 현물, 평가액 없음
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "현물후원",
        refTag: "족구후원현물",
        raw,
        date: null,
        payerName: rawOf(ws, r, 11).trim(),
        description: `족구대회 현물 후원: ${lRaw}`,
        amount: 0,
        amountKnown: false,
        currency: "PHP",
        method: "INKIND",
        warnings: ["현물 후원 — 평가액 미기재"],
      }));
    }
  }

  /* ── 체육대회 현금후원 → 현물후원 (N~O) ── */
  let phase: "cash" | "inkind" | "done" = "cash";
  for (let r = 3; r <= ws.rowCount && phase !== "done"; r++) {
    const nT = textOf(ws, r, 14);
    const oT = textOf(ws, r, 15);
    const oN = numOf(ws, r, 15);
    if (!nT) continue;
    if (nT === oT && oN === null) {
      // 병합 제목 행 ("한인 체육대회 현물 후원")
      if (/현물/.test(nT)) phase = "inkind";
      continue;
    }
    if (nT === "총") {
      if (oN !== null) {
        summary.excel.blocks.push({
          label: phase === "cash" ? "체육대회 현금후원" : "체육대회 현물후원",
          rowNo: r,
          value: oN,
        });
      }
      if (phase === "cash") phase = "inkind";
      else phase = "done";
      continue;
    }

    const raw = collectRaw(ws, r, [[14, "N"], [15, "O"]]);
    if (phase === "cash") {
      if (oN === null) continue; // "후원금" 머리글 등
      const amount = Math.round(oN);
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "후원수입",
        refTag: "체육현금",
        raw,
        date: null,
        payerName: rawOf(ws, r, 14).trim(),
        description: "체육대회 현금 후원",
        amount,
        amountKnown: true,
        currency: "PHP",
        method: "CASH",
        warnings: [],
      }));
    } else {
      // 현물 — N 에 후원자·품목이 함께 적혀 있다. 분리하지 않고 원문 그대로 둔다.
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "현물후원",
        refTag: "체육현물",
        raw,
        date: null,
        payerName: rawOf(ws, r, 14).trim(),
        description: "체육대회 현물 후원 (평가액 기재)",
        amount: oN !== null ? Math.round(oN) : 0,
        amountKnown: oN !== null,
        currency: "PHP",
        method: "INKIND",
        warnings: oN === null ? ["현물 후원 — 평가액 미기재"] : [],
      }));
    }
  }
}

/**
 * "금부원 교민지원" 시트.
 *  · B~C: 한화 수입 ("총" 행에서 끝) → 그 아래 페소 지원 항목(금액이 텍스트 안) →
 *    "지출 내역" 표(B 라벨 / C 금액, 빈 라벨 + 숫자 = 합계행)
 *  · E~F: 페소 수입 ("총" 행에서 끝), 그 아래 E="지출" 행이 지출 합계 선언
 *  날짜가 아예 없으므로 전 행이 확인필요다.
 */
function parseFundSheet(
  ws: WS,
  rows: ParsedRow[],
  summary: SheetSummary,
): void {
  const sheetName = ws.name;
  const BC: readonly [number, string][] = [[2, "B"], [3, "C"]];
  const EF: readonly [number, string][] = [[5, "E"], [6, "F"]];

  /* ── 한화 수입 (B~C) ── */
  let krwEndRow = ws.rowCount;
  for (let r = 3; r <= ws.rowCount; r++) {
    const bT = textOf(ws, r, 2);
    if (!bT) continue;
    if (bT === "총") {
      summary.excel.incomeKrw = numOf(ws, r, 3);
      krwEndRow = r;
      break;
    }
    const cN = numOf(ws, r, 3);
    pushRow(rows, summary, buildRow({
      sheetName,
      rowNo: r,
      blockType: "금부원수입",
      refTag: "금부원수입한화",
      raw: collectRaw(ws, r, BC),
      date: null,
      payerName: rawOf(ws, r, 2).trim(),
      description: "금부원 교민지원 기금 수입(한화)",
      amount: cN !== null ? Math.round(cN) : 0,
      amountKnown: cN !== null,
      currency: "KRW",
      method: "CASH",
      warnings: cN === null ? ["금액 없음"] : [],
    }));
  }

  /* ── 페소 수입 (E~F) + 지출 합계 선언 ── */
  for (let r = 3; r <= ws.rowCount; r++) {
    const eT = textOf(ws, r, 5);
    if (!eT) continue;
    if (eT === "총") {
      summary.excel.incomePhp = numOf(ws, r, 6);
      continue;
    }
    if (eT === "지출") {
      summary.excel.expense = numOf(ws, r, 6);
      continue;
    }
    if (eT === "잔액" || eT === "한화잔액") continue;
    const fN = numOf(ws, r, 6);
    if (fN === null) continue;
    pushRow(rows, summary, buildRow({
      sheetName,
      rowNo: r,
      blockType: "금부원수입",
      refTag: "금부원수입페소",
      raw: collectRaw(ws, r, EF),
      date: null,
      payerName: rawOf(ws, r, 5).trim(),
      description: "금부원 교민지원 기금 수입(페소)",
      amount: Math.round(fN),
      amountKnown: true,
      currency: "PHP",
      method: "CASH",
      warnings: [],
    }));
  }

  /* ── '지출 내역' 표 위치 찾기 ── */
  let markerRow = -1;
  for (let r = krwEndRow + 1; r <= ws.rowCount; r++) {
    if (textOf(ws, r, 2) === "지출 내역") {
      markerRow = r;
      break;
    }
  }

  /* ── 페소 지원 항목 (한화 수입 총계와 '지출 내역' 사이, 금액이 텍스트 안) ── */
  const supportEnd = markerRow > 0 ? markerRow - 1 : ws.rowCount;
  for (let r = krwEndRow + 1; r <= supportEnd; r++) {
    const bT = textOf(ws, r, 2);
    const cT = textOf(ws, r, 3);
    if (!bT && !cT) continue;
    const m = /([\d,]+)\s*페소/.exec(cT);
    const amount = m ? Math.round(Number(m[1].replace(/,/g, ""))) : 0;
    const amountKnown = m !== null;
    pushRow(rows, summary, buildRow({
      sheetName,
      rowNo: r,
      blockType: "금부원지출",
      refTag: "금부원지원",
      raw: collectRaw(ws, r, BC),
      date: null,
      payerName: rawOf(ws, r, 2).trim(),
      description: cT ? `교민 지원: ${cT}` : "교민 지원",
      amount,
      amountKnown,
      currency: "PHP",
      // 금액이 "6,000페소(생필품)" 처럼 적힌 건 현금성 집행으로, 품목만 적힌 건("마스크 4박스") 현물로 본다
      method: amountKnown ? "CASH" : "INKIND",
      warnings: amountKnown
        ? ["지원 항목 — 금액을 내역 텍스트에서 추출. 시트 자체 잔액 계산에 포함되지 않아 대사 불일치"]
        : ["지원 항목 — 평가액·금액 미기재"],
    }));
    if (amountKnown) summary.parsed.fundSupportPhp += amount;
  }

  /* ── 지출 내역 표 (B 라벨 / C 금액) ── */
  if (markerRow > 0) {
    for (let r = markerRow + 1; r <= ws.rowCount; r++) {
      const bT = textOf(ws, r, 2);
      const cN = numOf(ws, r, 3);
      if (!bT && cN !== null) break; // 라벨 없는 합계(SUM) 행
      if (!bT && cN === null) continue;
      pushRow(rows, summary, buildRow({
        sheetName,
        rowNo: r,
        blockType: "금부원지출",
        refTag: "금부원지출",
        raw: collectRaw(ws, r, BC),
        date: null,
        payerName: "",
        description: bT,
        amount: cN !== null ? Math.round(cN) : 0,
        amountKnown: cN !== null,
        currency: "PHP",
        method: "CASH",
        warnings: cN === null ? ["금액 없음"] : [],
      }));
      if (cN !== null) {
        summary.parsed.expenseRaw += cN;
        summary.parsed.expense += Math.round(cN);
      }
    }
  }
}

/* ═══════════════════════ 진입점 ═══════════════════════ */

const YEAR_SHEET_RE = /^(\d{4})년 한인회비$/;
const FUND_SHEET_NAME = "금부원 교민지원";

/**
 * 엑셀 버퍼 → 파싱 결과. DB 무접촉.
 * 알 수 없는 시트는 건너뛰고 경고에 남긴다 — 조용히 사라지는 데이터는 없다.
 */
export async function parseLedgerXlsx(data: ArrayBuffer | Uint8Array): Promise<ImportParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs 4.4 의 d.ts 는 Node Buffer 가 아니라 자체 `interface Buffer extends ArrayBuffer {}` 를
  // 기대한다(모듈 밖으로 export 되지 않는다). 런타임은 Node Buffer 를 그대로 받으므로
  // ArrayBuffer 로 캐스팅만 한다 — 구조적으로 동일해 통과한다.
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const rows: ParsedRow[] = [];
  const sheetSummaries: SheetSummary[] = [];
  const warnings: string[] = [];

  for (const ws of wb.worksheets) {
    const yearMatch = YEAR_SHEET_RE.exec(ws.name.trim());
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      const summary = emptySummary(ws.name, year);
      parseYearSheet(ws, year, rows, summary, warnings);
      sheetSummaries.push(summary);
      continue;
    }
    if (ws.name.trim() === FUND_SHEET_NAME) {
      const summary = emptySummary(ws.name, null);
      parseFundSheet(ws, rows, summary);
      sheetSummaries.push(summary);
      continue;
    }
    warnings.push(`알 수 없는 시트 "${ws.name}" — 파싱하지 않음`);
  }

  return { rows, sheetSummaries, warnings };
}

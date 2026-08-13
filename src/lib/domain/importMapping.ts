import { fiscalYearOf } from "./money";
import { cfgNum, cfgStr, type SettingMap } from "./settings";
import { IMPORT_BLOCK_TYPES, type ImportBlockType } from "../validators/enums";

/**
 * 장부 임포트 반영 규칙 — 엑셀 블록 → 05_거래의 과목·기금·계좌·방향 (L3).
 *
 * ★ 순수 함수다. DB 를 모른다. 마스터 행(과목·기금·계좌)과 00_설정 값을 **받아서**
 *   "무엇으로 반영할지" 를 정하거나, 정할 수 없으면 **무엇이 없는지** 를 돌려준다.
 *
 * ── 왜 여기서 기초데이터를 만들지 않는가 ────────────────────────────────
 *  과목 코드·기금·계좌·연도별 환율은 `prisma/realdata-cutover.ts` 가 만든다.
 *  화면이 없는 코드를 즉석에서 create 하면, 총무가 나중에 정식 코드 체계를 넣었을 때
 *  같은 뜻의 과목이 두 벌 생기고 공개 회계가 갈라진다. 그래서 **없으면 거부한다** —
 *  무엇이 없는지 문장으로 알려주고 멈추는 것이 조용히 만들어 내는 것보다 낫다.
 *
 * ── 해석 순서 ────────────────────────────────────────────────────────────
 *  ① 00_설정에 지정 키가 있으면 그 값을 쓴다 (총무가 코드 체계를 바꿔도 따라간다)
 *  ② 없으면 마스터에서 **정식 명칭**으로 찾는다 (cutover 가 만드는 이름)
 *  ③ 그래도 없으면 missing 으로 보고한다. 추측해서 아무 코드나 붙이지 않는다.
 */

/* ═══════════════════════ 블록 → 반영 계획 ═══════════════════════ */

/** 블록이 수입인가 지출인가. */
export const BLOCK_DIRECTION: Readonly<Record<ImportBlockType, "IN" | "OUT">> = {
  회비수입: "IN",
  후원수입: "IN",
  현물후원: "IN",
  금부원수입: "IN",
  지출: "OUT",
  금부원지출: "OUT",
};

/** 어느 기금으로 갈 블록인가. '금부원' 은 지정기금이라 일반회계와 섞이면 안 된다. */
export const BLOCK_FUND: Readonly<Record<ImportBlockType, "일반" | "금부원">> = {
  회비수입: "일반",
  후원수입: "일반",
  현물후원: "일반",
  지출: "일반",
  금부원수입: "금부원",
  금부원지출: "금부원",
};

/** 블록별 과목 해석 규칙 — 설정 키 우선, 없으면 정식 명칭. */
const BLOCK_CATEGORY: Readonly<
  Record<ImportBlockType, { settingKey: string; categoryName: string }>
> = {
  회비수입: { settingKey: "기본.과목코드.회비", categoryName: "회비수입" },
  후원수입: { settingKey: "기본.과목코드.후원금", categoryName: "후원금수입" },
  현물후원: { settingKey: "기본.과목코드.후원금", categoryName: "후원금수입" },
  금부원수입: { settingKey: "기본.과목코드.기부", categoryName: "기부수입" },
  지출: { settingKey: "기본.과목코드.운영지출", categoryName: "운영지출" },
  금부원지출: { settingKey: "기본.과목코드.지원지출", categoryName: "지원지출" },
};

/* ═══════════════════════ 입력 타입 ═══════════════════════ */

export type MasterCategory = { code: string; name: string; majorType: string; isActive: boolean };
export type MasterFund = { fundId: string; name: string; kind: string; status: string };
export type MasterAccount = {
  accountId: string;
  name: string;
  kind: string;
  currency: string;
  status: string;
};

/** 계좌를 고르는 축 — 통화와 수단으로 정해진다. */
export type AccountSlot = "KRW" | "PHP_CASH" | "PHP_BANK" | "INKIND";

/** 이 배치를 반영하는 데 실제로 필요한 것들 (정상 행에서 뽑는다). */
export type ImportNeeds = {
  blocks: ImportBlockType[];
  accountSlots: AccountSlot[];
  /** 원화 행이 있는 회계연도들 — 연도별 환율 설정이 필요하다 */
  krwYears: number[];
};

/** 반영 대상 행에서 "무엇이 필요한가" 를 뽑는다. 화면(준비 상태 표시)과 액션이 같은 함수를 쓴다. */
export function collectImportNeeds(
  rows: readonly { blockType: string; currency: string; method: string; date: string | null }[],
): ImportNeeds {
  const known = new Set<string>(IMPORT_BLOCK_TYPES);
  const blocks = new Set<ImportBlockType>();
  const accountSlots = new Set<AccountSlot>();
  const krwYears = new Set<number>();
  for (const r of rows) {
    if (known.has(r.blockType)) blocks.add(r.blockType as ImportBlockType);
    accountSlots.add(accountSlotOf(r.currency, r.method));
    if (r.currency.toUpperCase() === "KRW" && r.date) krwYears.add(fiscalYearOf(r.date));
  }
  return {
    blocks: [...blocks],
    accountSlots: [...accountSlots],
    krwYears: [...krwYears].sort((a, b) => a - b),
  };
}

export type MissingItem = {
  /** 무엇이 없는가 (화면 목록의 제목) */
  what: string;
  /** 어떻게 채우는가 */
  howToFix: string;
};

export type ImportPlan = {
  /** 블록 → 과목코드 */
  categoryByBlock: Record<string, string>;
  /** '일반' | '금부원' → 기금ID */
  fundByKind: Record<string, string>;
  /** 계좌 슬롯 → 계좌ID */
  accountBySlot: Record<string, string>;
  /** 회계연도 → 원화 환율 (KRW 1원당 페소) */
  fxByYear: Record<number, number>;
};

export type ResolveResult =
  | { ok: true; plan: ImportPlan }
  | { ok: false; missing: MissingItem[] };

/* ═══════════════════════ 해석 ═══════════════════════ */

/** 어느 계좌 슬롯으로 갈 행인가. */
export function accountSlotOf(currency: string, method: string): AccountSlot {
  if (String(method).toUpperCase() === "INKIND") return "INKIND";
  if (String(currency).toUpperCase() === "KRW") return "KRW";
  return String(method).toUpperCase() === "BANK" ? "PHP_BANK" : "PHP_CASH";
}

const SLOT_LABEL: Readonly<Record<AccountSlot, string>> = {
  KRW: "원화(KRW) 수납 계좌",
  PHP_CASH: "페소 현금 계좌",
  PHP_BANK: "페소 은행 계좌",
  INKIND: "현물 후원 전용 계좌",
};

const SLOT_SETTING_KEY: Readonly<Record<AccountSlot, string>> = {
  KRW: "기본.계좌ID.KRW",
  PHP_CASH: "기본.계좌ID.CASH",
  PHP_BANK: "기본.계좌ID.BANK",
  INKIND: "기본.계좌ID.INKIND",
};

/**
 * 반영에 필요한 마스터 코드를 전부 찾는다. 하나라도 없으면 ok:false 다.
 *
 * ★ 부분 성공을 만들지 않는다. "회비만 반영되고 후원은 빠진 장부" 는 대조가 불가능하고,
 *   나중에 나머지를 붙이면 영수증번호 순서가 뒤엉킨다.
 */
export function resolveImportBaseData(
  needs: ImportNeeds,
  master: {
    categories: readonly MasterCategory[];
    funds: readonly MasterFund[];
    accounts: readonly MasterAccount[];
    settings: SettingMap;
  },
): ResolveResult {
  const missing: MissingItem[] = [];
  const categoryByBlock: Record<string, string> = {};
  const fundByKind: Record<string, string> = {};
  const accountBySlot: Record<string, string> = {};
  const fxByYear: Record<number, number> = {};

  const byCode = new Map(master.categories.map((c) => [c.code, c]));
  const byName = new Map(master.categories.map((c) => [c.name, c]));

  /* ── 과목 ── */
  for (const block of unique(needs.blocks)) {
    const rule = BLOCK_CATEGORY[block];
    if (!rule) {
      missing.push({
        what: `블록 "${block}" 의 과목 규칙`,
        howToFix: "코드에 정의되지 않은 블록입니다. 개발자에게 알려 주십시오.",
      });
      continue;
    }
    const wantMajor = BLOCK_DIRECTION[block] === "IN" ? "수입" : "지출";
    const fromSetting = cfgStr(master.settings, rule.settingKey, "");
    const hit = fromSetting ? byCode.get(fromSetting) : byName.get(rule.categoryName);

    if (!hit) {
      missing.push({
        what: `04_과목 "${rule.categoryName}" (${block} 반영용)`,
        howToFix: fromSetting
          ? `00_설정 "${rule.settingKey}" 가 가리키는 과목코드 ${fromSetting} 가 04_과목에 없습니다. 설정을 고치거나 과목을 등록해 주십시오.`
          : `04_과목에 "${rule.categoryName}" 과목을 등록하거나, 00_설정 "${rule.settingKey}" 에 쓸 과목코드를 적어 주십시오.`,
      });
      continue;
    }
    if (hit.majorType !== wantMajor) {
      missing.push({
        what: `04_과목 ${hit.code}(${hit.name}) 대분류 불일치`,
        howToFix: `${block} 은 ${wantMajor} 인데 이 과목은 ${hit.majorType} 입니다. 다른 과목을 지정해 주십시오.`,
      });
      continue;
    }
    if (!hit.isActive) {
      missing.push({
        what: `04_과목 ${hit.code}(${hit.name}) 사용중지`,
        howToFix: "사용여부를 켜거나 다른 과목을 지정해 주십시오.",
      });
      continue;
    }
    categoryByBlock[block] = hit.code;
  }

  /* ── 기금 ── */
  const fundKinds = unique(needs.blocks.map((b) => BLOCK_FUND[b]));
  for (const kind of fundKinds) {
    if (kind === "일반") {
      const fromSetting = cfgStr(master.settings, "기본.기금ID", "");
      const hit = fromSetting
        ? master.funds.find((f) => f.fundId === fromSetting)
        : master.funds.find((f) => f.kind === "일반" && f.status === "ACTIVE");
      if (!hit || hit.status !== "ACTIVE") {
        missing.push({
          what: "03_기금 일반회계",
          howToFix:
            '03_기금에 종류 "일반" 인 활동 기금을 등록하고, 00_설정 "기본.기금ID" 에 그 기금ID 를 적어 주십시오.',
        });
        continue;
      }
      fundByKind[kind] = hit.fundId;
    } else {
      const fromSetting = cfgStr(master.settings, "기본.기금ID.금부원", "");
      const hit = fromSetting
        ? master.funds.find((f) => f.fundId === fromSetting)
        : master.funds.find(
            (f) => f.kind === "지정" && f.status === "ACTIVE" && f.name.includes("금부원"),
          );
      if (!hit || hit.status !== "ACTIVE") {
        missing.push({
          what: "03_기금 금부원 교민지원기금 (지정)",
          howToFix:
            '03_기금에 이름에 "금부원" 이 들어가는 종류 "지정" 기금을 등록하거나, 00_설정 "기본.기금ID.금부원" 에 기금ID 를 적어 주십시오. 지정기금이라 일반회계와 섞을 수 없습니다.',
        });
        continue;
      }
      fundByKind[kind] = hit.fundId;
    }
  }

  /* ── 계좌 ── */
  for (const slot of unique(needs.accountSlots)) {
    const key = SLOT_SETTING_KEY[slot];
    const fromSetting = cfgStr(master.settings, key, "");
    let hit = fromSetting ? master.accounts.find((a) => a.accountId === fromSetting) : undefined;

    if (!fromSetting) {
      // 설정이 비어 있으면 마스터에서 규칙으로 찾는다.
      // ★ 현물(INKIND)은 폴백을 두지 않는다 — 현금 계좌에 얹으면 현금 실사 대사가 통째로 깨진다.
      const active = master.accounts.filter((a) => a.status === "ACTIVE");
      if (slot === "KRW") {
        const krw = active.filter((a) => a.currency.toUpperCase() === "KRW");
        hit = krw.length === 1 ? krw[0] : undefined;
      } else if (slot === "PHP_CASH") {
        hit = active.find((a) => a.currency.toUpperCase() === "PHP" && a.kind === "CASH");
      } else if (slot === "PHP_BANK") {
        hit = active.find((a) => a.currency.toUpperCase() === "PHP" && a.kind === "BANK");
      }
    }

    if (!hit || hit.status !== "ACTIVE") {
      missing.push({
        what: `02_계좌 ${SLOT_LABEL[slot]}`,
        howToFix:
          slot === "INKIND"
            ? `현물 후원은 현금·통장 잔액을 움직이지 않습니다. 별도 계좌(예: "현물 후원")를 등록하고 00_설정 "${key}" 에 그 계좌ID 를 적어 주십시오. 현금 계좌로 대신하면 현금실사 대사(감사 C4)가 깨집니다.`
            : `02_계좌에 해당 계좌를 등록하고 00_설정 "${key}" 에 계좌ID 를 적어 주십시오.`,
      });
      continue;
    }
    accountBySlot[slot] = hit.accountId;
  }

  /* ── 연도별 원화 환율 ── */
  for (const year of unique(needs.krwYears)) {
    const rate = cfgNum(master.settings, `환율.${year}`, 0);
    if (!(rate > 0)) {
      missing.push({
        what: `00_설정 "환율.${year}"`,
        howToFix: `${year}년 원화 고정 환율(원 1원당 페소, 예 0.042)을 00_설정에 넣어 주십시오. 연도별 고정 환율은 대표 결정 사항이라 코드가 임의로 정하지 않습니다.`,
      });
      continue;
    }
    fxByYear[year] = rate;
  }

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, plan: { categoryByBlock, fundByKind, accountBySlot, fxByYear } };
}

/* ═══════════════════════ 행 상태 재계산 ═══════════════════════ */

export type StatusInput = {
  blockType: string;
  date: string | null;
  amount: number;
  description: string;
  /** 이미 반영된 행은 무엇을 고쳐도 '반영됨' 그대로다 */
  currentStatus: string;
};

/**
 * 편집 뒤 행 상태를 다시 정한다 — 파서(buildRow)와 **같은 기준**이다.
 *   · 날짜가 없거나 금액이 0 이하면 확인필요
 *   · 지출인데 내역이 없으면 확인필요 (무엇에 쓴 돈인지 모르는 지출은 반영할 수 없다)
 * 두 기준이 갈라지면 "파서는 확인필요라는데 화면은 정상" 인 행이 생긴다.
 */
export function recomputeRowStatus(r: StatusInput): "정상" | "확인필요" {
  if (!r.date) return "확인필요";
  if (!(r.amount > 0)) return "확인필요";
  if ((r.blockType === "지출" || r.blockType === "금부원지출") && !r.description.trim()) {
    return "확인필요";
  }
  return "정상";
}

/* ═══════════════════════ rawJson 보조 ═══════════════════════ */

/**
 * rawJson 에 함께 저장하는 **파서 원본값** 키 접두.
 * 원본 셀(A·B·C…)과 섞이지 않게 '#' 로 시작한다. 화면은 이 키를 따로 보여주고,
 * "원상복구" 는 여기 값을 되돌려 넣는다 — 원본 파일을 다시 읽지 않아도 된다.
 */
export const PARSED_SNAPSHOT_PREFIX = "#";
export const SNAP_DATE = "#파서날짜";
export const SNAP_AMOUNT = "#파서금액";
export const SNAP_DESC = "#파서내역";
export const SNAP_STATUS = "#파서상태";

/** rawJson 문자열 → { 원본 셀, 파서 스냅샷 } 으로 분리. 깨진 JSON 은 빈 값으로 본다. */
export function splitRawJson(rawJson: string): {
  cells: Record<string, string>;
  snapshot: Record<string, string>;
} {
  const cells: Record<string, string> = {};
  const snapshot: Record<string, string> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson || "{}");
  } catch {
    return { cells, snapshot };
  }
  if (!parsed || typeof parsed !== "object") return { cells, snapshot };
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const s = typeof v === "string" ? v : String(v ?? "");
    if (k.startsWith(PARSED_SNAPSHOT_PREFIX)) snapshot[k] = s;
    else cells[k] = s;
  }
  return { cells, snapshot };
}

/* ═══════════════════════ 대조표 ═══════════════════════ */

export type ReconLine = {
  sheetName: string;
  label: string;
  /** 파서가 계산한 값 */
  parsed: number;
  /** 엑셀 합계행에 적혀 있던 값 */
  excel: number;
  match: boolean;
  /** 지출처럼 소수가 섞이는 항목의 반올림 후 정수 합 (없으면 null) */
  roundedNote: string | null;
};

export type ReconSummary = { lines: ReconLine[]; matched: number; total: number };

/**
 * 시트별 대조표 — "파서 합계 vs 엑셀 자체 합계행".
 *
 * ★ 지출은 **반올림 전 원본 소수 합(expenseRaw)** 으로 대조한다.
 *   엑셀 합계행은 소수를 그대로 더한 값이고, 파서는 행마다 페소로 반올림해 저장한다
 *   (05_거래 금액은 정수 페소다). 반올림 후 합을 대조하면 2022·2024 처럼 1~2페소가
 *   어긋나 "장부가 틀렸다" 로 보인다 — 실제로 틀린 것은 없고 반올림 차이일 뿐이다.
 *   그래서 대조는 원본 소수로 하고, 반올림 차이는 별도 문구로 보여 준다.
 */
export function buildReconSummary(
  summaries: readonly {
    sheetName: string;
    parsed: { incomeKrw: number; incomePhp: number; expenseRaw: number; expense: number };
    excel: { incomeKrw: number | null; incomePhp: number | null; expense: number | null };
  }[],
): ReconSummary {
  const lines: ReconLine[] = [];
  for (const s of summaries) {
    if (s.excel.incomeKrw !== null) {
      lines.push(line(s.sheetName, "수입 합계 (원화)", s.parsed.incomeKrw, s.excel.incomeKrw, null));
    }
    if (s.excel.incomePhp !== null) {
      lines.push(line(s.sheetName, "수입 합계 (페소)", s.parsed.incomePhp, s.excel.incomePhp, null));
    }
    if (s.excel.expense !== null) {
      const diff = s.parsed.expense - s.excel.expense;
      lines.push(
        line(
          s.sheetName,
          "지출 합계 (페소)",
          s.parsed.expenseRaw,
          s.excel.expense,
          Math.abs(diff) >= 0.5
            ? `행별 페소 반올림 후 정수 합 ${s.parsed.expense} (원본 대비 ${diff > 0 ? "+" : ""}${Math.round(diff)})`
            : null,
        ),
      );
    }
  }
  return { lines, matched: lines.filter((l) => l.match).length, total: lines.length };
}

function line(
  sheetName: string,
  label: string,
  parsed: number,
  excel: number,
  roundedNote: string | null,
): ReconLine {
  // 엑셀 합계는 부동소수(402189.71300000005)라 정확 비교를 하면 항상 틀린다. 0.005페소 이내면 같다.
  return { sheetName, label, parsed, excel, match: Math.abs(parsed - excel) < 0.005, roundedNote };
}

/* ═══════════════════════ 유틸 ═══════════════════════ */

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

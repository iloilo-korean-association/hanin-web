import type { Db } from "../db";
import { toInt } from "./money";
import { DEFAULT_APPROVAL_CONFIG, type ApprovalConfig } from "./approval";
import type { PayeePolicy } from "../validators/enums";

/**
 * 00_설정 읽기.
 *
 * 원본: 02_노코드MVP/AppsScript/00_공통_유틸.gs 의 cfgStr_ / cfgNum_ / cfgList_ / 안전설정_
 *
 * ★ 값이 없으면 여기 적힌 기본값이 쓰인다. 시트 시절과 같은 계약이다.
 *   "설정에 없으면 터진다" 로 만들면 설정 한 줄이 빠졌을 때 공개 회계가 통째로 안 열린다.
 */

export type SettingMap = Map<string, string>;

/** Setting 행들을 Map 으로. 서버 컴포넌트에서 한 번 읽어 아래 함수들에 넘긴다. */
export function toSettingMap(rows: readonly { key: string; value: string }[]): SettingMap {
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function loadSettings(db: Db): Promise<SettingMap> {
  const rows = await db.setting.findMany({ select: { key: true, value: true } });
  return toSettingMap(rows);
}

export function cfgStr(s: SettingMap, key: string, fallback: string): string {
  const v = s.get(key);
  if (v === undefined || v === null) return fallback;
  const t = String(v).trim();
  if (!t || t.startsWith("CHANGE_ME")) return fallback;
  return t;
}

export function cfgNum(s: SettingMap, key: string, fallback: number): number {
  const v = s.get(key);
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function cfgBool(s: SettingMap, key: string, fallback: boolean): boolean {
  const v = s.get(key);
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  return String(v).trim().toUpperCase() === "Y";
}

/** '2025,2024' → ['2025','2024'] */
export function cfgList(s: SettingMap, key: string): string[] {
  return String(s.get(key) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 설정에서 승인 임계값 묶음을 만든다. */
export function approvalConfigFrom(s: SettingMap): ApprovalConfig {
  return {
    clerkSoleLimit: cfgNum(s, "결재선.총무단독한도", DEFAULT_APPROVAL_CONFIG.clerkSoleLimit),
    presidentLimit: cfgNum(s, "결재선.회장승인한도", DEFAULT_APPROVAL_CONFIG.presidentLimit),
    auditorNoticeLimit: cfgNum(s, "결재선.감사통보기준", DEFAULT_APPROVAL_CONFIG.auditorNoticeLimit),
    boardMajorityLimit: cfgNum(s, "결재선.이사회과반한도", DEFAULT_APPROVAL_CONFIG.boardMajorityLimit),
    boardTwoThirdsLimit: cfgNum(s, "결재선.이사회23한도", DEFAULT_APPROVAL_CONFIG.boardTwoThirdsLimit),
    cashPaymentLimit: cfgNum(s, "결재선.현금상한", DEFAULT_APPROVAL_CONFIG.cashPaymentLimit),
    noticeDays: cfgNum(s, "결재선.공고일수", DEFAULT_APPROVAL_CONFIG.noticeDays),
    sysSoleLimit: cfgNum(s, "승인한도.총무", DEFAULT_APPROVAL_CONFIG.sysSoleLimit),
    sysSecondStageLimit: cfgNum(s, "승인한도.2차필요기준", DEFAULT_APPROVAL_CONFIG.sysSecondStageLimit),
    relatedPartyForcesTwoStage: cfgBool(s, "승인.이해관계자_2차강제", true),
  };
}

/** 공개 회계 표시 정책. */
export function publicPolicyFrom(s: SettingMap): {
  showMemo: boolean;
  maskNames: boolean;
  payeePolicy: PayeePolicy;
  maxExpenseRows: number;
  receiptPrefix: string;
  showVendorOwnerName: boolean;
  showBizDirectory: boolean;
} {
  const raw = cfgStr(s, "공개.수취인_개인표기", "마스킹");
  const payeePolicy: PayeePolicy = raw === "전체" ? "전체" : raw === "숨김" ? "숨김" : "마스킹";
  return {
    showMemo: cfgBool(s, "공개.적요공개", true),
    // ★ 끄지 마라. N 으로 두면 회원 실명이 로그인 없는 공개 화면에 그대로 나간다.
    maskNames: cfgBool(s, "공개.적요_실명마스킹", true),
    payeePolicy,
    maxExpenseRows: cfgNum(s, "공개.지출목록_최대", 300),
    receiptPrefix: cfgStr(s, "영수증번호.접두", "IKA"),
    showVendorOwnerName: cfgBool(s, "공개.업소_대표자명공개", false),
    showBizDirectory: cfgBool(s, "공개.업소디렉터리", true),
  };
}

/** 환율표. 거래를 새로 만들 때 스냅샷으로 복사해 넣는다. */
export function fxTableFrom(s: SettingMap): Record<string, number> {
  return {
    PHP: 1,
    KRW: cfgNum(s, "환율.KRW_PHP", 0.0417),
    USD: cfgNum(s, "환율.USD_PHP", 58.5),
  };
}

/** 회비 단가표. '회비단가.정회원' → 1200 */
export function duesTableFrom(s: SettingMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of s) {
    if (k.startsWith("회비단가.")) out[k.slice("회비단가.".length)] = toInt(v);
  }
  return out;
}

/** 현금 2인 확인 임계액 (I4). */
export function cashThresholdFrom(s: SettingMap): number {
  return cfgNum(s, "현금2인확인_임계액", 3000);
}

/**
 * 긴급 핫라인.
 * ★ 값이 비었거나 CHANGE_ME 인 동안은 "핫라인 준비 중" 으로 정직하게 표시한다.
 *   받지도 않는 번호를 24시간 받는다고 쓰지 않기 위해서다.
 *   필리핀 전국 긴급번호는 **911** 이다 (117 은 2016년 폐기).
 */
export function hotlineFrom(s: SettingMap): { number: string | null; ready: boolean; fallback: "911" } {
  const raw = String(s.get("웹앱.긴급핫라인") ?? "").trim();
  const ready = !!raw && !raw.startsWith("CHANGE_ME");
  return { number: ready ? raw : null, ready, fallback: "911" };
}

/** 홈 화면 공지 1~3. 형식 "yyyy-MM-dd|제목|내용". 코드는 3개만 읽는다. */
export function noticesFrom(s: SettingMap): { date: string; title: string; body: string }[] {
  const out: { date: string; title: string; body: string }[] = [];
  for (const i of [1, 2, 3]) {
    const raw = String(s.get(`웹앱.공지${i}`) ?? "").trim();
    if (!raw) continue;
    const [date = "", title = "", body = ""] = raw.split("|");
    if (!title) continue;
    out.push({ date: date.trim(), title: title.trim(), body: body.trim() });
  }
  return out;
}

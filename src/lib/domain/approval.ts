import { toInt, formatMoney, formatPeso } from "./money";
import type { ApprovalFinalStatus, ApprovalResult, RequiredStages } from "../validators/enums";
import type { ConflictVerdict, OfficerRow } from "./conflict";
import { isRecused } from "./conflict";

/**
 * 결재선·승인단계 판정.
 *
 * 원본: 02_노코드MVP/AppsScript/13_웹앱_임원.gs 의 결재선판정_ 과 승인 처리부의 결재 흔적 검증.
 *       규정 원본: 03_거버넌스문서/승인한도표.md
 *
 * ★ 두 개의 서로 다른 숫자 체계가 공존한다. 임의로 하나로 합치지 않는다.
 *   (가) 규정상 결재선 : 2,000 / 10,000 / 20,000 / 50,000 / 200,000 구간.
 *        사람이 지켜야 하는 절차다. 화면에 크게 보여준다.
 *   (나) 시스템 승인단계: 승인한도.총무(3,000) / 승인한도.2차필요기준(30,000).
 *        Approval.requiredStages 에 0·1·2 로 저장되고 승인 화면이 이 값을 본다.
 *   두 체계가 어긋나는 구간(예: ₱2,500 — 규정은 회장 승인, 시스템은 전결)이 **실제로 있다.**
 *   숨기지 않고 화면에 경고로 띄운다. [확인 필요] 총회에서 두 숫자를 맞추는 것이 정답이다.
 */

/** Setting 에서 읽어 넘기는 임계값 묶음. 기본값은 00_설정_초기값.md 와 같다. */
export type ApprovalConfig = {
  /** 결재선.총무단독한도 */
  clerkSoleLimit: number;
  /** 결재선.회장승인한도 */
  presidentLimit: number;
  /** 결재선.감사통보기준 */
  auditorNoticeLimit: number;
  /** 결재선.이사회과반한도 */
  boardMajorityLimit: number;
  /** 결재선.이사회23한도 */
  boardTwoThirdsLimit: number;
  /** 결재선.현금상한 */
  cashPaymentLimit: number;
  /** 결재선.공고일수 */
  noticeDays: number;
  /** 승인한도.총무 — 시스템 전결 한도 */
  sysSoleLimit: number;
  /** 승인한도.2차필요기준 */
  sysSecondStageLimit: number;
  /** 승인.이해관계자_2차강제 */
  relatedPartyForcesTwoStage: boolean;
};

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  clerkSoleLimit: 2000,
  presidentLimit: 10000,
  auditorNoticeLimit: 20000,
  boardMajorityLimit: 50000,
  boardTwoThirdsLimit: 200000,
  cashPaymentLimit: 5000,
  noticeDays: 14,
  sysSoleLimit: 3000,
  sysSecondStageLimit: 30000,
  relatedPartyForcesTwoStage: true,
};

export type ApprovalRoute = {
  amountPhp: number;
  /** 금액 구간 표기 "2,001 ~ 10,000" */
  band: string;
  relatedParty: boolean;
  /** 실제 적용되는 결재선 (이해관계면 가중결재선) */
  route: string;
  /** 평시 결재선 */
  normalRoute: string;
  /** 이해관계자 가중 결재선 */
  weightedRoute: string;
  /** 필요한 견적서 수 */
  quotesRequired: number;
  /** 지급 방법 제한 */
  paymentMethod: string;
  /** 사전 공개 공고가 필요한가 */
  noticeRequired: boolean;
  noticeDays: number;
  /** 시스템 승인단계 0(전결)/1/2 */
  requiredStages: RequiredStages;
  /** 화면에 띄울 경고들 */
  warnings: string[];
};

/**
 * 금액 구간별 결재선 + 시스템 승인단계.
 * 원본 결재선판정_ 을 그대로 옮겼다.
 */
export function decideApprovalRoute(
  amountPhp: unknown,
  relatedParty: boolean,
  cfg: ApprovalConfig = DEFAULT_APPROVAL_CONFIG,
): ApprovalRoute {
  const A = cfg.clerkSoleLimit;
  const B = cfg.presidentLimit;
  const C = cfg.auditorNoticeLimit;
  const D = cfg.boardMajorityLimit;
  const E = cfg.boardTwoThirdsLimit;
  const n = toInt(amountPhp);

  let band: string;
  let normalRoute: string;
  let weightedRoute: string;
  let quotes: number;
  let paymentMethod: string;

  if (n <= A) {
    band = `~ ${formatMoney(A)}`;
    normalRoute = "총무 단독";
    weightedRoute = "회장 승인 + 이사회 의결(과반)";
    quotes = 0;
    paymentMethod = "현금 가능";
  } else if (n <= B) {
    band = `${formatMoney(A + 1)} ~ ${formatMoney(B)}`;
    normalRoute = "총무 기안 → 회장 승인";
    weightedRoute = "이사회 의결(과반)";
    quotes = 0;
    paymentMethod = `계좌이체 (현금은 ${formatPeso(cfg.cashPaymentLimit)} 까지)`;
  } else if (n <= C) {
    band = `${formatMoney(B + 1)} ~ ${formatMoney(C)}`;
    normalRoute = "총무 기안 → 회장 승인 → 감사 사전 통보";
    weightedRoute = "이사회 의결(과반) + 감사 의견서";
    quotes = 2;
    paymentMethod = "계좌이체 only";
  } else if (n <= D) {
    band = `${formatMoney(C + 1)} ~ ${formatMoney(D)}`;
    normalRoute = "이사회 의결(과반)";
    weightedRoute = "이사회 의결(2/3) + 감사 의견서";
    quotes = 3;
    paymentMethod = "계좌이체 (2인 서명)";
  } else if (n <= E) {
    band = `${formatMoney(D + 1)} ~ ${formatMoney(E)}`;
    normalRoute = "이사회 의결(2/3) + 감사 의견서";
    weightedRoute = "총회 의결";
    quotes = 3;
    paymentMethod = "계좌이체 (2인 서명)";
  } else {
    band = `${formatMoney(E + 1)} ~`;
    normalRoute = `총회 의결 + ${cfg.noticeDays}일 공개 공고`;
    weightedRoute = "총회 의결 + 사전 공개 공고 필수";
    quotes = 3;
    paymentMethod = "계좌이체 (2인 서명)";
  }

  const rp = !!relatedParty;
  // 가중규칙 D: 이해관계면 견적 최소 2곳
  const quotesRequired = rp ? Math.max(2, quotes) : quotes;

  // ---- 시스템 승인단계 ----
  let stages: RequiredStages = 0;
  if (n > cfg.sysSecondStageLimit) stages = 2;
  else if (n > cfg.sysSoleLimit) stages = 1;
  if (rp && cfg.relatedPartyForcesTwoStage) stages = 2;

  const warnings: string[] = [];
  if (n > A && stages === 0) {
    warnings.push(
      `규정상으로는 "${normalRoute}" 가 필요한 금액인데, 설정의 승인한도.총무(${formatMoney(cfg.sysSoleLimit)})가 ` +
        `승인한도표의 총무 단독 한도(${formatMoney(A)})보다 커서 시스템은 전결(0단계)로 계산합니다. ` +
        `회장 승인을 별도로 받아 두십시오.`,
    );
  }
  if (rp) {
    warnings.push(
      "이해관계자 거래입니다. 금액과 무관하게 이사회 의결이 필요하고, 해당 임원은 논의·표결에서 퇴장합니다(recusal). 사후 추인 대상이 아닙니다.",
    );
  }
  if (n > cfg.cashPaymentLimit) {
    warnings.push(
      `1건 ${formatPeso(cfg.cashPaymentLimit)} 초과는 현금으로 지급할 수 없습니다. 계좌이체 또는 GCash 를 쓰십시오.`,
    );
  }

  return {
    amountPhp: n,
    band,
    relatedParty: rp,
    route: rp ? weightedRoute : normalRoute,
    normalRoute,
    weightedRoute,
    quotesRequired,
    paymentMethod,
    noticeRequired: n > E,
    noticeDays: cfg.noticeDays,
    requiredStages: stages,
    warnings,
  };
}

/** 화면에 늘 띄워 두는 구간표 (승인한도표 1번 표). */
export function approvalBands(cfg: ApprovalConfig = DEFAULT_APPROVAL_CONFIG): ApprovalRoute[] {
  return [0, cfg.clerkSoleLimit + 1, cfg.presidentLimit + 1, cfg.auditorNoticeLimit + 1, cfg.boardMajorityLimit + 1, cfg.boardTwoThirdsLimit + 1].map(
    (v) => decideApprovalRoute(v, false, cfg),
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * 결재 흔적 검증 — 집행(POSTED) 직전에 서버가 다시 본다
 * ════════════════════════════════════════════════════════════════════════ */

export type ApprovalRecord = {
  approvalId: string;
  amountPhp: number;
  relatedParty: boolean;
  requiredStages: number;
  approver1: string;
  result1: string;
  approver2: string;
  result2: string;
  finalStatus: string;
  quoteUrl?: string | null;
};

export type TrailCheck = { ok: true } | { ok: false; reason: string };

/**
 * 결재 흔적이 실제로 남아 있는가.
 *
 * ★ 전결(requiredStages = 0) 처리에 주의.
 *   원본에는 `toInt_(r['필요승인단계']) || 1` 로 폴백하던 버그가 있었다 —
 *   전결은 0 인데 `0 || 1 === 1` 이라 1단계로 승격되고, 전결 건의 1차결과는 '불필요' 라서
 *   "1차 승인이 없다" 로 잘못 걸렸다. 여기서는 폴백하지 않는다.
 *
 * ★ 전결이라고 결재 없이 통과시키지 않는다. **정말 전결 한도 안인지 다시 계산한다** —
 *   임원이 승인이 난 뒤 금액이나 필요승인단계를 올려 쓸 수 있기 때문이다.
 */
export function checkApprovalTrail(
  ap: ApprovalRecord,
  cfg: ApprovalConfig = DEFAULT_APPROVAL_CONFIG,
): TrailCheck {
  const stages = toInt(ap.requiredStages);
  const amount = toInt(ap.amountPhp);

  if (stages === 0) {
    // 전결. 결재자가 없는 것이 정상이다. 대신 정말 전결 한도 안인지 다시 계산한다.
    const r1 = String(ap.result1 ?? "").trim();
    if (r1 && r1 !== "불필요" && r1 !== "승인") {
      return {
        ok: false,
        reason: `전결(필요승인단계 0) 건인데 1차결과가 "${r1 || "(빈칸)"}" 입니다. 자료가 어긋납니다.`,
      };
    }
    const recomputed = decideApprovalRoute(amount, ap.relatedParty, cfg);
    if (recomputed.requiredStages !== 0) {
      return {
        ok: false,
        reason:
          `전결 한도(${formatPeso(cfg.sysSoleLimit)})를 넘거나 이해관계자인 ${formatPeso(amount)} 건이 ` +
          `필요승인단계 0 으로 되어 있습니다. 결재를 건너뛰려는 시도로 보입니다.`,
      };
    }
    return { ok: true };
  }

  if (!String(ap.approver1 ?? "").trim() || String(ap.result1 ?? "").trim() !== "승인") {
    return { ok: false, reason: "1차 승인이 없습니다. 승인 없는 지출은 장부에 반영할 수 없습니다." };
  }

  if (stages >= 2) {
    if (!String(ap.approver2 ?? "").trim() || String(ap.result2 ?? "").trim() !== "승인") {
      return {
        ok: false,
        reason: "2차 승인이 없습니다. 이 건은 이사회(감사 포함) 2차 승인이 필요합니다.",
      };
    }
    if (String(ap.approver1).trim().toLowerCase() === String(ap.approver2).trim().toLowerCase()) {
      return { ok: false, reason: "1차와 2차 승인자가 같은 사람입니다. 2단계 승인이 아닙니다." };
    }
  }

  if (String(ap.finalStatus ?? "").trim() === "반려") {
    return { ok: false, reason: "반려된 승인입니다." };
  }

  const route = decideApprovalRoute(amount, ap.relatedParty, cfg);
  if (route.quotesRequired > 0 && !String(ap.quoteUrl ?? "").trim()) {
    return {
      ok: false,
      reason: `이 구간은 견적서 ${route.quotesRequired}곳 이상이 필요합니다. 견적서가 첨부되지 않았습니다.`,
    };
  }

  return { ok: true };
}

/* ════════════════════════════════════════════════════════════════════════
 * 지금 이 임원이 무엇을 할 수 있는가
 * ════════════════════════════════════════════════════════════════════════ */

export type ActionCheck = {
  /** 승인 버튼을 눌러도 되는가 */
  canApprove: boolean;
  /** 내가 처리할 차수 */
  stage: 1 | 2 | null;
  /** 못 누르는 이유 (버튼 옆에 그대로 보여준다) */
  blockedReason: string;
  /** 이해상충 회피 대상이라 막힌 것인가 */
  recused: boolean;
};

/** 권한 문자열('승인권,조회권')에 특정 권한이 있는가. */
export function hasPermission(permissions: string, want: string): boolean {
  return String(permissions ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(want);
}

/**
 * 이 임원이 이 승인 건을 지금 승인할 수 있는가.
 *
 * ★ 이해상충 당사자면 **승인 버튼 비활성(recusal)**. 화면에서 숨기는 것으로 끝내지 말고
 *   서버의 승인 처리 경로에서도 이 함수를 다시 불러라.
 * ★ 승인한도표 제6조 ④ — 회장이 당사자면 "회장 승인" 단계 자체가 무효다. 이사회가 의결한다.
 */
export function canOfficerApprove(
  me: OfficerRow,
  ap: ApprovalRecord,
  verdict: ConflictVerdict,
): ActionCheck {
  // ★ recused 는 **어느 분기로 빠지든 항상 정확해야 한다.**
  //   화면이 "이 임원은 회피 대상" 배지를 이 값으로 그리기 때문이다.
  //   먼저 계산해서 모든 return 에 실어 보낸다 — 예전에는 "이미 집행됨" 분기가 먼저 걸리면
  //   recused 가 false 로 나가서, 이미 집행된 이해관계 건을 다시 열었을 때 회피 사실이 사라졌다.
  const recused = isRecused(me, verdict);
  const base: ActionCheck = { canApprove: false, stage: null, blockedReason: "", recused };

  if (String(me.status).toUpperCase() !== "ACTIVE") {
    return { ...base, blockedReason: "임기 중이 아닌 임원입니다." };
  }
  if (!hasPermission(me.permissions, "승인권")) {
    return { ...base, blockedReason: "승인권이 없는 직책입니다(감사는 조회권만 가집니다)." };
  }
  if (String(ap.finalStatus).trim() === "집행완료") {
    return {
      ...base,
      blockedReason: recused
        ? "이미 집행이 끝난 건입니다. (귀하는 이 건의 이해관계 당사자로 회피 대상이었습니다.)"
        : "이미 집행이 끝난 건입니다.",
    };
  }
  if (String(ap.finalStatus).trim() === "반려") {
    return { ...base, blockedReason: "반려된 건입니다." };
  }

  if (recused) {
    return {
      ...base,
      blockedReason:
        `귀하는 이 건의 이해관계 당사자입니다(${verdict.vendorName ?? verdict.conflictId ?? "관련 업체"}). ` +
        `논의·표결·기권 모두 불가하며 퇴장해야 합니다(승인한도표 3-C).`,
    };
  }
  if (verdict.undetermined) {
    return {
      ...base,
      blockedReason:
        "이해상충을 판정할 수 없습니다(수취인 정보 부족). 판정할 수 없는 건은 승인하지 않습니다. 수취인을 정확히 적어 다시 상신하십시오.",
    };
  }

  const stages = toInt(ap.requiredStages);
  if (stages === 0) {
    return { ...base, blockedReason: "전결 건입니다. 승인 없이 총무가 집행합니다." };
  }

  let stage: 1 | 2 | null = null;
  if (String(ap.result1).trim() !== "승인") stage = 1;
  else if (stages >= 2 && String(ap.result2).trim() !== "승인") stage = 2;

  if (stage === null) {
    return { ...base, blockedReason: "필요한 결재가 모두 끝났습니다. 이제 집행 단계입니다." };
  }
  if (stage === 2 && String(ap.approver1).trim().toLowerCase() === me.email.trim().toLowerCase()) {
    return { ...base, blockedReason: "1차를 승인한 사람이 2차까지 승인할 수 없습니다." };
  }

  // 단계 1 = 이 한 사람의 승인으로 확정된다 → 개인 승인한도를 넘으면 단독 승인 불가.
  if (stage === 1 && stages === 1 && me.approvalLimit > 0 && toInt(ap.amountPhp) > me.approvalLimit) {
    return {
      ...base,
      stage,
      blockedReason:
        `이 건(${formatPeso(ap.amountPhp)})은 귀하의 승인한도 ${formatPeso(me.approvalLimit)} 를 넘습니다. ` +
        `상위 결재선으로 올리십시오.`,
    };
  }

  // 여기까지 왔으면 recused 는 false 다 (위에서 걸렀다).
  return { canApprove: true, stage, blockedReason: "", recused };
}

/** 1차·2차 결과로부터 최종상태를 계산한다. */
export function computeFinalStatus(
  requiredStages: number,
  result1: ApprovalResult,
  result2: ApprovalResult,
  executed: boolean,
): ApprovalFinalStatus {
  if (executed) return "집행완료";
  if (result1 === "반려" || result2 === "반려") return "반려";
  if (requiredStages === 0) return "승인";
  if (requiredStages === 1) return result1 === "승인" ? "승인" : "대기";
  return result1 === "승인" && result2 === "승인" ? "승인" : "대기";
}

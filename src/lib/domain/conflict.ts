import { conflictNormalize, nameLooseMatch, extractOwnershipPct } from "./normalize";

/**
 * 이해상충 판정.
 *
 * 원본: 02_노코드MVP/AppsScript/13_웹앱_임원.gs 의 이해상충판정_ · 이름부분일치_ · 이해상충_당사자_
 *
 * ★ 이 조직에서 이해상충은 가정이 아니라 실재다.
 *   대표는 일로일로에서 7개 사업을 운영한다(PIA어학원 · 스픽클 · 에이워크유학원 ·
 *   로펌(배우자) · 빌드앤셀 주택개발 · 에어비앤비 34유닛 · 오톤 하드웨어).
 *   한인회 지출 상대방이 그중 하나면 대표(회장)는 그 건의 승인 버튼을 누를 수 없어야 한다.
 *
 * ★ 순수 함수다. DB 를 모른다 — 호출자가 업소·이해상충 행을 읽어 넘긴다.
 *   그래야 테스트할 수 있고, 서버 컴포넌트에서도 API 라우트에서도 같은 판정이 나온다.
 */

export type VendorRow = {
  vendorId: string;
  name: string;
  /** 같은 업소의 다른 표기를 `|` 로 구분. 로마자 상호 등. 자세한 이유는 schema.prisma 의 Vendor.aliases 주석 참조. */
  aliases?: string | null;
  industry?: string | null;
  relatedMemberNo?: string | null;
  relatedParty: boolean;
  ownershipPct?: number | null;
};

/**
 * 업소의 대조 대상 이름 전부(본명 + 별칭)를 정규화해 돌려준다.
 *
 * conflictNormalize 는 부호·전각·제로폭·자모분해를 지우지만 **문자 체계는 못 바꾼다.**
 * "OTON Hardware" 와 "오톤 하드웨어" 는 정규화해도 영영 만나지 않으므로,
 * 별칭을 사람이 등록해 두는 것 말고는 방법이 없다.
 */
export function vendorNames(name: string, aliases?: string | null): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const n = conflictNormalize(s);
    if (n && out.indexOf(n) < 0) out.push(n);
  };
  push(name);
  for (const a of String(aliases ?? "").split("|")) push(a);
  return out;
}

export type ConflictRow = {
  conflictId: string;
  declarerMemberNo: string;
  declarerName: string;
  role?: string | null;
  counterpartyName: string;
  relationType: string;
  vendorId?: string | null;
  detail?: string | null;
  disclosed: boolean;
  recused?: boolean;
  ownershipPct?: number | null;
};

export type OfficerRow = {
  officerId: string;
  memberNo: string;
  name: string;
  role: string;
  email: string;
  approvalLimit: number;
  permissions: string;
  status: string;
};

/** 이 판정에 얽힌 임원 한 명 */
export type RelatedOfficer = {
  memberNo: string;
  name: string;
  role: string;
  email: string;
  ownershipPct: number | null;
};

export type ConflictVerdict = {
  /** 이해관계자 거래인가 */
  related: boolean;
  /**
   * ★ 판정 실패 = "이해관계자가 없다" 가 아니라 **"있는지 없는지 알 수 없다"**.
   *   true 면 호출자는 반드시 안전한 쪽(이해관계자로 간주 + 결재 차단)으로 기울여야 한다.
   */
  undetermined: boolean;
  reasons: string[];
  conflictId: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** 회피(recusal) 대상 임원들 */
  relatedOfficers: RelatedOfficer[];
  /** 배지에 찍을 지분율 (여러 건이면 최대값). 모르면 null — 지어내지 않는다 */
  ownershipPct: number | null;
};

export type ConflictInput = {
  /** 수취인(상대방) 이름. 승인 화면의 구조화 열에서 온다 */
  counterpartyName?: string | null;
  /** 매칭된 업소가 있으면 그 ID */
  vendorId?: string | null;
};

/**
 * 수취인이 임원 관련인지 업소·이해상충 두 표에서 찾는다.
 *
 * ★ 공시여부(disclosed)='N' 인 신고도 **건너뛰지 않는다.**
 *   아직 공시하지 않은 관계라도 회피(recusal) 대상인 것은 마찬가지이기 때문이다.
 *   (공개 화면에 목록으로 내보낼 때만 disclosed 로 거른다 — ledger.ts 참조)
 *
 * ★ 이름 부분일치를 쓴다. 과다 탐지는 안전한 실패다. 미탐지가 위험하다.
 */
export function evaluateConflict(
  input: ConflictInput,
  vendors: readonly VendorRow[],
  conflicts: readonly ConflictRow[],
  officers: readonly OfficerRow[],
): ConflictVerdict {
  const out: ConflictVerdict = {
    related: false,
    undetermined: false,
    reasons: [],
    conflictId: null,
    vendorId: String(input.vendorId ?? "").trim() || null,
    vendorName: null,
    relatedOfficers: [],
    ownershipPct: null,
  };

  const rawName = String(input.counterpartyName ?? "").trim();
  const name = conflictNormalize(rawName);

  // 부호를 다 지우고 나니 빈 문자열이 됐다면(수취인을 '---' 로 적은 경우)
  // "아무것도 안 걸림 = 깨끗함" 으로 흘러가면 안 된다. 판정 불가로 명시한다.
  if (!name && rawName) {
    out.undetermined = true;
    out.reasons.push(`수취인명 "${rawName}" 이 부호로만 이루어져 대조할 수 없습니다.`);
  }
  // 판정할 재료가 아예 없는 경우. 빈 문자열로 조회하면 아무것도 안 걸리고 "깨끗함" 처럼 보인다 —
  // 그게 정확히 예전 정규식 우회가 만들어 낸 상태다.
  if (!name && !out.vendorId) {
    out.undetermined = true;
    out.reasons.push("수취인과 업소ID 가 모두 비어 있어 이해상충을 판정할 수 없습니다.");
  }

  const officerByMemberNo = new Map(officers.map((o) => [o.memberNo, o]));
  const pcts: number[] = [];

  const addOfficer = (memberNo: string | null | undefined, fallbackRole: string, pct: number | null) => {
    const no = String(memberNo ?? "").trim();
    if (!no) return;
    if (pct !== null && pct !== undefined) pcts.push(pct);
    const existing = out.relatedOfficers.find((p) => p.memberNo === no);
    if (existing) {
      if (existing.ownershipPct === null && pct !== null) existing.ownershipPct = pct;
      return;
    }
    const row = officerByMemberNo.get(no);
    out.relatedOfficers.push({
      memberNo: no,
      name: row?.name ?? "",
      role: row?.role ?? fallbackRole ?? "",
      email: (row?.email ?? "").trim().toLowerCase(),
      ownershipPct: pct,
    });
  };

  /* ---- 14_업소 ---- */
  for (const v of vendors) {
    const id = String(v.vendorId ?? "").trim();
    // 상호 본명과 별칭(로마자 표기 등)을 **모두** 대조한다.
    // 정규화만으로는 문자 체계가 다른 표기("OTON Hardware" vs "오톤 하드웨어")를 잡을 수 없다.
    const hit =
      (out.vendorId && id && id === out.vendorId) ||
      vendorNames(v.name, v.aliases).some((n) => nameLooseMatch(name, n));
    if (!hit) continue;
    if (!out.vendorId) out.vendorId = id;
    if (!out.vendorName) out.vendorName = v.name;
    if (v.relatedParty) {
      out.related = true;
      out.reasons.push(
        `업소 대장에 이해관계 업체로 등록돼 있습니다 — ${v.name} (${id}, ${v.industry || "업종 미기재"})`,
      );
      addOfficer(v.relatedMemberNo, "", v.ownershipPct ?? null);
    }
  }

  /* ---- 13_이해상충 ---- */
  for (const c of conflicts) {
    const other = conflictNormalize(c.counterpartyName);
    const vid = String(c.vendorId ?? "").trim();
    const hit = (out.vendorId && vid && vid === out.vendorId) || nameLooseMatch(name, other);
    if (!hit) continue;
    out.related = true;
    if (!out.conflictId) out.conflictId = c.conflictId;
    out.reasons.push(
      `이해상충 신고 ${c.conflictId || "(번호없음)"} — ${c.declarerName} ${c.role ?? ""}` +
        ` / 관계: ${c.relationType || "(미기재)"}` +
        (c.disclosed ? "" : " · 아직 공시되지 않은 신고입니다"),
    );
    const pct = c.ownershipPct ?? extractOwnershipPct(`${c.detail ?? ""} ${c.relationType ?? ""}`);
    addOfficer(c.declarerMemberNo, c.role ?? "", pct);
  }

  out.ownershipPct = pcts.length ? Math.max(...pcts) : null;
  return out;
}

/**
 * 이 임원이 판정 결과의 당사자인가 — 승인 버튼을 비활성(recusal)하는 근거.
 *
 * ★ 화면에서 버튼을 숨기는 것은 통제가 아니다. 서버의 승인 처리 경로에서도 이 함수를 다시 부른다.
 */
export function isRecused(
  me: { memberNo?: string | null; email?: string | null } | null | undefined,
  verdict: ConflictVerdict,
): boolean {
  if (!me) return false;
  const myNo = String(me.memberNo ?? "").trim();
  const myEmail = String(me.email ?? "").trim().toLowerCase();
  return verdict.relatedOfficers.some(
    (p) => (myNo && p.memberNo && p.memberNo === myNo) || (myEmail && p.email && p.email === myEmail),
  );
}

/** 배지 문구. "박정우 회장 · 지분 100%" */
export function conflictBadgeText(verdict: ConflictVerdict): string {
  if (!verdict.related && !verdict.undetermined) return "";
  if (verdict.undetermined) return "이해관계 판정 불가";
  const parts: string[] = [];
  const first = verdict.relatedOfficers[0];
  if (first) parts.push(`${first.name || "임원"}${first.role ? " " + first.role : ""}`);
  if (verdict.ownershipPct !== null) parts.push(`지분 ${verdict.ownershipPct}%`);
  return parts.length ? parts.join(" · ") : "이해관계자 거래";
}

/**
 * 공개 화면(업소 디렉터리·공개 회계)에 내보낼 이해상충 목록.
 * ★ 여기서만 disclosed 로 거른다. 판정(evaluateConflict)은 거르지 않는다.
 */
export function publicDisclosures(conflicts: readonly ConflictRow[]): ConflictRow[] {
  return conflicts
    .filter((c) => c.disclosed)
    .slice()
    .sort((a, b) => (a.conflictId < b.conflictId ? 1 : -1));
}

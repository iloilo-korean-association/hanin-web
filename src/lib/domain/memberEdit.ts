/**
 * 임원 회원 정보 수정 (/officer/members/[회원번호]) 의 판정 규칙 — 순수 함수. DB 를 모른다.
 *
 * 서버 액션(officer/(secure)/members/[memberNo]/actions.ts)은 DB 를 읽어 여기 넘기고,
 * 결과대로 쓰고, 감사로그를 남기는 일만 한다. 규칙을 바꾸려면 이 파일을 고친다.
 *
 *   memberTypeForGrade   — 회비등급 → 회원구분 (회원구분은 등급을 따라간다)
 *   diffMemberEdit       — 무엇이 바뀌었나 (감사로그 1건 = 바뀐 필드 1개)
 *   statusTransition     — 탈퇴 / 탈퇴 취소 판정
 *   decideGradeInvoice   — 회비등급이 바뀌었을 때 올해 회비고지를 어떻게 할지
 *   editLocks            — 시스템 계정·본인 계정 잠금
 */
import type { DuesGrade } from "../validators/enums";
import { isSystemMemberNo } from "./dues";

/* ════════════════════════════════════════════════════════════════════════
 * 회원구분 ↔ 회비등급
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 회비등급 → 01_회원.회원구분.
 *
 * 등급이 원인이고 구분은 결과다 — 등급이 더 잘게 나뉘어 있기 때문이다('학생' 은 등급에만 있다).
 * 예전 가입 폼(join/constants.ts 의 memberTypeOf, 2026-10-22 삭제)과 같은 대응이고,
 * 그 폼에 없던 '명예'(한인회가 부여, 회비규정 제6조 ② 면제)만 명예 → 명예 로 더했다.
 *   정회원 → 정회원 · 준회원 → 준회원 · 학생 → 준회원 · 명예 → 명예 · 법인 → 법인
 * 그래서 임원 화면은 등급만 고르게 하고, 구분은 이 함수가 정한다(서로 어긋난 조합을 못 만든다).
 */
export const MEMBER_TYPE_BY_GRADE: Readonly<Record<DuesGrade, string>> = {
  정회원: "정회원",
  준회원: "준회원",
  학생: "준회원",
  명예: "명예",
  법인: "법인",
};

export function memberTypeForGrade(grade: string): string | null {
  return (MEMBER_TYPE_BY_GRADE as Record<string, string>)[grade] ?? null;
}

/**
 * 저장할 회원구분. **등급이 바뀔 때만** 등급을 따라간다.
 * 등급을 그대로 두면 기존 구분도 그대로 둔다 — 연락처만 고쳤는데 옛 데이터의 구분이
 * 조용히 바뀌는 일을 막는다(현재 운영 DB 에서 어긋난 조합은 시스템 계정 M9999 하나뿐).
 */
export function nextMemberType(before: { duesGrade: string; memberType: string }, newGrade: string): string {
  if (newGrade === before.duesGrade) return before.memberType;
  return memberTypeForGrade(newGrade) ?? before.memberType;
}

/* ════════════════════════════════════════════════════════════════════════
 * 바뀐 필드
 * ════════════════════════════════════════════════════════════════════════ */

/** 임원이 고칠 수 있는 01_회원 칸 (+ 등급을 따라가는 회원구분). */
export type MemberEditable = {
  name: string;
  phone: string;
  email: string;
  birthYear: number | null;
  region: string;
  memberType: string;
  duesGrade: string;
  note: string;
  rosterConsent: boolean;
  notifyConsent: boolean;
  status: string;
};

export type MemberEditField = keyof MemberEditable;

/** 순서 = 화면·감사로그에 나오는 순서. 라벨은 01_회원 원장 열 이름(회원 본인 수정의 감사로그와 같은 표기). */
export const MEMBER_EDIT_FIELDS: readonly { field: MemberEditField; label: string; severity: "INFO" | "WARN" }[] = [
  { field: "name", label: "성명", severity: "INFO" },
  { field: "phone", label: "연락처", severity: "INFO" },
  { field: "email", label: "이메일", severity: "INFO" },
  { field: "birthYear", label: "출생연도", severity: "INFO" },
  { field: "region", label: "주소_지역", severity: "INFO" },
  // 돈·자격이 걸린 칸 — WARN (마스터 확정 규칙)
  { field: "duesGrade", label: "회비등급", severity: "WARN" },
  { field: "memberType", label: "회원구분", severity: "WARN" },
  { field: "status", label: "상태", severity: "WARN" },
  { field: "note", label: "비고", severity: "INFO" },
  { field: "rosterConsent", label: "명부공개동의", severity: "INFO" },
  { field: "notifyConsent", label: "알림수신동의", severity: "INFO" },
];

export type MemberEditDiff = {
  field: MemberEditField;
  label: string;
  /** 감사로그에 그대로 들어가는 문자열. 불리언은 Y/N, 출생연도 null 은 "" (회원 본인 수정과 같은 표기) */
  before: string;
  after: string;
  severity: "INFO" | "WARN";
};

function show(field: MemberEditField, v: MemberEditable[MemberEditField]): string {
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (field === "birthYear") return v === null || v === undefined ? "" : String(v);
  return String(v ?? "");
}

/** 바뀐 칸만. 하나도 없으면 빈 배열 → 저장하지 않는다. */
export function diffMemberEdit(before: MemberEditable, after: MemberEditable): MemberEditDiff[] {
  const out: MemberEditDiff[] = [];
  for (const { field, label, severity } of MEMBER_EDIT_FIELDS) {
    const b = show(field, before[field]);
    const a = show(field, after[field]);
    if (b !== a) out.push({ field, label, before: b, after: a, severity });
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * 상태 전이
 * ════════════════════════════════════════════════════════════════════════ */

export type StatusTransition = {
  changed: boolean;
  /** → WITHDRAWN. 같은 트랜잭션에서 회원증(MemberCard 행)을 지우고, 커밋 뒤 사진 파일을 지운다 */
  withdrawing: boolean;
  /** WITHDRAWN → 다른 상태. 허용한다. 사진은 이미 지워졌으므로 회원이 다시 올려야 한다 */
  reinstating: boolean;
};

/** 네 상태(ACTIVE/INACTIVE/WITHDRAWN/중복확인필요) 사이의 모든 전이를 허용한다. 막는 것은 없다. */
export function statusTransition(before: string, after: string): StatusTransition {
  const changed = before !== after;
  return {
    changed,
    withdrawing: changed && after === "WITHDRAWN",
    reinstating: changed && before === "WITHDRAWN",
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * 회비등급 변경 → 올해 회비고지
 * ════════════════════════════════════════════════════════════════════════ */

export type GradeInvoiceRow = {
  invoiceId: string;
  duesGrade: string;
  billedAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  status: string;
  exemptReason: string;
};

export const GRADE_EXEMPT_REASON = "회비 단가 0원 등급";

export type GradeInvoiceDecision =
  /** 설정 '회계연도' 의 고지가 없다 — 아무것도 하지 않는다 */
  | { kind: "no-invoice" }
  /**
   * 미납(납부 0) 고지를 새 등급 단가로 고친다. 단가 0 이면 면제로 바꾸고 회원 기간을 오늘부터 준다.
   * set 은 고지에 그대로 쓸 값. 이미 같은 값이면 호출자가 쓰지 않는다(changes 가 빈 배열).
   */
  | {
      kind: "reprice";
      invoiceId: string;
      set: { duesGrade: string; billedAmount: number; unpaidAmount: number; status: string; exemptReason: string };
      changes: { field: "duesGrade" | "billedAmount" | "unpaidAmount" | "status" | "exemptReason"; before: string; after: string }[];
      becomesExempt: boolean;
    }
  /** 고지는 그대로 둔다 — 화면 경고 + 감사로그 WARN */
  | { kind: "keep"; invoiceId: string; reason: "paid" | "exempt" | "no-rate" | "fy-closed"; message: string };

/**
 * 회비등급이 바뀌었을 때 올해(설정 '회계연도') 고지를 어떻게 할지.
 *
 *   고지 없음                        → no-invoice (아무것도 안 함)
 *   회계연도 마감(I5)                → keep(fy-closed)
 *   일부라도 납부(paid > 0) 또는 완납·부분납 → keep(paid) — 차액 처리는 총무가 판단
 *   면제 고지                        → keep(exempt) — 면제 사유(가족 회비·명예 등)를 등급 변경이 지우지 않는다
 *   새 등급 단가가 설정에 없음        → keep(no-rate) — 0원으로 간주해 면제로 만드는 사고를 막는다
 *   미납이고 납부 0                  → reprice: 고지·미납금액 = 새 단가.
 *                                       새 단가 0 이면 상태 면제 · 면제사유 '회비 단가 0원 등급'
 */
export function decideGradeInvoice(input: {
  invoice: GradeInvoiceRow | null;
  newGrade: string;
  /** duesTableFrom(settings)[newGrade] — 없으면 undefined */
  newRate: number | undefined;
  fyClosed: boolean;
}): GradeInvoiceDecision {
  const inv = input.invoice;
  if (!inv) return { kind: "no-invoice" };

  if (input.fyClosed) {
    return {
      kind: "keep",
      invoiceId: inv.invoiceId,
      reason: "fy-closed",
      message: `올해 고지(${inv.invoiceId})의 회계연도가 마감(또는 회계연도 미등록) 상태라 고지는 바꾸지 않았습니다.`,
    };
  }

  const status = String(inv.status).trim();
  if (inv.paidAmount > 0 || status === "완납" || status === "부분납") {
    return {
      kind: "keep",
      invoiceId: inv.invoiceId,
      reason: "paid",
      message:
        `올해 고지(${inv.invoiceId}, ${status} · 납부 ₱${inv.paidAmount.toLocaleString("en-US")})는 이미 납부가 있어 바꾸지 않았습니다 — 차액 처리는 총무가 판단해 주십시오.`,
    };
  }

  if (status === "면제") {
    return {
      kind: "keep",
      invoiceId: inv.invoiceId,
      reason: "exempt",
      message:
        `올해 고지(${inv.invoiceId})는 면제 상태라 바꾸지 않았습니다` +
        (inv.exemptReason ? `(면제사유: ${inv.exemptReason})` : "") +
        " — 새 등급으로 회비를 부과할지는 총무가 판단해 주십시오.",
    };
  }

  if (status !== "미납") {
    // 알 수 없는 상태 문자열 — 손대지 않는다(안전한 쪽)
    return {
      kind: "keep",
      invoiceId: inv.invoiceId,
      reason: "paid",
      message: `올해 고지(${inv.invoiceId})의 상태가 '${status}' 라 바꾸지 않았습니다 — 총무가 확인해 주십시오.`,
    };
  }

  const rate = input.newRate;
  if (rate === undefined || !Number.isInteger(rate) || rate < 0) {
    return {
      kind: "keep",
      invoiceId: inv.invoiceId,
      reason: "no-rate",
      message: `설정에 '회비단가.${input.newGrade}' 가 없어 올해 고지(${inv.invoiceId})는 바꾸지 않았습니다.`,
    };
  }

  const becomesExempt = rate === 0;
  const set = {
    duesGrade: input.newGrade,
    billedAmount: rate,
    unpaidAmount: rate - inv.paidAmount, // paidAmount 는 여기서 언제나 0
    status: becomesExempt ? "면제" : "미납",
    exemptReason: becomesExempt ? GRADE_EXEMPT_REASON : inv.exemptReason,
  };
  const changes: Extract<GradeInvoiceDecision, { kind: "reprice" }>["changes"] = [];
  const cmp = (field: (typeof changes)[number]["field"], b: string | number, a: string | number) => {
    if (String(b) !== String(a)) changes.push({ field, before: String(b), after: String(a) });
  };
  cmp("duesGrade", inv.duesGrade, set.duesGrade);
  cmp("billedAmount", inv.billedAmount, set.billedAmount);
  cmp("unpaidAmount", inv.unpaidAmount, set.unpaidAmount);
  cmp("status", inv.status, set.status);
  cmp("exemptReason", inv.exemptReason, set.exemptReason);

  return { kind: "reprice", invoiceId: inv.invoiceId, set, changes, becomesExempt };
}

/* ════════════════════════════════════════════════════════════════════════
 * 잠금
 * ════════════════════════════════════════════════════════════════════════ */

export type EditLocks = {
  /** 아무것도 못 고친다 (M9xxx 시스템 계정) */
  all: string | null;
  /** 회비등급·상태를 못 고친다 (임원 본인의 회원 행) */
  gradeAndStatus: string | null;
};

/**
 * · M9xxx — 시스템 계정(M9999 관리자 등, 실제 사람이 아니다). 화면에서도 서버에서도 수정 거부.
 * · 본인 — 임원이 **자기 회원 행**의 회비등급·상태를 바꾸면 스스로 회비를 면제(명예 0원)하거나
 *   상태를 정할 수 있다. 임원관리(본인 권한 수정 금지)·확인권(본인 거래 확인 금지)과 같은 이유로
 *   다른 임원이 바꾸게 한다. 이름·연락처·동의 등은 본인도 고칠 수 있다.
 */
export function editLocks(memberNo: string, editorMemberNo: string | null | undefined): EditLocks {
  if (isSystemMemberNo(memberNo)) {
    return { all: "시스템 계정(M9xxx)은 실제 회원이 아니라 수정할 수 없습니다.", gradeAndStatus: null };
  }
  if (editorMemberNo && editorMemberNo === memberNo) {
    return {
      all: null,
      gradeAndStatus: "본인의 회비등급·상태는 직접 바꿀 수 없습니다. 다른 임원(회원관리 권한)에게 요청해 주십시오.",
    };
  }
  return { all: null, gradeAndStatus: null };
}

/**
 * 인가 관문 — 모든 쓰기 경로는 여기를 통과한다.
 *
 * ★ 화면에서 버튼을 숨기는 것은 통제가 아니다.
 *   서버 액션·Route Handler 의 **첫 줄**에서 requireOfficer / requireMember 를 부른다.
 *   호출을 빠뜨린 쓰기 경로는 통제가 없는 것과 같다.
 *
 * 왜 매 요청마다 DB 를 읽는가:
 *   세션 쿠키에는 신원(임원ID)만 들어 있다. 직책·권한·승인한도·임기·상태는
 *   12_임원 테이블이 유일한 진실이다. 총무가 감사로 바뀌거나 임기가 끝나면
 *   다음 요청부터 즉시 반영돼야 한다.
 */
import "server-only";

import { readMemberSession, readOfficerSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidMemberTokenFormat, parsePermissions, type OfficerPermission } from "@/lib/session";
import { MONEY_PERMISSIONS } from "@/lib/validators";

/* ═══════════════════════════ 에러 ═══════════════════════════ */

export type GuardCode =
  | "UNAUTHENTICATED" // 로그인 안 함
  | "NOT_OFFICER" // 세션은 있는데 임원 행이 없다(삭제·교체됨)
  | "INACTIVE" // 상태 ≠ ACTIVE
  | "TERM_EXPIRED" // 임기 종료 / 아직 시작 전
  | "READ_ONLY" // 감사 역할이 쓰기 시도
  | "NO_PERMISSION" // 권한 부족
  | "OVER_LIMIT" // 승인한도 초과
  | "RECUSED" // 이해상충 회피 대상
  | "BAD_TOKEN" // 회원 링크토큰 형식 오류
  | "NO_MEMBER" // 토큰에 해당하는 회원 없음
  | "MEMBER_INACTIVE"; // 탈퇴 회원

/**
 * message 는 화면에 그대로 보여도 되는 문장이다.
 * howToFix 는 "그래서 어떻게 하면 되는가" — 이게 없으면 사용자는 총무에게 전화한다.
 */
export class GuardError extends Error {
  readonly code: GuardCode;
  readonly status: number;
  readonly howToFix: string | null;

  constructor(code: GuardCode, message: string, status: number, howToFix: string | null = null) {
    super(message);
    this.name = "GuardError";
    this.code = code;
    this.status = status;
    this.howToFix = howToFix;
  }
}

export function isGuardError(e: unknown): e is GuardError {
  return e instanceof GuardError;
}

/* ═══════════════════════════ 임원 ═══════════════════════════ */

/** requireOfficer 가 돌려주는 것. Prisma 행 타입을 화면으로 그대로 흘리지 않는다. */
export interface OfficerContext {
  /** 12_임원.임원ID (OF01 …) — 감사로그·승인 행에 남기는 값이자 PK */
  officerId: string;
  /** 12_임원.회원번호 — 임원도 회원이다. 이해상충 대조 키. */
  memberNo: string;
  name: string;
  /** 직책: 회장 / 부회장 / 총무 / 감사 / 이사 / 지역반장 */
  role: string;
  email: string;
  permissions: OfficerPermission[];
  /** 12_임원.승인한도 (PHP 정수) */
  approvalLimit: number;
  /** 감사 계정인가 = 쓰기 금지 대상인가 */
  isAuditor: boolean;
  can: (p: OfficerPermission) => boolean;
}

/**
 * 감사 판정 — 직책과 권한 둘 다 본다.
 *
 * 왜 둘 다 보는가(Apps Script 판 감사역할_() 과 같은 이유):
 *   직책을 '감사위원' 으로 적는 사람이 있고, 반대로 직책은 '이사' 인데
 *   권한 칸에는 조회권만 있는 사람도 있다. 한쪽만 보면 반드시 뚫린다.
 */
export function computeIsAuditor(role: string, permissions: readonly OfficerPermission[]): boolean {
  if (role.includes("감사")) return true;
  // ★ '돈' 권한만 본다. 자료 관리 권한(업소·행사·연락처·임원관리)은 판정에 넣지 않는다.
  //   감사에게 업소관리를 주더라도 **돈에 대해서는 여전히 읽기 전용**이어야 하는데,
  //   전체 권한을 보면 업소관리 하나 때문에 감사 판정이 풀려 수납·승인이 열린다.
  const money = permissions.filter((p) => MONEY_PERMISSIONS.includes(p as never));
  return money.length > 0 && money.every((p) => p === "조회권");
}

function toContext(row: {
  officerId: string;
  memberNo: string;
  name: string;
  role: string;
  email: string;
  permissions: string;
  approvalLimit: number;
}): OfficerContext {
  const permissions = parsePermissions(row.permissions);
  return {
    officerId: row.officerId,
    memberNo: row.memberNo,
    name: row.name,
    role: row.role,
    email: row.email,
    permissions,
    approvalLimit: row.approvalLimit,
    isAuditor: computeIsAuditor(row.role, permissions),
    can: (p) => permissions.includes(p),
  };
}

export interface RequireOfficerOptions {
  /**
   * 이 중 **하나라도** 가지고 있으면 통과. 비우면 임원이기만 하면 통과.
   * (Apps Script 판 임원권한보유_() 와 같은 OR 규칙)
   */
  permissions?: OfficerPermission[];
  /**
   * true 면 쓰기 경로다 → 감사 계정을 거부한다.
   * 데이터를 바꾸는 모든 서버 액션은 반드시 write: true 로 부른다.
   */
  write?: boolean;
  /**
   * 감사 계정에게도 이 쓰기를 허용한다. **극히 좁게만 쓴다.**
   *
   * 유일한 정당한 용도는 **감사 본인의 확인 도장**이다 (Transaction.reviewedBy/reviewedAt).
   * 사전 승인 절차를 없앤 뒤로 통제가 "입력 전 결재" 에서 "입력 후 감사" 로 옮겨졌는데,
   * 감사가 아무것도 못 쓰면 그 확인을 기록할 자리가 없다.
   *
   * ★ 이 옵션을 켠 액션은 **장부 값(금액·과목·상대방·상태)을 절대 건드리면 안 된다.**
   *   건드리는 순간 "감사가 장부를 고칠 수 있으면 감사가 아니다" 가 깨진다.
   *   지금 이 옵션을 쓰는 곳은 reviewTransactionAction 하나뿐이다.
   */
  allowAuditorAttestation?: boolean;
  /** 거부 메시지에 찍히는 화면 이름. 예: "수납 기록" */
  screen?: string;
}

/**
 * 로그인한 임원을 돌려준다. 조건에 안 맞으면 GuardError 를 던진다.
 *
 * 서버 액션 사용 예:
 *   "use server";
 *   export async function 수납기록(formData: FormData) {
 *     const me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "수납 기록" });
 *     const input = 수납스키마.parse(Object.fromEntries(formData));
 *     …  // me.officerId 를 입력자로 남긴다
 *   }
 */
export async function requireOfficer(opts: RequireOfficerOptions = {}): Promise<OfficerContext> {
  const screen = opts.screen ?? "이 화면";
  const session = await readOfficerSession();
  if (!session) {
    throw new GuardError(
      "UNAUTHENTICATED",
      "로그인이 필요합니다.",
      401,
      "임원 로그인 화면에서 이메일과 비밀번호로 로그인하십시오.",
    );
  }

  const row = await prisma.officer.findUnique({
    where: { officerId: session.sub },
    select: {
      officerId: true,
      memberNo: true,
      name: true,
      role: true,
      email: true,
      permissions: true,
      approvalLimit: true,
      status: true,
      termStart: true,
      termEnd: true,
    },
  });

  if (!row) {
    throw new GuardError(
      "NOT_OFFICER",
      "임원 정보를 찾을 수 없습니다. 다시 로그인해 주십시오.",
      403,
      "임원 명부에서 계정이 제거되었을 수 있습니다. 회장 또는 총무에게 문의하십시오.",
    );
  }

  if (row.status !== "ACTIVE") {
    throw new GuardError(
      "INACTIVE",
      `비활성 상태의 임원 계정입니다 (${row.name} · ${row.role}).`,
      403,
      "12_임원 상태를 ACTIVE 로 되돌려야 합니다. 변경은 회장·총무가 하며 그 자체가 감사 대상입니다.",
    );
  }

  // 임기 검사 — 임기가 끝난 임원의 결재는 무효다(재무회계규정).
  // termStart/termEnd 는 'yyyy-MM-dd' 문자열이다. 같은 형식끼리는 문자열 비교로
  // 날짜 비교가 성립하므로 Date 로 파싱하지 않는다(타임존 사고를 원천 차단).
  const today = todayIso();
  if (row.termStart && row.termStart > today) {
    throw new GuardError(
      "TERM_EXPIRED",
      `임기가 아직 시작되지 않았습니다 (시작: ${row.termStart}).`,
      403,
      null,
    );
  }
  if (row.termEnd && row.termEnd < today) {
    throw new GuardError(
      "TERM_EXPIRED",
      `임기가 종료된 임원 계정입니다 (종료: ${row.termEnd}).`,
      403,
      "임기를 연장하거나 후임 임원으로 인수인계해야 합니다(18_인수인계).",
    );
  }

  const me = toContext(row);

  // 감사는 읽기 전용. 쓰기 함수를 부르면 서버에서 거부한다.
  // 예외는 감사 본인의 확인 도장 하나뿐이다(allowAuditorAttestation 주석 참조).
  if (opts.write && me.isAuditor && !opts.allowAuditorAttestation) {
    throw new GuardError(
      "READ_ONLY",
      `감사(${me.role || "조회 전용"}) 계정은 읽기 전용입니다. ${screen}에서 저장할 수 없습니다.`,
      403,
      "입력이 필요하면 총무에게 요청하십시오. 감사가 직접 입력하면 감사의 독립성이 깨집니다.",
    );
  }

  const need = opts.permissions ?? [];
  if (need.length > 0 && !need.some((p) => me.permissions.includes(p))) {
    throw new GuardError(
      "NO_PERMISSION",
      `${screen} — "${need.join('" 또는 "')}" 권한이 필요합니다.`,
      403,
      `현재 직책: ${me.role || "(미기재)"} / 보유 권한: ${me.permissions.join(", ") || "(없음)"}. ` +
        "권한 변경은 회장·총무가 12_임원 권한 칸에서 합니다.",
    );
  }

  return me;
}

/** 로그인 안 했으면 null. 헤더에 이름을 띄우는 정도의 용도. 통제에 쓰지 마라. */
export async function currentOfficer(): Promise<OfficerContext | null> {
  try {
    return await requireOfficer();
  } catch {
    return null;
  }
}

/* ═══════════════════════ 회피 ═══════════════════════ */

/*
 * assertApprovalLimit 은 삭제했다.
 *
 * 사전 승인 절차(요청 → 결재 → 집행)를 없애면서 "지금 이 사람이 누르는 승인 버튼이
 * 유효한가" 를 물을 자리가 사라졌다. 부르는 곳이 없는 가드를 남겨 두면
 * 다음 사람이 "승인한도가 아직 동작한다" 고 믿고 그 위에 기능을 얹는다.
 *
 * Officer.approvalLimit 컬럼과 domain/approval.ts 는 남겨 두었다 —
 * 총회가 결재선을 되살리기로 하면 그때 다시 붙일 수 있어야 하기 때문이다.
 */

/**
 * 이해상충 회피(recusal) 강제.
 *
 * 지출 상대방이 임원 관련 업체이면 그 임원은 자기 건을 승인할 수 없다.
 * 화면에서 버튼을 비활성화하는 것만으로는 부족하다 — 폼을 직접 POST 하면 뚫린다.
 * 그래서 서버 승인 경로에서 한 번 더 막는다.
 *
 * 판정은 domain/conflict.ts 의 evaluateConflict() → isRecused() 가 한다.
 * 이 함수는 그 결과를 받아 "던지는" 역할만 한다.
 *
 *   const verdict = evaluateConflict({ … });
 *   assertNotRecused(me, isRecused(me, verdict), conflictBadgeText(verdict));
 *
 * ★ verdict.undetermined 가 true 면(판정 불가) 호출자는 반드시 안전한 쪽으로
 *   기울여 recused=true 로 넘겨야 한다. "모르겠다" 는 "괜찮다" 가 아니다.
 */
export function assertNotRecused(
  me: OfficerContext,
  recused: boolean,
  reason = "이 건의 상대방과 이해관계가 있습니다",
): void {
  if (recused) {
    throw new GuardError(
      "RECUSED",
      `${me.name}(${me.role}) 님은 이 건을 승인할 수 없습니다 — ${reason}.`,
      403,
      "이해상충 관리규정에 따라 해당 임원은 심의·의결에서 빠집니다. 다른 승인권자가 처리해야 합니다.",
    );
  }
}

/* ═══════════════════════════ 회원 ═══════════════════════════ */

export interface MemberContext {
  /** 01_회원.회원번호 — 이 테이블의 PK 다 */
  memberNo: string;
  name: string;
  email: string;
  status: string;
  /** 명부공개동의 — false 면 어떤 공개 화면에도 이름이 나가면 안 된다 */
  rosterConsent: boolean;
  notifyConsent: boolean;
  linkToken: string;
}

/**
 * 링크토큰으로 회원을 특정한다.
 *
 * ★ 인자로 받은 회원번호는 절대 믿지 마라.
 *   화면·폼·쿼리스트링에 회원번호가 실려 와도 무시하고, **토큰으로 조회한 결과만** 쓴다.
 *   회원번호는 M0001 처럼 순차라서 옆 사람 것을 넣어보는 데 3초면 된다.
 *
 * 서버 액션 사용 예:
 *   const me = await requireMember(token);
 *   await prisma.member.update({ where: { memberNo: me.memberNo }, data: { phone } });
 *                                        ^^^^^^^^^^^^ 폼에서 온 값이 아니라 토큰에서 나온 값
 */
export async function requireMember(token: string): Promise<MemberContext> {
  const t = (token ?? "").trim();

  // DB 를 두들기기 전에 형식부터 거른다.
  if (!isValidMemberTokenFormat(t)) {
    throw new GuardError(
      "BAD_TOKEN",
      "회원 링크가 올바르지 않습니다.",
      400,
      "가입 환영 메일이나 영수증 메일에 들어 있는 '내 정보' 링크를 다시 눌러 주십시오. " +
        "링크를 잃어버렸다면 총무에게 재발송을 요청하십시오.",
    );
  }

  const row = await prisma.member.findUnique({
    where: { linkToken: t },
    select: {
      memberNo: true,
      name: true,
      email: true,
      status: true,
      rosterConsent: true,
      notifyConsent: true,
      linkToken: true,
    },
  });

  if (!row) {
    // 존재하지 않는 토큰과 폐기된 토큰을 구분해서 알려주지 않는다.
    throw new GuardError(
      "NO_MEMBER",
      "회원 링크가 올바르지 않거나 더 이상 사용할 수 없습니다.",
      404,
      "총무에게 링크 재발송을 요청하십시오.",
    );
  }

  if (row.status === "WITHDRAWN") {
    throw new GuardError(
      "MEMBER_INACTIVE",
      "탈퇴 처리된 회원입니다.",
      403,
      "다시 가입하시려면 회원 가입 화면을 이용해 주십시오.",
    );
  }

  return row;
}

/** 토큰이 틀려도 던지지 않는 버전. */
export async function currentMember(token: string | undefined): Promise<MemberContext | null> {
  if (!token) return null;
  try {
    return await requireMember(token);
  } catch {
    return null;
  }
}

/**
 * 세션 쿠키로 회원을 특정한다 (P1 — /login 비밀번호 로그인).
 *
 * 쿠키에는 신원(회원번호)만 있다. 상태·동의는 요청마다 01_회원을 다시 읽는다 —
 * 탈퇴 처리되면 다음 요청부터 즉시 막혀야 하기 때문이다(README §9 원칙).
 * 매직링크(requireMember)와 돌려주는 모양(MemberContext)이 같아서 화면은 구분하지 않는다.
 */
export async function requireMemberSession(): Promise<MemberContext> {
  const session = await readMemberSession();
  if (!session) {
    throw new GuardError(
      "UNAUTHENTICATED",
      "회원 로그인이 필요합니다.",
      401,
      "회원 로그인 화면에서 회원번호(또는 이메일)와 비밀번호로 로그인해 주십시오.",
    );
  }

  const row = await prisma.member.findUnique({
    where: { memberNo: session.sub },
    select: {
      memberNo: true,
      name: true,
      email: true,
      status: true,
      rosterConsent: true,
      notifyConsent: true,
      linkToken: true,
    },
  });

  if (!row) {
    throw new GuardError(
      "NO_MEMBER",
      "회원 정보를 찾을 수 없습니다. 다시 로그인해 주십시오.",
      403,
      "총무에게 문의해 주십시오.",
    );
  }

  if (row.status === "WITHDRAWN") {
    throw new GuardError(
      "MEMBER_INACTIVE",
      "탈퇴 처리된 회원입니다.",
      403,
      "다시 가입하시려면 회원 가입 화면을 이용해 주십시오.",
    );
  }

  return row;
}

/** 세션이 없거나 무효면 null. 화면 분기용. */
export async function currentMemberSession(): Promise<MemberContext | null> {
  try {
    return await requireMemberSession();
  } catch {
    return null;
  }
}

/* ═══════════════════════════ 유틸 ═══════════════════════════ */

/** 오늘 날짜를 'yyyy-MM-dd' 로. 임기 비교에 쓴다(로컬 시간 기준 = 일로일로 시간). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 임원 로그인 · 세션 쿠키 · 비밀번호 해시 (Node 런타임 전용).
 *
 * middleware 에서 import 하지 마라 — cookies()/bcrypt 는 Edge 에서 못 돈다.
 * 순수 토큰 서명/검증은 session.ts 에 있다.
 *
 * 인증 3계층
 *   공개  인증 없음
 *   회원  매직링크 /me/[token] — 링크토큰으로만 회원을 특정한다 (guard.requireMember)
 *   임원  이메일 + 비밀번호(bcrypt) + httpOnly 세션 쿠키
 *
 * 비밀번호는 Officer 가 아니라 **OfficerCredential** 에 있다.
 * 12_임원 탭 12열을 그대로 보존하기 위해 스키마가 분리해 두었다.
 */
import "server-only";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { appendAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  MEMBER_COOKIE,
  MEMBER_SESSION_MAX_AGE,
  OFFICER_COOKIE,
  SESSION_MAX_AGE,
  signMemberSession,
  signOfficerSession,
  verifyMemberSession,
  verifyOfficerSession,
  type MemberSessionPayload,
  type OfficerSessionPayload,
} from "@/lib/session";

/** 회원 링크토큰 생성기는 domain 쪽 한 곳에만 둔다. 여기서는 다시 내보내기만 한다. */
export { newLinkToken, newMagicToken } from "@/lib/domain/mail";

/* ─────────────────────────── 비밀번호 ─────────────────────────── */

const BCRYPT_ROUNDS = 10;

/**
 * 존재하지 않는 이메일로 로그인해도 bcrypt 를 한 번 돌린다.
 * 안 돌리면 응답 시간 차이로 "이 이메일은 임원이다" 가 새어 나간다(사용자 열거).
 * 라운드 수가 실제와 같아야 의미가 있다.
 */
const DUMMY_HASH = "$2b$10$Fs8hQBhN4pma6n7lBbDAvO.B8zv3Wh0Amaui0hdnvlwy/NcZ2eL8G";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 임원 비밀번호 설정/변경. 시드와 임원 설정 화면이 같이 쓴다. */
export async function setOfficerPassword(officerId: string, plain: string): Promise<void> {
  const passwordHash = await hashPassword(plain);
  await prisma.officerCredential.upsert({
    where: { officerId },
    create: { officerId, passwordHash },
    update: { passwordHash },
  });
}

/* ─────────────────────────── 세션 쿠키 ─────────────────────────── */

export async function setOfficerSession(payload: OfficerSessionPayload): Promise<void> {
  const token = await signOfficerSession(payload);
  const store = await cookies();
  store.set(OFFICER_COOKIE, token, {
    httpOnly: true, // JS 로 못 읽는다 = XSS 로 세션 탈취 불가
    sameSite: "lax", // 외부 사이트에서 온 POST 에는 쿠키가 안 실린다(CSRF 1차 방어)
    secure: process.env.NODE_ENV === "production", // 로컬은 http 라 false
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearOfficerSession(): Promise<void> {
  const store = await cookies();
  store.delete(OFFICER_COOKIE);
}

/** 쿠키에서 세션을 읽어 서명을 검증한다. 권한 판단은 여기서 하지 않는다 → guard.ts */
export async function readOfficerSession(): Promise<OfficerSessionPayload | null> {
  const store = await cookies();
  const token = store.get(OFFICER_COOKIE)?.value;
  if (!token) return null;
  return verifyOfficerSession(token);
}

/* ─────────────────────────── 로그인 ─────────────────────────── */

export type SignInResult =
  | { ok: true; officerId: string; name: string }
  /** reason 은 서버 로그용. 화면에는 message 만 보여준다. */
  | {
      ok: false;
      message: string;
      reason: "NO_USER" | "NO_PASSWORD" | "BAD_PASSWORD" | "INACTIVE";
    };

const GENERIC_LOGIN_ERROR = "이메일 또는 비밀번호가 맞지 않습니다.";

/**
 * 임원 로그인. 성공하면 세션 쿠키를 심는다.
 *
 * 실패 사유를 화면에 구분해서 보여주지 않는다 — "비밀번호가 틀렸습니다" 는
 * "이 이메일은 임원이다" 를 알려주는 것과 같다. 좁은 한인 커뮤니티에서
 * 임원 명단·이메일은 그 자체로 민감하다.
 */
export async function signInOfficer(emailRaw: string, password: string): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase();

  const officer = await prisma.officer.findFirst({
    // SQLite 는 mode:"insensitive" 를 지원하지 않는다. 시드가 소문자로 넣는다는 전제.
    where: { email },
    select: {
      officerId: true,
      name: true,
      status: true,
      credential: { select: { passwordHash: true } },
    },
  });

  if (!officer) {
    await bcrypt.compare(password, DUMMY_HASH); // 타이밍 평탄화
    return { ok: false, message: GENERIC_LOGIN_ERROR, reason: "NO_USER" };
  }

  const hash = officer.credential?.passwordHash;
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, message: GENERIC_LOGIN_ERROR, reason: "NO_PASSWORD" };
  }

  const good = await bcrypt.compare(password, hash);
  if (!good) return { ok: false, message: GENERIC_LOGIN_ERROR, reason: "BAD_PASSWORD" };

  // 비활성 계정은 비밀번호가 맞아도 막는다. 여기서는 사유를 알려줘도 안전하다
  // (비밀번호를 맞힌 사람이므로 본인이다).
  if (officer.status !== "ACTIVE") {
    return {
      ok: false,
      message: "비활성 상태의 임원 계정입니다. 회장 또는 총무에게 문의하십시오.",
      reason: "INACTIVE",
    };
  }

  await setOfficerSession({ sub: officer.officerId, email, name: officer.name });
  return { ok: true, officerId: officer.officerId, name: officer.name };
}

/* ═══════════════════════════ 회원 (P1) ═══════════════════════════ */

/**
 * 회원 로그인 = 회원번호(아이디) 또는 이메일 + 비밀번호.
 * 임원과 같은 스택(bcrypt + jose httpOnly 쿠키)을 재사용하되 쿠키는 별도다.
 *
 * 무차별 대입 방어: 연속 MEMBER_LOCK_THRESHOLD 회 실패 → MEMBER_LOCK_MINUTES 분 잠금.
 * 판정은 전부 여기(서버)서 한다. 남은 시도 횟수는 어떤 경로로도 알려주지 않는다.
 */
const MEMBER_LOCK_THRESHOLD = 5;
const MEMBER_LOCK_MINUTES = 30;

/** 실패 사유를 화면에 구분해 주지 않는다 — 임원 로그인과 같은 원칙. */
const MEMBER_LOGIN_ERROR = "회원번호(또는 이메일) 또는 비밀번호가 맞지 않습니다.";
const MEMBER_LOCKED_ERROR =
  `비밀번호를 여러 번 잘못 입력하셔서 로그인이 잠시 잠겨 있습니다. ` +
  `${MEMBER_LOCK_MINUTES}분 뒤에 다시 시도해 주십시오.`;

export type MemberSignInResult =
  | { ok: true; memberNo: string; name: string; mustChange: boolean }
  /** reason 은 서버 로그용. 화면에는 message 만 보여준다. */
  | {
      ok: false;
      message: string;
      howToFix?: string;
      reason:
        | "NO_USER"
        | "NO_PASSWORD"
        | "BAD_PASSWORD"
        | "LOCKED"
        | "WITHDRAWN"
        | "EMAIL_SHARED";
    };

/* ── 세션 쿠키 ── */

export async function setMemberSession(payload: MemberSessionPayload): Promise<void> {
  const token = await signMemberSession(payload);
  const store = await cookies();
  store.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MEMBER_SESSION_MAX_AGE,
  });
}

export async function clearMemberSession(): Promise<void> {
  const store = await cookies();
  store.delete(MEMBER_COOKIE);
}

/** 쿠키에서 회원 세션을 읽어 서명을 검증한다. 회원 존재·상태 판단은 guard.ts. */
export async function readMemberSession(): Promise<MemberSessionPayload | null> {
  const store = await cookies();
  const token = store.get(MEMBER_COOKIE)?.value;
  if (!token) return null;
  return verifyMemberSession(token);
}

/* ── 로그인 ── */

/**
 * 아이디 문자열로 회원 한 명을 특정한다.
 *
 * · M0001 형태 → 회원번호로 조회 (유일)
 * · 이메일 → 탈퇴 제외 후 조회. **여러 명이면(가족 공유 이메일) 특정하지 않는다** —
 *   비밀번호를 맞혀도 어느 회원인지 서버가 정할 수 없기 때문. 회원번호 로그인을 안내한다.
 */
async function findMemberForLogin(
  idRaw: string,
): Promise<
  | { kind: "one"; memberNo: string }
  | { kind: "none" }
  | { kind: "shared" }
> {
  const id = idRaw.trim();
  if (/^m\d{4,}$/i.test(id)) {
    const row = await prisma.member.findUnique({
      where: { memberNo: id.toUpperCase() },
      select: { memberNo: true },
    });
    return row ? { kind: "one", memberNo: row.memberNo } : { kind: "none" };
  }
  const email = id.toLowerCase();
  if (!email.includes("@")) return { kind: "none" };
  const rows = await prisma.member.findMany({
    where: { email, status: { not: "WITHDRAWN" } },
    select: { memberNo: true },
    take: 2,
  });
  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "shared" };
  return { kind: "one", memberNo: rows[0].memberNo };
}

/**
 * 회원 로그인. 성공하면 회원 세션 쿠키를 심는다.
 *
 * 잠금·실패 카운트는 MemberCredential 행에서만 판정한다(서버가 유일한 심판).
 * 잠금이 걸리는 순간은 16_감사로그에 WARN 으로 남긴다.
 */
export async function signInMember(idRaw: string, password: string): Promise<MemberSignInResult> {
  const found = await findMemberForLogin(idRaw);

  if (found.kind === "shared") {
    // 가족이 이메일 하나를 함께 쓰는 경우다. 이 안내는 의도된 것이다(요구사항).
    return {
      ok: false,
      message: "이 이메일은 여러 회원이 함께 쓰고 계셔서 이메일로는 로그인하실 수 없습니다.",
      howToFix: "회원번호(예: M0001)를 아이디로 입력해 주십시오. 회원번호는 가입 안내 메일에 있습니다.",
      reason: "EMAIL_SHARED",
    };
  }

  if (found.kind === "none") {
    await bcrypt.compare(password, DUMMY_HASH); // 타이밍 평탄화 — 임원 로그인과 같은 이유
    return { ok: false, message: MEMBER_LOGIN_ERROR, reason: "NO_USER" };
  }

  const member = await prisma.member.findUnique({
    where: { memberNo: found.memberNo },
    select: {
      memberNo: true,
      name: true,
      status: true,
      credential: {
        select: { passwordHash: true, mustChange: true, failedCount: true, lockedUntil: true },
      },
    },
  });
  if (!member) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, message: MEMBER_LOGIN_ERROR, reason: "NO_USER" };
  }

  const cred = member.credential;
  if (!cred) {
    await bcrypt.compare(password, DUMMY_HASH);
    // "비밀번호 미설정" 을 구분해 알려주지 않는다 — 회원번호는 순차라 열거가 쉽다.
    return { ok: false, message: MEMBER_LOGIN_ERROR, reason: "NO_PASSWORD" };
  }

  const now = new Date();

  // ① 잠금 검사 — 비밀번호를 보기 전에 먼저. 잠긴 동안은 맞는 비밀번호도 거부한다.
  if (cred.lockedUntil && cred.lockedUntil > now) {
    return { ok: false, message: MEMBER_LOCKED_ERROR, reason: "LOCKED" };
  }

  // ② 비밀번호 대조
  const good = await bcrypt.compare(password, cred.passwordHash);
  if (!good) {
    const nextCount = cred.failedCount + 1;
    if (nextCount >= MEMBER_LOCK_THRESHOLD) {
      const lockedUntil = new Date(now.getTime() + MEMBER_LOCK_MINUTES * 60_000);
      await prisma.$transaction(async (tx) => {
        await tx.memberCredential.update({
          where: { memberNo: member.memberNo },
          // 잠금이 풀리면 5회를 새로 센다.
          data: { failedCount: 0, lockedUntil },
        });
        await appendAuditLog(tx, {
          actor: "SYSTEM (로그인 방어)",
          tableName: "MemberCredential",
          recordKey: member.memberNo,
          fieldName: "lockedUntil",
          afterValue: lockedUntil.toISOString(),
          changeType: "EDIT",
          severity: "WARN",
          note: `회원 로그인 연속 ${MEMBER_LOCK_THRESHOLD}회 실패 — ${MEMBER_LOCK_MINUTES}분 잠금`,
        });
      });
      return { ok: false, message: MEMBER_LOCKED_ERROR, reason: "LOCKED" };
    }
    await prisma.memberCredential.update({
      where: { memberNo: member.memberNo },
      data: { failedCount: nextCount },
    });
    return { ok: false, message: MEMBER_LOGIN_ERROR, reason: "BAD_PASSWORD" };
  }

  // ③ 상태 검사 — 비밀번호를 맞힌 본인에게는 사유를 알려줘도 안전하다.
  if (member.status === "WITHDRAWN") {
    return {
      ok: false,
      message: "탈퇴 처리된 회원입니다.",
      howToFix: "다시 가입하시려면 회원 가입 화면을 이용해 주십시오.",
      reason: "WITHDRAWN",
    };
  }

  // ④ 성공 — 실패 카운트·잠금을 되돌리고 세션을 심는다.
  if (cred.failedCount !== 0 || cred.lockedUntil !== null) {
    await prisma.memberCredential.update({
      where: { memberNo: member.memberNo },
      data: { failedCount: 0, lockedUntil: null },
    });
  }
  await setMemberSession({ sub: member.memberNo, name: member.name });
  return { ok: true, memberNo: member.memberNo, name: member.name, mustChange: cred.mustChange };
}

/* ── 비밀번호 설정 ── */

/**
 * 회원 비밀번호 설정/변경. 가입 트랜잭션·본인 변경·총무 재설정이 같이 쓴다.
 * 트랜잭션 안에서 부를 수 있게 해시는 호출 전에 만들어 두는 버전도 함께 둔다.
 */
export async function setMemberPassword(
  memberNo: string,
  plain: string,
  opts: { mustChange: boolean; updatedBy: string },
): Promise<void> {
  const passwordHash = await hashPassword(plain);
  await prisma.memberCredential.upsert({
    where: { memberNo },
    create: { memberNo, passwordHash, mustChange: opts.mustChange, updatedBy: opts.updatedBy },
    update: {
      passwordHash,
      mustChange: opts.mustChange,
      failedCount: 0,
      lockedUntil: null,
      updatedBy: opts.updatedBy,
    },
  });
}

/**
 * 임시 비밀번호 생성 — 총무가 읽어 주고 회원이 옮겨 적는 값이다.
 * 링크토큰과 같은 문자 집합(헷갈리는 0 O 1 I L 제외), 10자리.
 * ★ 화면에 1회 보여주고 어디에도 저장하지 않는다. DB 에는 해시만 남는다.
 */
const TEMP_POOL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newTempPassword(len = 10): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += TEMP_POOL[bytes[i] % TEMP_POOL.length];
  return out;
}

/* ─────────────────────────── 개발 전용 ─────────────────────────── */

/**
 * 개발용 화면(/dev/login, /dev/outbox)이 켜져 있는가.
 *
 * ★ 프로덕션에서는 무조건 꺼진다. 이 판정은 **서버에서** 한다 —
 *   화면에서 버튼을 숨기는 것은 통제가 아니다.
 */
export function devToolsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_TOOLS !== "off";
}

/** 비밀번호 없이 임원 세션을 심는다. /dev/login 전용. */
export async function devSignInOfficer(officerId: string): Promise<SignInResult> {
  if (!devToolsEnabled()) {
    throw new Error("[차단] 개발용 빠른 로그인은 프로덕션에서 사용할 수 없습니다.");
  }
  const officer = await prisma.officer.findUnique({
    where: { officerId },
    select: { officerId: true, name: true, email: true },
  });
  if (!officer) return { ok: false, message: "임원을 찾을 수 없습니다.", reason: "NO_USER" };

  await setOfficerSession({
    sub: officer.officerId,
    email: officer.email,
    name: officer.name,
  });
  return { ok: true, officerId: officer.officerId, name: officer.name };
}

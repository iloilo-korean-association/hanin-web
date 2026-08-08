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

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import {
  OFFICER_COOKIE,
  SESSION_MAX_AGE,
  signOfficerSession,
  verifyOfficerSession,
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

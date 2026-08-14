/**
 * 세션 토큰 (jose HS256) — Edge 안전.
 *
 * 이 파일은 Node 전용 API(cookies, bcrypt, prisma)를 절대 import 하지 않는다.
 * middleware 에서도 그대로 쓸 수 있어야 하기 때문이다. 쿠키 읽기/쓰기는 auth.ts.
 *
 * ★ 설계 원칙: 세션에는 **신원 식별자만** 넣는다.
 *   직책·권한·승인한도는 넣지 않는다 — 넣으면 총무가 감사로 바뀌어도, 임기가 끝나도,
 *   승인한도가 내려가도 쿠키가 만료될 때까지 옛 권한이 살아 있다. 회계 시스템에서
 *   그건 사고다. guard.ts 가 요청마다 12_임원 테이블을 다시 읽는다.
 */
import { SignJWT, jwtVerify } from "jose";

import { PERMISSIONS, type Permission } from "@/lib/validators/enums";

/** 임원 세션 쿠키 이름. */
export const OFFICER_COOKIE = "ika_officer";

/**
 * 세션 수명 8시간.
 * 돈을 만지는 화면이고, 총무 휴대폰을 남이 집어들 수 있다. 7일은 너무 길다.
 */
export const SESSION_MAX_AGE = 60 * 60 * 8;

/** 회원 세션 쿠키 이름. 임원 쿠키와 반드시 별도다 — 같은 브라우저에서 둘 다 유지된다. */
export const MEMBER_COOKIE = "ika_member";

/**
 * 회원 세션 수명 14일.
 * 임원(8시간)보다 긴 이유: 회원 화면은 본인 조회 전용이고 쓰기라고는 본인 연락처
 * 수정뿐이다. 기존 매직링크(/me/[token])는 아예 만료가 없으므로 14일은 더 좁힌 것이다.
 */
export const MEMBER_SESSION_MAX_AGE = 60 * 60 * 24 * 14;

/**
 * 12_임원.권한 에 들어가는 값. 이 3개가 전부다.
 * 정의는 validators/enums.ts 한 곳에만 둔다 — 두 군데에 적으면 반드시 어긋난다.
 */
export type OfficerPermission = Permission;
export const OFFICER_PERMISSIONS: readonly OfficerPermission[] = PERMISSIONS;

export function isOfficerPermission(v: string): v is OfficerPermission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

/**
 * "확인권,조회권" → ["확인권","조회권"]
 * 12_임원.권한 은 쉼표로 이어붙인 문자열이다(SQLite 라 배열 컬럼이 없다).
 * 알 수 없는 값은 조용히 버린다 — 오타 하나로 임원이 전 권한을 잃는 것보다
 * 아는 권한만 인정하는 편이 안전하다.
 */
export function parsePermissions(raw: string | null | undefined): OfficerPermission[] {
  if (!raw) return [];
  const out: OfficerPermission[] = [];
  for (const part of raw.split(/[,\s/|]+/)) {
    const v = part.trim();
    if (isOfficerPermission(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 쿠키에 담기는 내용. 신원만. */
export interface OfficerSessionPayload {
  /** 12_임원.임원ID */
  sub: string;
  /** 12_임원.이메일 — 로그인 아이디 */
  email: string;
  /** 화면 인사말용. 권한 판단에 절대 쓰지 마라. */
  name: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET 이 없거나 너무 짧습니다(32자 이상). .env 를 확인하십시오. " +
        '생성: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signOfficerSession(payload: OfficerSessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

/** 검증 실패(변조·만료·서명불일치)는 예외가 아니라 null 이다. */
export async function verifyOfficerSession(
  token: string,
): Promise<OfficerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
    };
  } catch {
    return null;
  }
}

/* ─────────────────────────── 회원 세션 ─────────────────────────── */

/**
 * 회원 세션 쿠키에 담기는 내용. **신원만.**
 * 회비 상태·회원구분 같은 것을 넣지 않는다 — 넣으면 상태가 바뀌어도 쿠키가
 * 만료될 때까지 옛 값이 살아 있다. 화면이 요청마다 01_회원을 다시 읽는다.
 */
export interface MemberSessionPayload {
  /** 01_회원.회원번호 (M0001) */
  sub: string;
  /** 화면 인사말용. 판정에 쓰지 마라. */
  name: string;
}

/**
 * aud 클레임으로 임원 토큰과 구분한다.
 * 같은 SESSION_SECRET 으로 서명하므로, aud 검사가 없으면 회원 토큰을
 * ika_officer 쿠키에 옮겨 심는 혼용 시도가 서명 검증을 통과해 버린다.
 * (임원 조회는 officerId 로 하니 실패하겠지만, 계층 구분은 토큰 자체에 둔다.)
 */
const MEMBER_AUDIENCE = "ika-member";

export async function signMemberSession(payload: MemberSessionPayload): Promise<string> {
  return new SignJWT({ name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setAudience(MEMBER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MEMBER_SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

/** 검증 실패(변조·만료·서명불일치·임원 토큰 혼용)는 예외가 아니라 null 이다. */
export async function verifyMemberSession(token: string): Promise<MemberSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: MEMBER_AUDIENCE });
    if (!payload.sub) return null;
    return { sub: String(payload.sub), name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

/**
 * 회원 링크토큰 형식 검사.
 *
 * 토큰은 URL 세그먼트로 들어온다(/me/[token]). DB 조회 전에 형식부터 거른다 —
 * 아무 문자열로 원장을 두들기게 두지 않는다.
 *
 * 알파벳은 domain/mail.ts 의 newLinkToken() 과 같다:
 *   ABCDEFGHJKMNPQRSTUVWXYZ23456789  (헷갈리는 0 O 1 I L 제외)
 * 기본 길이는 8자리. 나중에 길이를 늘려도 통과하도록 상한만 넉넉히 둔다.
 *
 * ★ 8자리는 31^8 ≈ 8,528억 가지다. 대입 공격 자체는 비현실적이지만,
 *   그래도 이 토큰으로 열리는 화면에는 민감정보를 넣지 마라(인증이 아니라 식별자다).
 *   [확인 필요] 운영 전환 시 토큰 실패 횟수 모니터링(00_설정 웹앱.토큰실패경고=200)을 붙인다.
 */
const MEMBER_TOKEN_RE = /^[A-HJKMNP-Z2-9]{6,64}$/;

export function isValidMemberTokenFormat(token: string): boolean {
  return MEMBER_TOKEN_RE.test(token);
}

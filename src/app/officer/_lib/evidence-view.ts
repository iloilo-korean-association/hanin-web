/**
 * 비공개 Blob 조회 — 렌더 시점 서명 URL 생성.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *  운영 Blob 스토어는 Private 모드다. upload.ts 가 저장한 URL
 *  (https://<id>.private.blob.vercel-storage.com/…)은 인증 없이 열면 403 이라
 *  <a href>·<img src> 로 바로 못 쓴다. 그래서 화면에 보여줄 때 이 모듈로
 *  **짧은 만료시간(10분)의 서명 GET URL** 을 만들어 그걸 렌더한다.
 *  링크가 채팅방 등으로 새어나가도 몇 분 뒤 죽는다.
 *
 * ── 동작 ────────────────────────────────────────────────────────────────
 *  · issueSignedToken(get 전용, 30분) 을 서버 프로세스에 캐시해 두고
 *    (제어면 API 호출은 토큰 갱신 때 한 번), 개별 URL 서명(presignUrl)은
 *    로컬 HMAC 계산이라 페이지당 몇 개를 서명해도 네트워크 비용이 없다.
 *  · 비공개 Blob URL 이 아닌 값 — 로컬 폴백 상대경로(/uploads/…),
 *    구 데이터의 일반 https URL, 빈 문자열 — 는 **그대로 돌려준다**.
 *    호출부는 값을 가리지 않고 항상 toViewUrl() 을 통과시키면 된다.
 *  · 서명에 실패하면(네트워크 등) 원본 URL 을 돌려준다 — 그 링크는 403 이
 *    뜨지만 페이지 렌더는 죽지 않는다.
 *
 * ── 권한은 호출한 화면이 책임진다 ───────────────────────────────────────
 *  이 모듈은 "서명할 수 있느냐"만 안다. "이 사용자가 이 파일을 봐도 되느냐"는
 *  호출부의 가드가 정한다 — 임원 증빙은 requireOfficer 가 걸린 페이지에서만
 *  toViewUrl() 이 불리므로 임원만 서명 URL 을 받는다. 회원 사진(P3) 등
 *  "본인 + 임원만" 규칙이 생겨도 해당 화면이 본인 확인 후 같은 함수를 부르면
 *  된다 — 이 모듈은 바꿀 것이 없다.
 */
import "server-only";

import { issueSignedToken, presignUrl, type IssuedSignedToken } from "@vercel/blob";

/** 서명 URL 의 수명. 페이지를 보다가 누르는 데 충분하고, 새면 곧 죽는 값. */
const VIEW_TTL_MS = 10 * 60 * 1000;
/** 위임 토큰 수명. VIEW_TTL 보다 길어야 서명 URL 이 온전한 수명을 갖는다. */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/** 비공개 Blob 호스트. 공개 스토어(<id>.public.…)나 일반 URL 은 매칭되지 않는다. */
const PRIVATE_BLOB_HOST_RE = /^[a-z0-9]+\.private\.blob\.vercel-storage\.com$/i;

/* 위임 토큰은 프로세스에 캐시한다. presignUrl 의 만료가 토큰 만료에 상한되므로,
   남은 수명이 VIEW_TTL 아래로 내려오면 재발급한다. */
let cachedToken: IssuedSignedToken | null = null;
let issuing: Promise<IssuedSignedToken> | null = null;

async function getReadToken(): Promise<IssuedSignedToken> {
  if (cachedToken && cachedToken.validUntil - Date.now() > VIEW_TTL_MS) return cachedToken;
  if (!issuing) {
    issuing = issueSignedToken({
      pathname: "*", // 서명 대상 경로는 presignUrl 이 개별로 못 박는다. 토큰 자체는 서버 밖으로 안 나간다.
      operations: ["get"],
      validUntil: Date.now() + TOKEN_TTL_MS,
      // upload.ts 와 같은 이유 — 자동감지는 OIDC 로 빠져 로컬에서 실패한다. 항상 명시한다.
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
      .then((t) => {
        cachedToken = t;
        return t;
      })
      .finally(() => {
        issuing = null;
      });
  }
  return issuing;
}

/** 이 값이 서명이 필요한 비공개 Blob URL 인가. */
export function isPrivateBlobUrl(url: string): boolean {
  try {
    return PRIVATE_BLOB_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false; // 상대경로(/uploads/…)·빈 문자열 등
  }
}

/**
 * 저장된 파일 URL → 화면에 렌더할 URL.
 *
 * 비공개 Blob URL 이면 만료시간 있는 서명 URL 을, 그 외(로컬 폴백 상대경로,
 * 구 데이터의 일반 https URL, 빈 문자열)는 입력 그대로 돌려준다.
 */
export async function toViewUrl(url: string): Promise<string> {
  const raw = String(url ?? "").trim();
  if (!raw || !isPrivateBlobUrl(raw)) return raw;

  try {
    const token = await getReadToken();
    const pathname = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ""));
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname,
      validUntil: Date.now() + VIEW_TTL_MS,
    });
    return presignedUrl;
  } catch {
    // 서명 실패 — 원본을 돌려준다. 링크는 403 이 뜨지만 페이지는 렌더된다.
    return raw;
  }
}

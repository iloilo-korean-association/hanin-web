import { NextResponse, type NextRequest } from "next/server";

import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";

import { loadMemberCardData } from "../../_portal/card-data";
import { fetchPhotoAsDataUrl, renderMemberCardImage } from "./card-image";
import { memberCardAsciiFileName, memberCardFileName } from "./file-name";

/**
 * GET /me/card/image[?token=] — 디지털 회원증 한 장을 PNG 로 (P3 "이미지로 저장").
 *
 * ── 인증: /me/card 화면과 똑같은 가드 ───────────────────────────────────
 *  세션 쿠키(requireMemberSession) 가 기본, 매직링크로 들어온 분은 ?token=(requireMember).
 *  어느 쪽이든 **가드가 돌려준 회원번호로만** 조회한다 — 쿼리스트링의 회원번호 같은 것은
 *  받지 않는다. 가드에 걸리면 401/403/404 JSON (화면 버튼이 message 를 그대로 보여 준다).
 *
 * ── 유효하지 않은 카드는 만들지 않는다 ──────────────────────────────────
 *  verdict.valid 가 아니면 403. 화면에서 버튼을 숨기는 것은 통제가 아니다 — URL 을 직접
 *  쳐도 미납 회원의 카드 PNG 는 나오지 않아야 한다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · Cache-Control: private, no-store — 회원증 유효/무효는 매 요청 판정이고, 개인정보다.
 *  · X-Robots-Tag: noindex — next.config 의 /me/:path* 규칙과 중복이지만 라우트 단독으로도 안전하게.
 *  · Content-Disposition: inline + 파일명 — 브라우저가 URL 을 직접 열어 저장할 때의 이름.
 *    (화면 버튼은 fetch → blob 으로 받아 자기가 파일명을 붙인다.)
 *  · 사진 서명 URL 은 서버 안에서 fetch 되어 data URL 로 PNG 에 박히고 끝난다.
 *
 * nodejs 런타임이어야 한다 — Prisma(가드·데이터)와 fs(폰트)를 쓴다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

function deny(status: number, message: string, howToFix: string | null = null): NextResponse {
  return NextResponse.json({ ok: false, message, howToFix }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim().toUpperCase();

  let me;
  try {
    me = token ? await requireMember(token) : await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) return deny(e.status, e.message, e.howToFix);
    throw e;
  }

  const data = await loadMemberCardData(me.memberNo);
  const period = data.verdict.period;
  if (!data.verdict.valid || !period) {
    return deny(
      403,
      "아직 회원증을 발급해 드릴 수 없습니다.",
      data.verdict.blockers.map((b) => `${b.message} — ${b.howToFix}`).join(" "),
    );
  }

  const photoDataUrl = await fetchPhotoAsDataUrl(data.photoViewUrl);
  const fileName = memberCardFileName(data.member.memberNo, period.validUntil);

  try {
    const image = await renderMemberCardImage({
      name: data.member.name,
      memberNo: data.member.memberNo,
      memberType: data.member.memberType,
      period,
      photoDataUrl,
      verifyUrl: data.verifyUrl,
    });
    // ImageResponse 는 스트림이라 렌더 오류가 응답 도중(500 "failed to pipe") 터진다.
    // 여기서 끝까지 받아 두면 오류를 잡아 안내 JSON 으로 바꿀 수 있고, Content-Length 도 붙는다.
    const png = await image.arrayBuffer();
    return new Response(png, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        // ASCII 폴백 + RFC 5987 한글 파일명
        "Content-Disposition":
          `inline; filename="${memberCardAsciiFileName(data.member.memberNo, period.validUntil)}"; ` +
          `filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    // 폰트 파일 누락·렌더 오류 등. 회원에게는 "다시 시도" 를, 로그에는 원인을.
    console.error("[me/card/image] 회원증 PNG 렌더 실패", e);
    return deny(
      500,
      "회원증 이미지를 만들지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 안 되면 [회원증 인쇄] 를 이용하시거나 총무에게 알려 주십시오.",
    );
  }
}

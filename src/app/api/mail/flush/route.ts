/**
 * POST/GET /api/mail/flush — 발송함 미발송 잔량 일괄 발송.
 *
 * ── 누가 부르나 ─────────────────────────────────────────────────────────
 *  나중에 붙일 Vercel Cron (배포_리전메모.md — Hobby 는 크론 하루 1회 제약이 있어
 *  vercel.json 의 crons 는 **아직 넣지 않는다**. 라우트가 먼저, 크론 등록은 나중).
 *  Vercel Cron 은 GET 으로 호출하고 `Authorization: Bearer <CRON_SECRET>` 을 붙인다.
 *
 * ── 인증 ────────────────────────────────────────────────────────────────
 *  CRON_SECRET 헤더 검사 필수. 불일치·미설정 전부 401 —
 *  이게 없으면 누구나 독촉·영수증 메일 발송을 트리거할 수 있다(배포_리전메모.md 경고).
 *  임원 세션이 아니라 시크릿인 이유: 호출자가 사람이 아니라 크론이다.
 *
 * ── 동작 ────────────────────────────────────────────────────────────────
 *  RESEND_API_KEY 없으면: 인증돼도 아무것도 안 보낸다 (enabled:false — 현행 유지).
 *  있으면: NotifyLog.result = DEFERRED/FAIL(재시도 여지) 건을 오래된 것부터 발송.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { flushOutbox } from "@/lib/mail-sender";

/** 크론 호출은 항상 그 시점의 DB 를 봐야 한다. 빌드 시 실행·캐시 전부 금지. */
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // 시크릿이 없으면 아무도 통과 못 한다 — "설정 깜빡함" 이 "전체 공개" 가 되면 안 된다.
  if (!secret) return false;

  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  // timingSafeEqual 은 길이가 다르면 던진다 — 길이 비교 자체는 비밀이 아니다.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, message: "인증되지 않은 요청입니다. CRON_SECRET 헤더를 확인해 주십시오." },
      { status: 401 },
    );
  }
  const result = await flushOutbox();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

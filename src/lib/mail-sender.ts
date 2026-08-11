/**
 * 메일 실발송 어댑터 (Resend).
 *
 * ── 역할 분담 ────────────────────────────────────────────────────────────
 *  · @/lib/domain/mail  : 발송함(OutboxMail) + 알림로그(NotifyLog)에 **적는다** (정본, 무변경)
 *  · @/lib/mail         : prisma 를 물린 앱 레벨 어댑터. 큐잉 직후 이 파일의 발송을 예약한다
 *  · 이 파일            : 발송함에 적힌 미발송 건을 **실제로 보낸다**
 *
 * ── 켜고 끄기 ────────────────────────────────────────────────────────────
 *  RESEND_API_KEY 가 없으면 아무것도 하지 않는다(현행 유지 — 발송함 기록만).
 *  키가 있으면:
 *    · queueMail 이 NotifyLog.result 를 "DEFERRED" 로 넣고
 *    · (a) 응답이 나간 뒤(after) 즉시 1건 발송 시도  ← @/lib/mail 이 예약
 *    · (b) /api/mail/flush (CRON_SECRET 필요) 가 잔량을 일괄 처리
 *  발송 결과는 NotifyLog.result 를 SUCCESS/FAIL 로 갱신한다. 스키마 변경 없음 —
 *  "미발송" 은 새 테이블이 아니라 기존 result="DEFERRED" 로 표현한다.
 *
 * ── 이중 발송 방지 ───────────────────────────────────────────────────────
 *  (a)와 (b)가 같은 메일을 동시에 잡을 수 있다. 그래서 보내기 전에
 *  updateMany(WHERE result IN (DEFERRED, FAIL)) 로 원자적으로 선점한다 —
 *  선점 수가 0 이면 다른 쪽이 이미 잡은 것이므로 그냥 물러난다.
 *  선점 시 result 를 일단 FAIL 로 적어 두는 이유: 발송 도중 프로세스가 죽어도
 *  "성공했다고 남는" 일은 없어야 한다. 성공이 확인된 뒤에만 SUCCESS 로 바꾼다.
 *  (NOTIFY_RESULTS 안의 값만 쓴다 — "SENDING" 같은 새 상태를 만들지 않는다.)
 */
import "server-only";

import { Resend } from "resend";

import { prisma } from "@/lib/db";
import { SITE_URL } from "@/lib/site";

/**
 * 기본 발신 주소.
 * ★ 이 도메인(iloilokorean.org)은 아직 등록도 Resend 인증(SPF·DKIM)도 되지 않았다.
 *   따라서 이 기본값으로는 실발송이 **되지 않는다** — Resend 가 미인증 도메인을 거부한다.
 *   도메인 인증 후 Vercel 환경변수 MAIL_FROM 으로 실제 주소를 넣어야 발송이 시작된다.
 */
const DEFAULT_MAIL_FROM = "일로일로 한인회 <noreply@iloilokorean.org>";

/** FAIL 이 이 횟수에 이르면 더 재시도하지 않는다 (flush 가 건너뛴다). */
const MAX_ATTEMPTS = 3;

/** RESEND_API_KEY 가 설정돼 있는가. 없으면 모든 발송 경로가 조용히 꺼진다(현행 유지). */
export function mailSendingEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
}

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}

/**
 * 본문의 앱 내부 경로(href="/me/XXXX")를 절대주소로 바꾼다.
 * 발송함 미리보기(/dev/outbox)는 상대경로로 충분하지만, 실제 메일함에서
 * 상대경로 링크는 죽은 링크다. 저장본(OutboxMail)은 그대로 두고 보낼 때만 바꾼다.
 */
function absolutizeLinks(html: string): string {
  return html.replace(/href="\//g, `href="${SITE_URL}/`);
}

export type SendOutcome = "SENT" | "FAILED" | "SKIPPED";

/**
 * 발송함 한 건을 실제로 보낸다. queueMail 직후(after) 와 flush 양쪽이 부른다.
 *
 * 실패해도 던지지 않는다 — 결과는 NotifyLog(result/errorMessage/retryCount)에 남는다.
 * 응답 경로 밖(fire-and-forget)에서 불리므로, 여기서 던지면 잡을 사람이 없다.
 */
export async function sendOutboxMail(outboxId: string): Promise<SendOutcome> {
  const resend = getResend();
  if (!resend) return "SKIPPED";

  const mail = await prisma.outboxMail.findUnique({
    where: { id: outboxId },
    select: { id: true, toEmail: true, subject: true, bodyHtml: true, notifyLogId: true },
  });
  if (!mail?.notifyLogId) return "SKIPPED";

  // 원자적 선점 — 파일 상단 "이중 발송 방지" 참조.
  const claimed = await prisma.notifyLog.updateMany({
    where: {
      logId: mail.notifyLogId,
      result: { in: ["DEFERRED", "FAIL"] },
      retryCount: { lt: MAX_ATTEMPTS },
    },
    data: {
      result: "FAIL",
      errorMessage: "발송 시도 중 완료가 확인되지 않았습니다.",
      retryCount: { increment: 1 },
    },
  });
  if (claimed.count === 0) return "SKIPPED";

  try {
    const { error } = await resend.emails.send({
      from: mailFrom(),
      to: mail.toEmail,
      subject: mail.subject,
      html: absolutizeLinks(mail.bodyHtml),
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);

    await prisma.notifyLog.update({
      where: { logId: mail.notifyLogId },
      data: { result: "SUCCESS", errorMessage: "" },
    });
    return "SENT";
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    // 여기서도 실패하면 선점 때 적어 둔 FAIL 이 그대로 남는다 — 성공으로 둔갑하지는 않는다.
    await prisma.notifyLog
      .update({ where: { logId: mail.notifyLogId }, data: { result: "FAIL", errorMessage: message } })
      .catch(() => undefined);
    return "FAILED";
  }
}

export type FlushResult = {
  /** RESEND_API_KEY 유무. false 면 아무것도 하지 않았다. */
  enabled: boolean;
  /** 이번에 집어든 미발송(DEFERRED/FAIL·재시도 여지) 건수 */
  picked: number;
  sent: number;
  failed: number;
  /** 다른 트리거가 먼저 잡았거나 대상이 아니어서 건너뛴 건수 */
  skipped: number;
};

/**
 * 미발송 잔량 일괄 발송. /api/mail/flush (CRON_SECRET 검사 뒤) 가 부른다.
 * 오래된 것부터 순서대로, 한 번에 최대 limit 건.
 */
export async function flushOutbox(limit = 50): Promise<FlushResult> {
  const result: FlushResult = { enabled: mailSendingEnabled(), picked: 0, sent: 0, failed: 0, skipped: 0 };
  if (!result.enabled) return result;

  const pending = await prisma.notifyLog.findMany({
    where: {
      channel: "EMAIL",
      result: { in: ["DEFERRED", "FAIL"] },
      retryCount: { lt: MAX_ATTEMPTS },
      outbox: { isNot: null },
    },
    orderBy: { sentAt: "asc" },
    take: Math.min(200, Math.max(1, limit)),
    select: { outbox: { select: { id: true } } },
  });
  result.picked = pending.length;

  // 순차 발송 — Resend 무료 구간의 초당 요청 제한을 넘지 않게 병렬로 쏘지 않는다.
  for (const row of pending) {
    if (!row.outbox) {
      result.skipped += 1;
      continue;
    }
    const outcome = await sendOutboxMail(row.outbox.id);
    if (outcome === "SENT") result.sent += 1;
    else if (outcome === "FAILED") result.failed += 1;
    else result.skipped += 1;
  }
  return result;
}

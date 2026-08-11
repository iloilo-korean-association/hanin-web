/**
 * 메일 — 앱 레벨 어댑터.
 *
 * ★ 발송 로직은 여기에 없다. `@/lib/domain/mail` 에 있다.
 *   그쪽이 NotifyLog(15_알림로그) + OutboxMail 두 테이블에 함께 적는 정본이고,
 *   이 파일은 (1) prisma 를 미리 물려 주고 (2) /dev/outbox 가 읽을 조회 함수를 더한다.
 *   같은 일을 두 군데서 하면 반드시 어긋난다 — 그래서 재구현하지 않았다.
 *
 * 실발송 (RESEND_API_KEY 가 있을 때만):
 *   발송함 기록은 위와 완전히 동일하게 남고(NotifyLog.result 만 "DEFERRED" 로 시작),
 *   응답이 나간 **뒤에**(after) @/lib/mail-sender 가 실제로 보내고 SUCCESS/FAIL 로 갱신한다.
 *   after 를 쓰는 이유: 발송은 외부 API 왕복이라 느리다 — 트랜잭션·응답을 붙잡으면 안 된다.
 *   키가 없으면(로컬·현행 운영) 예전과 완전히 같다: 발송함 기록만 하고 /dev/outbox 로 본다.
 *
 * 프로덕션 이식:
 *   queueMail() 호출부는 한 줄도 안 바뀐다. 위 워커가 그 "뒤에 붙인 워커"다.
 */
import "server-only";

import { after } from "next/server";

import { prisma } from "@/lib/db";
import {
  issueMagicLink as domainIssueMagicLink,
  queueMail as domainQueueMail,
  type QueueMailInput,
} from "@/lib/domain/mail";
import { mailSendingEnabled, sendOutboxMail } from "@/lib/mail-sender";
import type { MagicPurpose } from "@/lib/validators/enums";

/**
 * 발송함 1건의 실발송을 응답 경로 밖으로 예약한다.
 * after() 는 서버 액션·라우트 핸들러·서버 컴포넌트 안에서만 동작한다(요청 컨텍스트 필요).
 * 그 밖(스크립트 등)에서 불리면 fire-and-forget 으로 대체한다 — 어느 쪽이든
 * 오류는 sendOutboxMail 이 NotifyLog 에 기록하므로 여기서 삼켜도 유실되지 않는다.
 */
function scheduleSend(outboxId: string): void {
  const run = (): Promise<void> =>
    sendOutboxMail(outboxId).then(
      () => undefined,
      (e) => console.error(`[mail] 발송 예약 실패 (outbox ${outboxId}):`, e),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}

/** 템플릿·경로·토큰 유틸은 그대로 다시 내보낸다. 화면은 "@/lib/mail" 하나만 알면 된다. */
export {
  escapeHtml,
  memberLinkPath,
  magicLinkPath,
  newLinkToken,
  newMagicToken,
  renderTemplate,
  renderFromSettings,
  PUBLIC_LEDGER_PATH,
  FALLBACK_TEMPLATES,
  type QueueMailInput,
} from "@/lib/domain/mail";

/**
 * 메일 한 통을 발송함에 넣는다 (prisma 를 미리 물린 버전).
 *
 * 트랜잭션 안에서 보내야 하면 domain 쪽을 직접 부른다:
 *   import { queueMail } from "@/lib/domain/mail";
 *   await prisma.$transaction(async (tx) => { … ; await queueMail(tx, input); });
 *
 * 트랜잭션 밖(대부분의 경우)에서는 이 함수를 쓴다.
 */
export async function queueMail(input: QueueMailInput) {
  const deferred = mailSendingEnabled();
  const queued = await domainQueueMail(prisma, {
    ...input,
    initialResult: deferred ? "DEFERRED" : "SUCCESS",
  });
  if (deferred) scheduleSend(queued.outboxId);
  return queued;
}

/** 매직링크를 만들고 그 링크가 담긴 메일을 발송함에 넣는다. */
export async function issueMagicLink(opt: {
  purpose: MagicPurpose;
  email: string;
  name?: string;
  memberNo?: string | null;
  officerId?: string | null;
  /** 기본 24시간. 임원 로그인 링크는 더 짧게 잡아도 된다. */
  ttlHours?: number;
  now?: Date;
}): Promise<{ token: string; linkPath: string }> {
  const deferred = mailSendingEnabled();
  const issued = await domainIssueMagicLink(prisma, {
    ...opt,
    initialResult: deferred ? "DEFERRED" : "SUCCESS",
  });
  if (deferred) scheduleSend(issued.outboxId);
  return { token: issued.token, linkPath: issued.linkPath };
}

/* ═══════════════════════ 조회 (/dev/outbox 전용) ═══════════════════════ */

export interface OutboxRow {
  id: string;
  createdAt: Date;
  kind: string;
  toEmail: string;
  toName: string;
  subject: string;
  bodyHtml: string;
  /** 본문에 들어간 앱 내부 경로 (/me/XXXX 등). 빈 문자열이면 링크 없음. */
  linkPath: string;
  memberNo: string | null;
  notifyLogId: string | null;
}

/**
 * 발송함 목록 (최신순).
 *
 * ★ 이 함수는 실제 수신 주소를 그대로 돌려준다.
 *   호출은 /dev/outbox 에서만 해라. 그 화면은 프로덕션에서 404 다.
 *   공개·회원·임원 화면에서 부르면 개인정보 노출이다.
 */
export async function listOutbox(opts?: {
  limit?: number;
  kind?: string;
  memberNo?: string;
}): Promise<OutboxRow[]> {
  const take = Math.min(200, Math.max(1, opts?.limit ?? 50));
  return prisma.outboxMail.findMany({
    where: {
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.memberNo ? { memberNo: opts.memberNo } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      kind: true,
      toEmail: true,
      toName: true,
      subject: true,
      bodyHtml: true,
      linkPath: true,
      memberNo: true,
      notifyLogId: true,
    },
  });
}

/** 종류별 건수. 발송함 상단 필터 칩에 쓴다. */
export async function countOutboxByKind(): Promise<Array<{ kind: string; count: number }>> {
  const rows = await prisma.outboxMail.groupBy({
    by: ["kind"],
    _count: { _all: true },
    orderBy: { kind: "asc" },
  });
  return rows.map((r) => ({ kind: r.kind, count: r._count._all }));
}

export async function countOutbox(): Promise<number> {
  return prisma.outboxMail.count();
}

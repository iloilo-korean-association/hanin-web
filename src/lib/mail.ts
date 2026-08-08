/**
 * 메일 — 앱 레벨 어댑터.
 *
 * ★ 발송 로직은 여기에 없다. `@/lib/domain/mail` 에 있다.
 *   그쪽이 NotifyLog(15_알림로그) + OutboxMail 두 테이블에 함께 적는 정본이고,
 *   이 파일은 (1) prisma 를 미리 물려 주고 (2) /dev/outbox 가 읽을 조회 함수를 더한다.
 *   같은 일을 두 군데서 하면 반드시 어긋난다 — 그래서 재구현하지 않았다.
 *
 * 왜 메일을 안 보내는가:
 *   로컬 프로토타입은 외부 메일 프로바이더에 가입하지 않는다(계정 0개 원칙).
 *   대신 "이런 메일이 이렇게 나간다" 를 대표가 눈으로 확인할 수 있어야 한다.
 *   → /dev/outbox 에서 제목·수신자·본문 HTML 을 그대로 본다.
 *   → 매직링크도 실제 발송 대신 outbox 에서 눌러서 들어간다.
 *
 * 프로덕션 이식:
 *   queueMail() 호출부는 한 줄도 안 바뀐다. 뒤에 워커를 붙여
 *   NotifyLog.result 를 SUCCESS/FAIL 로 갱신하면 된다.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  issueMagicLink as domainIssueMagicLink,
  queueMail as domainQueueMail,
  type QueueMailInput,
} from "@/lib/domain/mail";
import type { MagicPurpose } from "@/lib/validators/enums";

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
  return domainQueueMail(prisma, input);
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
  return domainIssueMagicLink(prisma, opt);
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

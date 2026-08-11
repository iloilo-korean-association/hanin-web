import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import { maskEmail } from "./normalize";
import { cfgStr, type SettingMap } from "./settings";
import type { MagicPurpose, NotifyKind } from "../validators/enums";

/**
 * 메일 — **보내지 않는다. 대신 보이게 한다.**
 *
 * 로컬 프로토타입이라 외부 메일 프로바이더에 가입하지 않는다(계정 0개 원칙).
 * 보낼 메일은 NotifyLog(15_알림로그) + OutboxMail 두 곳에 적히고,
 * /dev/outbox 화면에서 제목·수신자·본문 HTML 을 눈으로 확인한다.
 * 매직링크도 실제 발송 대신 그 화면의 링크를 눌러 들어간다.
 *
 * ★ 프로덕션으로 갈 때 고칠 곳은 queueMail 하나다.
 *   여기서 실제 프로바이더를 호출하고 결과를 NotifyLog.result 에 적으면 된다.
 *   화면·시드·다른 도메인 코드는 손대지 않는다.
 */

/* ── 링크 경로 규약 ──────────────────────────────────────────────────────
 * 화면 담당들은 **이 함수들이 만드는 경로를 그대로 라우트로 만들면 된다.**
 * 문자열을 각자 하드코딩하면 시드가 만든 링크와 어긋나서 outbox 링크가 404 가 난다.
 * ------------------------------------------------------------------- */

/** 회원 본인 조회. 회원 링크토큰(8자리)으로 들어간다. */
export function memberLinkPath(linkToken: string): string {
  return `/me/${linkToken}`;
}

/** 임원 무비밀번호 로그인. 매직링크 토큰으로 들어간다. */
export function magicLinkPath(token: string): string {
  return `/auth/magic/${token}`;
}

/** 공개 회계 */
export const PUBLIC_LEDGER_PATH = "/ledger";

/* ── 토큰 ────────────────────────────────────────────────────────────── */

/**
 * 회원 링크토큰 8자리.
 * ★ 헷갈리는 글자(0 O 1 I L)를 뺐다. 60대 회원이 손으로 옮겨 적는다.
 * ★ 암호학적 난수를 쓰되, 이 토큰 하나로 민감정보를 열지 마라 —
 *   화면에 이름·연락처·회비 상태까지만 보이고 그 이상은 안 된다.
 */
const TOKEN_POOL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newLinkToken(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += TOKEN_POOL[bytes[i] % TOKEN_POOL.length];
  return out;
}

/** 매직링크 토큰. 사람이 옮겨 적지 않으므로 길고 진하게. */
export function newMagicToken(): string {
  return randomBytes(24).toString("base64url");
}

/* ── 템플릿 ──────────────────────────────────────────────────────────── */

/**
 * {{키}} 치환. 원본 Apps Script 템플릿 문법 그대로.
 * ★ 값은 HTML 이스케이프한다. 회원 이름에 <script> 가 들어와도 본문에서 살아나면 안 된다.
 */
export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  // ★ `\w` 를 쓰면 안 된다. JS 의 `\w` 는 [A-Za-z0-9_] 뿐이라 **한글을 매치하지 못한다.**
  //   우리 템플릿 키는 전부 한글({{성명}} {{영수증번호}} {{금액}})이라
  //   `\{\{(\w+)\}\}` 로는 단 한 건도 치환되지 않고 발송함에 {{성명}} 이 그대로 찍혔다(실측).
  //   중괄호·공백이 아닌 문자열을 키로 받는다. 키 앞뒤 공백({{ 성명 }})도 허용한다.
  return String(tpl ?? "").replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : escapeHtml(String(v));
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 설정에서 템플릿 한 쌍(제목/본문)을 꺼내 렌더한다. */
export function renderFromSettings(
  s: SettingMap,
  name: string,
  vars: Record<string, string | number>,
  fallback: { subject: string; body: string },
): { subject: string; bodyHtml: string } {
  const subject = renderTemplate(cfgStr(s, `템플릿.${name}.제목`, fallback.subject), vars);
  const bodyHtml = renderTemplate(cfgStr(s, `템플릿.${name}.본문`, fallback.body), vars);
  return { subject, bodyHtml };
}

/* ── 발송함에 넣기 ───────────────────────────────────────────────────── */

let notifySeqCache: number | null = null;

/** LG-000001 다음 번호. append-only 라 최대값 + 1 로 충분하다. */
async function nextNotifyLogId(db: Db): Promise<string> {
  if (notifySeqCache === null) {
    const last = await db.notifyLog.findFirst({ orderBy: { logId: "desc" }, select: { logId: true } });
    notifySeqCache = last ? Number(last.logId.replace(/\D/g, "")) : 0;
  }
  notifySeqCache += 1;
  return "LG-" + String(notifySeqCache).padStart(6, "0");
}

/** 테스트·시드에서 캐시를 비운다. */
export function resetNotifySeqCache(): void {
  notifySeqCache = null;
}

export type QueueMailInput = {
  kind: NotifyKind;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  /** 본문에 들어간 앱 내부 경로. /dev/outbox 가 클릭 가능한 링크로 만들어 준다 */
  linkPath?: string;
  memberNo?: string | null;
  relatedId?: string;
  trigger?: string;
  sentAt?: Date;
  /**
   * NotifyLog 초기 결과.
   * · 기본 "SUCCESS" — 현행(발송함 기록 = 완료) 그대로. 시드·실발송 미설정 환경이 여기다.
   * · "DEFERRED"    — 실발송 워커(@/lib/mail-sender)가 있을 때만. 워커가 발송 후
   *                   SUCCESS/FAIL 로 갱신한다. 값은 validators/enums 의 NOTIFY_RESULTS 안이다.
   * ★ 화면 호출부는 이 필드를 직접 쓰지 않는다 — 앱 레벨 어댑터(@/lib/mail)가 환경을 보고 정한다.
   */
  initialResult?: "SUCCESS" | "DEFERRED";
};

/**
 * 메일 한 통을 "보낸다" — 실제로는 NotifyLog + OutboxMail 에 적는다.
 *
 * ★ NotifyLog 에는 마스킹된 주소만 남긴다(15_알림로그 스펙 그대로).
 *   실주소는 OutboxMail 에만 있고, 그 화면은 /dev 아래라 프로덕션에서는 꺼진다.
 */
export async function queueMail(db: Db, input: QueueMailInput): Promise<{ logId: string; outboxId: string }> {
  const logId = await nextNotifyLogId(db);
  const sentAt = input.sentAt ?? new Date();

  await db.notifyLog.create({
    data: {
      logId,
      sentAt,
      kind: input.kind,
      channel: "EMAIL",
      memberNo: input.memberNo ?? null,
      toMasked: maskEmail(input.toEmail),
      subject: input.subject,
      relatedId: input.relatedId ?? "",
      result: input.initialResult ?? "SUCCESS",
      trigger: input.trigger ?? "queueMail",
    },
  });

  const mail = await db.outboxMail.create({
    data: {
      createdAt: sentAt,
      kind: input.kind,
      toEmail: input.toEmail,
      toName: input.toName ?? "",
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      linkPath: input.linkPath ?? "",
      memberNo: input.memberNo ?? null,
      notifyLogId: logId,
    },
    select: { id: true },
  });

  return { logId, outboxId: mail.id };
}

/** 매직링크를 만들고 그 링크가 담긴 메일을 발송함에 넣는다. */
export async function issueMagicLink(
  db: Db,
  opt: {
    purpose: MagicPurpose;
    email: string;
    name?: string;
    memberNo?: string | null;
    officerId?: string | null;
    ttlHours?: number;
    now?: Date;
    /** QueueMailInput.initialResult 와 같다. 앱 레벨 어댑터만 넘긴다. */
    initialResult?: "SUCCESS" | "DEFERRED";
  },
): Promise<{ token: string; linkPath: string; outboxId: string }> {
  const token = newMagicToken();
  const linkPath = magicLinkPath(token);
  const now = opt.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (opt.ttlHours ?? 24) * 3600 * 1000);

  await db.magicLink.create({
    data: {
      token,
      purpose: opt.purpose,
      email: opt.email,
      memberNo: opt.memberNo ?? null,
      officerId: opt.officerId ?? null,
      linkPath,
      expiresAt,
      createdAt: now,
    },
  });

  const who = opt.name ? escapeHtml(opt.name) + "님" : "안녕하세요";
  const queued = await queueMail(db, {
    kind: "매직링크",
    toEmail: opt.email,
    toName: opt.name ?? "",
    subject: "[일로일로 한인회] 로그인 링크",
    bodyHtml:
      `${who}, 아래 링크를 누르시면 비밀번호 없이 바로 들어가실 수 있습니다.<br><br>` +
      `<a href="${linkPath}">${linkPath}</a><br><br>` +
      `이 링크는 ${opt.ttlHours ?? 24}시간 뒤에 만료됩니다. 본인이 요청하지 않으셨다면 그냥 무시하십시오.<br><br>` +
      `일로일로 한인회 드림`,
    linkPath,
    memberNo: opt.memberNo ?? null,
    trigger: "issueMagicLink",
    sentAt: now,
    initialResult: opt.initialResult,
  });

  return { token, linkPath, outboxId: queued.outboxId };
}

/* ── 기본 템플릿 (설정에 값이 없을 때) ──────────────────────────────── */

export const FALLBACK_TEMPLATES = {
  환영: {
    subject: "[일로일로 한인회] 가입을 환영합니다 ({{성명}}님)",
    body:
      "{{성명}}님, 일로일로 한인회 가입을 환영합니다.<br><br>" +
      "회원번호: <b>{{회원번호}}</b><br>{{회계연도}}년 연회비: <b>{{고지금액}} PHP</b><br>납기일: {{납기일}}<br><br>" +
      "회비는 총무에게 현금 또는 GCash 로 납부하실 수 있으며, 납부하시면 영수증 메일이 자동으로 발송됩니다.<br>" +
      "회계 내역은 누구나 열람 가능한 공개 장부에서 확인하실 수 있습니다: {{공개장부URL}}<br><br>" +
      "일로일로 한인회 드림",
  },
  영수증: {
    subject: "[일로일로 한인회] 영수증 {{영수증번호}} ({{금액}} PHP)",
    body:
      "{{성명}}님, 아래와 같이 납부해 주셔서 감사합니다.<br><br>" +
      "영수증번호: <b>{{영수증번호}}</b><br>일자: {{일자}}<br>금액: <b>{{금액}} {{통화}}</b><br>" +
      "항목: {{과목명}}<br>수단: {{수단}}<br>처리: {{입력자}}<br><br>{{미납안내}}<br><br>" +
      "이 영수증은 자동 발송되었습니다. 금액이 다르면 즉시 총무에게 알려 주십시오.<br>" +
      "공개 장부: {{공개장부URL}}<br><br>일로일로 한인회 드림",
  },
  독촉1: {
    subject: "[일로일로 한인회] {{회계연도}}년 회비 납부 안내",
    body:
      "{{성명}}님, 안녕하십니까.<br><br>{{회계연도}}년 연회비 납부 기한이 지났습니다. 확인 부탁드립니다.<br><br>" +
      "고지금액: {{고지금액}} PHP<br>납부금액: {{납부금액}} PHP<br><b>미납금액: {{미납금액}} PHP</b><br>납기일: {{납기일}}<br><br>" +
      "총무에게 현금 또는 GCash 로 납부하시면 됩니다.<br>이미 납부하셨다면 이 메일을 무시하시고 총무에게 알려 주십시오.<br><br>" +
      "일로일로 한인회 드림",
  },
  독촉2: {
    subject: "[일로일로 한인회] {{회계연도}}년 회비 미납 안내 (2차)",
    body:
      "{{성명}}님, {{회계연도}}년 연회비가 아직 미납 상태입니다.<br><br>" +
      "<b>미납금액: {{미납금액}} PHP</b> (납기일 {{납기일}})<br><br>" +
      "회비는 한인회 행사·긴급구호·영사 협조 활동에 쓰입니다. 사용 내역은 공개 장부에서 전액 확인하실 수 있습니다: {{공개장부URL}}<br><br>" +
      "사정이 어려우시면 총무에게 말씀해 주십시오. 감면·분납이 가능합니다.<br><br>일로일로 한인회 드림",
  },
  독촉3: {
    subject: "[일로일로 한인회] {{회계연도}}년 회비 최종 안내",
    body:
      "{{성명}}님, {{회계연도}}년 연회비 관련 마지막 안내드립니다.<br><br><b>미납금액: {{미납금액}} PHP</b><br><br>" +
      "이후로는 회비 관련 자동 안내를 보내지 않습니다. 납부 의사가 없으시거나 회원 자격 정리를 원하시면 회신해 주십시오.<br>" +
      "계속 회원으로 함께해 주시길 바랍니다.<br><br>일로일로 한인회 드림",
  },
  감사장: {
    subject: "[일로일로 한인회] 기부해 주셔서 감사합니다",
    body:
      "{{기부자명}}님의 소중한 기부에 감사드립니다.<br><br>기부번호: {{기부ID}}<br>금액: <b>{{금액}} {{통화}}</b><br>" +
      "지정용도: {{지정용도}}<br><br>지정하신 용도로만 사용하며, 사용 내역은 공개 장부의 기금 현황에 전액 공개됩니다: {{공개장부URL}}<br><br>" +
      "일로일로 한인회 드림",
  },
  월결산: {
    subject: "[일로일로 한인회] {{연월}} 월간 결산 및 현금실사 요청",
    body:
      "{{연월}} 월간 결산을 정리했습니다.<br><br>총수입: <b>{{총수입}} PHP</b><br>총지출: <b>{{총지출}} PHP</b><br>" +
      "월말 잔액: <b>{{잔액}} PHP</b><br><br>현금·GCash 실사를 이번 주 안에 2인 입회로 진행해 주십시오.<br>" +
      "공개 장부: {{공개장부URL}}<br><br>일로일로 한인회 드림",
  },
} as const;

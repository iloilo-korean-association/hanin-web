"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { appendAuditLog } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import {
  cfgNum,
  decideGradeInvoice,
  diffMemberEdit,
  duesTableFrom,
  duplicateCheckTargets,
  editLocks,
  findMemberDuplicate,
  fiscalYearOf,
  formatMoney,
  isFyClosed,
  loadSettings,
  nextMemberType,
  normalizeMemberEmail,
  phoneLast4,
  statusTransition,
  todayManila,
  type MemberEditable,
} from "@/lib/domain";
import { periodChangeNote, syncMembershipPeriod } from "@/lib/dues-period";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { memberUpdateSchema, zMemberNo } from "@/lib/validators";

import { zodFieldErrors, zodSummary } from "../../../../(public)/_shared";
import { deleteStoredFile } from "../../../_lib/upload";
import { fdBool, fdStr, toActionError } from "../../../_lib/server-utils";

/**
 * 임원 회원 정보 수정 — /officer/members/[회원번호] (대표 요청 2026-10-22).
 *
 * ── 가드 ────────────────────────────────────────────────────────────────
 *  ★ 첫 줄: requireOfficer({ permissions: ["회원관리"], write: true }) — 감사 계정은 서버가 거부한다.
 *  ★ M9xxx 시스템 계정은 수정 불가. 임원 **본인** 회원 행의 회비등급·상태도 불가(domain/memberEdit.ts editLocks).
 *  ★ 화면이 잠가도 폼은 직접 POST 할 수 있다 — 같은 판정을 여기서 다시 한다.
 *
 * ── 저장 (전부 한 트랜잭션) ─────────────────────────────────────────────
 *  ① 01_회원 update — 바뀐 칸이 없으면 아무것도 쓰지 않고 "바뀐 내용이 없습니다".
 *  ② 16_감사로그 — 바뀐 칸마다 1건. 상태·회비등급·회원구분은 WARN, 나머지 INFO.
 *     연락처·이메일도 before/after 를 그대로 남긴다(회원 본인 수정 me/[token]/actions.ts 와 같은 관례).
 *  ③ 연락처·이메일 중복 — 가입과 같은 규칙(lib/domain/memberDuplicate.ts). 자기 자신·탈퇴 회원 제외.
 *  ④ 이름 변경 → 그 회원 06_회비고지.성명(조회 편의용 사본)도 갱신. 05_거래 상대방명(원장)은 건드리지 않는다.
 *  ⑤ 회비등급 변경 → 올해(설정 '회계연도') 고지 처리 — decideGradeInvoice. 0원 등급이 되면 면제 +
 *     회원 기간을 **오늘부터**(syncMembershipPeriod exemptFrom).
 *  ⑥ 탈퇴(WITHDRAWN) → MemberCard 행 삭제(회원증·QR 즉시 무효). 사진 **파일**은 커밋 뒤에 지운다 —
 *     저장소는 트랜잭션이 아니라서, 안에서 지웠다가 롤백되면 사진만 사라진 회원이 남는다.
 *     파일 삭제가 실패해도 액션은 성공이다(결과 경고 + 감사로그 WARN, 수동 삭제용 URL 기록).
 */

export type MemberEditValues = {
  name: string;
  phone: string;
  email: string;
  birthYear: string;
  region: string;
  duesGrade: string;
  status: string;
  note: string;
  rosterConsent: boolean;
  notifyConsent: boolean;
};

/** ★ "use server" 파일이라 초기 상태 상수는 MemberEditForm.tsx(클라이언트)에 있다. */
export type MemberEditState = {
  /** null = 아직 실행 전 */
  ok: boolean | null;
  message: string;
  howToFix: string | null;
  at: number;
  /** 성공 시 바뀐 항목 (빈 배열 = 바뀐 내용 없음) */
  changes?: { label: string; before: string; after: string }[];
  /** 저장과 함께 일어난 부수 처리 (고지 단가 조정·사진 삭제 등) */
  notes?: string[];
  /** 저장은 됐지만 총무가 판단하거나 손써야 할 것 */
  warnings?: string[];
  /** 실패 시 칸별 오류 (키 = 입력 name) */
  fieldErrors?: Record<string, string>;
  /** 실패 시 입력값 — 폼이 다시 그려질 때 그대로 채운다 */
  values?: MemberEditValues;
};

function bad(
  message: string,
  howToFix: string | null = null,
  extra: Partial<MemberEditState> = {},
): MemberEditState {
  return { ok: false, message, howToFix, at: Date.now(), ...extra };
}

/** 회원 행에서 읽는 칸 — 수정 대상 + 부수 처리에 필요한 것 */
const MEMBER_SELECT = {
  memberNo: true,
  name: true,
  phone: true,
  email: true,
  birthYear: true,
  region: true,
  memberType: true,
  duesGrade: true,
  note: true,
  rosterConsent: true,
  notifyConsent: true,
  status: true,
  linkToken: true,
} as const;

type OkResult = {
  kind: "ok";
  name: string;
  changes: { label: string; before: string; after: string }[];
  notes: string[];
  warnings: string[];
  /** 커밋 뒤 저장소에서 지울 사진 */
  photoUrl: string;
  linkToken: string;
};
type FailResult = { kind: "fail"; state: MemberEditState };

export async function updateMemberAction(
  _prev: MemberEditState,
  fd: FormData,
): Promise<MemberEditState> {
  // 실패하면 입력값을 그대로 돌려준다(React 가 폼을 비워도 다시 채울 수 있게).
  const values: MemberEditValues = {
    name: fdStr(fd, "name"),
    phone: fdStr(fd, "phone"),
    email: fdStr(fd, "email"),
    birthYear: fdStr(fd, "birthYear"),
    region: fdStr(fd, "region"),
    duesGrade: fdStr(fd, "duesGrade"),
    status: fdStr(fd, "status"),
    note: fdStr(fd, "note"),
    rosterConsent: fdBool(fd, "rosterConsent"),
    notifyConsent: fdBool(fd, "notifyConsent"),
  };

  try {
    // ★ 첫 줄.
    const me = await requireOfficer({
      permissions: ["회원관리"],
      write: true,
      screen: "회원 정보 수정",
    });

    const memberNoParsed = zMemberNo.safeParse(fdStr(fd, "memberNo"));
    if (!memberNoParsed.success) return bad("대상 회원번호가 올바르지 않습니다.", null, { values });
    const memberNo = memberNoParsed.data;

    const locks = editLocks(memberNo, me.memberNo);
    if (locks.all) return bad(locks.all, null, { values });

    const settings = await loadSettings(prisma);
    const today = todayManila();
    const fiscalYear = cfgNum(settings, "회계연도", fiscalYearOf(today));
    const duesTable = duesTableFrom(settings);
    const actorNote = `${me.name}(${me.role})`;

    const result: OkResult | FailResult = await prisma.$transaction(
      async (tx: Tx): Promise<OkResult | FailResult> => {
        const before = await tx.member.findUnique({ where: { memberNo }, select: MEMBER_SELECT });
        if (!before) {
          return { kind: "fail", state: bad(`회원 ${memberNo} 를 찾을 수 없습니다.`, "목록으로 돌아가 다시 골라 주십시오.") };
        }

        /* ── 검증 ── 잠긴(disabled) 칸은 브라우저가 보내지 않는다 → 기존 값 */
        const parsed = memberUpdateSchema.safeParse({
          memberNo,
          name: values.name,
          phone: values.phone,
          email: values.email,
          birthYear: values.birthYear,
          region: values.region,
          duesGrade: fd.has("duesGrade") ? values.duesGrade : before.duesGrade,
          status: fd.has("status") ? values.status : before.status,
          note: values.note,
          rosterConsent: values.rosterConsent,
          notifyConsent: values.notifyConsent,
        });
        if (!parsed.success) {
          return {
            kind: "fail",
            state: bad(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", {
              fieldErrors: zodFieldErrors(parsed.error),
              values,
            }),
          };
        }
        const input = parsed.data;

        if (locks.gradeAndStatus && (input.duesGrade !== before.duesGrade || input.status !== before.status)) {
          return { kind: "fail", state: bad(locks.gradeAndStatus, null, { values }) };
        }

        const beforeEditable: MemberEditable = {
          name: before.name,
          phone: before.phone,
          email: before.email,
          birthYear: before.birthYear,
          region: before.region,
          memberType: before.memberType,
          duesGrade: before.duesGrade,
          note: before.note,
          rosterConsent: before.rosterConsent,
          notifyConsent: before.notifyConsent,
          status: before.status,
        };
        const after: MemberEditable = {
          name: input.name,
          phone: input.phone,
          email: input.email, // zEmail 이 trim·소문자로 만들었다
          birthYear: input.birthYear,
          region: input.region,
          memberType: nextMemberType(before, input.duesGrade),
          duesGrade: input.duesGrade,
          note: input.note,
          rosterConsent: input.rosterConsent,
          notifyConsent: input.notifyConsent,
          status: input.status,
        };

        const diffs = diffMemberEdit(beforeEditable, after);
        if (diffs.length === 0) {
          return {
            kind: "ok",
            name: before.name,
            changes: [],
            notes: [],
            warnings: [],
            photoUrl: "",
            linkToken: before.linkToken,
          };
        }

        /* ── 연락처·이메일 중복 (가입과 같은 규칙, 바뀐 값만) ── */
        const targets = duplicateCheckTargets(before, after);
        if (targets.phone || targets.email) {
          const or: Prisma.MemberWhereInput[] = [];
          if (targets.phone) or.push({ phoneLast4: phoneLast4(targets.phone) });
          if (targets.email) {
            or.push({ email: { contains: normalizeMemberEmail(targets.email), mode: "insensitive" } });
          }
          const candidates = await tx.member.findMany({
            where: { status: { not: "WITHDRAWN" }, memberNo: { not: memberNo }, OR: or },
            select: { memberNo: true, phone: true, email: true, status: true },
          });
          const dup = findMemberDuplicate(candidates, {
            phone: targets.phone,
            email: targets.email,
            excludeMemberNo: memberNo,
          });
          if (dup) {
            // 누구와 겹쳤는지(회원번호·이름)는 알려주지 않는다 — 가입과 같은 원칙.
            const what = dup.phone && dup.email ? "연락처·이메일" : dup.phone ? "연락처" : "이메일";
            const fieldErrors: Record<string, string> = {};
            if (dup.phone) fieldErrors.phone = "이미 다른 회원이 쓰고 있는 연락처입니다.";
            if (dup.email) fieldErrors.email = "이미 다른 회원이 쓰고 있는 이메일입니다.";
            return {
              kind: "fail",
              state: bad(
                `이미 다른 회원이 쓰고 있는 ${what}입니다.`,
                before.status === "WITHDRAWN" && after.status !== "WITHDRAWN"
                  ? "탈퇴해 있는 동안 같은 연락처·이메일로 다른 회원이 가입했을 수 있습니다. 명부에서 확인한 뒤 고쳐 주십시오. 아무것도 저장하지 않았습니다."
                  : "같은 사람이 두 번 등록된 것인지 명부에서 확인해 주십시오. 아무것도 저장하지 않았습니다.",
                { fieldErrors, values },
              ),
            };
          }
        }

        /* ── ① 01_회원 ── */
        await tx.member.update({
          where: { memberNo },
          data: {
            name: after.name,
            phone: after.phone,
            // 중복검사 키다. 번호를 바꾸면 함께 다시 뽑아야 한다(회원 본인 수정과 같다).
            phoneLast4: phoneLast4(after.phone),
            email: after.email,
            birthYear: after.birthYear,
            region: after.region,
            memberType: after.memberType,
            duesGrade: after.duesGrade,
            note: after.note,
            rosterConsent: after.rosterConsent,
            notifyConsent: after.notifyConsent,
            status: after.status,
          },
        });

        /* ── ② 감사로그 — 바뀐 칸마다 1건 ── */
        for (const d of diffs) {
          await appendAuditLog(tx, {
            actor: me.email,
            tableName: "Member",
            recordKey: memberNo,
            fieldName: d.label,
            beforeValue: d.before,
            afterValue: d.after,
            changeType: "EDIT",
            severity: d.severity,
            relatedKey: before.name,
            note:
              `임원 회원정보 수정: ${actorNote} → ${before.name}(${memberNo})` +
              (d.field === "memberType" ? " — 회비등급 변경을 따라감" : ""),
          });
        }

        const notes: string[] = [];
        const warnings: string[] = [];
        let periodNote = "";

        /* ── ④ 이름 → 회비고지 성명 사본 ── */
        if (after.name !== before.name) {
          const copied = await tx.duesInvoice.updateMany({
            where: { memberNo, memberName: { not: after.name } },
            data: { memberName: after.name },
          });
          if (copied.count > 0) {
            await appendAuditLog(tx, {
              actor: me.email,
              tableName: "DuesInvoice",
              recordKey: memberNo,
              fieldName: "성명 (조회 편의용 사본)",
              beforeValue: before.name,
              afterValue: after.name,
              changeType: "EDIT",
              severity: "INFO",
              relatedKey: memberNo,
              note: `회원 성명 변경을 따라 회비고지 ${copied.count}건의 성명 사본을 갱신. 05_거래 상대방명(원장)은 그대로 둠.`,
            });
          }
        }

        /* ── ⑤ 회비등급 → 올해 고지 ── */
        if (after.duesGrade !== before.duesGrade) {
          const inv = await tx.duesInvoice.findUnique({
            where: { fiscalYear_memberNo: { fiscalYear, memberNo } },
            select: {
              invoiceId: true,
              duesGrade: true,
              billedAmount: true,
              paidAmount: true,
              unpaidAmount: true,
              status: true,
              exemptReason: true,
            },
          });
          const decision = decideGradeInvoice({
            invoice: inv,
            newGrade: after.duesGrade,
            newRate: duesTable[after.duesGrade],
            fyClosed: inv ? await isFyClosed(tx, fiscalYear) : false,
          });

          if (decision.kind === "reprice" && decision.changes.length > 0) {
            await tx.duesInvoice.update({ where: { invoiceId: decision.invoiceId }, data: decision.set });
            for (const c of decision.changes) {
              await appendAuditLog(tx, {
                actor: me.email,
                tableName: "DuesInvoice",
                recordKey: decision.invoiceId,
                fieldName: c.field,
                beforeValue: c.before,
                afterValue: c.after,
                changeType: "EDIT",
                severity: "WARN",
                relatedKey: memberNo,
                note: `회비등급 변경(${before.duesGrade} → ${after.duesGrade})에 따라 ${fiscalYear}년 미납 고지를 새 단가로 고침 — ${actorNote}`,
              });
            }
            if (decision.becomesExempt) {
              // 면제가 된 날 = 오늘. 고지일부터 세지 않는다(마스터 확정 규칙).
              const change = await syncMembershipPeriod(tx, decision.invoiceId, {
                actor: me.email,
                via: `임원 회원정보 수정 — 회비등급 ${before.duesGrade} → ${after.duesGrade}(0원), ${actorNote}`,
                exemptFrom: today,
              });
              periodNote = periodChangeNote(change);
            }
            notes.push(
              `${fiscalYear}년 회비고지(${decision.invoiceId})를 새 등급에 맞춰 고쳤습니다: ` +
                `고지 ₱${formatMoney(decision.set.billedAmount)} · ${decision.set.status}.` +
                periodNote,
            );
          } else if (decision.kind === "keep") {
            warnings.push(decision.message);
            await appendAuditLog(tx, {
              actor: me.email,
              tableName: "DuesInvoice",
              recordKey: decision.invoiceId,
              fieldName: "duesGrade",
              beforeValue: inv ? `${inv.duesGrade} · 고지 ₱${inv.billedAmount} · 납부 ₱${inv.paidAmount} · ${inv.status}` : "",
              afterValue: "(변경 안 함)",
              changeType: "OTHER",
              severity: "WARN",
              relatedKey: memberNo,
              note: `회원 회비등급은 ${before.duesGrade} → ${after.duesGrade} 로 바뀌었으나 고지는 그대로 둠: ${decision.message} — ${actorNote}`,
            });
          }
          // no-invoice: 아무것도 하지 않는다
        }

        /* ── ⑥ 상태 ── */
        let photoUrl = "";
        const transition = statusTransition(before.status, after.status);
        if (transition.withdrawing) {
          const card = await tx.memberCard.findUnique({
            where: { memberNo },
            select: { photoUrl: true, photoStatus: true },
          });
          if (card) {
            await tx.memberCard.delete({ where: { memberNo } });
            photoUrl = card.photoUrl;
            await appendAuditLog(tx, {
              actor: me.email,
              tableName: "MemberCard",
              recordKey: memberNo,
              fieldName: "(행 삭제)",
              beforeValue: `${card.photoStatus} / ${card.photoUrl ? "사진 있음" : "사진 없음"} / 진위확인 토큰`,
              afterValue: "(삭제 — 회원증·QR 무효)",
              changeType: "OTHER",
              severity: "WARN",
              relatedKey: before.name,
              note: `탈퇴 처리로 회원증 행 삭제: ${actorNote} → ${before.name}(${memberNo}). 사진 파일은 커밋 뒤 저장소에서 지움(RA 10173, SOP 6-2).`,
            });
          }
          notes.push(
            "탈퇴 처리했습니다 — 이 회원의 로그인·본인 링크(/me)는 다음 요청부터 막힙니다." +
              (card ? " 회원증(QR 확인 포함)은 즉시 무효가 됩니다." : " 회원증 사진은 원래 없었습니다."),
          );
        }
        if (transition.reinstating) {
          warnings.push(
            "탈퇴에서 되돌렸습니다. 탈퇴 처리 때 회원증 사진은 지워졌으므로, 회원이 사진을 다시 올리고 총무가 다시 검수해야 회원증이 나옵니다.",
          );
        }

        return {
          kind: "ok",
          name: after.name,
          changes: diffs.map((d) => ({ label: d.label, before: d.before, after: d.after })),
          notes,
          warnings,
          photoUrl,
          linkToken: before.linkToken,
        };
      },
      { timeout: 20_000 },
    );

    if (result.kind === "fail") return result.state;

    if (result.changes.length === 0) {
      return {
        ok: true,
        message: "바뀐 내용이 없습니다.",
        howToFix: null,
        at: Date.now(),
        changes: [],
        notes: [],
        warnings: [],
      };
    }

    /* ── 커밋 뒤: 탈퇴 회원 사진 파일 삭제 (실패해도 액션은 성공) ── */
    const notes = [...result.notes];
    const warnings = [...result.warnings];
    if (result.photoUrl) {
      const removed = await deleteStoredFile(result.photoUrl);
      try {
        await appendAuditLog(prisma, {
          actor: me.email,
          tableName: "MemberCard",
          recordKey: memberNo,
          fieldName: "photoUrl (저장소 파일)",
          // 실패하면 행은 이미 지워졌으므로 이 기록이 파일을 찾을 유일한 단서다 — URL 을 남긴다(비공개 저장소라 열람엔 인증 필요).
          beforeValue: removed.ok ? "사진 있음" : result.photoUrl,
          afterValue: removed.ok ? "(삭제)" : "(삭제 실패 — 수동 삭제 필요)",
          changeType: "OTHER",
          severity: removed.ok ? "INFO" : "WARN",
          relatedKey: result.name,
          note: removed.ok
            ? `탈퇴 처리로 회원 사진 파일 삭제 — ${actorNote}`
            : `탈퇴 처리 중 회원 사진 파일 삭제 실패: ${removed.message} — 개발 담당이 위 URL 의 파일을 지워야 함`,
        });
      } catch (e) {
        console.error("[officer/members/edit] 사진 삭제 감사로그 기록 실패", e);
      }
      if (!removed.ok) {
        console.warn("[officer/members/edit] 탈퇴 회원 사진 파일 삭제 실패:", removed.message);
        warnings.push(
          `회원증은 무효로 했지만 사진 파일을 저장소에서 지우지 못했습니다(${removed.message}). ` +
            "감사로그(회원번호 " + memberNo + ")에 파일 주소를 남겼습니다 — 개발 담당에게 수동 삭제를 요청해 주십시오.",
        );
      } else {
        notes.push("회원 사진 파일을 저장소에서 삭제했습니다(감사로그 기록).");
      }
    }

    revalidatePath(`${ROUTES.officer}/members`);
    revalidatePath(`${ROUTES.officer}/members/${memberNo}`);
    revalidatePath(`${ROUTES.officer}/members/photos`);
    revalidatePath(`${ROUTES.officer}/dues`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.meHome);
    revalidatePath(ROUTES.meCard);
    if (result.linkToken) revalidatePath(`/me/${result.linkToken}`);
    revalidatePath("/verify/[token]", "page");

    return {
      ok: true,
      message: `${result.name}(${memberNo}) 회원 정보를 저장했습니다 — ${result.changes.length}개 항목.`,
      howToFix: null,
      at: Date.now(),
      changes: result.changes,
      notes,
      warnings,
    };
  } catch (e) {
    const mapped = toActionError(e);
    return bad(mapped.message, mapped.howToFix, { values });
  }
}

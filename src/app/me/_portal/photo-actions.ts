"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { appendAuditLog } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { todayManila } from "@/lib/domain";
import { isGuardError, requireMember, requireMemberSession } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { memberPhotoUploadSchema } from "@/lib/validators";

import { boolOf, fail, textOf, zodFieldErrors, zodSummary, type FormResult } from "../../(public)/_shared";
import { deleteStoredFile, saveDataUrlTo } from "../../officer/_lib/upload";

/**
 * /me · /me/[token] — 회원 본인의 회원증 사진 업로드 (P3).
 *
 * ★ 본인 특정은 **링크토큰 또는 세션 쿠키뿐**이다 (ProfileForm 과 같은 규칙).
 *   폼에 회원번호가 실려 와도 쳐다보지 않는다. M0001 은 순차라서 옆 사람 번호를
 *   넣어 보는 데 3초면 되고, 그게 통하면 남의 얼굴 사진을 갈아치울 수 있다.
 *
 * ★ 동의가 없으면 파일을 **저장조차 하지 않는다.**
 *   동의 검사를 저장 뒤에 두면 "동의 안 했는데 서버에 얼굴 사진이 올라간" 상태가
 *   잠시라도 존재한다. 그 잠시가 곧 수집이다(RA 10173).
 *
 * ★ 올린 사진은 언제나 '대기' 로 들어간다. 회원이 스스로 승인할 방법은 없다 —
 *   부적절 사진을 거르는 것이 검수의 목적이므로 이 액션에는 승인 경로가 아예 없다.
 */

/** 저장 경로 프리픽스. upload.ts 의 PREFIX_RE(소문자·숫자·하이픈) 를 지킨다. */
const PHOTO_PREFIX = "members/photos";

export interface PhotoUploadOk {
  /** 화면에 띄울 안내 문장 */
  message: string;
}

export type PhotoUploadState = FormResult<PhotoUploadOk>;

/**
 * 회원증 진위확인 토큰.
 *
 * 128비트 난수를 base64url 로. 회원번호·이름·가입일 등 **추측 가능한 값을 절대
 * 섞지 않는다** — 이 토큰 하나가 /verify 페이지의 유일한 접근 통제이기 때문이다.
 * 한 번 만들면 재업로드해도 바꾸지 않는다(이미 인쇄된 카드의 QR 이 죽으면 안 된다).
 */
function newVerifyToken(): string {
  return randomBytes(16).toString("base64url");
}

export async function uploadMyPhotoAction(
  _prev: PhotoUploadState,
  formData: FormData,
): Promise<PhotoUploadState> {
  const token = textOf(formData, "token");

  let me;
  try {
    me = token ? await requireMember(token.toUpperCase()) : await requireMemberSession();
  } catch (e) {
    if (isGuardError(e)) return fail(e.message, e.howToFix);
    throw e;
  }

  /* ── ① 별도 동의 (명부공개동의와 분리된 독립 항목) ── */
  const parsed = memberPhotoUploadSchema.safeParse({
    photoConsent: boolOf(formData, "photoConsent") ? (true as const) : undefined,
  });
  if (!parsed.success) {
    return fail(
      zodSummary(parsed.error),
      "사진은 회원증 발급과 본인 확인에만 씁니다. 동의 칸에 체크해 주십시오.",
      zodFieldErrors(parsed.error),
    );
  }

  /* ── ② 사진 ── */
  const dataUrl = textOf(formData, "photoDataUrl");
  if (!dataUrl) {
    return fail(
      "올리실 사진을 선택해 주십시오.",
      "휴대폰이면 “사진 선택” 을 누르면 카메라가 바로 열립니다.",
      { photoDataUrl: "사진이 첨부되지 않았습니다." },
    );
  }
  // 증빙(_lib/upload.ts)은 PDF 도 받지만 회원증 사진은 얼굴 이미지여야 한다.
  if (!dataUrl.startsWith("data:image/")) {
    return fail(
      "회원증 사진은 사진 파일(JPG·PNG)이어야 합니다.",
      "PDF·문서 파일은 회원증에 넣을 수 없습니다.",
      { photoDataUrl: "사진 파일만 올리실 수 있습니다." },
    );
  }

  // 저장은 트랜잭션 **밖에서** 먼저 한다(upload.ts 주석의 이유와 같다).
  const saved = await saveDataUrlTo(PHOTO_PREFIX, dataUrl, todayManila());
  if (!saved.ok) return fail(saved.message);

  /* ── ③ 기록 ── */
  const before = await prisma.memberCard.findUnique({
    where: { memberNo: me.memberNo },
    select: { photoUrl: true, photoStatus: true },
  });

  const now = new Date();
  try {
    await prisma.$transaction(async (tx: Tx) => {
      await tx.memberCard.upsert({
        where: { memberNo: me.memberNo }, // ★ 폼 값이 아니라 토큰·세션에서 나온 값
        create: {
          memberNo: me.memberNo,
          verifyToken: newVerifyToken(),
          photoUrl: saved.url,
          photoStatus: "대기",
          photoUploadedAt: now,
          photoConsentAt: now,
        },
        update: {
          photoUrl: saved.url,
          photoStatus: "대기",
          photoUploadedAt: now,
          photoConsentAt: now,
          // 새 사진은 새로 봐야 한다 — 이전 검수 결과를 지운다.
          photoReviewedBy: "",
          photoReviewedAt: null,
          photoRejectReason: "",
          // verifyToken 은 건드리지 않는다(이미 인쇄된 카드의 QR 유지)
        },
      });

      await appendAuditLog(tx, {
        actor: `${me.memberNo} (회원 본인)`,
        tableName: "MemberCard",
        recordKey: me.memberNo,
        fieldName: "photoUrl",
        beforeValue: before ? `${before.photoStatus} / ${before.photoUrl ? "사진 있음" : "사진 없음"}` : "(없음)",
        afterValue: "대기 / 사진 있음",
        changeType: before ? "EDIT" : "INSERT",
        severity: "INFO",
        note:
          "회원 본인이 회원증 사진을 올림. 사진 수집·이용 동의 시각 갱신(목적: 회원증 발급 및 본인 확인).",
      });
    });
  } catch (e) {
    console.error("[me/photo] 저장 실패", e);
    // DB 에 못 넣었으면 방금 올린 파일은 고아다. 얼굴 사진을 쓰레기로 남기지 않는다.
    await deleteStoredFile(saved.url);
    return fail(
      "사진을 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  // 밀려난 옛 사진은 지운다. 실패해도 업로드를 되돌리지 않는다(best effort).
  if (before?.photoUrl && before.photoUrl !== saved.url) {
    const removed = await deleteStoredFile(before.photoUrl);
    if (!removed.ok) console.warn("[me/photo] 이전 사진 삭제 실패:", removed.message);
  }

  revalidatePath(ROUTES.meHome);
  revalidatePath(ROUTES.meCard);
  revalidatePath(`/me/${me.linkToken}`);
  revalidatePath(`${ROUTES.officer}/members`);
  revalidatePath(`${ROUTES.officer}/members/photos`);

  return {
    status: "ok",
    message:
      "사진을 올렸습니다. 총무가 확인한 뒤 회원증이 발급됩니다 — 따로 하실 일은 없습니다.",
  };
}

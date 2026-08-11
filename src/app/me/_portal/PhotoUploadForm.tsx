"use client";

import { useActionState, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  FormStack,
} from "@/components/ui";

import { PhotoField } from "../../officer/_components/PhotoField";
import { IDLE, type FieldErrors } from "../../(public)/_shared";
import { uploadMyPhotoAction, type PhotoUploadState } from "./photo-actions";

/**
 * 회원증 사진 업로드 (P3) — 회원 본인 화면.
 *
 * 왜 임원 증빙과 같은 PhotoField 를 쓰는가: 현지 회선이 느리고 폰 사진은 4~8MB 다.
 * 보내기 전에 브라우저에서 줄이는 그 로직을 두 벌 만들 이유가 없다.
 *
 * ★ 동의 체크는 **명부공개동의와 별개**다. 여기 체크가 없으면 서버가 저장조차 하지
 *   않는다(photo-actions.ts). 화면에서 버튼을 잠그는 것은 통제가 아니므로,
 *   여기서 잠그는 것은 "왜 안 되는지 미리 보여 주기" 용도일 뿐이다.
 */

function errOf(state: PhotoUploadState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

const STATUS_LABEL: Record<string, { tone: "neutral" | "info" | "success" | "warn" | "danger"; text: string }> = {
  대기: { tone: "warn", text: "총무 확인 중" },
  승인: { tone: "success", text: "승인됨" },
  반려: { tone: "danger", text: "반려됨" },
};

export function PhotoUploadForm({
  token,
  photoStatus,
  photoViewUrl,
  rejectReason,
  uploadedAtText,
}: {
  /** 매직링크 모드면 링크토큰, 세션 모드면 빈 문자열 */
  token: string;
  /** "" = 아직 한 장도 올리지 않음 */
  photoStatus: string;
  /** 서명 URL(10분). 본인 사진만 넘어온다 — 서버가 세션·토큰으로 특정한 것이다 */
  photoViewUrl: string;
  rejectReason: string;
  uploadedAtText: string;
}) {
  const [state, formAction, pending] = useActionState<PhotoUploadState, FormData>(
    uploadMyPhotoAction,
    IDLE,
  );
  const [consented, setConsented] = useState(false);
  const [hasFile, setHasFile] = useState(false);

  // 성공하면 첨부를 비운다 — 같은 사진이 남아 있으면 두 번 올리게 된다.
  const resetKey = state.status === "ok" ? 1 : 0;
  const badge = STATUS_LABEL[photoStatus];

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />

      <Card>
        <CardHeader
          title="회원증 사진"
          description="총무가 확인한 뒤 디지털 회원증이 발급됩니다. 얼굴이 정면으로 잘 보이는 사진 한 장이면 됩니다."
          action={badge ? <Badge tone={badge.tone} dot>{badge.text}</Badge> : null}
        />
        <CardBody>
          <div className="flex flex-col gap-4">
            {state.status === "error" ? (
              <Alert tone="error" title={state.message}>
                {state.howToFix ? <p>{state.howToFix}</p> : null}
              </Alert>
            ) : null}

            {state.status === "ok" ? (
              <Alert tone="success" title="사진을 접수했습니다">
                <p>{state.message}</p>
              </Alert>
            ) : null}

            {/* ── 지금 상태 ─────────────────────────────────────────── */}
            {photoStatus === "반려" ? (
              <Alert tone="warn" title="사진이 반려되었습니다">
                <p>
                  사유: <b>{rejectReason || "(사유가 기록되지 않았습니다 — 총무에게 문의해 주십시오)"}</b>
                </p>
                <p className="mt-1">아래에서 다른 사진으로 다시 올려 주시면 됩니다.</p>
              </Alert>
            ) : null}

            {photoStatus === "대기" ? (
              <Alert tone="info" title="총무 확인 후 발급됩니다">
                <p>
                  {uploadedAtText ? `${uploadedAtText}에 ` : ""}올려 주신 사진을 총무가 확인하고
                  있습니다. 확인이 끝나면 이 화면에 회원증이 나타납니다.
                </p>
              </Alert>
            ) : null}

            {photoViewUrl ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-field)] border border-line bg-surface-sub p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- 만료되는 서명 URL 이라 next/image 최적화 캐시에 올리면 안 된다 */}
                <img
                  src={photoViewUrl}
                  alt="현재 등록된 내 회원증 사진"
                  className="h-28 w-auto max-w-[7rem] rounded border border-line object-cover"
                />
                <div className="min-w-0 text-sm text-ink-muted">
                  <p className="font-semibold text-ink">지금 등록된 사진입니다.</p>
                  <p className="mt-0.5">
                    이 사진은 본인과 총무만 볼 수 있습니다. 공개 화면에는 어떤 경우에도 나가지
                    않습니다.
                  </p>
                </div>
              </div>
            ) : null}

            {/* ── 업로드 ────────────────────────────────────────────── */}
            <FormStack>
              <Checkbox
                id="photo-consent"
                name="photoConsent"
                checked={consented}
                onChange={(e) => setConsented(e.currentTarget.checked)}
                label="사진 수집·이용에 동의합니다 (필수)"
                description={
                  "수집 목적: 디지털 회원증 발급 및 본인 확인. 보관 기간: 회원 자격 유지 기간 " +
                  "(탈퇴하시거나 동의를 철회하시면 사진을 지웁니다). 이 동의는 회원 명부 공개 동의와 " +
                  "별개이며, 동의하지 않으셔도 회원 자격에는 아무런 영향이 없습니다. " +
                  "— 필리핀 개인정보보호법(RA 10173)"
                }
              />
              {errOf(state, "photoConsent") ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {errOf(state, "photoConsent")}
                </p>
              ) : null}

              <PhotoField
                name="photoDataUrl"
                label="사진 선택"
                labelEn="Photo"
                hint="얼굴이 정면으로 나온 사진. 모자·선글라스 없이, 배경은 단순한 곳이 좋습니다. 보내기 전에 자동으로 줄입니다."
                captureMode="user"
                savedNote="본인과 총무만 볼 수 있는 비공개 저장소에 보관됩니다. 공개 화면에는 나가지 않습니다."
                onChangeHasFile={setHasFile}
                resetKey={resetKey}
              />
              {errOf(state, "photoDataUrl") ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {errOf(state, "photoDataUrl")}
                </p>
              ) : null}
            </FormStack>
          </div>
        </CardBody>
        <CardFooter>
          <p className="text-sm text-ink-muted">
            {consented
              ? "올리시면 “총무 확인 대기” 상태가 됩니다."
              : "동의 칸에 체크하셔야 사진을 올리실 수 있습니다."}
          </p>
          <Button
            type="submit"
            disabled={pending || !consented || !hasFile}
            className="w-full sm:w-auto"
          >
            {pending ? "올리는 중…" : photoStatus ? "사진 다시 올리기" : "사진 올리기"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

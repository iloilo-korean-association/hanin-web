"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Field, fieldAria, Textarea } from "@/components/ui";

import { IDLE, type ActionState } from "../../../_lib/action-state";
import { reviewMemberPhotoAction } from "../photo-actions";

/**
 * 사진 한 건의 승인 / 반려 (P3).
 *
 * 반려 사유 칸은 "반려" 를 누를 때만 펼친다 — 승인이 대부분인데 매번 빈 칸이
 * 보이면 총무가 거기에 뭘 적어야 하나 멈칫한다.
 *
 * ★ 화면에서 버튼을 잠그는 것은 통제가 아니다. 권한·감사 판정과 사유 필수는
 *   서버 액션(photo-actions.ts)이 다시 검사한다. 여기서 잠그는 것은 안내일 뿐이다.
 */
export function PhotoReviewForm({
  memberNo,
  memberName,
  disabled,
  disabledReason,
}: {
  memberNo: string;
  memberName: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    reviewMemberPhotoAction,
    IDLE,
  );
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const reasonId = `reject-reason-${memberNo}`;

  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}
      {state.ok === true ? <Alert tone="success" title={state.message} /> : null}

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <form action={formAction}>
            <input type="hidden" name="memberNo" value={memberNo} />
            <input type="hidden" name="decision" value="승인" />
            <Button
              type="submit"
              size="sm"
              disabled={pending || disabled}
              title={disabled ? disabledReason : undefined}
            >
              {pending ? "처리 중…" : "승인"}
            </Button>
          </form>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending || disabled}
            title={disabled ? disabledReason : undefined}
            onClick={() => setMode("reject")}
          >
            반려
          </Button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="memberNo" value={memberNo} />
          <input type="hidden" name="decision" value="반려" />
          <Field
            htmlFor={reasonId}
            label="반려 사유"
            required
            hint="회원 화면에 그대로 보입니다. 무엇을 고쳐야 하는지 적어 주십시오."
          >
            <Textarea
              id={reasonId}
              name="rejectReason"
              rows={3}
              required
              maxLength={200}
              placeholder="예: 얼굴이 정면으로 보이지 않습니다. 모자를 벗고 다시 찍어 주십시오."
              {...fieldAria(reasonId, { hint: true })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="danger"
              disabled={pending || disabled}
              title={disabled ? disabledReason : undefined}
            >
              {pending ? "처리 중…" : `${memberName} 님 사진 반려`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              취소
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

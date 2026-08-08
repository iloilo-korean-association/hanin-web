"use client";

import { useActionState } from "react";

import { Alert, Button, ButtonRow, Field, fieldAria, Textarea } from "@/components/ui";

import { IDLE } from "../../_lib/action-state";
import { decideApprovalAction } from "./actions";

/**
 * 결재 버튼 한 세트.
 *
 * ★ 회피(recusal) 대상이어도 **버튼을 숨기지 않는다.** 비활성 + 사유를 그대로 보여준다.
 *   투명성이 설계 의도다 — 숨기면 "왜 나한테는 안 보이지?" 가 되고, 회피가 일어났다는
 *   사실 자체가 화면에서 사라진다.
 * ★ 그리고 화면 비활성은 통제가 아니다. 서버 액션이 canOfficerApprove 로 다시 판정한다.
 */
export function DecisionForm({
  approvalId,
  stage,
  blockedReason,
}: {
  approvalId: string;
  /** 지금 필요한 결재 차수. null 이면 결재할 것이 없다. */
  stage: 1 | 2 | null;
  /** 못 누르는 이유. null 이면 누를 수 있다. */
  blockedReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(decideApprovalAction, IDLE);
  const disabled = blockedReason !== null || stage === null || pending;

  return (
    <form action={formAction} className="no-print">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="stage" value={stage ?? 1} />

      {state.ok === true ? <Alert tone="success" title={state.message} className="mb-3" /> : null}
      {state.ok === false ? (
        <Alert tone="error" title={state.message} className="mb-3">
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}

      <Field
        htmlFor={`comment-${approvalId}`}
        label="결재 의견"
        hint="반려할 때는 사유가 사실상 필수입니다. 여기 적은 문장은 승인 이력과 감사로그에 그대로 남습니다."
      >
        <Textarea
          {...fieldAria(`comment-${approvalId}`, { hint: true })}
          id={`comment-${approvalId}`}
          name="comment"
          rows={2}
          maxLength={300}
          disabled={disabled}
        />
      </Field>

      <ButtonRow className="mt-3">
        <Button
          type="submit"
          name="decision"
          value="승인"
          disabled={pending}
          disabledReason={
            blockedReason ?? (stage === null ? "지금 이 건에 필요한 결재가 없습니다." : null)
          }
        >
          {pending ? "처리 중…" : `${stage ?? ""}차 승인`}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="반려"
          variant="danger"
          disabled={pending}
          disabledReason={
            blockedReason ?? (stage === null ? "지금 이 건에 필요한 결재가 없습니다." : null)
          }
        >
          반려
        </Button>
      </ButtonRow>
    </form>
  );
}

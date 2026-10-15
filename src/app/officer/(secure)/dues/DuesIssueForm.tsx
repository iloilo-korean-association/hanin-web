"use client";

import { useActionState } from "react";

import { Alert, Button, ButtonRow } from "@/components/ui";

import { IDLE } from "../../_lib/action-state";
import { issueDuesAction } from "./actions";

/**
 * "N명에게 2026 회비고지 생성" 버튼 하나.
 *
 * ★ 명단은 보내지 않는다. 보내는 것은 미리보기의 회계연도와 지문(fingerprint)뿐이고,
 *   서버가 트랜잭션 안에서 다시 계산해 지문이 같을 때만 만든다.
 * ★ action 에 서버 액션을 **그대로** 넘긴다 — 스크립트가 꺼진 환경에서도 폼이 제출된다.
 * ★ 결과 메시지는 버튼이 잠겨도(대상 0명) 계속 보이도록 이 컴포넌트를 항상 그린다.
 */
export function DuesIssueForm({
  fiscalYear,
  fingerprint,
  count,
  disabled,
  disabledReason,
}: {
  fiscalYear: number;
  fingerprint: string;
  count: number;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(issueDuesAction, IDLE);

  return (
    <div className="flex flex-col gap-3">
      {state.ok !== null && state.message ? (
        <Alert tone={state.ok ? "success" : "error"} title={state.message}>
          {state.howToFix}
        </Alert>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="fiscalYear" value={fiscalYear} />
        <input type="hidden" name="fingerprint" value={fingerprint} />
        <ButtonRow>
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || pending}
            title={disabled ? (disabledReason ?? undefined) : undefined}
          >
            {pending ? "만드는 중…" : `${count}명에게 ${fiscalYear} 회비고지 생성`}
          </Button>
        </ButtonRow>
        {disabled && disabledReason ? (
          <p className="mt-2 text-sm text-ink-muted">{disabledReason}</p>
        ) : null}
      </form>
    </div>
  );
}

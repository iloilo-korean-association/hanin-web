"use client";

import { useActionState, useId } from "react";

import { Alert, Button, Field, Select, fieldAria } from "@/components/ui";

import { IDLE, type ActionState } from "../../../_lib/action-state";
import { applyBatchAction } from "../actions";

/**
 * 반영 — status=정상 인 행을 05_거래로 만든다.
 *
 * ── 확인자(I4)를 왜 여기서 고르는가 ─────────────────────────────────────
 *  현금 수납이 임계액(00_설정 '현금2인확인_임계액', 기본 ₱3,000)을 넘으면
 *  **입력자와 다른 확인자**가 있어야 POSTED 가 된다(I4). 없으면 그 행은 DRAFT 로
 *  기록되고 공개 회계 집계에서 빠진다.
 *  과거 장부를 옮기는 일도 예외가 아니다 — 예외를 만들면 "임포트로 올리면 2인 확인이
 *  면제된다" 는 우회로가 생긴다. 그래서 유령 확인자를 만들지 않고, **실재하는 현직 임원**을
 *  고르게 한다(서버가 다시 검증한다). 회장·감사가 과거 장부를 함께 확인했다는 기록이 남는다.
 */
export function ApplyForm({
  batchId,
  normalCount,
  needsReviewCount,
  cashOverThresholdCount,
  cashThreshold,
  officers,
  disabled,
  disabledReason,
}: {
  batchId: string;
  normalCount: number;
  needsReviewCount: number;
  cashOverThresholdCount: number;
  cashThreshold: number;
  officers: { email: string; label: string }[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    applyBatchAction,
    IDLE,
  );
  const id = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}
      {state.ok === true ? <Alert tone="success" title="반영 완료">{state.message}</Alert> : null}

      <input type="hidden" name="batchId" value={batchId} />

      {needsReviewCount > 0 ? (
        <Alert tone="warn" title={`확인필요 ${needsReviewCount}건은 건너뜁니다`}>
          <p>
            날짜나 금액을 읽지 못한 행입니다. 지금 반영해도 되지만 이 {needsReviewCount}건은 장부에
            들어가지 않습니다 — 아래 목록에서 날짜·금액을 지정하거나 제외로 처리한 뒤 다시
            반영하면 이어서 들어갑니다.
          </p>
        </Alert>
      ) : null}

      {cashOverThresholdCount > 0 ? (
        <Alert tone="warn" title={`현금 ₱${cashThreshold.toLocaleString("en-PH")} 초과 ${cashOverThresholdCount}건 — 2인 확인 대상(I4)`}>
          <p>
            확인자를 고르지 않으면 이 {cashOverThresholdCount}건은 <b>미확정(DRAFT)</b> 으로
            기록되어 공개 회계 집계에 잡히지 않습니다. 과거 장부를 함께 확인한 임원을 골라
            주십시오.
          </p>
        </Alert>
      ) : null}

      <Field
        htmlFor={id}
        label="확인자 (2인 확인)"
        labelEn="Verified by"
        hint="본인은 고를 수 없습니다. 고르지 않으면 현금 고액 행만 DRAFT 로 남고 나머지는 정상 반영됩니다."
      >
        <Select id={id} name="verifiedBy" defaultValue="" disabled={disabled || pending} {...fieldAria(id, { hint: true })}>
          <option value="">— 지정하지 않음 —</option>
          {officers.map((o) => (
            <option key={o.email} value={o.email}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || pending || normalCount === 0}
          title={disabled ? disabledReason : undefined}
        >
          {pending
            ? "반영 중… (수백 건이라 시간이 걸립니다)"
            : `정상 ${normalCount.toLocaleString("en-PH")}건 장부에 반영`}
        </Button>
      </div>

      <p className="text-sm text-ink-muted">
        반영은 되돌릴 수 없습니다(I1 — 거래는 삭제되지 않습니다). 잘못 들어간 거래는 승인·집행
        화면에서 무효 처리하고 정정 거래를 새로 만들어야 합니다. 같은 배치를 다시 눌러도 이미
        반영된 행은 건너뛰므로 두 번 들어가지 않습니다.
      </p>
    </form>
  );
}

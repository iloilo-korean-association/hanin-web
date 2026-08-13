"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";

import { IDLE, type ActionState } from "../../../_lib/action-state";
import { editImportRowAction } from "../actions";

/**
 * 임포트 행 1건 편집 — 확인필요를 해소하는 유일한 손잡이.
 *
 * 날짜·금액·내역을 지정하면 서버가 파서와 **같은 기준**으로 상태를 다시 계산한다
 * (recomputeRowStatus). 화면이 자체 판단으로 '정상' 을 만들지 않는다.
 *
 * · 제외   — 이 행은 장부에 넣지 않는다(중복 기재·오기재 등)
 * · 복구   — 파서가 처음 읽은 값으로 되돌린다
 *
 * ★ 반영된 행은 서버가 편집을 거부한다. 화면에서도 잠그지만 그건 안내일 뿐이다.
 */
export function RowEditForm({
  rowId,
  date,
  amount,
  description,
  currency,
  locked,
  lockedReason,
  showDescription,
}: {
  rowId: string;
  date: string | null;
  amount: number;
  description: string;
  currency: string;
  locked?: boolean;
  lockedReason?: string;
  /** 지출 행은 내역이 없으면 반영할 수 없다 — 그 칸을 열어 준다 */
  showDescription?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    editImportRowAction,
    IDLE,
  );

  return (
    <div className="flex min-w-[19rem] flex-col gap-1.5">
      {state.ok === false ? (
        <p className="text-sm font-semibold text-danger">
          {state.message}
          {state.howToFix ? <span className="block font-normal">{state.howToFix}</span> : null}
        </p>
      ) : null}
      {state.ok === true ? (
        <p className="text-sm font-semibold text-success">{state.message}</p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-1.5">
        <input type="hidden" name="rowId" value={rowId} />
        {/* ★ op 은 **누른 버튼**이 보낸다. hidden input 으로도 같이 보내면 FormData.get 이
            먼저 온 hidden 값을 돌려줘서 제외·복구가 저장으로 둔갑한다. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`date-${rowId}`}>
            날짜 지정
          </label>
          <Input
            id={`date-${rowId}`}
            name="date"
            type="date"
            defaultValue={date ?? ""}
            disabled={locked || pending}
            className="w-[10.5rem]"
          />
          <label className="sr-only" htmlFor={`amount-${rowId}`}>
            금액 지정 ({currency})
          </label>
          <Input
            id={`amount-${rowId}`}
            name="amount"
            inputMode="numeric"
            defaultValue={String(amount)}
            disabled={locked || pending}
            className="w-[7.5rem]"
          />
          <span className="text-sm text-ink-muted">{currency}</span>
        </div>
        {showDescription ? (
          <>
            <label className="sr-only" htmlFor={`desc-${rowId}`}>
              내역
            </label>
            <Input
              id={`desc-${rowId}`}
              name="description"
              defaultValue={description}
              maxLength={200}
              placeholder="무엇에 쓴 돈인지"
              disabled={locked || pending}
            />
          </>
        ) : (
          <input type="hidden" name="description" value={description} />
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="submit"
            size="sm"
            name="op"
            value="저장"
            disabled={locked || pending}
            title={locked ? lockedReason : undefined}
          >
            {pending ? "저장 중…" : "저장"}
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            name="op"
            value="제외"
            disabled={locked || pending}
            title={locked ? lockedReason : "이 행은 장부에 넣지 않습니다"}
          >
            제외
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            name="op"
            value="복구"
            disabled={locked || pending}
            title={locked ? lockedReason : "파서가 처음 읽은 값으로 되돌립니다"}
          >
            원상복구
          </Button>
        </div>
      </form>
    </div>
  );
}

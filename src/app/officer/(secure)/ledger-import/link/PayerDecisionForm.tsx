"use client";

import { useActionState, useState } from "react";

import { Button, Input } from "@/components/ui";

import { IDLE, type ActionState } from "../../../_lib/action-state";
import { decidePayerAction } from "./actions";

/**
 * 납부자 표기 1건 판정 (L4).
 *
 * 세 갈래 중 하나를 고른다:
 *   ① 기존 회원 — 회원번호를 입력(공용 datalist 로 이름 검색)하고 "연결"
 *   ② 이 이름으로 회원 생성 — 이름만으로 01_회원을 만든다("회원관리" 권한 필요)
 *   ③ 회원 아님 — 단체·오기재. 기록으로 남겨 미연결 목록에서 내린다
 *
 * ★ 부부 병기("○○/○○")·상호 병기는 쪼개지 않는다. 총무가 둘 중 한 명을 고르거나
 *   회원 아님으로 두면 된다. 쪼개는 순간 엑셀 합계와 대조가 불가능해진다.
 */
export function PayerDecisionForm({
  alias,
  idKey,
  memberListId,
  currentMemberNo,
  currentKind,
  canCreateMember,
  disabled,
  disabledReason,
}: {
  alias: string;
  /** 표기 원문에는 공백·괄호·슬래시가 섞여 있어 id 로 쓸 수 없다. 목록 순번을 받아 쓴다. */
  idKey: string;
  /** 페이지에 한 번만 그린 <datalist> 의 id. 표기마다 목록을 복제하지 않는다. */
  memberListId: string;
  currentMemberNo: string | null;
  currentKind: string | null;
  canCreateMember: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    decidePayerAction,
    IDLE,
  );
  const [mode, setMode] = useState<"idle" | "new">("idle");

  return (
    <div className="flex min-w-[20rem] flex-col gap-1.5">
      {state.ok === false ? (
        <p className="text-sm font-semibold text-danger">
          {state.message}
          {state.howToFix ? <span className="block font-normal">{state.howToFix}</span> : null}
        </p>
      ) : null}
      {state.ok === true ? (
        <p className="text-sm font-semibold text-success">{state.message}</p>
      ) : null}

      {mode === "idle" ? (
        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="alias" value={alias} />
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor={`member-${idKey}`}>
              {alias} — 연결할 회원번호
            </label>
            <Input
              id={`member-${idKey}`}
              name="memberNo"
              list={memberListId}
              defaultValue={currentMemberNo ?? ""}
              placeholder="회원 검색 (이름·번호)"
              disabled={disabled || pending}
              className="w-[13rem]"
            />
            <Button
              type="submit"
              size="sm"
              name="decision"
              value="기존회원"
              disabled={disabled || pending}
              title={disabled ? disabledReason : "이 표기를 위 회원에 연결합니다"}
            >
              {pending ? "처리 중…" : "연결"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || pending || !canCreateMember}
              title={
                canCreateMember
                  ? "이 이름으로 회원을 새로 만듭니다"
                  : '"회원관리" 권한이 있어야 회원을 만들 수 있습니다'
              }
              onClick={() => setMode("new")}
            >
              이 이름으로 회원 생성
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              name="decision"
              value="회원아님"
              disabled={disabled || pending}
              title={disabled ? disabledReason : "단체·오기재 등 회원이 아닌 표기"}
            >
              회원 아님
            </Button>
          </div>
          {currentKind ? (
            <p className="text-sm text-ink-muted">
              현재 판정: {currentKind}
              {currentMemberNo ? ` · ${currentMemberNo}` : ""} (다시 고르면 바뀝니다)
            </p>
          ) : null}
        </form>
      ) : (
        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="alias" value={alias} />
          <p className="text-sm">
            <b>{alias}</b> 이름으로 회원을 새로 만듭니다. 연락처·생년은 비워 둡니다(나중에 회원
            본인이 채웁니다). 가입일은 장부에서 확인되는 가장 이른 납부일로 기록됩니다.
          </p>
          <label className="sr-only" htmlFor={`note-${idKey}`}>
            비고
          </label>
          <Input
            id={`note-${idKey}`}
            name="note"
            maxLength={200}
            placeholder="비고 (선택) — 예: 2021년부터 회비 납부"
            disabled={pending}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="submit"
              size="sm"
              name="decision"
              value="신규회원"
              disabled={disabled || pending}
              title={disabled ? disabledReason : undefined}
            >
              {pending ? "생성 중…" : "회원 생성하고 연결"}
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

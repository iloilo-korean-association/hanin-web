"use client";

import { useActionState } from "react";

import { Alert, Button } from "@/components/ui";

import { resetMemberPasswordAction, type ResetPasswordState } from "./actions";

/** 초기 상태 — actions.ts 는 "use server" 라 객체를 export 할 수 없어 여기 둔다. */
const RESET_IDLE: ResetPasswordState = { ok: null, message: "", howToFix: null, at: 0 };

/**
 * 회원 한 명의 "비밀번호 재설정" 버튼 + 임시 비밀번호 1회 표시 (P1).
 *
 * 임시 비밀번호는 이 화면에만, 이 렌더에만 있다 — 새로고침하면 사라지고
 * DB 에는 해시만 남는다. 총무는 이 값을 회원에게 직접(전화·대면) 알려 준다.
 */
export function ResetPasswordButton({
  memberNo,
  memberName,
  disabled,
  disabledReason,
}: {
  memberNo: string;
  memberName: string;
  /** 권한이 없거나 감사 계정이면 화면에서도 잠근다 (서버는 어차피 거부한다). */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    resetMemberPasswordAction,
    RESET_IDLE,
  );

  return (
    <div className="flex flex-col gap-2">
      <form
        action={formAction}
        onSubmit={(e) => {
          // 실수 클릭 방지 — 기존 비밀번호가 있으면 그 자리에서 무효가 되기 때문이다.
          if (!window.confirm(`${memberName}(${memberNo})님의 비밀번호를 재설정하시겠습니까?\n기존 비밀번호는 즉시 사용할 수 없게 됩니다.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="memberNo" value={memberNo} />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={pending || disabled}
          title={disabled ? disabledReason : undefined}
        >
          {pending ? "발급 중…" : "비밀번호 재설정"}
        </Button>
      </form>

      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}

      {state.ok === true && state.tempPassword ? (
        <Alert tone="warn" title="임시 비밀번호 — 지금만 보입니다">
          <p className="font-mono text-lg font-bold tracking-widest">{state.tempPassword}</p>
          <p className="mt-1 text-sm">
            {state.memberName}({state.memberNo})님께 직접 전달해 주십시오. 화면을 벗어나면 다시 볼 수
            없습니다. 회원이 이 값으로 로그인하면 새 비밀번호를 만들도록 강제됩니다.
          </p>
        </Alert>
      ) : null}
    </div>
  );
}

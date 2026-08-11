"use client";

import { useActionState } from "react";

import { Alert, Button, Field, fieldAria, FormStack, Input } from "@/components/ui";

import { IDLE, type FieldErrors } from "../../(public)/_shared";
import { changeMyPasswordAction, type PasswordChangeState } from "./actions";

function errOf(state: PasswordChangeState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

/**
 * 비밀번호 변경 폼. 성공하면 서버 액션이 /me 로 redirect 하므로
 * 이 컴포넌트에는 성공 상태 화면이 없다.
 */
export function PasswordChangeForm({ mustChange }: { mustChange: boolean }) {
  const [state, formAction, pending] = useActionState<PasswordChangeState, FormData>(
    changeMyPasswordAction,
    IDLE,
  );

  return (
    <form action={formAction} noValidate>
      <FormStack>
        {state.status === "error" ? (
          <Alert tone="error" title={state.message}>
            {state.howToFix ? <p>{state.howToFix}</p> : null}
          </Alert>
        ) : null}

        <Field
          htmlFor="currentPassword"
          label={mustChange ? "임시 비밀번호 (지금 로그인에 쓰신 것)" : "현재 비밀번호"}
          labelEn="Current password"
          required
          error={errOf(state, "currentPassword")}
        >
          <Input
            {...fieldAria("currentPassword", { error: errOf(state, "currentPassword") })}
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            invalid={Boolean(errOf(state, "currentPassword"))}
          />
        </Field>

        <Field
          htmlFor="newPassword"
          label="새 비밀번호"
          labelEn="New password"
          required
          hint="8자 이상으로 정해 주십시오. 다른 곳에서 쓰시는 비밀번호는 피해 주십시오."
          error={errOf(state, "newPassword")}
        >
          <Input
            {...fieldAria("newPassword", { hint: true, error: errOf(state, "newPassword") })}
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
            invalid={Boolean(errOf(state, "newPassword"))}
          />
        </Field>

        <Field
          htmlFor="newPasswordConfirm"
          label="새 비밀번호 확인"
          labelEn="Confirm"
          required
          error={errOf(state, "newPasswordConfirm")}
        >
          <Input
            {...fieldAria("newPasswordConfirm", { error: errOf(state, "newPasswordConfirm") })}
            id="newPasswordConfirm"
            name="newPasswordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
            invalid={Boolean(errOf(state, "newPasswordConfirm"))}
          />
        </Field>

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "저장 중…" : "비밀번호 바꾸기"}
        </Button>
      </FormStack>
    </form>
  );
}

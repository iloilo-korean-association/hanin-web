"use client";

import { useActionState } from "react";

import { Alert, Button, Field, fieldAria, FormStack, Input } from "@/components/ui";

import { IDLE } from "../_lib/action-state";
import { officerLoginAction } from "./actions";

export function LoginForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction, pending] = useActionState(officerLoginAction, IDLE);

  return (
    <form action={formAction}>
      <FormStack>
        {state.ok === false ? (
          <Alert tone="error" title={state.message}>
            {state.howToFix ? <p>{state.howToFix}</p> : null}
          </Alert>
        ) : null}

        <Field htmlFor="email" label="이메일" labelEn="Email" required>
          <Input
            {...fieldAria("email", {})}
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            defaultValue={defaultEmail}
            placeholder="treasurer@ika-iloilo.org"
          />
        </Field>

        <Field htmlFor="password" label="비밀번호" labelEn="Password" required>
          <Input
            {...fieldAria("password", {})}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </Button>
      </FormStack>
    </form>
  );
}

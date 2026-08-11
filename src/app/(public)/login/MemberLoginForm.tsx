"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, Button, Field, fieldAria, FormStack, Input } from "@/components/ui";
import { ROUTES } from "@/lib/site";

import { IDLE } from "../_shared";
import { memberLoginAction, type MemberLoginState } from "./actions";

/**
 * 회원 로그인 폼.
 *
 * 아이디 칸은 회원번호(M0001)와 이메일을 모두 받는다 — 어느 쪽인지는 서버가 판별한다.
 * 이메일이 가족과 공유돼 여러 회원에 걸리면 서버가 "회원번호로 로그인해 주십시오" 를
 * 안내한다(화면은 그 문장을 그대로 보여줄 뿐, 어떤 판정도 하지 않는다).
 */
export function MemberLoginForm() {
  const [state, formAction, pending] = useActionState<MemberLoginState, FormData>(
    memberLoginAction,
    IDLE,
  );

  return (
    <form action={formAction}>
      <FormStack>
        {state.status === "error" ? (
          <Alert tone="error" title={state.message}>
            {state.howToFix ? <p>{state.howToFix}</p> : null}
          </Alert>
        ) : null}

        <Field
          htmlFor="loginId"
          label="회원번호 또는 이메일"
          labelEn="Member No. / Email"
          required
          hint="회원번호는 M0001 형식입니다. 가입 안내 메일에 적혀 있습니다."
        >
          <Input
            {...fieldAria("loginId", { hint: true })}
            id="loginId"
            name="loginId"
            required
            autoComplete="username"
            maxLength={100}
            placeholder="M0001 또는 name@example.com"
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

        <p className="text-sm text-ink-muted">
          <Link href={ROUTES.loginForgot} className="link-ika">
            비밀번호를 잊으셨나요?
          </Link>
        </p>
      </FormStack>
    </form>
  );
}

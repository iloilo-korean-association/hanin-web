"use client";

import { useActionState } from "react";

import { Alert, Button, Field, fieldAria, FormStack, Input } from "@/components/ui";

import { IDLE, type FieldErrors } from "../../(public)/_shared";
import { saveMyNameEnAction, type NameEnState } from "./actions";

function errOf(state: NameEnState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

/**
 * 영문 이름 등록 폼 — 칸 하나. 성공하면 서버 액션이 포털로 redirect 하므로 성공 화면이 없다.
 * "나중에" 버튼은 없다 — 필수 관문이다(로그아웃·홈 링크는 page.tsx 가 폼 밖에 둔다).
 */
export function NameEnForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<NameEnState, FormData>(saveMyNameEnAction, IDLE);

  return (
    <form action={formAction} noValidate>
      {/* 매직링크로 들어온 경우만 값이 있다. 세션이면 "" — 서버는 어느 쪽이든 가드가 돌려준 회원번호만 쓴다. */}
      <input type="hidden" name="token" value={token} />
      <FormStack>
        {state.status === "error" ? (
          <Alert tone="error" title={state.message}>
            {state.howToFix ? <p>{state.howToFix}</p> : null}
          </Alert>
        ) : null}

        <Field
          htmlFor="nameEn"
          label="영문 이름"
          labelEn="Name in English"
          required
          hint="여권의 영문 표기와 같게 적어 주십시오. 예: HONG GILDONG (소문자로 적으셔도 대문자로 저장됩니다)"
          error={errOf(state, "nameEn")}
        >
          <Input
            {...fieldAria("nameEn", { hint: true, error: errOf(state, "nameEn") })}
            id="nameEn"
            name="nameEn"
            required
            maxLength={60}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="HONG GILDONG"
            invalid={Boolean(errOf(state, "nameEn"))}
          />
        </Field>

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "저장 중…" : "저장하고 내 정보 열기"}
        </Button>
      </FormStack>
    </form>
  );
}

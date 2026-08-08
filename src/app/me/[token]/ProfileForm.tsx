"use client";

import { useActionState } from "react";

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Field,
  fieldAria,
  FormStack,
  Input,
  Select,
} from "@/components/ui";

import { IDLE, REGIONS, type FieldErrors } from "../../(public)/_shared";
import { updateMyInfo, type MeUpdateState } from "./actions";

function errOf(state: MeUpdateState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

/**
 * 회원 본인이 고칠 수 있는 것만 있는 폼.
 *
 * 회원번호·성명·회비등급·상태는 여기 없다. 폼에 없으면 서버 스키마에도 없어서
 * 폼을 직접 조작해 보내도 무시된다(memberSelfUpdateSchema).
 */
export function ProfileForm({
  token,
  phone,
  email,
  region,
  rosterConsent,
  notifyConsent,
}: {
  token: string;
  phone: string;
  email: string;
  region: string;
  rosterConsent: boolean;
  notifyConsent: boolean;
}) {
  const [state, formAction, pending] = useActionState<MeUpdateState, FormData>(updateMyInfo, IDLE);

  // 원장에 이미 들어 있는 값이 목록에 없을 수도 있다. 그럴 때는 현재 값을 맨 앞에 끼워
  // 넣는다 — 안 그러면 저장 버튼을 누르는 순간 지역이 조용히 다른 값으로 바뀐다.
  const regionOptions: string[] = (REGIONS as readonly string[]).includes(region)
    ? [...REGIONS]
    : [region, ...REGIONS].filter((r) => r.length > 0);

  return (
    // 인쇄할 때는 편집 폼을 뺀다. 회원이 인쇄하는 것은 영수증 목록이지 입력 칸이 아니다.
    <form action={formAction} noValidate className="no-print">
      <input type="hidden" name="token" value={token} />

      <Card>
        <CardHeader
          title="내 정보 수정"
          description="연락처와 동의 항목은 직접 고치실 수 있습니다. 성명·회원번호·회비등급 변경은 총무에게 말씀해 주십시오."
        />
        <CardBody>
          {state.status === "error" ? (
            <div className="mb-4">
              <Alert tone="error" title={state.message}>
                {state.howToFix ? <p>{state.howToFix}</p> : null}
              </Alert>
            </div>
          ) : null}

          {state.status === "ok" ? (
            <div className="mb-4">
              <Alert
                tone={state.changed.length ? "success" : "info"}
                title={state.changed.length ? "저장했습니다." : "바뀐 내용이 없습니다."}
              >
                {state.changed.length ? (
                  <p>
                    바뀐 항목: <b>{state.changed.join(", ")}</b> — 변경 내역은 감사로그에 기록되었습니다.
                  </p>
                ) : (
                  <p>입력하신 값이 기존 값과 같아 아무것도 바꾸지 않았습니다.</p>
                )}
              </Alert>
            </div>
          ) : null}

          <FormStack>
            <Field
              htmlFor="me-phone"
              label="연락처"
              labelEn="Mobile"
              required
              hint="영수증·행사 안내를 이 번호로 드립니다."
              error={errOf(state, "phone")}
            >
              <Input
                id="me-phone"
                name="phone"
                required
                type="tel"
                inputMode="tel"
                maxLength={30}
                autoComplete="tel"
                defaultValue={phone}
                invalid={Boolean(errOf(state, "phone"))}
                {...fieldAria("me-phone", { hint: true, error: errOf(state, "phone") })}
              />
            </Field>

            <Field htmlFor="me-email" label="이메일" labelEn="Email" error={errOf(state, "email")}>
              <Input
                id="me-email"
                name="email"
                type="email"
                inputMode="email"
                maxLength={100}
                autoComplete="email"
                defaultValue={email}
                invalid={Boolean(errOf(state, "email"))}
                {...fieldAria("me-email", { error: errOf(state, "email") })}
              />
            </Field>

            <Field htmlFor="me-region" label="거주 지역" labelEn="Area" error={errOf(state, "region")}>
              <Select
                id="me-region"
                name="region"
                defaultValue={region}
                invalid={Boolean(errOf(state, "region"))}
                {...fieldAria("me-region", { error: errOf(state, "region") })}
              >
                {regionOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">동의 항목</legend>
              <Checkbox
                id="me-rosterConsent"
                name="rosterConsent"
                defaultChecked={rosterConsent}
                label="회원 명부에 이름을 공개합니다"
                description="동의하신 분만 명부에 표시됩니다. 누구나 볼 수 있는 공개 페이지에는 어떤 경우에도 회원 실명이 나가지 않습니다."
              />
              <Checkbox
                id="me-notifyConsent"
                name="notifyConsent"
                defaultChecked={notifyConsent}
                label="회비·행사 알림을 받겠습니다"
                description="끄시면 영수증·회비 안내 메일이 나가지 않습니다."
              />
            </fieldset>
          </FormStack>
        </CardBody>
        <CardFooter>
          <p className="text-sm text-ink-muted">변경 내역은 감사로그(16_감사로그)에 그대로 남습니다.</p>
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "저장 중…" : "저장"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

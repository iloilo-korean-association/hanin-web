"use client";

import { useActionState, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  fieldAria,
  FormStack,
  Input,
  Radio,
  RadioGroup,
  Select,
  StatLine,
  Textarea,
} from "@/components/ui";
import { EMERGENCY_NUMBER } from "@/lib/site";

import { IDLE, type FieldErrors } from "../_shared";
import { submitHelpRequest, type HelpState } from "./actions";
import {
  CONFLICT_CHOICES,
  CONSENT_CHOICES,
  INJURIES,
  MEMBERSHIPS,
  SEVERITIES,
  SITUATION_TYPES,
} from "./constants";

const SEVERITY_DESC: Record<string, string> = {
  "L1 경미": "정보·안내만 필요합니다.",
  "L2 중대": "동행·통역·기관 연결이 필요합니다.",
  "L3 최중대": "체포·중상·사망·실종 등. 공관 통보가 필요한 상황입니다.",
};

function errOf(state: HelpState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

export function HelpForm({ formToken }: { formToken: string }) {
  const [state, formAction, pending] = useActionState<HelpState, FormData>(submitHelpRequest, IDLE);
  const [conflictCheck, setConflictCheck] = useState<string>("해당 없음");

  if (state.status === "ok") {
    return <HelpSuccess state={state} />;
  }

  const topError = state.status === "error" ? state : null;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="formToken" value={formToken} />

      {topError ? (
        <div className="mb-5">
          <Alert tone="error" title={topError.message}>
            {topError.howToFix ? <p>{topError.howToFix}</p> : null}
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader
            title="무슨 일이 있었습니까"
            description="판단이 어려우시면 심각도를 높게 잡아 주십시오. 낮게 잡아 늦는 것보다 낫습니다."
          />
          <CardBody>
            <FormStack>
              <Field
                htmlFor="situationType"
                label="상황 유형"
                required
                error={errOf(state, "situationType")}
              >
                <Select
                  id="situationType"
                  name="situationType"
                  required
                  defaultValue=""
                  invalid={Boolean(errOf(state, "situationType"))}
                  {...fieldAria("situationType", { error: errOf(state, "situationType") })}
                >
                  <option value="" disabled>
                    골라 주십시오
                  </option>
                  {SITUATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>

              <RadioGroup
                legend="심각도"
                hint="판단이 어려우면 높게 잡습니다."
                error={errOf(state, "severity")}
              >
                {SEVERITIES.map((s, i) => (
                  <Radio
                    key={s}
                    id={`severity-${i}`}
                    name="severity"
                    value={s}
                    label={s}
                    description={SEVERITY_DESC[s]}
                    required
                  />
                ))}
              </RadioGroup>

              <Field
                htmlFor="summary"
                label="상황 요약"
                required
                hint="언제·어디서·누가·무엇을. 판단이나 추측은 빼고 사실만 적어 주십시오."
                error={errOf(state, "summary")}
              >
                <Textarea
                  id="summary"
                  name="summary"
                  required
                  rows={5}
                  maxLength={2000}
                  invalid={Boolean(errOf(state, "summary"))}
                  {...fieldAria("summary", { hint: true, error: errOf(state, "summary") })}
                />
              </Field>

              <RadioGroup legend="부상 · 인명피해" error={errOf(state, "injury")}>
                {INJURIES.map((i) => (
                  <Radio key={i} id={`injury-${i}`} name="injury" value={i} label={i} required />
                ))}
              </RadioGroup>
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="당사자와 위치" description="연락이 닿아야 도울 수 있습니다." />
          <CardBody>
            <FormStack>
              <Field htmlFor="personName" label="당사자 성명" required error={errOf(state, "personName")}>
                <Input
                  id="personName"
                  name="personName"
                  required
                  maxLength={40}
                  autoComplete="name"
                  invalid={Boolean(errOf(state, "personName"))}
                  {...fieldAria("personName", { error: errOf(state, "personName") })}
                />
              </Field>

              <Field
                htmlFor="personPhone"
                label="연락처"
                required
                hint="지금 통화가 가능한 번호를 적어 주십시오."
                error={errOf(state, "personPhone")}
              >
                <Input
                  id="personPhone"
                  name="personPhone"
                  required
                  type="tel"
                  inputMode="tel"
                  maxLength={30}
                  autoComplete="tel"
                  placeholder="0917 123 4567"
                  invalid={Boolean(errOf(state, "personPhone"))}
                  {...fieldAria("personPhone", { hint: true, error: errOf(state, "personPhone") })}
                />
              </Field>

              <Field
                htmlFor="location"
                label="현재 위치"
                required
                hint="바랑가이 이름이나 근처 랜드마크면 충분합니다. 예: Jaro, SM City 뒤편"
                error={errOf(state, "location")}
              >
                <Input
                  id="location"
                  name="location"
                  required
                  maxLength={200}
                  invalid={Boolean(errOf(state, "location"))}
                  {...fieldAria("location", { hint: true, error: errOf(state, "location") })}
                />
              </Field>

              <Field
                htmlFor="contactedAgencies"
                label="이미 연락한 기관"
                hint={`선택 사항입니다. 예: ${EMERGENCY_NUMBER}, 경찰, 병원, 주세부분관`}
              >
                <Input
                  id="contactedAgencies"
                  name="contactedAgencies"
                  maxLength={200}
                  {...fieldAria("contactedAgencies", { hint: true })}
                />
              </Field>

              <Field
                htmlFor="membership"
                label="회원 여부"
                hint="⚠ 대응 수준에 영향이 없습니다. 통계 목적으로만 씁니다. 회비 미납이어도, 비회원이어도, 관광객이어도 똑같이 지원합니다."
              >
                <Select
                  id="membership"
                  name="membership"
                  defaultValue="불명"
                  {...fieldAria("membership", { hint: true })}
                >
                  {MEMBERSHIPS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="이해상충 확인"
            description="한인회 규정(R-4)이 요구하는 문항입니다. 해당되면 그 임원을 대응 라인에서 빼고 다른 임원이 총괄합니다."
          />
          <CardBody>
            <FormStack>
              <RadioGroup
                legend="이 건의 상대방이 아래에 해당합니까"
                hint="대표는 일로일로에서 여러 사업을 운영하고 배우자가 로펌을 합니다. 미리 밝히지 않으면 나중에 무슨 설명을 해도 늦습니다."
                error={errOf(state, "conflictCheck")}
              >
                {/* id 에는 공백이 들어가면 안 된다(HTML 규칙) — 한글 선택지라 번호로 만든다. */}
                {CONFLICT_CHOICES.map((c, i) => (
                  <Radio
                    key={c}
                    id={`conflict-${i}`}
                    name="conflictCheck"
                    value={c}
                    required
                    checked={conflictCheck === c}
                    onChange={() => setConflictCheck(c)}
                    label={c}
                    description={
                      c === "대표 사업체 관계자"
                        ? "PIA 어학원 · 스픽클 · 에이워크 유학원 · 로펌(배우자) · 빌드앤셀 · 일로일로스테이 · 오톤 하드웨어"
                        : c === "판단 보류"
                          ? "모르시면 이것을 고르십시오. 안전한 쪽으로 처리합니다."
                          : undefined
                    }
                  />
                ))}
              </RadioGroup>

              {conflictCheck === "대표 사업체 관계자" ? (
                <Alert tone="warn" title="회장(대표)을 대응 라인에서 제외합니다">
                  <p>
                    이 건은 부회장이 총괄합니다. 회장에게는 통보 메일이 가지 않습니다. 화면 안내만이
                    아니라 실제 수신자 목록이 바뀝니다.
                  </p>
                </Alert>
              ) : null}

              <RadioGroup
                legend="개인정보 처리"
                hint="접수된 정보는 긴급 대응 목적으로만 쓰고 담당 임원 외에는 열람할 수 없습니다. 2년 보관 후 삭제합니다."
                error={errOf(state, "privacyChoice")}
              >
                {CONSENT_CHOICES.map((c, i) => (
                  <Radio key={c} id={`consent-${i}`} name="privacyChoice" value={c} label={c} required />
                ))}
              </RadioGroup>
            </FormStack>
          </CardBody>
          <CardFooter>
            <p className="text-sm text-ink-muted">
              생명이 위험하시면 이 양식을 채우지 마시고 지금 <b>{EMERGENCY_NUMBER}</b> 로 전화하십시오.
            </p>
            <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
              {pending ? "접수 중입니다…" : "지원 요청 접수"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </form>
  );
}

function HelpSuccess({ state }: { state: Extract<HelpState, { status: "ok" }> }) {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="success" title="지원 요청이 접수되었습니다.">
        <p>
          로그번호는 <b>{state.logNo}</b> 입니다. 담당 임원에게 통보되었습니다.
          {state.resubmitted ? " (이미 접수된 건입니다. 두 번 접수되지 않았습니다.)" : ""}
        </p>
      </Alert>

      <Card>
        <CardHeader title="접수 확인" />
        <CardBody>
          <StatLine label="로그번호" value={state.logNo} />
          <StatLine label="상황 유형" value={state.situationType} />
          <StatLine label="심각도" value={state.severity} />
          <StatLine
            label="통보한 임원"
            value={state.notifiedTo.length ? state.notifiedTo.join(", ") : "담당 임원"}
          />
          {state.presidentRecused ? (
            <StatLine label="이해상충 회피" value="회장(대표) 제외 · 부회장 총괄" tone="expense" />
          ) : null}
        </CardBody>
      </Card>

      <Alert tone="warn" title={`지금 위급하시면 ${EMERGENCY_NUMBER}`}>
        <p>
          이 접수는 사람이 확인해야 움직입니다. 생명이 위험하거나 지금 진행 중인 위협이 있으면
          기다리지 마시고 <b>{EMERGENCY_NUMBER}</b> (필리핀 전국 긴급번호 · 경찰·소방·구급 · 무료) 로
          바로 전화하십시오.
          {state.hotline ? ` 한인회 긴급 핫라인: ${state.hotline}` : " (한인회 긴급 핫라인은 아직 개통 준비 중입니다.)"}
        </p>
      </Alert>
    </div>
  );
}

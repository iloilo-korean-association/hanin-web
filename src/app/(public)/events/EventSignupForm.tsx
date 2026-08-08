"use client";

import { useActionState, useState } from "react";

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
  formatPeso,
  Input,
  Select,
  StatLine,
  Textarea,
} from "@/components/ui";

import { IDLE, type FieldErrors } from "../_shared";
import { submitEventSignup, type EventSignupState } from "./actions";

export interface OpenEventOption {
  eventId: string;
  title: string;
  fee: number;
  capacity: number;
  /** 남은 자리. capacity 가 0(제한 없음)이면 null */
  seatsLeft: number | null;
  signupDeadline: string | null;
}

function errOf(state: EventSignupState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

export function EventSignupForm({
  formToken,
  events,
  consentSlot,
  contactEmail,
}: {
  formToken: string;
  events: OpenEventOption[];
  consentSlot: React.ReactNode;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<EventSignupState, FormData>(
    submitEventSignup,
    IDLE,
  );
  const [eventId, setEventId] = useState(events.length === 1 ? events[0].eventId : "");
  const [guests, setGuests] = useState("0");

  if (state.status === "ok") {
    return <SignupSuccess state={state} contactEmail={contactEmail} />;
  }

  const topError = state.status === "error" ? state : null;
  const selected = events.find((e) => e.eventId === eventId) ?? null;
  const guestCount = Math.max(0, Math.min(20, Number(guests) || 0));
  const totalPeople = 1 + guestCount;
  const feeTotal = selected ? selected.fee * totalPeople : 0;

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

      <Card>
        <CardHeader title="참가 신청" description="5개 항목이면 끝납니다." />
        <CardBody>
          <FormStack>
            <Field htmlFor="eventId" label="참가할 행사" labelEn="Event" required error={errOf(state, "eventId")}>
              <Select
                id="eventId"
                name="eventId"
                required
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                invalid={Boolean(errOf(state, "eventId"))}
                {...fieldAria("eventId", { error: errOf(state, "eventId") })}
              >
                <option value="" disabled>
                  골라 주십시오
                </option>
                {events.map((e) => (
                  <option key={e.eventId} value={e.eventId}>
                    {e.eventId} {e.title}
                    {e.fee > 0 ? ` · 참가비 ${formatPeso(e.fee)}` : " · 무료"}
                    {e.seatsLeft !== null ? ` · 남은 자리 ${e.seatsLeft}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              htmlFor="applicantName"
              label="신청자 성명"
              labelEn="Name"
              required
              error={errOf(state, "applicantName")}
            >
              <Input
                id="applicantName"
                name="applicantName"
                required
                maxLength={20}
                autoComplete="name"
                placeholder="홍길동"
                invalid={Boolean(errOf(state, "applicantName"))}
                {...fieldAria("applicantName", { error: errOf(state, "applicantName") })}
              />
            </Field>

            <Field
              htmlFor="memberNo"
              label="회원번호"
              labelEn="Member no."
              hint="아시면 적어 주십시오. 예: M0007 — 성함이 일치할 때만 회원 기록에 연결됩니다. 모르셔도 신청은 됩니다."
              error={errOf(state, "memberNo")}
            >
              <Input
                id="memberNo"
                name="memberNo"
                maxLength={10}
                placeholder="M0007"
                autoCapitalize="characters"
                invalid={Boolean(errOf(state, "memberNo"))}
                {...fieldAria("memberNo", { hint: true, error: errOf(state, "memberNo") })}
              />
            </Field>

            <Field
              htmlFor="phone"
              label="연락처"
              labelEn="Phone"
              required
              hint="당일 안내 문자를 드릴 번호입니다."
              error={errOf(state, "phone")}
            >
              <Input
                id="phone"
                name="phone"
                required
                type="tel"
                inputMode="tel"
                maxLength={30}
                autoComplete="tel"
                placeholder="0917 123 4567"
                invalid={Boolean(errOf(state, "phone"))}
                {...fieldAria("phone", { hint: true, error: errOf(state, "phone") })}
              />
            </Field>

            <Field
              htmlFor="guests"
              label="동반 인원"
              labelEn="Guests"
              required
              hint="본인 제외. 혼자 오시면 0 을 적으십시오."
              error={errOf(state, "guests")}
            >
              <Input
                id="guests"
                name="guests"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={guests}
                onChange={(e) => setGuests(e.target.value.replace(/\D/g, "").slice(0, 2))}
                className="sm:max-w-32"
                invalid={Boolean(errOf(state, "guests"))}
                {...fieldAria("guests", { hint: true, error: errOf(state, "guests") })}
              />
            </Field>

            <Field
              htmlFor="specialNote"
              label="특이사항"
              hint="알러지 · 채식 · 거동 불편 등. 행사가 끝나면 바로 파기합니다."
            >
              <Textarea
                id="specialNote"
                name="specialNote"
                rows={2}
                maxLength={200}
                {...fieldAria("specialNote", { hint: true })}
              />
            </Field>

            {selected ? (
              <div className="rounded-[var(--radius-field)] border border-line bg-surface-inset p-4">
                <StatLine label="총 인원" value={`${totalPeople}명 (본인 + 동반 ${guestCount}명)`} />
                <StatLine
                  label="참가비 합계"
                  value={selected.fee > 0 ? `${formatPeso(selected.fee)} × ${totalPeople} = ${formatPeso(feeTotal)}` : "무료"}
                  tone={selected.fee > 0 ? "expense" : "neutral"}
                />
                {selected.seatsLeft !== null ? (
                  <StatLine label="남은 자리" value={`${selected.seatsLeft}명`} />
                ) : null}
                {selected.signupDeadline ? (
                  <StatLine label="신청 마감" value={selected.signupDeadline} />
                ) : null}
              </div>
            ) : null}

            {consentSlot}

            <Checkbox
              id="privacyConsent"
              name="privacyConsent"
              required
              label="전체 내용을 확인하였으며 이에 동의합니다 (필수)"
            />
            {errOf(state, "privacyConsent") ? (
              <p role="alert" className="text-sm font-semibold text-danger">
                {errOf(state, "privacyConsent")}
              </p>
            ) : null}
          </FormStack>
        </CardBody>
        <CardFooter>
          <p className="text-sm text-ink-muted">
            참가비는 당일 현장 또는 총무에게 납부하십니다. 문의:{" "}
            <a className="link-ika" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          </p>
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
            {pending ? "접수 중입니다…" : "참가 신청하기"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function SignupSuccess({
  state,
  contactEmail,
}: {
  state: Extract<EventSignupState, { status: "ok" }>;
  contactEmail: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="success" title={`${state.applicantName}님, 참가 신청이 접수되었습니다.`}>
        <p>
          신청번호는 <b>{state.signupId}</b> 입니다.
          {state.resubmitted ? " (이미 접수된 신청입니다. 같은 내용이 두 번 저장되지는 않았습니다.)" : ""}
        </p>
      </Alert>

      <Card>
        <CardHeader title="신청 내용" />
        <CardBody>
          <StatLine label="행사" value={`${state.eventTitle} (${state.eventId})`} />
          {state.eventPlace ? <StatLine label="장소" value={state.eventPlace} /> : null}
          <StatLine label="총 인원" value={`${state.totalPeople}명`} />
          <StatLine
            label="참가비"
            value={state.feeTotal > 0 ? `${formatPeso(state.feeTotal)} · 미납` : "무료"}
            tone={state.feeTotal > 0 ? "expense" : "neutral"}
          />
          <StatLine label="회원 연결" value={state.linkedMemberNo ?? "없음"} />
        </CardBody>
      </Card>

      {state.memberLinkRejected ? (
        <Alert tone="warn" title="회원번호를 연결하지 않았습니다">
          <p>
            적어 주신 회원번호의 등록 성함과 신청자 성함이 달라서, 다른 분의 기록에 붙지 않도록 연결을
            하지 않았습니다. <b>신청 자체는 정상 접수되었습니다.</b> 본인이 맞으시면 총무(
            {contactEmail})에게 말씀해 주시면 연결해 드립니다.
          </p>
        </Alert>
      ) : null}

      {state.feeTotal > 0 ? (
        <Alert tone="info" title="참가비 납부 안내">
          <p>
            참가비 {formatPeso(state.feeTotal)} 는 당일 현장 또는 총무에게 현금·GCash 로 납부하시면
            됩니다. 납부하시면 영수증번호가 붙고 영수증 메일이 나갑니다.
          </p>
        </Alert>
      ) : null}
    </div>
  );
}

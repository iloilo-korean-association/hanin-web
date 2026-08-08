"use client";

import Link from "next/link";
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
  formatPeso,
  Input,
  LinkButton,
  Select,
  StatLine,
  Textarea,
} from "@/components/ui";
import { ROUTES } from "@/lib/site";

import { IDLE, REGIONS, type FieldErrors } from "../_shared";
import { submitJoin, type JoinState } from "./actions";
import { GRADE_HINT, JOIN_GRADES } from "./constants";

function errOf(state: JoinState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

export function JoinForm({
  formToken,
  consentSlot,
  duesTable,
  contactEmail,
}: {
  /** 이중 제출 방지 키. 서버 컴포넌트가 요청마다 새로 만들어 내려 준다. */
  formToken: string;
  /** 개인정보 동의서 전문 블록 (서버 컴포넌트에서 만들어 넘긴다) */
  consentSlot: React.ReactNode;
  /** 회비등급 → 연회비. 화면에 실제 금액을 보여 주기 위한 것. */
  duesTable: Record<string, number>;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(submitJoin, IDLE);

  if (state.status === "ok") {
    return <JoinSuccess state={state} contactEmail={contactEmail} />;
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
          <CardHeader title="신청자 정보" description="7개 항목이면 끝납니다. 1분이면 충분합니다." />
          <CardBody>
            <FormStack>
              <Field htmlFor="name" label="성명 (한글)" labelEn="Name" required error={errOf(state, "name")}>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={20}
                  autoComplete="name"
                  enterKeyHint="next"
                  placeholder="홍길동"
                  invalid={Boolean(errOf(state, "name"))}
                  {...fieldAria("name", { error: errOf(state, "name") })}
                />
              </Field>

              <Field
                htmlFor="birthYear"
                label="출생연도"
                labelEn="Year of birth"
                required
                hint="태어난 해 4자리만 적어 주십시오. 예: 1968 — 중복 가입을 걸러내는 데만 씁니다."
                error={errOf(state, "birthYear")}
              >
                <Input
                  id="birthYear"
                  name="birthYear"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="bday-year"
                  placeholder="1968"
                  invalid={Boolean(errOf(state, "birthYear"))}
                  {...fieldAria("birthYear", { hint: true, error: errOf(state, "birthYear") })}
                />
              </Field>

              <Field
                htmlFor="phone"
                label="휴대전화"
                labelEn="Mobile"
                required
                hint="필리핀 번호도 한국 번호도 괜찮습니다. 예: 0917 123 4567"
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
                htmlFor="email"
                label="이메일"
                labelEn="Email"
                required
                hint="영수증과 회비 안내를 이 주소로 보내드립니다."
                error={errOf(state, "email")}
              >
                <Input
                  id="email"
                  name="email"
                  required
                  type="email"
                  inputMode="email"
                  maxLength={100}
                  autoComplete="email"
                  placeholder="name@example.com"
                  invalid={Boolean(errOf(state, "email"))}
                  {...fieldAria("email", { hint: true, error: errOf(state, "email") })}
                />
              </Field>

              <Field htmlFor="region" label="거주 지역" labelEn="Area" required error={errOf(state, "region")}>
                <Select
                  id="region"
                  name="region"
                  required
                  defaultValue=""
                  invalid={Boolean(errOf(state, "region"))}
                  {...fieldAria("region", { error: errOf(state, "region") })}
                >
                  <option value="" disabled>
                    골라 주십시오
                  </option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                htmlFor="duesGrade"
                label="회원 구분"
                labelEn="Membership"
                required
                hint="명예회원은 한인회가 부여하는 등급이라 여기서 고를 수 없습니다(회비규정 제6조 ②)."
                error={errOf(state, "duesGrade")}
              >
                <Select
                  id="duesGrade"
                  name="duesGrade"
                  required
                  defaultValue=""
                  invalid={Boolean(errOf(state, "duesGrade"))}
                  {...fieldAria("duesGrade", { hint: true, error: errOf(state, "duesGrade") })}
                >
                  <option value="" disabled>
                    골라 주십시오
                  </option>
                  {JOIN_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g} — {GRADE_HINT[g] ?? ""} · 연회비 {formatPeso(duesTable[g] ?? 0)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                htmlFor="note"
                label="남기실 말씀"
                labelEn="Note"
                hint="선택 사항입니다. 지역반 배정이나 봉사 참여 희망 등을 적어 주셔도 좋습니다."
              >
                <Textarea
                  id="note"
                  name="note"
                  rows={3}
                  maxLength={200}
                  {...fieldAria("note", { hint: true })}
                />
              </Field>
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="개인정보 수집·이용 동의"
            description="필리핀 Data Privacy Act of 2012 (RA 10173) 및 대한민국 개인정보 보호법(PIPA) 제15조·제22조에 따른 고지입니다."
          />
          <CardBody>
            <div className="flex flex-col gap-4">
              {consentSlot}

              <Checkbox
                id="privacyConsent"
                name="privacyConsent"
                required
                label="위 내용을 모두 읽었으며 개인정보 수집·이용에 동의합니다 (필수)"
                description="동의하지 않으시면 회원 등록 자체가 불가능합니다. 선택 항목에 동의하지 않으셔도 회원 자격에는 아무런 불이익이 없습니다."
              />
              {errOf(state, "privacyConsent") ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {errOf(state, "privacyConsent")}
                </p>
              ) : null}

              <fieldset className="flex flex-col gap-2">
                <legend className="font-semibold">선택 동의 항목</legend>
                <Checkbox
                  id="rosterConsent"
                  name="rosterConsent"
                  label="회원 명부에 이름을 공개합니다"
                  description="동의하신 분만 회원 명부에 표시됩니다. 명부는 로그인한 회원에게만 보이며, 누구나 볼 수 있는 공개 페이지에는 회원 실명이 한 건도 나가지 않습니다."
                />
                <Checkbox
                  id="notifyConsent"
                  name="notifyConsent"
                  defaultChecked
                  label="회비·행사 알림을 받겠습니다"
                  description="※ 이 항목을 선택하지 않으시면 환영 메일·영수증·회비 안내를 보내드릴 수 없습니다."
                />
              </fieldset>
            </div>
          </CardBody>
          <CardFooter>
            <p className="text-sm text-ink-muted">
              문의: <a className="link-ika" href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
            <Button type="submit" size="lg" disabled={pending} className="sm:w-auto w-full">
              {pending ? "접수 중입니다…" : "가입 신청하기"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </form>
  );
}

/* ───────────────────────── 접수 완료 화면 ───────────────────────── */

function JoinSuccess({
  state,
  contactEmail,
}: {
  state: Extract<JoinState, { status: "ok" }>;
  contactEmail: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="success" title={`${state.name}님, 가입 신청이 접수되었습니다.`}>
        <p>
          회원번호는 <b>{state.memberNo}</b> 입니다.
          {state.resubmitted ? " (이미 접수된 신청서입니다. 같은 내용이 두 번 저장되지는 않았습니다.)" : ""}
        </p>
      </Alert>

      <Card>
        <CardHeader
          title="본인 전용 조회 링크"
          description="이 주소를 저장해 두십시오. 비밀번호 없이 이 링크만으로 회비 납부 내역과 영수증을 보실 수 있습니다."
        />
        <CardBody>
          <div className="rounded-[var(--radius-field)] border border-brand-300 bg-brand-50 p-4">
            <Link href={state.linkPath} className="link-ika text-lg font-bold break-all">
              {state.linkPath}
            </Link>
            <p className="mt-2 text-sm text-ink-muted">
              링크토큰: <span className="tnum font-semibold">{state.linkToken}</span> — 화면을 캡처해 두시거나
              메모장에 옮겨 적어 두십시오. 잃어버리시면 총무가 다시 보내드립니다.
            </p>
          </div>
          <div className="mt-4">
            <LinkButton href={state.linkPath} variant="primary" size="lg" block>
              내 정보 화면 열기 →
            </LinkButton>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${state.fiscalYear}년 연회비 안내`} />
        <CardBody>
          <StatLine label="회원 구분" value={state.duesGrade} />
          <StatLine label="고지 금액" value={formatPeso(state.billedAmount)} tone="expense" />
          <StatLine label="고지일" value={state.billedOn} />
          <StatLine label="납기일" value={state.dueOn} />
          <p className="mt-3 text-sm text-ink-muted">
            회비는 총무에게 현금 또는 GCash 로 납부하실 수 있습니다. 납부하시면 영수증 메일이 자동으로
            발송되고, 사용 내역은{" "}
            <Link href={ROUTES.ledger} className="link-ika">
              공개 회계
            </Link>{" "}
            에서 건별로 확인하실 수 있습니다.
          </p>
        </CardBody>
      </Card>

      <Alert tone={state.mailQueued ? "info" : "warn"} title={state.mailQueued ? "환영 메일이 발송함에 기록되었습니다" : "환영 메일을 보내지 않았습니다"}>
        {state.mailQueued ? (
          <p>
            이 프로토타입은 실제 메일을 보내지 않고 발송함에 기록합니다. {state.mailTo} 로 나갈 내용을{" "}
            <Link href={ROUTES.devOutbox} className="link-ika">
              /dev/outbox
            </Link>{" "}
            에서 그대로 보실 수 있습니다.
          </p>
        ) : (
          <p>
            &quot;회비·행사 알림을 받겠습니다&quot; 에 동의하지 않으셔서 환영 메일·영수증·회비 안내를
            보내드리지 않습니다. 나중에 받고 싶으시면 위 조회 링크에서 알림 수신을 켜시거나 총무(
            {contactEmail})에게 말씀해 주십시오.
          </p>
        )}
      </Alert>
    </div>
  );
}

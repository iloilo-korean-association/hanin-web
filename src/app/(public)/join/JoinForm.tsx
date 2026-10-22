"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  Alert,
  Button,
  ButtonRow,
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
  StatLine,
} from "@/components/ui";
import { ROUTES } from "@/lib/site";

import { IDLE, type FieldErrors } from "../_shared";
import { submitJoin, type JoinState } from "./actions";

function errOf(state: JoinState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

/**
 * 가입 폼 — 이름·연락처·이메일·비밀번호 4칸 + 개인정보 동의 체크 1개 (대표 결정 2026-10-22).
 * 회원 구분은 고르지 않는다(전원 정회원). 명부공개·알림수신은 가입 후 '내 정보' 에서 켠다.
 */
export function JoinForm({
  formToken,
  consentSlot,
  contactEmail,
}: {
  /** 이중 제출 방지 키. 서버 컴포넌트가 요청마다 새로 만들어 내려 준다. */
  formToken: string;
  /** 개인정보 동의서 전문 블록 (서버 컴포넌트에서 만들어 넘긴다) */
  consentSlot: React.ReactNode;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(submitJoin, IDLE);
  const [showPw, setShowPw] = useState(false);

  if (state.status === "ok") {
    return <JoinSuccess state={state} contactEmail={contactEmail} />;
  }

  const topError = state.status === "error" ? state : null;
  // 중복 가입 거부일 때만 actions.ts 가 이 키를 채운다 → 로그인 / 비밀번호 찾기로 안내.
  const duplicate = topError?.fields?.duplicate ?? null;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="formToken" value={formToken} />

      {topError ? (
        <div className="mb-5">
          <Alert
            tone="error"
            title={topError.message}
            action={
              duplicate ? (
                <ButtonRow>
                  <LinkButton href={ROUTES.login} variant="primary">
                    로그인하기
                  </LinkButton>
                  <LinkButton href={ROUTES.loginForgot}>비밀번호 찾기</LinkButton>
                </ButtonRow>
              ) : null
            }
          >
            {topError.howToFix ? <p>{topError.howToFix}</p> : null}
          </Alert>
        </div>
      ) : null}

      {/* 카드 제목은 두지 않는다 — 안내(정회원·연회비)는 페이지 머리말에 한 번만. 모바일 세로 공간 절약. */}
      <Card>
        <CardBody>
          <FormStack>
            <Field htmlFor="name" label="이름" labelEn="Name" required error={errOf(state, "name")}>
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
              htmlFor="phone"
              label="연락처"
              labelEn="Mobile"
              required
              hint="필리핀·한국 번호 모두 됩니다."
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
                enterKeyHint="next"
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
              hint="로그인 아이디로 쓰입니다."
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
                enterKeyHint="next"
                placeholder="name@example.com"
                invalid={Boolean(errOf(state, "email"))}
                {...fieldAria("email", { hint: true, error: errOf(state, "email") })}
              />
            </Field>

            <Field
              htmlFor="password"
              label="비밀번호"
              labelEn="Password"
              required
              hint="8자 이상으로 정해 주십시오."
              error={errOf(state, "password")}
            >
              {/* 확인 칸 대신 '보기' 토글 — 잘못 친 글자를 눈으로 확인하게 한다. */}
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  required
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={8}
                  maxLength={72}
                  className="pr-24"
                  invalid={Boolean(errOf(state, "password"))}
                  {...fieldAria("password", { hint: true, error: errOf(state, "password") })}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-controls="password"
                  aria-pressed={showPw}
                  aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  className="absolute inset-y-0 right-0 flex min-h-touch min-w-touch items-center gap-1.5 rounded-r-[var(--radius-field)] px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  <EyeIcon off={showPw} />
                  <span>{showPw ? "숨기기" : "보기"}</span>
                </button>
              </div>
            </Field>

            <div className="flex flex-col gap-3">
              {/* 전문(접힘)은 체크박스 바로 위 — 동의 전에 반드시 펼쳐 읽을 수 있어야 한다. */}
              {consentSlot}
              <Checkbox
                id="privacyConsent"
                name="privacyConsent"
                required
                label="개인정보 수집·이용에 동의합니다 (필수)"
                description="성명·연락처·이메일을 회원 관리·회비 안내에만 씁니다."
                aria-invalid={errOf(state, "privacyConsent") ? true : undefined}
              />
              {errOf(state, "privacyConsent") ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {errOf(state, "privacyConsent")}
                </p>
              ) : null}
            </div>
          </FormStack>
        </CardBody>
        <CardFooter>
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:order-2 sm:w-auto">
            {pending ? "접수 중입니다…" : "가입 신청하기"}
          </Button>
          <p className="text-sm text-ink-muted sm:order-1">
            이미 회원이신가요?{" "}
            <Link href={ROUTES.login} className="link-ika font-semibold">
              로그인
            </Link>
            {contactEmail ? (
              <>
                {" "}· 문의{" "}
                <a className="link-ika" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </>
            ) : null}
          </p>
        </CardFooter>
      </Card>
    </form>
  );
}

/** 눈 아이콘 (장식용 — 버튼의 aria-label 이 뜻을 전한다). */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </svg>
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
          회원번호는 <b>{state.memberNo}</b> 입니다. 가입 시 정하신 비밀번호와 함께{" "}
          <Link href={ROUTES.login} className="link-ika font-semibold">
            회원 로그인
          </Link>
          에서 로그인하실 수 있습니다.
          {state.resubmitted ? " (이미 접수된 신청서입니다. 같은 내용이 두 번 저장되지는 않았습니다.)" : ""}
        </p>
        <p className="mt-1">
          로그인 아이디는 <b>회원번호</b> 또는 가입하신 <b>이메일</b>({state.mailTo}) 중 편한 것을 쓰시면 됩니다.
        </p>
      </Alert>

      <Card>
        <CardHeader
          title="본인 전용 조회 링크"
          description="이 주소를 저장해 두시면 비밀번호 없이도 회비 납부 내역과 영수증을 보실 수 있습니다. 비밀번호 로그인과 둘 다 쓰실 수 있습니다."
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
            회비는 총무에게 현금 또는 GCash 로 납부하실 수 있습니다. 학생·사업회원 등 회원 구분이 다르시면
            총무에게 말씀해 주십시오. 사용 내역은{" "}
            <Link href={ROUTES.ledger} className="link-ika">
              공개 회계
            </Link>{" "}
            에서 건별로 확인하실 수 있습니다.
          </p>
        </CardBody>
      </Card>

      <Alert tone={state.mailQueued ? "info" : "warn"} title={state.mailQueued ? "환영 메일이 발송함에 기록되었습니다" : "회비·행사 알림은 꺼진 상태로 가입되었습니다"}>
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
            그래서 환영 메일은 보내지 않았습니다. 회비 안내·행사 알림을 받으시려면 위{" "}
            <Link href={state.linkPath} className="link-ika font-semibold">
              내 정보 화면
            </Link>
            에서 &quot;회비·행사 알림을 받겠습니다&quot; 를 켜 주십시오. 회원 명부 공개도 같은 곳에서 정하실 수
            있습니다. 도움이 필요하시면 총무({contactEmail})에게 말씀해 주십시오.
          </p>
        )}
      </Alert>
    </div>
  );
}

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
  Input,
  Select,
  Textarea,
} from "@/components/ui";

import { updateMemberAction, type MemberEditState, type MemberEditValues } from "./actions";

/** 초기 상태 — actions.ts 는 "use server" 라 객체를 export 할 수 없어 여기 둔다. */
const EDIT_IDLE: MemberEditState = { ok: null, message: "", howToFix: null, at: 0 };

/** 상태 값은 원장 그대로(ACTIVE …) 저장하고, 옆에 한글 뜻을 붙여 보여 준다. */
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ACTIVE — 활동",
  INACTIVE: "INACTIVE — 비활동",
  WITHDRAWN: "WITHDRAWN — 탈퇴",
  중복확인필요: "중복확인필요",
};

export type GradeOption = {
  grade: string;
  /** 설정 '회비단가.<등급>'. 없으면 null */
  rate: number | null;
  /** 이 등급을 고르면 정해지는 회원구분 */
  memberType: string;
};

function peso(n: number): string {
  return "₱" + n.toLocaleString("en-US");
}

/**
 * 임원 회원 정보 수정 폼.
 *
 * ★ 권한이 없으면(회원관리 없음·감사 계정) 칸 전체를 잠그고 이유를 보여 준다.
 *   서버 액션이 어차피 다시 거부한다 — 화면 잠금은 통제가 아니라 안내다.
 * ★ 실패하면 입력값을 그대로 다시 채운다(서버가 values 로 돌려준다).
 *   React 19 는 폼 액션이 끝나면 비제어 입력을 초기화하므로, 결과마다 key 를 바꿔
 *   그 결과에 맞는 기본값으로 다시 그린다 — 성공이면 저장된 값(서버가 새로 그린 props),
 *   실패면 방금 입력한 값.
 */
export function MemberEditForm({
  memberNo,
  initial,
  initialMemberType,
  grades,
  regions,
  statuses,
  gradeHint,
  canEdit,
  blockedReason,
  gradeStatusLock,
}: {
  memberNo: string;
  initial: MemberEditValues;
  initialMemberType: string;
  grades: GradeOption[];
  regions: readonly string[];
  statuses: readonly string[];
  /** 회비등급을 바꾸면 올해 고지가 어떻게 되는지 한 줄 */
  gradeHint: string;
  canEdit: boolean;
  blockedReason?: string;
  /** 임원 본인 회원 행 — 회비등급·상태 잠금 사유 */
  gradeStatusLock: string | null;
}) {
  const [state, formAction, pending] = useActionState<MemberEditState, FormData>(updateMemberAction, EDIT_IDLE);

  // 잠긴(disabled) 회비등급·상태는 브라우저가 보내지 않아 실패 응답의 values 에 "" 로 온다 → 원래 값으로.
  const values =
    state.ok === false && state.values
      ? {
          ...state.values,
          duesGrade: state.values.duesGrade || initial.duesGrade,
          status: state.values.status || initial.status,
        }
      : initial;

  return (
    <div className="flex flex-col gap-4">
      <ResultBox state={state} />

      {!canEdit ? (
        <Alert tone="warn" title="열람만 가능합니다">
          {blockedReason ?? "이 회원의 정보를 고칠 권한이 없습니다."} 칸은 잠겨 있고, 저장해도 서버가 거부합니다.
        </Alert>
      ) : null}

      <EditFields
        // 결과가 올 때마다 다시 그린다(위 주석 참조)
        key={state.at}
        memberNo={memberNo}
        values={values}
        initialStatus={initial.status}
        initialGrade={initial.duesGrade}
        initialMemberType={initialMemberType}
        grades={grades}
        regions={regions}
        statuses={statuses}
        gradeHint={gradeHint}
        canEdit={canEdit}
        gradeStatusLock={gradeStatusLock}
        fieldErrors={state.ok === false ? (state.fieldErrors ?? {}) : {}}
        formAction={formAction}
        pending={pending}
      />
    </div>
  );
}

function ResultBox({ state }: { state: MemberEditState }) {
  if (state.ok === null) return null;
  if (state.ok === false) {
    return (
      <Alert tone="error" title={state.message}>
        {state.howToFix ? <p>{state.howToFix}</p> : null}
      </Alert>
    );
  }
  const changes = state.changes ?? [];
  if (changes.length === 0) {
    return (
      <Alert tone="info" title="바뀐 내용이 없습니다.">
        <p>입력하신 값이 기존 값과 같아 아무것도 저장하지 않았습니다.</p>
      </Alert>
    );
  }
  return (
    <>
      <Alert tone="success" title={state.message}>
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
          {changes.map((c) => (
            <li key={c.label} className="break-words">
              <b>{c.label}</b>: {c.before === "" ? "(비어 있음)" : c.before} → {c.after === "" ? "(비움)" : c.after}
            </li>
          ))}
        </ul>
        {(state.notes ?? []).length ? (
          <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5">
            {(state.notes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-sm">변경 내역은 감사로그에 기록되었습니다.</p>
      </Alert>
      {(state.warnings ?? []).length ? (
        <Alert tone="warn" title="확인이 필요합니다">
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {(state.warnings ?? []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}

function EditFields({
  memberNo,
  values,
  initialStatus,
  initialGrade,
  initialMemberType,
  grades,
  regions,
  statuses,
  gradeHint,
  canEdit,
  gradeStatusLock,
  fieldErrors,
  formAction,
  pending,
}: {
  memberNo: string;
  values: MemberEditValues;
  initialStatus: string;
  initialGrade: string;
  initialMemberType: string;
  grades: GradeOption[];
  regions: readonly string[];
  statuses: readonly string[];
  gradeHint: string;
  canEdit: boolean;
  gradeStatusLock: string | null;
  fieldErrors: Record<string, string>;
  formAction: (fd: FormData) => void;
  pending: boolean;
}) {
  const [grade, setGrade] = useState(values.duesGrade);
  const err = (k: string) => fieldErrors[k] ?? null;

  // 원장에 이미 들어 있는 지역이 목록에 없을 수도 있다 — 현재 값을 끼워 넣지 않으면
  // 저장하는 순간 지역이 조용히 다른 값으로 바뀐다. 빈 값은 '(미기재)' 로 그대로 둔다.
  const regionOptions = regions.includes(values.region) || values.region === "" ? [...regions] : [values.region, ...regions];

  const gradeOpt = grades.find((g) => g.grade === grade);
  // 등급을 그대로 두면 회원구분도 그대로다(서버 nextMemberType 과 같은 규칙).
  const memberTypeShown = grade === initialGrade ? initialMemberType : (gradeOpt?.memberType ?? initialMemberType);
  const gradeLocked = Boolean(gradeStatusLock);

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(e) => {
        const status = (e.currentTarget.elements.namedItem("status") as HTMLSelectElement | null)?.value;
        if (status === "WITHDRAWN" && initialStatus !== "WITHDRAWN") {
          const okToGo = window.confirm(
            `${memberNo} 회원을 탈퇴 처리합니다.\n\n` +
              "탈퇴 처리하면 회원증이 즉시 무효가 되고 회원 사진이 삭제됩니다. " +
              "회원 로그인과 본인 링크도 막힙니다.\n" +
              "나중에 상태를 되돌릴 수는 있지만, 지워진 사진은 회원이 다시 올려야 합니다.\n\n" +
              "계속하시겠습니까?",
          );
          if (!okToGo) e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="memberNo" value={memberNo} />

      <Card>
        <CardHeader
          title="회원 정보 수정"
          headingLevel={2}
          description="바뀐 칸만 저장되고, 칸마다 감사로그가 남습니다. 비밀번호는 아래 [비밀번호 재설정]으로 따로 발급합니다."
        />
        <CardBody>
          {/* disabled fieldset — 권한이 없으면 칸 전체를 잠근다 */}
          <fieldset disabled={!canEdit} className="min-w-0">
            <FormStack>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field htmlFor="mem-name" label="이름" required error={err("name")}>
                  <Input
                    id="mem-name"
                    name="name"
                    required
                    maxLength={20}
                    autoComplete="off"
                    defaultValue={values.name}
                    invalid={Boolean(err("name"))}
                    {...fieldAria("mem-name", { error: err("name") })}
                  />
                </Field>

                <Field
                  htmlFor="mem-nameEn"
                  label="영문 이름"
                  labelEn="Name in English"
                  hint="여권 영문 표기. 대문자로 저장됩니다. 기존 회원은 비어 있을 수 있고, 비워 둔 채 다른 칸만 저장해도 됩니다."
                  error={err("nameEn")}
                >
                  <Input
                    id="mem-nameEn"
                    name="nameEn"
                    maxLength={60}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="HONG GILDONG"
                    defaultValue={values.nameEn}
                    invalid={Boolean(err("nameEn"))}
                    {...fieldAria("mem-nameEn", { hint: true, error: err("nameEn") })}
                  />
                </Field>

                <Field
                  htmlFor="mem-birthYear"
                  label="출생연도"
                  hint="4자리. 모르면 비워 두십시오."
                  error={err("birthYear")}
                >
                  <Input
                    id="mem-birthYear"
                    name="birthYear"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="예: 1965"
                    autoComplete="off"
                    defaultValue={values.birthYear}
                    invalid={Boolean(err("birthYear"))}
                    {...fieldAria("mem-birthYear", { hint: true, error: err("birthYear") })}
                  />
                </Field>

                <Field
                  htmlFor="mem-phone"
                  label="연락처"
                  hint="비워 둘 수 있습니다. 다른 회원과 같은 번호는 저장되지 않습니다."
                  error={err("phone")}
                >
                  <Input
                    id="mem-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    maxLength={30}
                    autoComplete="off"
                    defaultValue={values.phone}
                    invalid={Boolean(err("phone"))}
                    {...fieldAria("mem-phone", { hint: true, error: err("phone") })}
                  />
                </Field>

                <Field
                  htmlFor="mem-email"
                  label="이메일"
                  hint="회원 로그인 아이디로도 쓰입니다. 소문자로 저장됩니다."
                  error={err("email")}
                >
                  <Input
                    id="mem-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    maxLength={100}
                    autoComplete="off"
                    defaultValue={values.email}
                    invalid={Boolean(err("email"))}
                    {...fieldAria("mem-email", { hint: true, error: err("email") })}
                  />
                </Field>

                <Field htmlFor="mem-region" label="거주 지역" error={err("region")}>
                  <Select
                    id="mem-region"
                    name="region"
                    defaultValue={values.region}
                    invalid={Boolean(err("region"))}
                    {...fieldAria("mem-region", { error: err("region") })}
                  >
                    <option value="">(미기재)</option>
                    {regionOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  htmlFor="mem-status"
                  label="회원 상태"
                  hint={
                    gradeStatusLock ??
                    "WITHDRAWN(탈퇴)로 바꾸면 회원증이 즉시 무효가 되고 회원 사진이 삭제됩니다."
                  }
                  error={err("status")}
                >
                  <Select
                    id="mem-status"
                    name="status"
                    defaultValue={values.status}
                    disabled={gradeLocked}
                    invalid={Boolean(err("status"))}
                    {...fieldAria("mem-status", { hint: true, error: err("status") })}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s] ?? s}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                htmlFor="mem-duesGrade"
                label="회비등급"
                hint={gradeStatusLock ?? gradeHint}
                error={err("duesGrade")}
              >
                <Select
                  id="mem-duesGrade"
                  name="duesGrade"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  disabled={gradeLocked}
                  invalid={Boolean(err("duesGrade"))}
                  {...fieldAria("mem-duesGrade", { hint: true, error: err("duesGrade") })}
                >
                  {grades.map((g) => (
                    <option key={g.grade} value={g.grade}>
                      {g.grade} — {g.rate === null ? "단가 미설정" : g.rate === 0 ? "₱0 (면제)" : peso(g.rate)}
                    </option>
                  ))}
                </Select>
                <p className="text-sm text-ink-soft">
                  회원 구분: <b>{memberTypeShown}</b>{" "}
                  <span className="text-ink-muted">(회비등급을 바꾸면 자동으로 따라갑니다 · 학생 → 준회원)</span>
                </p>
              </Field>

              <Field
                htmlFor="mem-note"
                label="비고 (남기실 말씀)"
                hint="200자 이내. 회원 본인에게는 보이지 않는 임원용 메모입니다."
                error={err("note")}
              >
                <Textarea
                  id="mem-note"
                  name="note"
                  rows={3}
                  maxLength={200}
                  defaultValue={values.note}
                  invalid={Boolean(err("note"))}
                  {...fieldAria("mem-note", { hint: true, error: err("note") })}
                />
              </Field>

              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="mb-1 font-semibold">동의 항목</legend>
                <Checkbox
                  id="mem-rosterConsent"
                  name="rosterConsent"
                  defaultChecked={values.rosterConsent}
                  label="명부공개 동의"
                  description="회원 명부에 이름을 공개합니다. 공개 페이지에는 어떤 경우에도 실명이 나가지 않습니다."
                />
                <Checkbox
                  id="mem-notifyConsent"
                  name="notifyConsent"
                  defaultChecked={values.notifyConsent}
                  label="알림수신 동의"
                  description="끄면 영수증·회비 안내 메일이 나가지 않습니다."
                />
              </fieldset>
            </FormStack>
          </fieldset>
        </CardBody>
        <CardFooter>
          <p className="text-sm text-ink-muted">변경 내역은 감사로그(16_감사로그)에 칸마다 남습니다.</p>
          <Button
            type="submit"
            disabled={pending}
            disabledReason={canEdit ? null : "수정 권한이 없습니다."}
            className="w-full sm:w-auto"
          >
            {pending ? "저장 중…" : "저장"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

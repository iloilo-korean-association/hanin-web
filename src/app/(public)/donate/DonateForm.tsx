"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  Alert,
  Badge,
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
  MoneyInput,
  Radio,
  RadioGroup,
  Select,
  StatLine,
  Textarea,
} from "@/components/ui";
import { ROUTES } from "@/lib/site";

import { IDLE, type FieldErrors } from "../_shared";
import { submitDonation, type DonateState } from "./actions";

export interface FundOption {
  fundId: string;
  name: string;
  purpose: string;
}

const METHODS: Array<{ value: string; label: string }> = [
  { value: "CASH", label: "현금 (CASH)" },
  { value: "GCASH", label: "GCash" },
  { value: "MAYA", label: "Maya" },
  { value: "BANK", label: "계좌이체 (BANK)" },
  { value: "INKIND", label: "현물 (INKIND)" },
];

const DONOR_TYPES: Array<{ value: string; label: string; desc: string }> = [
  { value: "회원", label: "한인회 회원", desc: "이미 가입하신 회원이십니다." },
  { value: "비회원", label: "비회원 개인", desc: "회원이 아니셔도 기부하실 수 있습니다." },
  { value: "법인", label: "업소 · 법인", desc: "상호로 기록됩니다." },
  { value: "익명", label: "익명으로 하겠습니다", desc: "성함·연락처를 아예 남기지 않습니다. 감사 메일도 보내드릴 수 없습니다." },
];

function errOf(state: DonateState, key: string): string | null {
  if (state.status !== "error") return null;
  const fields: FieldErrors = state.fields ?? {};
  return fields[key] ?? null;
}

export function DonateForm({
  formToken,
  funds,
  fxTable,
  consentSlot,
  contactEmail,
}: {
  formToken: string;
  funds: FundOption[];
  /** 통화 → 페소 환율 (00_설정 스냅샷) */
  fxTable: Record<string, number>;
  consentSlot: React.ReactNode;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<DonateState, FormData>(submitDonation, IDLE);
  const [donorType, setDonorType] = useState("비회원");
  const [designated, setDesignated] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("PHP");

  if (state.status === "ok") {
    return <DonateSuccess state={state} />;
  }

  const topError = state.status === "error" ? state : null;
  const anonymousDonor = donorType === "익명";
  const effectivelyAnonymous = anonymousDonor || anonymous;

  const numericAmount = Number(amount.replace(/[^\d.]/g, ""));
  const rate = fxTable[currency] ?? 1;
  const preview =
    Number.isFinite(numericAmount) && numericAmount > 0 && currency !== "PHP"
      ? `${formatPeso(Math.round(numericAmount * rate))} (환율 @${rate})`
      : null;

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
          <CardHeader title="기부자" description="내부 기록용입니다. 공개 여부는 아래에서 따로 정하십니다." />
          <CardBody>
            <FormStack>
              <RadioGroup legend="기부자 구분" error={errOf(state, "donorType")}>
                {DONOR_TYPES.map((t) => (
                  <Radio
                    key={t.value}
                    id={`donorType-${t.value}`}
                    name="donorType"
                    value={t.value}
                    checked={donorType === t.value}
                    onChange={() => setDonorType(t.value)}
                    label={t.label}
                    description={t.desc}
                  />
                ))}
              </RadioGroup>

              {anonymousDonor ? (
                <Alert tone="info" title="익명 기부로 접수됩니다">
                  <p>
                    성함·연락처·이메일을 저장하지 않습니다. 그래서 감사 메일과 기부 영수증을
                    보내드릴 수 없습니다. <b>금액은 총 기부금 합계에 그대로 포함됩니다.</b>
                  </p>
                </Alert>
              ) : (
                <>
                  <Field
                    htmlFor="donorName"
                    label="기부자 성명"
                    labelEn="Donor name"
                    required
                    error={errOf(state, "donorName")}
                  >
                    <Input
                      id="donorName"
                      name="donorName"
                      required
                      maxLength={40}
                      autoComplete="name"
                      placeholder={donorType === "법인" ? "○○식당" : "홍길동"}
                      invalid={Boolean(errOf(state, "donorName"))}
                      {...fieldAria("donorName", { error: errOf(state, "donorName") })}
                    />
                  </Field>

                  <Field
                    htmlFor="donorEmail"
                    label="이메일"
                    labelEn="Email"
                    hint="감사 인사를 보내드립니다. 적지 않으셔도 접수됩니다."
                    error={errOf(state, "donorEmail")}
                  >
                    <Input
                      id="donorEmail"
                      name="donorEmail"
                      type="email"
                      inputMode="email"
                      maxLength={100}
                      autoComplete="email"
                      invalid={Boolean(errOf(state, "donorEmail"))}
                      {...fieldAria("donorEmail", { hint: true, error: errOf(state, "donorEmail") })}
                    />
                  </Field>

                  <Field htmlFor="donorPhone" label="연락처" labelEn="Phone" error={errOf(state, "donorPhone")}>
                    <Input
                      id="donorPhone"
                      name="donorPhone"
                      type="tel"
                      inputMode="tel"
                      maxLength={30}
                      autoComplete="tel"
                      placeholder="0917 123 4567"
                      invalid={Boolean(errOf(state, "donorPhone"))}
                      {...fieldAria("donorPhone", { error: errOf(state, "donorPhone") })}
                    />
                  </Field>
                </>
              )}
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="금액과 방법" />
          <CardBody>
            <FormStack>
              <Field
                htmlFor="amount"
                label="기부 금액"
                labelEn="Amount"
                required
                hint={preview ? `페소 환산 ${preview}` : "숫자만 적어 주십시오. 쉼표는 넣으셔도 됩니다."}
                error={errOf(state, "amount")}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <MoneyInput
                    id="amount"
                    name="amount"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="1,000"
                    className="sm:flex-1"
                    invalid={Boolean(errOf(state, "amount"))}
                    {...fieldAria("amount", { hint: true, error: errOf(state, "amount") })}
                  />
                  <Select
                    id="currency"
                    name="currency"
                    aria-label="통화"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="sm:w-40"
                  >
                    <option value="PHP">PHP 페소</option>
                    <option value="USD">USD 달러</option>
                    <option value="KRW">KRW 원</option>
                  </Select>
                </div>
              </Field>

              <Field htmlFor="method" label="납부 수단" labelEn="Method" required error={errOf(state, "method")}>
                <Select
                  id="method"
                  name="method"
                  required
                  defaultValue=""
                  invalid={Boolean(errOf(state, "method"))}
                  {...fieldAria("method", { error: errOf(state, "method") })}
                >
                  <option value="" disabled>
                    골라 주십시오
                  </option>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="용도 지정"
            description="지정하신 기금은 그 목적에만 쓸 수 있습니다. 일반회계와 장부가 분리되어 관리됩니다."
          />
          <CardBody>
            <FormStack>
              <RadioGroup legend="지정 기부 여부">
                <Radio
                  id="designated-no"
                  name="isDesignatedChoice"
                  value="no"
                  checked={!designated}
                  onChange={() => setDesignated(false)}
                  label="아니오 — 한인회가 필요한 곳에 써 주세요"
                  description="일반회계(FD01)로 들어갑니다. 운영비·행사·긴급구호 등 그때그때 필요한 곳에 씁니다."
                />
                <Radio
                  id="designated-yes"
                  name="isDesignatedChoice"
                  value="yes"
                  checked={designated}
                  onChange={() => setDesignated(true)}
                  label="예 — 용도를 지정하겠습니다"
                  description="고르신 기금의 목적 외에는 한 푼도 쓸 수 없습니다. 초과 사용은 주간 무결성 검사가 잡아냅니다."
                />
              </RadioGroup>
              {/* 라디오는 화면 전환용이고, 서버가 읽는 값은 이 hidden 하나다. */}
              <input type="hidden" name="isDesignated" value={designated ? "on" : ""} />

              {designated ? (
                <>
                  <Field htmlFor="fundId" label="지정 기금" labelEn="Fund" required error={errOf(state, "fundId")}>
                    <Select
                      id="fundId"
                      name="fundId"
                      required
                      defaultValue=""
                      invalid={Boolean(errOf(state, "fundId"))}
                      {...fieldAria("fundId", { error: errOf(state, "fundId") })}
                    >
                      <option value="" disabled>
                        골라 주십시오
                      </option>
                      {funds.map((f) => (
                        <option key={f.fundId} value={f.fundId}>
                          {f.fundId} {f.name}
                          {f.purpose ? ` — ${f.purpose}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    htmlFor="designatedPurpose"
                    label="지정 용도"
                    hint="더 구체적인 조건이 있으면 적어 주십시오. 예: 고등학생 장학금으로만"
                  >
                    <Textarea
                      id="designatedPurpose"
                      name="designatedPurpose"
                      rows={2}
                      maxLength={200}
                      {...fieldAria("designatedPurpose", { hint: true })}
                    />
                  </Field>
                </>
              ) : null}
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="공개 방식"
            description="금액은 어떤 경우에도 숨기지 않습니다. 익명·비공개를 선택하셔도 총 기부금 합계에는 그대로 포함됩니다. 이름만 빠집니다."
          />
          <CardBody>
            <FormStack>
              {anonymousDonor ? (
                <p className="text-ink-muted">
                  기부자 구분을 <b>익명</b>으로 고르셔서 공개 표기 항목이 필요하지 않습니다.
                </p>
              ) : (
                <>
                  <Checkbox
                    id="isAnonymous"
                    name="isAnonymous"
                    checked={anonymous}
                    onChange={(e) => {
                      setAnonymous(e.target.checked);
                      if (e.target.checked) setPublicConsent(false);
                    }}
                    label="익명으로 처리해 주세요"
                    description="한인회 내부 장부에는 성함이 남지만, 공개 목록에는 표기되지 않습니다."
                  />
                  <Checkbox
                    id="publicConsent"
                    name="publicConsent"
                    checked={publicConsent}
                    disabled={anonymous}
                    onChange={(e) => setPublicConsent(e.target.checked)}
                    label="공개 장부에 표기명을 실어도 좋습니다"
                    description={
                      anonymous
                        ? "익명 기부는 공개 목록에 표기할 수 없습니다."
                        : "동의하신 분만 표기됩니다. 표기명은 아래에서 직접 정하실 수 있습니다."
                    }
                  />
                  {publicConsent && !anonymous ? (
                    <Field
                      htmlFor="publicDisplayName"
                      label="공개 표기명"
                      hint="공개 장부에 어떻게 표시할까요? 예: 김OO, 아무개 가족, ○○식당"
                      error={errOf(state, "publicDisplayName")}
                    >
                      <Input
                        id="publicDisplayName"
                        name="publicDisplayName"
                        maxLength={40}
                        {...fieldAria("publicDisplayName", { hint: true })}
                      />
                    </Field>
                  ) : null}
                </>
              )}

              <Field htmlFor="note" label="남기실 말씀" hint="선택 사항입니다.">
                <Textarea id="note" name="note" rows={2} maxLength={200} {...fieldAria("note", { hint: true })} />
              </Field>
            </FormStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="개인정보 수집·이용 동의" />
          <CardBody>
            <div className="flex flex-col gap-4">
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
            </div>
          </CardBody>
          <CardFooter>
            <p className="text-sm text-ink-muted">
              문의: <a className="link-ika" href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
            <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
              {pending ? "접수 중입니다…" : "기부 접수하기"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </form>
  );
}

function DonateSuccess({ state }: { state: Extract<DonateState, { status: "ok" }> }) {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="success" title="기부 접수가 완료되었습니다. 감사합니다.">
        <p>
          접수번호는 <b>{state.donationId}</b> 입니다.
          {state.resubmitted ? " (이미 접수된 건입니다. 같은 내용이 두 번 저장되지는 않았습니다.)" : ""}
        </p>
      </Alert>

      <Card>
        <CardHeader title="접수 내용" />
        <CardBody>
          <StatLine label="접수번호" value={state.donationId} />
          <StatLine label="기부자" value={state.displayName} />
          <StatLine
            label="금액"
            value={
              state.currency === "PHP"
                ? formatPeso(state.amountPhp)
                : `${state.currency} ${state.amount.toLocaleString("en-PH")} → ${formatPeso(state.amountPhp)}`
            }
            tone="income"
          />
          <StatLine label="접수일" value={state.receivedOn} />
          <StatLine
            label="용도"
            value={
              state.isDesignated
                ? `${state.fundName}${state.designatedPurpose ? ` — ${state.designatedPurpose}` : ""}`
                : "지정 없음 (일반회계)"
            }
          />
          <StatLine
            label="공개 표기"
            value={
              state.isAnonymous ? "익명 (이름 비공개)" : state.publicConsent ? "공개 동의함" : "이름 비공개 · 금액만 합산"
            }
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="warn" dot>
              상태: 접수
            </Badge>
            <span className="text-sm text-ink-muted">
              총무가 실제 입금을 확인하면 영수증번호가 붙고 <b>확인</b> 상태로 바뀝니다.
            </span>
          </div>
        </CardBody>
      </Card>

      <Alert tone="info" title="다음에 일어나는 일">
        <ol className="ml-5 list-decimal space-y-1">
          <li>총무가 현금·GCash·계좌를 확인하고 수납으로 기록합니다(증빙 사진 필수).</li>
          <li>영수증번호가 결번 없이 발급됩니다.</li>
          <li>
            사용 내역이{" "}
            <Link href={ROUTES.ledger} className="link-ika">
              공개 회계
            </Link>{" "}
            의 기금 현황에 전액 반영됩니다.
          </li>
          {state.mailQueued ? (
            <li>
              감사 인사 메일이 {state.mailTo} 로 나갑니다 —{" "}
              <Link href={ROUTES.devOutbox} className="link-ika">
                /dev/outbox
              </Link>{" "}
              에서 내용을 그대로 보실 수 있습니다.
            </li>
          ) : null}
        </ol>
      </Alert>
    </div>
  );
}

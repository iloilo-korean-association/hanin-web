"use client";

import { useActionState, useState } from "react";

import {
  Alert,
  Button,
  ButtonRow,
  Checkbox,
  Field,
  fieldAria,
  FormStack,
  Input,
  MoneyInput,
  Select,
  StatusBadge,
  formatPeso,
} from "@/components/ui";
import { evaluateTxState } from "@/lib/domain/invariants";
import { toInt } from "@/lib/domain/money";

import { IDLE } from "../../_lib/action-state";
import { PhotoField } from "../../_components/PhotoField";
import { executeApprovalAction } from "./actions";

const METHODS = [
  { value: "BANK", label: "계좌이체 BANK" },
  { value: "GCASH", label: "GCash" },
  { value: "MAYA", label: "Maya" },
  { value: "CASH", label: "현금 CASH" },
  { value: "CARD_2C2P", label: "카드 2C2P" },
  { value: "INKIND", label: "현물 INKIND" },
] as const;

const COUNTERPARTY_TYPES = ["업소", "법인", "공공", "비회원", "회원", "익명", "내부이체"] as const;

export interface ExecuteFormProps {
  approvalId: string;
  approvedPhp: number;
  counterpartyName: string;
  /** 지급 방법 제한 안내 (승인한도표) */
  paymentMethod: string;
  today: string;
  myEmail: string;
  accounts: { accountId: string; name: string; kind: string }[];
  verifiers: { email: string; label: string }[];
  accountByMethod: Record<string, string>;
  cashThreshold: number;
  /** 이 구간에 필요한 견적 곳수 */
  quotesRequired: number;
  /** 견적이 필요한데 승인 행에 첨부가 없는가 */
  quoteMissing: boolean;
  /** 이해관계자 거래인가 — 이 경우 견적 면제를 허용하지 않는다 */
  relatedParty: boolean;
  /** 집행할 수 없는 이유. null 이면 집행 가능. */
  blockedReason: string | null;
}

/**
 * 집행(장부 기입) 폼.
 *
 * 여기가 지출이 05_거래로 들어가는 **유일한 경로**다. 이 화면이 없으면 총무는 결국
 * 원장에 직접 타이핑하게 되고, 그게 이 시스템이 없애려는 무통제 경로다.
 */
export function ExecuteForm(p: ExecuteFormProps) {
  const [state, formAction, pending] = useActionState(executeApprovalAction, IDLE);

  const [method, setMethod] = useState<string>("BANK");
  const [accountId, setAccountId] = useState(p.accountByMethod.BANK ?? "");
  const [amount, setAmount] = useState(String(p.approvedPhp));
  const [verifiedBy, setVerifiedBy] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [ack, setAck] = useState(false);
  const [hasQuote, setHasQuote] = useState(false);

  const paid = toInt(amount) || p.approvedPhp;
  const preview = evaluateTxState(
    {
      evidenceUrl: hasPhoto ? "/uploads/preview" : "",
      method,
      amount: paid,
      currency: "PHP",
      fxRate: 1,
      enteredBy: p.myEmail,
      verifiedBy,
    },
    p.cashThreshold,
  );
  const cashOver = method === "CASH" && paid > p.cashThreshold;
  const disabled = p.blockedReason !== null || pending;

  return (
    <form action={formAction} className="no-print">
      <input type="hidden" name="approvalId" value={p.approvalId} />

      {state.ok === true ? (
        <Alert tone={state.status === "POSTED" ? "success" : "warn"} title={state.message} className="mb-3" />
      ) : null}
      {state.ok === false ? (
        <Alert tone="error" title={state.message} className="mb-3">
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}

      <FormStack>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field htmlFor={`date-${p.approvalId}`} label="지급 일자" required>
            <Input
              {...fieldAria(`date-${p.approvalId}`, {})}
              id={`date-${p.approvalId}`}
              name="date"
              type="date"
              required
              max={p.today}
              defaultValue={p.today}
              disabled={disabled}
            />
          </Field>

          <Field
            htmlFor={`amount-${p.approvalId}`}
            label="실제 지급액"
            hint={`승인 금액 ${formatPeso(p.approvedPhp)}. 이 금액을 넘길 수 없습니다 — 초과분은 새 승인이 필요합니다.`}
          >
            <MoneyInput
              {...fieldAria(`amount-${p.approvalId}`, { hint: true })}
              id={`amount-${p.approvalId}`}
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              disabled={disabled}
            />
          </Field>

          <Field
            htmlFor={`method-${p.approvalId}`}
            label="지급 수단"
            required
            hint={`규정상 이 구간의 지급 방법: ${p.paymentMethod}`}
          >
            <Select
              {...fieldAria(`method-${p.approvalId}`, { hint: true })}
              id={`method-${p.approvalId}`}
              name="method"
              required
              value={method}
              disabled={disabled}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setMethod(next);
                const auto = p.accountByMethod[next];
                if (auto) setAccountId(auto);
              }}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor={`accountId-${p.approvalId}`}
            label="출금 계좌"
            required
            hint="어느 계좌에서 나간 돈인가. 틀리면 현금실사 대사가 어긋납니다."
          >
            <Select
              {...fieldAria(`accountId-${p.approvalId}`, { hint: true })}
              id={`accountId-${p.approvalId}`}
              name="accountId"
              required
              value={accountId}
              disabled={disabled}
              onChange={(e) => setAccountId(e.currentTarget.value)}
            >
              <option value="">— 계좌 선택 —</option>
              {p.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountId} · {a.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor={`counterpartyType-${p.approvalId}`}
            label="수취인 구분"
            required
            hint={`수취인은 승인 행에 저장된 "${p.counterpartyName}" 이 그대로 들어갑니다. 이 구분이 공개 회계에서 상호를 그대로 보일지, 사람 이름을 가릴지를 정합니다.`}
          >
            <Select
              {...fieldAria(`counterpartyType-${p.approvalId}`, { hint: true })}
              id={`counterpartyType-${p.approvalId}`}
              name="counterpartyType"
              required
              defaultValue="업소"
              disabled={disabled}
            >
              {COUNTERPARTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor={`verifiedBy-${p.approvalId}`}
            label="확인자"
            required={cashOver}
            hint={`현금 ${formatPeso(p.cashThreshold)} 초과는 지급한 사람과 다른 사람의 확인이 있어야 장부에 반영됩니다(I4).`}
          >
            <Select
              {...fieldAria(`verifiedBy-${p.approvalId}`, { hint: true })}
              id={`verifiedBy-${p.approvalId}`}
              name="verifiedBy"
              value={verifiedBy}
              disabled={disabled}
              onChange={(e) => setVerifiedBy(e.currentTarget.value)}
            >
              <option value="">— 확인자 없음 —</option>
              {p.verifiers.map((v) => (
                <option key={v.email} value={v.email}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field htmlFor={`externalRef-${p.approvalId}`} label="외부 참조번호" hint="이체 확인번호 · GCash Ref No">
            <Input
              {...fieldAria(`externalRef-${p.approvalId}`, { hint: true })}
              id={`externalRef-${p.approvalId}`}
              name="externalRef"
              maxLength={60}
              disabled={disabled}
            />
          </Field>

          <Field htmlFor={`memo-${p.approvalId}`} label="적요 보충" hint="회원 실명은 적지 마십시오.">
            <Input
              {...fieldAria(`memo-${p.approvalId}`, { hint: true })}
              id={`memo-${p.approvalId}`}
              name="memo"
              maxLength={200}
              disabled={disabled}
            />
          </Field>
        </div>

        <PhotoField
          name="photoDataUrl"
          label="지출 영수증 사진"
          labelEn="Payment receipt"
          allowPdf
          onChangeHasFile={setHasPhoto}
          missingWarning="사진이 없습니다. 이대로 집행하면 미확정(DRAFT)으로 남고 공개 회계에 뜨지 않습니다."
        />
        {!hasPhoto ? (
          <Checkbox
            id={`ack-${p.approvalId}`}
            name="ackNoEvidence"
            checked={ack}
            disabled={disabled}
            onChange={(e) => setAck(e.currentTarget.checked)}
            label="사진 없이 임시(DRAFT)로 기록하겠습니다"
            description="나중에 영수증을 붙여 확정합니다."
          />
        ) : null}

        {/* 결재 시점에 견적서가 빠진 건 — 지금 붙이면 승인 기록에 남고 집행할 수 있다.
            면제 체크박스를 두지 않는 이유는 actions.ts 의 quoteDataUrl 주석에 적었다. */}
        {p.quoteMissing ? (
          <div className="rounded-[var(--radius-field)] border border-warn-line bg-warn-bg p-3">
            <p className="mb-1 font-bold text-warn">
              견적 {p.quotesRequired}곳이 필요한데 승인 기록에 첨부가 없습니다
            </p>
            <p className="mb-3 text-sm text-ink-soft">
              첨부하지 않으면 집행되지 않습니다. 긴급구호처럼 견적 자체가 없는 건이라면{" "}
              <b>견적 면제 사유서</b>를 찍어 올리십시오 — 규정은 긴급 상황에도 사유·긴급성의 서면
              기록을 요구합니다(승인한도표 제4조 ⑤).
              {p.relatedParty ? (
                <>
                  {" "}
                  <b>
                    이 건은 이해관계자 거래입니다. 견적 2곳 이상이 반드시 있어야 하며 어떤 완화도
                    인정되지 않습니다(제6조 가중규칙 D · 제9조 ③).
                  </b>
                </>
              ) : null}
            </p>
            <PhotoField
              name="quoteDataUrl"
              label="견적서 / 견적 면제 사유서 첨부"
              labelEn="Quotation"
              allowPdf
              onChangeHasFile={setHasQuote}
              missingWarning="첨부가 없으면 집행 단계에서 서버가 거부합니다."
            />
            {hasQuote ? (
              <p className="mt-2 text-sm text-ink-soft">
                이 문서는 승인 행(11_승인)의 견적서URL 에 기록되고, 결재 시점에 없던 문서라는 사실이
                감사로그에 WARN 으로 남습니다.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-[var(--radius-field)] border border-line bg-surface-sub p-3">
          <p className="flex items-center gap-2">
            <StatusBadge status={preview.status} />
            <span className="text-sm text-ink-soft">
              {preview.status === "POSTED"
                ? "지금 집행하면 바로 장부에 반영됩니다."
                : preview.reason}
            </span>
          </p>
        </div>

        <ButtonRow>
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            disabledReason={p.blockedReason}
          >
            {pending ? "집행 기록 중…" : `집행 기록 (${formatPeso(paid)})`}
          </Button>
        </ButtonRow>
      </FormStack>
    </form>
  );
}

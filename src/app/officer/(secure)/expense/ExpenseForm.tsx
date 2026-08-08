"use client";

import { useActionState, useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  ButtonRow,
  Card,
  CardBody,
  CardHeader,
  ConflictBadge,
  Field,
  fieldAria,
  FormStack,
  Input,
  MoneyInput,
  Select,
  StatLine,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  formatPeso,
} from "@/components/ui";
import { approvalBands, decideApprovalRoute, type ApprovalConfig } from "@/lib/domain/approval";
import {
  evaluateConflict,
  isRecused,
  type ConflictRow,
  type OfficerRow,
  type VendorRow,
} from "@/lib/domain/conflict";
import { toInt } from "@/lib/domain/money";

import { IDLE } from "../../_lib/action-state";
import { PhotoField } from "../../_components/PhotoField";
import { requestExpenseAction } from "./actions";

export interface ExpenseFormProps {
  today: string;
  /** 요청자 본인 — 자기 관련 업체에 발주하는 것을 화면에서 먼저 알려 준다 */
  me: { memberNo: string; email: string; name: string; role: string };
  vendors: VendorRow[];
  conflicts: ConflictRow[];
  officers: OfficerRow[];
  cfg: ApprovalConfig;
  categories: { code: string; name: string }[];
  funds: { fundId: string; name: string; kind: string }[];
  /** 통화 → 페소 환율 (00_설정 스냅샷) */
  fxTable: Record<string, number>;
  defaults: { fundId: string; categoryCode: string };
}

export function ExpenseForm(p: ExpenseFormProps) {
  const [state, formAction, pending] = useActionState(requestExpenseAction, IDLE);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("PHP");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [hasQuote, setHasQuote] = useState(false);
  const [note, setNote] = useState("");

  const rate = p.fxTable[currency] ?? 1;
  const amountPhp = Math.round(toInt(amount) * rate);

  /* 서버와 **같은 함수**로 실시간 판정한다. 최종 판단은 서버가 다시 한다. */
  const verdict = useMemo(
    () =>
      evaluateConflict(
        { counterpartyName, vendorId: vendorId || null },
        p.vendors,
        p.conflicts,
        p.officers,
      ),
    [counterpartyName, vendorId, p.vendors, p.conflicts, p.officers],
  );

  const route = decideApprovalRoute(amountPhp, verdict.related, p.cfg);
  const bands = useMemo(() => approvalBands(p.cfg), [p.cfg]);
  const iAmParty = isRecused({ memberNo: p.me.memberNo, email: p.me.email }, verdict);
  const showConflict = counterpartyName.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      {state.ok === true ? <Alert tone="success" title={state.message} /> : null}
      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="kind" value="지출" />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="무엇에 얼마를 쓰는가" headingLevel={2} />
              <CardBody>
                <FormStack>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field htmlFor="amount" label="금액" labelEn="Amount" required>
                      <MoneyInput
                        {...fieldAria("amount", {})}
                        id="amount"
                        name="amount"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.currentTarget.value)}
                        placeholder="15000"
                      />
                    </Field>
                    <Field htmlFor="currency" label="통화" labelEn="Currency">
                      <Select
                        {...fieldAria("currency", {})}
                        id="currency"
                        name="currency"
                        value={currency}
                        onChange={(e) => setCurrency(e.currentTarget.value)}
                      >
                        <option value="PHP">PHP</option>
                        <option value="KRW">KRW</option>
                        <option value="USD">USD</option>
                      </Select>
                    </Field>
                  </div>
                  {currency !== "PHP" ? (
                    <p className="text-sm text-ink-muted">
                      페소 환산 {formatPeso(amountPhp)} (환율 @{rate}) 기준으로 결재선을 판단합니다.
                    </p>
                  ) : null}

                  <Field htmlFor="categoryCode" label="과목" labelEn="Category" required>
                    <Select
                      {...fieldAria("categoryCode", {})}
                      id="categoryCode"
                      name="categoryCode"
                      required
                      defaultValue={p.defaults.categoryCode}
                    >
                      {p.categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field htmlFor="fundId" label="기금" labelEn="Fund" required hint="지정기금은 목적 외 사용이 금지됩니다. 감사 화면이 접수액 초과 사용을 매번 검사합니다.">
                    <Select
                      {...fieldAria("fundId", { hint: true })}
                      id="fundId"
                      name="fundId"
                      required
                      defaultValue={p.defaults.fundId}
                    >
                      {p.funds.map((f) => (
                        <option key={f.fundId} value={f.fundId}>
                          {f.fundId} · {f.name} ({f.kind})
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    htmlFor="reason"
                    label="지출 목적 및 필요성"
                    labelEn="Purpose"
                    required
                    hint="2~3줄. 산출 근거(계산식)를 같이 적으면 결재가 빨라집니다."
                  >
                    <Textarea
                      {...fieldAria("reason", { hint: true })}
                      id="reason"
                      name="reason"
                      rows={3}
                      required
                      maxLength={300}
                      placeholder="추석 한마당 식대 — 참가 120명 × ₱125"
                    />
                  </Field>
                </FormStack>
              </CardBody>
            </Card>

            {/* ── 수취인: 이해상충 판정의 유일한 입력 ─────────── */}
            <Card>
              <CardHeader
                title="수취인 (누구에게 나가는 돈인가)"
                headingLevel={2}
                description="이 칸이 이해상충 판정의 유일한 입력입니다. 사유 텍스트에 묻지 마십시오 — 그게 예전 우회 경로였습니다."
              />
              <CardBody>
                <FormStack>
                  <Field
                    htmlFor="vendorId"
                    label="등록된 업소에서 고르기"
                    labelEn="Vendor"
                    hint="14_업소에 등록된 거래처입니다. 고르면 수취인명이 자동으로 채워집니다."
                  >
                    <Select
                      {...fieldAria("vendorId", { hint: true })}
                      id="vendorId"
                      name="vendorId"
                      value={vendorId}
                      onChange={(e) => {
                        const id = e.currentTarget.value;
                        setVendorId(id);
                        const v = p.vendors.find((x) => x.vendorId === id);
                        if (v) setCounterpartyName(v.name);
                      }}
                    >
                      <option value="">— 목록에 없음(직접 입력) —</option>
                      {p.vendors.map((v) => (
                        <option key={v.vendorId} value={v.vendorId}>
                          {v.name}
                          {v.relatedParty ? " ★ 임원 관련" : ""}
                          {v.industry ? ` · ${v.industry}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    htmlFor="counterpartyName"
                    label="수취인명"
                    labelEn="Payee"
                    required
                    hint="상호 또는 이름을 그대로. 부호만 적으면(예: ---) 판정 불가로 접수가 거부됩니다."
                  >
                    <Input
                      {...fieldAria("counterpartyName", { hint: true })}
                      id="counterpartyName"
                      name="counterpartyName"
                      required
                      maxLength={80}
                      value={counterpartyName}
                      onChange={(e) => {
                        setCounterpartyName(e.currentTarget.value);
                        setVendorId("");
                      }}
                    />
                  </Field>

                  {showConflict ? (
                    verdict.undetermined ? (
                      <Alert tone="error" title="이해상충을 판정할 수 없습니다">
                        <ul className="ml-4 list-disc">
                          {verdict.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        <p className="mt-1">
                          판정하지 못한 건은 접수되지 않습니다. “모르겠다”는 “괜찮다”가 아닙니다.
                        </p>
                      </Alert>
                    ) : verdict.related ? (
                      <Alert tone="warn" title="이해관계자 거래입니다">
                        <p className="mb-2">
                          <ConflictBadge
                            officer={verdict.relatedOfficers[0]?.name || "임원"}
                            relation={
                              verdict.relatedOfficers[0]?.role
                                ? `${verdict.relatedOfficers[0].role} 관련`
                                : "관련"
                            }
                            {...(verdict.ownershipPct !== null
                              ? { stakePct: verdict.ownershipPct }
                              : {})}
                          />
                        </p>
                        <ul className="ml-4 list-disc">
                          {verdict.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        <p className="mt-2">
                          금액과 무관하게 이사회 의결이 필요하고, 해당 임원은 논의·표결·집행에서
                          빠집니다(recusal). 사후 추인 대상이 아닙니다.
                        </p>
                        {iAmParty ? (
                          <p className="mt-2 font-bold">
                            ★ {p.me.name} {p.me.role} 님이 바로 그 당사자입니다. 요청은 접수되지만
                            결재와 집행은 다른 임원이 해야 합니다.
                          </p>
                        ) : null}
                      </Alert>
                    ) : (
                      <Alert tone="success" title="이해관계 없음">
                        <p>
                          14_업소와 13_이해상충 어디에서도 임원 관련으로 잡히지 않았습니다. 판정은
                          접수 시점에 서버가 다시 합니다.
                        </p>
                      </Alert>
                    )
                  ) : null}
                </FormStack>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={`견적서 (이 구간은 ${route.quotesRequired}곳 필요)`}
                headingLevel={2}
                description="사진 또는 PDF. 견적이 필요한 구간인데 첨부가 없으면 비고에 면제 사유를 적어야 접수됩니다."
              />
              <CardBody>
                <FormStack>
                  <PhotoField
                    name="quoteDataUrl"
                    label="견적서 첨부"
                    labelEn="Quotation"
                    allowPdf
                    onChangeHasFile={setHasQuote}
                    missingWarning={
                      route.quotesRequired > 0
                        ? `이 금액 구간(${route.band})은 견적 ${route.quotesRequired}곳이 필요합니다.`
                        : undefined
                    }
                  />
                  <Field
                    htmlFor="note"
                    label="비고 / 견적 면제 사유"
                    labelEn="Note"
                    required={route.quotesRequired > 0 && !hasQuote}
                    hint="긴급·독점공급·법정가격 등. 여기 적은 문장은 결재 화면과 감사 화면에 그대로 남습니다."
                  >
                    <Textarea
                      {...fieldAria("note", { hint: true })}
                      id="note"
                      name="note"
                      rows={2}
                      maxLength={200}
                      value={note}
                      onChange={(e) => setNote(e.currentTarget.value)}
                    />
                  </Field>
                </FormStack>
              </CardBody>
            </Card>
          </div>

          {/* ── 오른쪽: 결재선 ─────────────────────────────── */}
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="이 건은 누구 승인이 필요한가" headingLevel={2} />
              <CardBody>
                <p className="mb-3 text-2xl font-bold tnum">{formatPeso(amountPhp)}</p>
                <StatLine label="금액 구간" value={route.band} />
                <StatLine label="결재선" value={route.route} />
                {verdict.related ? (
                  <StatLine label="평시라면" value={route.normalRoute} tone="neutral" />
                ) : null}
                <StatLine label="필요 견적" value={route.quotesRequired ? `${route.quotesRequired}곳` : "없음"} />
                <StatLine label="지급 방법" value={route.paymentMethod} />
                <StatLine
                  label="시스템 승인단계"
                  value={route.requiredStages === 0 ? "전결(0단계)" : `${route.requiredStages}단계`}
                />
                {route.noticeRequired ? (
                  <StatLine label="사전 공개 공고" value={`${route.noticeDays}일`} tone="expense" />
                ) : null}

                {route.warnings.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-2">
                    {route.warnings.map((w) => (
                      <Alert key={w} tone="warn">
                        <p>{w}</p>
                      </Alert>
                    ))}
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="승인한도표"
                headingLevel={2}
                description="03_거버넌스문서/승인한도표.md · 총회 의결 전제"
              />
              <TableCardBody label="금액 구간별 결재선">
                <Table caption="금액 구간별 결재선" captionHidden>
                  <THead>
                    <TR>
                      <TH>1건 금액</TH>
                      <TH>평시</TH>
                      <TH>임원 관련 업체</TH>
                      <TH numeric>견적</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {bands.map((b) => {
                      const current = b.band === route.band;
                      return (
                        <TR key={b.band} tone={current ? "warn" : undefined}>
                          <TD className="whitespace-nowrap tnum">
                            {b.band}
                            {current ? (
                              <Badge tone="info" className="ml-1.5">
                                이 건
                              </Badge>
                            ) : null}
                          </TD>
                          <TD>{b.normalRoute}</TD>
                          <TD>{b.weightedRoute}</TD>
                          <TD numeric>{b.quotesRequired || "—"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableCardBody>
            </Card>

            <Card>
              <CardBody>
                <ButtonRow>
                  <Button
                    type="submit"
                    size="lg"
                    block
                    disabled={pending}
                    disabledReason={
                      showConflict && verdict.undetermined
                        ? "이해상충을 판정할 수 없어 접수할 수 없습니다. 수취인을 정확히 적어 주십시오."
                        : null
                    }
                  >
                    {pending ? "접수하는 중…" : "지출 요청 접수"}
                  </Button>
                </ButtonRow>
                <p className="mt-3 text-sm text-ink-muted">
                  접수해도 돈은 나가지 않습니다. 결재가 끝난 뒤 “승인 · 집행” 화면에서 집행해야
                  장부(05_거래)에 들어갑니다.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}

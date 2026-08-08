"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  ButtonRow,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  fieldAria,
  FormStack,
  Input,
  MoneyInput,
  Select,
  StatusBadge,
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
import { evaluateTxState } from "@/lib/domain/invariants";
import { toInt } from "@/lib/domain/money";

import { IDLE } from "../../_lib/action-state";
import { PhotoField } from "../../_components/PhotoField";
import { recordReceiptAction } from "./actions";

/* ───────────────────────── props ───────────────────────── */

export type MemberOption = {
  memberNo: string;
  name: string;
  duesGrade: string;
  last4: string;
  /** 올해 미납액. 고지가 없으면 null */
  unpaid: number | null;
};

export interface ReceiptFormProps {
  today: string;
  myEmail: string;
  members: MemberOption[];
  accounts: { accountId: string; name: string; kind: string }[];
  funds: { fundId: string; name: string; kind: string }[];
  categories: { code: string; name: string }[];
  /** 확인자 후보 — 본인은 이미 빠져 있다(I4) */
  verifiers: { email: string; label: string }[];
  defaults: {
    fundId: string;
    categoryCode: string;
    /** 수단 → 기본 계좌 (00_설정 기본.계좌ID.*) */
    accountByMethod: Record<string, string>;
  };
  cashThreshold: number;
  /** 다음에 발급될 것으로 보이는 영수증번호(미리보기) */
  receiptPreview: string;
}

const METHODS = [
  { value: "CASH", label: "현금 CASH" },
  { value: "GCASH", label: "GCash" },
  { value: "MAYA", label: "Maya" },
  { value: "BANK", label: "계좌이체 BANK" },
  { value: "CARD_2C2P", label: "카드 2C2P" },
  { value: "INKIND", label: "현물 INKIND" },
] as const;

type Logged = { receiptNo: string; payer: string; amount: number; status: string; reason: string };

/* ───────────────────────── 화면 ───────────────────────── */

export function ReceiptForm(p: ReceiptFormProps) {
  const [state, formAction, pending] = useActionState(recordReceiptAction, IDLE);

  /* 배치(연속) 입력에서 유지되는 공통 값 */
  const [date, setDate] = useState(p.today);
  const [method, setMethod] = useState<string>("CASH");
  const [accountId, setAccountId] = useState(p.defaults.accountByMethod.CASH ?? "");
  const [fundId, setFundId] = useState(p.defaults.fundId);
  const [categoryCode, setCategoryCode] = useState(p.defaults.categoryCode);
  const [verifiedBy, setVerifiedBy] = useState("");
  const [batch, setBatch] = useState(false);

  /* 건별로 비워지는 값 */
  const [query, setQuery] = useState("");
  const [payer, setPayer] = useState("");
  const [memberNo, setMemberNo] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("PHP");
  const [externalRef, setExternalRef] = useState("");
  const [memo, setMemo] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [ack, setAck] = useState(false);
  const [photoReset, setPhotoReset] = useState(0);

  const [logged, setLogged] = useState<Logged[]>([]);
  const handledAt = useRef(0);

  /* 성공하면 건별 값만 비우고 공통 값은 남긴다 — 정전 뒤 밀린 종이 영수증을 몰아 넣는 실제 시나리오 */
  useEffect(() => {
    if (state.ok !== true || state.at === handledAt.current) return;
    handledAt.current = state.at;
    setLogged((prev) =>
      [
        {
          receiptNo: state.receiptNo ?? "",
          payer,
          amount: toInt(amount),
          status: state.status ?? "",
          reason: state.reason ?? "",
        },
        ...prev,
      ].slice(0, 25),
    );
    setQuery("");
    setPayer("");
    setMemberNo("");
    setAmount("");
    setExternalRef("");
    setMemo("");
    setAck(false);
    setHasPhoto(false);
    setPhotoReset((k) => k + 1);
    // 연속 입력 모드에서는 다음 건을 바로 칠 수 있게 커서를 납부자 칸으로 돌려놓는다.
    if (batch) document.getElementById("payer")?.focus();
  }, [state, payer, amount, batch]);

  function pickMethod(next: string) {
    setMethod(next);
    const auto = p.defaults.accountByMethod[next];
    if (auto) setAccountId(auto);
  }

  function pickMember(m: MemberOption) {
    setMemberNo(m.memberNo);
    setPayer(m.name);
    setQuery("");
    // 미납액이 있으면 금액을 미리 채워 준다. 총무가 매번 고지서를 다시 찾지 않아도 된다.
    if (m.unpaid && m.unpaid > 0 && !amount) setAmount(String(m.unpaid));
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return p.members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.memberNo.toLowerCase().includes(q) ||
          m.last4.includes(q),
      )
      .slice(0, 8);
  }, [query, p.members]);

  /* 지금 저장하면 POSTED 인가 DRAFT 인가 — 서버와 **같은 함수**로 미리 보여준다.
     (최종 판단은 서버가 한다. 이건 안내일 뿐이다) */
  const preview = evaluateTxState(
    {
      evidenceUrl: hasPhoto ? "/uploads/preview" : "",
      method,
      amount: toInt(amount),
      currency,
      fxRate: currency === "PHP" ? 1 : null,
      enteredBy: p.myEmail,
      verifiedBy,
    },
    p.cashThreshold,
  );

  const cashOverThreshold = method === "CASH" && toInt(amount) > p.cashThreshold;

  return (
    <div className="flex flex-col gap-5">
      {state.ok === true ? (
        <Alert tone={state.status === "POSTED" ? "success" : "warn"} title={state.message}>
          {state.status === "DRAFT" && state.reason ? (
            <p>
              <b>{state.reason}</b> — 빠진 것을 채우면 장부에 반영됩니다. 지금은 공개 회계에 잡히지
              않습니다.
            </p>
          ) : null}
        </Alert>
      ) : null}
      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}

      <form action={formAction}>
        {/* 배치 모드에서 유지되는 값들도 매 제출마다 함께 보낸다 */}
        <input type="hidden" name="memberNo" value={memberNo} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-5">
            {/* ── 누가 · 얼마 ─────────────────────────────── */}
            <Card>
              <CardHeader title="누가 · 얼마를 냈는가" headingLevel={2} />
              <CardBody>
                <FormStack>
                  <Field
                    htmlFor="payer-search"
                    label="회원 찾기"
                    labelEn="Find member"
                    hint="이름·회원번호·전화 뒷 4자리로 찾습니다. 비회원이면 그냥 아래 칸에 이름을 적으십시오."
                  >
                    <Input
                      {...fieldAria("payer-search", { hint: true })}
                      id="payer-search"
                      type="search"
                      autoComplete="off"
                      value={query}
                      onChange={(e) => setQuery(e.currentTarget.value)}
                      placeholder="김민준 / M0007 / 4567"
                    />
                  </Field>

                  {matches.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {matches.map((m) => (
                        <li key={m.memberNo}>
                          <button
                            type="button"
                            onClick={() => pickMember(m)}
                            className="flex min-h-touch w-full items-center justify-between gap-3 rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50"
                          >
                            <span className="min-w-0">
                              <span className="font-semibold">{m.name}</span>
                              <span className="ml-2 font-mono text-sm text-ink-muted">
                                {m.memberNo}
                              </span>
                              <span className="block text-sm text-ink-muted">
                                {m.duesGrade}
                                {m.last4 ? ` · ****${m.last4}` : ""}
                              </span>
                            </span>
                            {m.unpaid !== null && m.unpaid > 0 ? (
                              <Badge tone="warn">미납 {formatPeso(m.unpaid)}</Badge>
                            ) : m.unpaid === 0 ? (
                              <Badge tone="success">완납</Badge>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Field
                    htmlFor="payer"
                    label="납부자"
                    labelEn="Payer"
                    required
                    hint={
                      memberNo
                        ? `회원 ${memberNo} 로 연결됩니다. 회비 수납이면 06_회비고지가 자동으로 갱신됩니다.`
                        : "회원으로 연결되지 않은 상태입니다(비회원으로 기록됩니다)."
                    }
                  >
                    <Input
                      {...fieldAria("payer", { hint: true })}
                      id="payer"
                      name="payer"
                      required
                      maxLength={60}
                      value={payer}
                      onChange={(e) => {
                        setPayer(e.currentTarget.value);
                        setMemberNo(""); // 손으로 고치면 회원 연결을 끊는다
                      }}
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field htmlFor="amount" label="금액" labelEn="Amount" required>
                      <MoneyInput
                        {...fieldAria("amount", {})}
                        id="amount"
                        name="amount"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.currentTarget.value)}
                        placeholder="1200"
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
                      외화는 00_설정의 환율로 페소 환산해 저장하고, 거래 시점 환율을 함께 기록합니다.
                      집계는 언제나 페소 환산액으로만 합니다.
                    </p>
                  ) : null}

                  <Field htmlFor="memo" label="적요" labelEn="Memo" hint="회원 실명은 적지 마십시오 — 적요는 공개 화면으로 나갈 수 있는 칸입니다. 회원번호로 남습니다.">
                    <Textarea
                      {...fieldAria("memo", { hint: true })}
                      id="memo"
                      name="memo"
                      rows={2}
                      maxLength={200}
                      value={memo}
                      onChange={(e) => setMemo(e.currentTarget.value)}
                      placeholder="2026년 연회비"
                    />
                  </Field>

                  <Field
                    htmlFor="externalRef"
                    label="외부 참조번호"
                    labelEn="Reference"
                    hint="GCash Ref No 등. 나중에 은행·GCash 명세와 대사할 때 이 값으로 붙습니다."
                  >
                    <Input
                      {...fieldAria("externalRef", { hint: true })}
                      id="externalRef"
                      name="externalRef"
                      maxLength={60}
                      value={externalRef}
                      onChange={(e) => setExternalRef(e.currentTarget.value)}
                    />
                  </Field>
                </FormStack>
              </CardBody>
            </Card>

            {/* ── 증빙 ─────────────────────────────────────── */}
            <Card>
              <CardHeader
                title="증빙 (I3)"
                headingLevel={2}
                description="증빙이 없으면 POSTED 가 될 수 없습니다. 이건 설정으로 끌 수 없습니다."
              />
              <CardBody>
                <FormStack>
                  <PhotoField
                    name="photoDataUrl"
                    label="영수증 사진"
                    labelEn="Receipt photo"
                    onChangeHasFile={setHasPhoto}
                    resetKey={photoReset}
                    missingWarning="사진이 없습니다. 이대로 저장하면 미확정(DRAFT)으로 남습니다."
                  />
                  {!hasPhoto ? (
                    <Checkbox
                      id="ackNoEvidence"
                      name="ackNoEvidence"
                      checked={ack}
                      onChange={(e) => setAck(e.currentTarget.checked)}
                      label="사진 없이 임시(DRAFT)로 기록하겠습니다"
                      description="나중에 사진을 붙여 확정합니다. DRAFT 는 공개 회계·잔액 계산에 잡히지 않습니다."
                    />
                  ) : null}
                </FormStack>
              </CardBody>
            </Card>
          </div>

          {/* ── 오른쪽: 공통 값 + 판정 미리보기 ─────────────── */}
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader
                title="공통 항목"
                headingLevel={2}
                description="연속 입력 모드에서 이 값들은 그대로 남습니다."
              />
              <CardBody>
                <FormStack>
                  <Field htmlFor="date" label="일자" labelEn="Date" required>
                    <Input
                      {...fieldAria("date", {})}
                      id="date"
                      name="date"
                      type="date"
                      required
                      max={p.today}
                      value={date}
                      onChange={(e) => setDate(e.currentTarget.value)}
                    />
                  </Field>

                  <Field htmlFor="method" label="수단" labelEn="Method" required>
                    <Select
                      {...fieldAria("method", {})}
                      id="method"
                      name="method"
                      required
                      value={method}
                      onChange={(e) => pickMethod(e.currentTarget.value)}
                    >
                      {METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    htmlFor="accountId"
                    label="입금 계좌"
                    labelEn="Account"
                    required
                    hint="수단을 바꾸면 기본 계좌가 따라 바뀝니다. 틀리면 현금실사 대사가 어긋납니다."
                  >
                    <Select
                      {...fieldAria("accountId", { hint: true })}
                      id="accountId"
                      name="accountId"
                      required
                      value={accountId}
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

                  <Field htmlFor="categoryCode" label="과목" labelEn="Category" required>
                    <Select
                      {...fieldAria("categoryCode", {})}
                      id="categoryCode"
                      name="categoryCode"
                      required
                      value={categoryCode}
                      onChange={(e) => setCategoryCode(e.currentTarget.value)}
                    >
                      {p.categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field htmlFor="fundId" label="기금" labelEn="Fund" required>
                    <Select
                      {...fieldAria("fundId", {})}
                      id="fundId"
                      name="fundId"
                      required
                      value={fundId}
                      onChange={(e) => setFundId(e.currentTarget.value)}
                    >
                      {p.funds.map((f) => (
                        <option key={f.fundId} value={f.fundId}>
                          {f.fundId} · {f.name} ({f.kind})
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    htmlFor="verifiedBy"
                    label="확인자"
                    labelEn="Verified by"
                    required={cashOverThreshold}
                    hint={`현금 ${formatPeso(p.cashThreshold)} 초과는 입력자와 다른 사람의 확인이 있어야 장부에 반영됩니다(I4). 목록에 본인은 없습니다.`}
                  >
                    <Select
                      {...fieldAria("verifiedBy", { hint: true })}
                      id="verifiedBy"
                      name="verifiedBy"
                      value={verifiedBy}
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
                </FormStack>
              </CardBody>
            </Card>

            {/* 판정 미리보기 */}
            <Card>
              <CardHeader title="저장하면 어떻게 되는가" headingLevel={2} />
              <CardBody>
                <p className="flex items-center gap-2">
                  <StatusBadge status={preview.status} />
                  <span className="font-mono text-sm text-ink-muted">{p.receiptPreview}</span>
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  {preview.status === "POSTED"
                    ? "증빙과 확인 요건을 모두 갖췄습니다. 저장 즉시 공개 회계와 잔액에 반영됩니다."
                    : preview.reason}
                </p>
                <p className="mt-3 text-sm text-ink-muted">
                  영수증번호는 저장하는 순간 트랜잭션 안에서 발급됩니다. 위 번호는 예상값이며, 저장이
                  실패하면 번호도 함께 되돌아가 결번이 생기지 않습니다(I2).
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <Checkbox
                  id="batch"
                  checked={batch}
                  onChange={(e) => setBatch(e.currentTarget.checked)}
                  label="연속 입력 모드"
                  description="저장 후 일자·수단·계좌·과목·기금·확인자는 그대로 두고 납부자와 금액만 비웁니다. 정전 뒤 밀린 종이 영수증을 몰아 넣을 때 씁니다."
                />
                <ButtonRow className="mt-4">
                  <Button type="submit" size="lg" block disabled={pending}>
                    {pending ? "기록하는 중…" : "수납 기록"}
                  </Button>
                </ButtonRow>
              </CardBody>
            </Card>
          </div>
        </div>
      </form>

      {/* 이번 세션에 넣은 것 */}
      {logged.length > 0 ? (
        <Card>
          <CardHeader
            title={`이번에 기록한 ${logged.length}건`}
            description="이 목록은 화면을 새로고침하면 사라집니다. 원본은 05_거래에 남습니다."
          />
          <TableCardBody label="이번 세션 수납 목록">
            <Table caption="이번 세션에 기록한 수납" captionHidden>
              <THead>
                <TR>
                  <TH>영수증번호</TH>
                  <TH>납부자</TH>
                  <TH numeric>금액</TH>
                  <TH>상태</TH>
                </TR>
              </THead>
              <TBody>
                {logged.map((l) => (
                  <TR key={l.receiptNo} tone={l.status === "DRAFT" ? "warn" : undefined}>
                    <TD className="font-mono text-sm">{l.receiptNo}</TD>
                    <TD>{l.payer}</TD>
                    <TD numeric>{formatPeso(l.amount)}</TD>
                    <TD>
                      <StatusBadge status={l.status} />
                      {l.reason ? (
                        <span className="block text-sm text-ink-muted">{l.reason}</span>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCardBody>
        </Card>
      ) : null}
    </div>
  );
}

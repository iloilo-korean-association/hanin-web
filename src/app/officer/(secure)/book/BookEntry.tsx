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
  Field,
  Input,
  MoneyInput,
  Select,
  StatGrid,
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
import { accountForMethod, ENTRY_FLAG_HELP, type EntryFlag } from "@/lib/domain/direct-entry";

import { IDLE } from "../../_lib/action-state";
import { addEntryAction, editEntryAction, voidEntryAction } from "./actions";

export type MasterData = {
  accounts: { accountId: string; name: string; kind: string; currency: string; status: string }[];
  funds: { fundId: string; name: string; kind: string }[];
  categories: { code: string; name: string; majorType: string }[];
  events: { eventId: string; title: string }[];
  officers: { email: string; label: string }[];
  today: string;
  cashThreshold: number;
};

export type BookRowUI = {
  receiptNo: string;
  date: string;
  direction: string;
  amount: number;
  amountPhp: number;
  currency: string;
  method: string;
  accountId: string;
  fundId: string;
  categoryCode: string;
  categoryName: string;
  counterpartyName: string;
  counterpartyType: string;
  memo: string;
  externalRef: string;
  status: string;
  voidReason: string;
  relatedParty: boolean;
  enteredBy: string;
  verifiedBy: string;
  evidenceUrl: string;
  reviewedBy: string;
  reviewedAt: string | null;
  flags: EntryFlag[];
};

const METHODS = [
  { value: "CASH", label: "현금" },
  { value: "GCASH", label: "GCash" },
  { value: "MAYA", label: "Maya" },
  { value: "BANK", label: "계좌이체" },
  { value: "CARD_2C2P", label: "카드" },
  { value: "INKIND", label: "현물" },
];

const FLAG_TONE: Record<EntryFlag, "warn" | "danger" | "neutral"> = {
  증빙없음: "neutral",
  미확인현금: "warn",
  이해관계자: "danger",
  고액: "warn",
  수정됨: "neutral",
};

/** 'yyyy-MM-dd' → '8/14'. 목록은 같은 달만 나오므로 월/일이면 충분하다. */
function md(date: string): string {
  const [, m, d] = date.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : date;
}

export function BookEntry({
  rows,
  master,
  monthLabel,
  totalBalance,
  readOnly,
  readOnlyReason,
}: {
  rows: BookRowUI[];
  master: MasterData;
  monthLabel: string;
  totalBalance: number;
  readOnly: boolean;
  readOnlyReason: string;
}) {
  const [addState, add, adding] = useActionState(addEntryAction, IDLE);
  const [editState, edit, editing] = useActionState(editEntryAction, IDLE);
  const [voidState, doVoid, voiding] = useActionState(voidEntryAction, IDLE);

  const formRef = useRef<HTMLFormElement>(null);

  /** 연속 입력에서 유지되는 값들. 이것 때문에 두 번째 줄부터는 3칸만 치면 된다. */
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [method, setMethod] = useState("CASH");
  const [accountId, setAccountId] = useState(() => accountForMethod("CASH", master.accounts));
  const [editRow, setEditRow] = useState<BookRowUI | null>(null);
  const [voidRow, setVoidRow] = useState<BookRowUI | null>(null);

  // 가장 최근에 끝난 액션의 메시지만 보여준다. 셋을 동시에 띄우면 무엇이 지금 일인지 알 수 없다.
  const latest = [addState, editState, voidState].reduce((a, b) => (b.at > a.at ? b : a));

  const cats = useMemo(
    () => master.categories.filter((c) => c.majorType === (direction === "IN" ? "수입" : "지출")),
    [master.categories, direction],
  );
  const eventCats = useMemo(
    () => new Set(cats.filter((c) => c.name.includes("행사")).map((c) => c.code)),
    [cats],
  );
  const [categoryCode, setCategoryCode] = useState("");

  const inSum = rows.filter((r) => r.status === "POSTED" && r.direction === "IN").reduce((s, r) => s + r.amountPhp, 0);
  const outSum = rows.filter((r) => r.status === "POSTED" && r.direction === "OUT").reduce((s, r) => s + r.amountPhp, 0);

  function pickMethod(next: string) {
    setMethod(next);
    setAccountId(accountForMethod(next, master.accounts, accountId));
  }

  /**
   * 연속 입력의 핵심 — 상대방·금액·메모만 비우고 커서를 상대방으로 돌린다.
   * 날짜·과목·수단·계좌·기금은 그대로 두므로 두 번째 줄부터는 세 칸만 치면 된다.
   *
   * ★ **성공했을 때만** 비운다.
   *   제출 직후에 비우면 서버가 거부했을 때(마감 연도·과목 불일치 등) 방금 친 내용이
   *   통째로 사라진다. 오류 메시지만 남고 다시 처음부터 쳐야 한다 — 그게 가장 화난다.
   * ★ addState.at 을 의존성으로 쓴다. ok 만 보면 연달아 성공했을 때 값이 안 바뀌어
   *   두 번째 성공에서 폼이 안 비워진다.
   */
  useEffect(() => {
    if (addState.ok !== true) return;
    const f = formRef.current;
    if (!f) return;
    let first: HTMLInputElement | null = null;
    for (const name of ["counterpartyName", "amount", "memo", "externalRef"]) {
      const el = f.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = "";
        if (name === "counterpartyName" && el instanceof HTMLInputElement) first = el;
      }
    }
    first?.focus();
  }, [addState.ok, addState.at]);

  return (
    <>
      {latest.ok !== null && latest.message ? (
        <Alert tone={latest.ok ? "success" : "error"} title={latest.message}>
          {latest.howToFix}
        </Alert>
      ) : null}

      {readOnly ? (
        <Alert tone="warn" title="열람만 가능합니다">
          {readOnlyReason}
        </Alert>
      ) : null}

      {/* ── 새로 적기 ─────────────────────────────────────────────── */}
      {!readOnly && !editRow ? (
        <Card as="section">
          <CardHeader
            title="새로 적기"
            description="과목 · 상대방 · 금액 세 칸만 채우면 됩니다. 나머지는 직전 값이 그대로 남습니다."
            headingLevel={2}
          />
          <CardBody>
            {/* action 에 서버 액션을 **그대로** 넘긴다. 화살표로 감싸면 Next 가
                JS 없는 제출 경로를 만들지 못해, 스크립트가 막힌 환경에서 폼이 죽는다. */}
            <form ref={formRef} action={add}>
              <fieldset className="mb-4">
                <legend className="sr-only">방향</legend>
                <div className="flex gap-2">
                  {(["IN", "OUT"] as const).map((d) => (
                    <label
                      key={d}
                      className={`cursor-pointer rounded-md border px-4 py-2 font-semibold ${
                        direction === d ? "border-ink bg-ink text-white" : "border-line"
                      }`}
                    >
                      <input
                        type="radio"
                        name="direction"
                        value={d}
                        checked={direction === d}
                        onChange={() => {
                          setDirection(d);
                          setCategoryCode("");
                        }}
                        className="sr-only"
                      />
                      {d === "IN" ? "들어옴 (수입)" : "나감 (지출)"}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="날짜" htmlFor="date">
                  <Input id="date" name="date" type="date" defaultValue={master.today} max={master.today} required />
                </Field>

                <Field label="과목" htmlFor="categoryCode" required>
                  <Select
                    id="categoryCode"
                    name="categoryCode"
                    value={categoryCode}
                    onChange={(e) => setCategoryCode(e.target.value)}
                    required
                  >
                    <option value="">— 고르십시오 —</option>
                    {cats.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="상대방" htmlFor="counterpartyName" required hint={direction === "OUT" ? "수취인. 이해관계 판정의 유일한 근거입니다." : "납부자"}>
                  <Input id="counterpartyName" name="counterpartyName" autoComplete="off" required />
                </Field>

                <Field label="금액" htmlFor="amount" required>
                  <MoneyInput id="amount" name="amount" required />
                </Field>

                <Field label="수단" htmlFor="method">
                  <Select id="method" name="method" value={method} onChange={(e) => pickMethod(e.target.value)}>
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="계좌" htmlFor="accountId" hint="수단을 고르면 자동으로 따라옵니다.">
                  <Select
                    id="accountId"
                    name="accountId"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                  >
                    {master.accounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="기금" htmlFor="fundId">
                  <Select id="fundId" name="fundId" defaultValue={master.funds[0]?.fundId ?? ""}>
                    {master.funds.map((f) => (
                      <option key={f.fundId} value={f.fundId}>
                        {f.name}
                        {f.kind === "지정" ? " (지정)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>

                {method === "CASH" ? (
                  <Field
                    label="확인자"
                    htmlFor="verifiedBy"
                    hint={`현금 ${formatPeso(master.cashThreshold)} 초과는 채워 주십시오. 비우면 감사가 확인합니다.`}
                  >
                    <Select id="verifiedBy" name="verifiedBy" defaultValue="">
                      <option value="">— 없음 —</option>
                      {master.officers.map((o) => (
                        <option key={o.email} value={o.email}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="외부 참조번호" htmlFor="externalRef" hint="GCash Ref No 등. 대사 매칭 키입니다.">
                    <Input id="externalRef" name="externalRef" autoComplete="off" />
                  </Field>
                )}

                {eventCats.has(categoryCode) && master.events.length > 0 ? (
                  <Field label="행사" htmlFor="eventId" hint="고르면 행사별 정산에 묶입니다.">
                    <Select id="eventId" name="eventId" defaultValue="">
                      <option value="">— 묶지 않음 —</option>
                      {master.events.map((e) => (
                        <option key={e.eventId} value={e.eventId}>
                          {e.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                <Field label="메모" htmlFor="memo" className="sm:col-span-2">
                  <Input id="memo" name="memo" autoComplete="off" />
                </Field>
              </div>

              <ButtonRow className="mt-4">
                <Button type="submit" variant="primary" disabled={adding}>
                  {adding ? "적는 중…" : "적기"}
                </Button>
              </ButtonRow>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {/* ── 수정 ──────────────────────────────────────────────────── */}
      {editRow ? (
        <Card as="section">
          <CardHeader title={`수정 — ${editRow.receiptNo}`} headingLevel={2} />
          <CardBody>
            <Alert tone="warn" title="고친 내용은 공개 장부에 그대로 나갑니다">
              영수증번호는 바뀌지 않습니다. 금액을 고치면 감사로그에 CRITICAL 로 남고, 감사 확인
              도장은 취소되어 다시 확인 대기로 올라갑니다.
            </Alert>
            <form action={edit} className="mt-4">
              <input type="hidden" name="receiptNo" value={editRow.receiptNo} />
              <input type="hidden" name="direction" value={editRow.direction} />
              <input type="hidden" name="counterpartyType" value={editRow.counterpartyType} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="날짜" htmlFor="e_date">
                  <Input id="e_date" name="date" type="date" defaultValue={editRow.date} max={master.today} required />
                </Field>
                <Field label="과목" htmlFor="e_cat" required>
                  <Select id="e_cat" name="categoryCode" defaultValue={editRow.categoryCode} required>
                    {master.categories
                      .filter((c) => c.majorType === (editRow.direction === "IN" ? "수입" : "지출"))
                      .map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="상대방" htmlFor="e_payee" required>
                  <Input id="e_payee" name="counterpartyName" defaultValue={editRow.counterpartyName} required />
                </Field>
                <Field label="금액" htmlFor="e_amount" required>
                  <MoneyInput id="e_amount" name="amount" defaultValue={String(editRow.amount)} required />
                </Field>
                <Field label="수단" htmlFor="e_method">
                  <Select id="e_method" name="method" defaultValue={editRow.method}>
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="계좌" htmlFor="e_acc">
                  <Select id="e_acc" name="accountId" defaultValue={editRow.accountId} required>
                    {master.accounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="기금" htmlFor="e_fund">
                  <Select id="e_fund" name="fundId" defaultValue={editRow.fundId}>
                    {master.funds.map((f) => (
                      <option key={f.fundId} value={f.fundId}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="메모" htmlFor="e_memo" className="sm:col-span-2">
                  <Input id="e_memo" name="memo" defaultValue={editRow.memo} />
                </Field>
              </div>
              <ButtonRow className="mt-4">
                <Button type="submit" variant="primary" disabled={editing}>
                  {editing ? "고치는 중…" : "고치기"}
                </Button>
                <Button type="button" onClick={() => setEditRow(null)}>
                  취소
                </Button>
              </ButtonRow>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {/* ── 무효 ──────────────────────────────────────────────────── */}
      {voidRow ? (
        <Card as="section">
          <CardHeader title={`무효 처리 — ${voidRow.receiptNo}`} headingLevel={2} />
          <CardBody>
            <Alert tone="error" title="행은 지워지지 않습니다">
              공개 장부에 줄이 그어진 채 사유와 함께 남습니다. 지우면 “그런 지출이 있었다”는 사실
              자체가 사라지기 때문입니다(I1).
            </Alert>
            <form action={doVoid} className="mt-4">
              <input type="hidden" name="receiptNo" value={voidRow.receiptNo} />
              <input type="hidden" name="reversalDate" value={master.today} />
              <Field label="무효 사유" htmlFor="v_reason" required hint="왜 무효인지 적으십시오. 공개됩니다.">
                <Textarea id="v_reason" name="reason" rows={2} required />
              </Field>
              <ButtonRow className="mt-4">
                <Button type="submit" variant="danger" disabled={voiding}>
                  {voiding ? "처리 중…" : "무효 처리"}
                </Button>
                <Button type="button" onClick={() => setVoidRow(null)}>
                  취소
                </Button>
              </ButtonRow>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {/* ── 이번 달 목록 ───────────────────────────────────────────── */}
      <Card as="section">
        <CardHeader title={`${monthLabel} — ${rows.length}건`} headingLevel={2} />
        <CardBody>
          <StatGrid
            label={`${monthLabel} 요약`}
            items={[
              { label: "들어옴", value: formatPeso(inSum), tone: "income" },
              { label: "나감", value: formatPeso(outSum), tone: "expense" },
              { label: "이번 달 수지", value: formatPeso(inSum - outSum) },
              { label: "계좌 잔액 합계", value: formatPeso(totalBalance), tone: "balance" },
            ]}
          />
        </CardBody>
        <TableCardBody label="이번 달 장부">
          <Table caption="이번 달 장부" captionHidden>
            <THead>
              <TR>
                <TH>날짜</TH>
                <TH>과목</TH>
                <TH>상대방</TH>
                <TH numeric>금액</TH>
                <TH>표시</TH>
                {readOnly ? null : <TH>관리</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TR>
                  <TD>이번 달에 적은 것이 아직 없습니다.</TD>
                </TR>
              ) : (
                rows.map((r) => {
                  const voided = r.status === "VOIDED";
                  return (
                    <TR key={r.receiptNo} className={voided ? "opacity-55 line-through" : undefined}>
                      <TD>
                        <div>{md(r.date)}</div>
                        <div className="text-xs text-ink-faint">{r.receiptNo}</div>
                      </TD>
                      <TD>
                        <Badge tone={r.direction === "IN" ? "success" : "neutral"}>
                          {r.direction === "IN" ? "들어옴" : "나감"}
                        </Badge>{" "}
                        {r.categoryName}
                      </TD>
                      <TD>
                        <div>{r.counterpartyName}</div>
                        {r.memo ? <div className="text-xs text-ink-faint">{r.memo}</div> : null}
                        {voided && r.voidReason ? (
                          <div className="text-xs text-danger">무효: {r.voidReason}</div>
                        ) : null}
                      </TD>
                      <TD numeric>{formatPeso(r.amountPhp)}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {r.reviewedAt ? <Badge tone="success">감사확인</Badge> : null}
                          {r.flags.map((f) => (
                            <Badge key={f} tone={FLAG_TONE[f]} title={ENTRY_FLAG_HELP[f]}>
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      {readOnly ? null : (
                        <TD>
                          {voided ? (
                            <span className="text-xs text-ink-faint">무효됨</span>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => {
                                  setVoidRow(null);
                                  setEditRow(r);
                                }}
                              >
                                수정
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                onClick={() => {
                                  setEditRow(null);
                                  setVoidRow(r);
                                }}
                              >
                                무효
                              </Button>
                            </div>
                          )}
                        </TD>
                      )}
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableCardBody>
      </Card>
    </>
  );
}

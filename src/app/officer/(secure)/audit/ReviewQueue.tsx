"use client";

import { useActionState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatPeso,
} from "@/components/ui";
import type { EntryFlag } from "@/lib/domain/direct-entry";

import { IDLE } from "../../_lib/action-state";
import { reviewTransactionAction } from "./actions";

export type QueueRowUI = {
  receiptNo: string;
  date: string;
  direction: string;
  amountPhp: number;
  categoryName: string;
  counterpartyName: string;
  enteredBy: string;
  flags: EntryFlag[];
  reasons: string[];
  /** 본인이 적은 건이면 확인 버튼을 못 누른다 */
  isMine: boolean;
};

const TONE: Record<EntryFlag, "warn" | "danger" | "neutral"> = {
  증빙없음: "neutral",
  미확인현금: "warn",
  이해관계자: "danger",
  고액: "warn",
  수정됨: "neutral",
};

/**
 * 확인 대기 큐 — 사전 승인을 대신하는 사후 통제.
 *
 * 감사 화면의 나머지(C1~C14 검사)는 전부 읽기 전용인데 여기만 버튼이 있다.
 * 그 버튼이 하는 일은 장부 수정이 아니라 **"내가 봤다" 는 기록**이다.
 */
export function ReviewQueue({
  rows,
  canReview,
  cannotReason,
}: {
  rows: QueueRowUI[];
  canReview: boolean;
  cannotReason: string;
}) {
  const [state, review, pending] = useActionState(reviewTransactionAction, IDLE);

  return (
    <Card as="section">
      <CardHeader
        title={`확인 대기 ${rows.length}건`}
        description="증빙이 없거나, 현금 고액인데 확인자가 없거나, 이해관계 건이거나, 금액이 크거나, 적은 뒤에 고쳐진 거래입니다."
        headingLevel={2}
      />

      {state.ok !== null && state.message ? (
        <div className="px-4 pt-4 sm:px-5">
          <Alert tone={state.ok ? "success" : "error"} title={state.message}>
            {state.howToFix}
          </Alert>
        </div>
      ) : null}

      {!canReview ? (
        <div className="px-4 pt-4 sm:px-5">
          <Alert tone="info" title="확인 도장을 찍을 수 없는 계정입니다">
            {cannotReason}
          </Alert>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon="✓" title="확인이 필요한 거래가 없습니다." />
      ) : (
        <TableCardBody label="확인 대기">
          <Table caption="확인 대기 거래" captionHidden>
            <THead>
              <TR>
                <TH>거래</TH>
                <TH>상대방</TH>
                <TH numeric>금액</TH>
                <TH>봐야 하는 이유</TH>
                {canReview ? <TH>확인</TH> : null}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.receiptNo}>
                  <TD>
                    <div className="font-medium">{r.date}</div>
                    <div className="text-xs text-ink-faint">
                      {r.receiptNo} · {r.direction === "IN" ? "들어옴" : "나감"} · {r.categoryName}
                    </div>
                  </TD>
                  <TD>
                    <div>{r.counterpartyName}</div>
                    <div className="text-xs text-ink-faint">적은 사람 {r.enteredBy}</div>
                  </TD>
                  <TD numeric>{formatPeso(r.amountPhp)}</TD>
                  <TD>
                    <div className="mb-1 flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <Badge key={f} tone={TONE[f]}>
                          {f}
                        </Badge>
                      ))}
                    </div>
                    <ul className="text-xs text-ink-faint">
                      {r.reasons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </TD>
                  {canReview ? (
                    <TD>
                      {r.isMine ? (
                        <span
                          className="text-xs text-ink-faint"
                          title="자기가 적은 거래를 자기가 확인하면 2인 원칙이 형식만 남습니다."
                        >
                          본인 기재 — 확인 불가
                        </span>
                      ) : (
                        <form action={review}>
                          <input type="hidden" name="receiptNo" value={r.receiptNo} />
                          <Button type="submit" disabled={pending}>
                            확인함
                          </Button>
                        </form>
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableCardBody>
      )}
    </Card>
  );
}

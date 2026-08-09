"use client";

import { useActionState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  CardBody,
  formatPeso,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "@/components/ui";

import { IDLE } from "../../../_lib/action-state";
import { setSignupStatusAction } from "./actions";

/**
 * 행사 참가자 명단 표.
 *
 * ★ 개인정보(실명·연락처)가 그대로 보이는 임원 전용 화면이다.
 *   이 데이터를 공개 화면으로 옮기는 경로를 만들지 마라.
 * ★ 상태 변경 버튼은 "행사관리" 권한 + 감사가 아닐 때만 그린다.
 *   버튼을 숨기는 것은 통제가 아니다 — 서버 액션 첫 줄의 requireOfficer 가 진짜 관문이다.
 */

export type SignupRowUI = {
  signupId: string;
  applicantName: string;
  phone: string;
  guests: number;
  totalPeople: number;
  feeTotal: number;
  paid: boolean;
  status: string;
  appliedAt: string; // 마닐라 기준 'yyyy-MM-dd HH:mm'
  specialNote: string;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  접수: "info",
  확정: "success",
  취소: "danger",
};

export function SignupRoster({
  rows,
  canManage,
  readOnlyReason,
}: {
  rows: SignupRowUI[];
  canManage: boolean;
  readOnlyReason?: string;
}) {
  const [state, act, pending] = useActionState(setSignupStatusAction, IDLE);

  return (
    <>
      {state.ok !== null && state.message ? (
        <Alert tone={state.ok ? "success" : "error"} title={state.message}>
          {state.howToFix}
        </Alert>
      ) : null}

      {!canManage && readOnlyReason ? (
        <Alert tone="warn" title="열람만 가능합니다">
          {readOnlyReason}
        </Alert>
      ) : null}

      <Card as="section">
        <CardHeader title={`참가 신청 (${rows.length}건)`} headingLevel={2} />
        {rows.length === 0 ? (
          <CardBody>
            <EmptyState icon="📝" title="아직 신청이 없습니다" />
          </CardBody>
        ) : (
          <TableCardBody label="행사 참가자 명단">
            <Table caption="행사 참가자 명단" captionHidden>
              <THead>
                <TR>
                  <TH>신청번호</TH>
                  <TH>신청자명</TH>
                  <TH>연락처</TH>
                  <TH numeric>총인원</TH>
                  <TH>상태</TH>
                  <TH>신청일시</TH>
                  <TH numeric>참가비 합계</TH>
                  {canManage ? <TH className="no-print">관리</TH> : null}
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.signupId} tone={r.status === "취소" ? "muted" : undefined}>
                    <TD className="font-mono text-sm">{r.signupId}</TD>
                    <TD>
                      <span className="font-medium">{r.applicantName}</span>
                      {r.specialNote ? (
                        <span className="block text-xs text-ink-faint">{r.specialNote}</span>
                      ) : null}
                    </TD>
                    <TD className="tnum whitespace-nowrap">{r.phone || "—"}</TD>
                    <TD numeric>
                      {r.totalPeople}명{r.guests > 0 ? ` (동반 ${r.guests})` : ""}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    </TD>
                    <TD className="tnum whitespace-nowrap">{r.appliedAt}</TD>
                    <TD numeric>
                      {r.feeTotal > 0 ? formatPeso(r.feeTotal) : "무료"}
                      {r.feeTotal > 0 ? (
                        <span className="block text-xs text-ink-faint">
                          {r.paid ? "납부됨" : "미납"}
                        </span>
                      ) : null}
                    </TD>
                    {canManage ? (
                      <TD className="no-print">
                        <div className="flex flex-wrap gap-2">
                          {r.status === "접수" ? (
                            <StatusForm signupId={r.signupId} next="확정" pending={pending} act={act} />
                          ) : null}
                          {r.status !== "취소" ? (
                            <StatusForm
                              signupId={r.signupId}
                              next="취소"
                              pending={pending}
                              act={act}
                              danger
                            />
                          ) : (
                            <StatusForm
                              signupId={r.signupId}
                              next="접수"
                              label="접수로 되살리기"
                              pending={pending}
                              act={act}
                            />
                          )}
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCardBody>
        )}
      </Card>
    </>
  );
}

function StatusForm({
  signupId,
  next,
  label,
  pending,
  act,
  danger,
}: {
  signupId: string;
  next: "접수" | "확정" | "취소";
  label?: string;
  pending: boolean;
  act: (fd: FormData) => void;
  danger?: boolean;
}) {
  return (
    <form action={act} className="inline">
      <input type="hidden" name="signupId" value={signupId} />
      <input type="hidden" name="nextStatus" value={next} />
      <Button type="submit" size="sm" variant={danger ? "danger" : undefined} disabled={pending}>
        {label ?? next}
      </Button>
    </form>
  );
}

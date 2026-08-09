"use client";

import { Badge, formatPeso } from "@/components/ui";

import { AdminCrud, type ColumnSpec, type FieldSpec } from "../../_components/AdminCrud";
import { saveEventAction, toggleEventAction } from "./actions";

export type EventRowUI = {
  eventId: string;
  title: string;
  kind: string;
  startsAt: string; // yyyy-MM-dd
  endsAt: string;
  place: string;
  capacity: number;
  fee: number;
  budget: number;
  ownerEmail: string;
  signupDeadline: string;
  status: string;
  isPublic: boolean;
  note: string;
  signupCount: number;
};

const TONE: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  접수중: "success",
  준비: "neutral",
  마감: "warn",
  완료: "neutral",
  취소: "danger",
};

const columns: ColumnSpec<EventRowUI>[] = [
  { key: "id", label: "ID", render: (r) => <span className="font-mono text-sm">{r.eventId}</span> },
  {
    key: "title",
    label: "행사",
    render: (r) => (
      <div>
        <div className="font-medium">{r.title}</div>
        <div className="text-xs text-ink-faint">
          {r.startsAt}
          {r.endsAt && r.endsAt !== r.startsAt ? ` ~ ${r.endsAt}` : ""} · {r.place || "장소 미정"}
        </div>
      </div>
    ),
  },
  {
    key: "status",
    label: "상태",
    render: (r) => <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>,
  },
  {
    key: "signup",
    label: "신청",
    numeric: true,
    render: (r) => (
      <span>
        {r.signupCount}
        {r.capacity > 0 ? ` / ${r.capacity}` : ""}
      </span>
    ),
  },
  {
    key: "fee",
    label: "참가비",
    numeric: true,
    render: (r) => (r.fee > 0 ? formatPeso(r.fee) : "무료"),
  },
];

export function EventAdmin({
  rows,
  readOnly,
  readOnlyReason,
}: {
  rows: EventRowUI[];
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const fields: FieldSpec[] = [
    { name: "title", label: "행사명", type: "text", required: true, full: true },
    {
      name: "kind",
      label: "유형",
      type: "select",
      options: ["정기총회", "체육대회", "명절", "봉사", "기타"].map((v) => ({
        value: v,
        label: v,
      })),
    },
    {
      name: "status",
      label: "상태",
      type: "select",
      options: [
        { value: "준비", label: "준비 — 아직 신청 안 받음" },
        { value: "접수중", label: "접수중 — 신청 화면에 표시" },
        { value: "마감", label: "마감 — 표시하되 신청 불가" },
        { value: "완료", label: "완료 — 정산 끝남" },
        { value: "취소", label: "취소" },
      ],
      help: '"접수중" 이어야 회원 신청 화면(/events)에 뜹니다.',
    },
    { name: "startsAt", label: "시작일", type: "date", required: true },
    { name: "endsAt", label: "종료일", type: "date", help: "하루짜리면 비워 두셔도 됩니다." },
    { name: "place", label: "장소", type: "text", full: true },
    {
      name: "capacity",
      label: "정원 (명)",
      type: "number",
      help: "0 이면 제한 없음. 이미 신청한 인원보다 적게 줄일 수는 없습니다.",
    },
    { name: "fee", label: "참가비 (₱)", type: "number", help: "0 이면 무료" },
    { name: "budget", label: "예산 (₱)", type: "number" },
    {
      name: "signupDeadline",
      label: "신청 마감일",
      type: "date",
      help: "이 날짜가 지나면 신청을 받지 않습니다.",
    },
    { name: "ownerEmail", label: "담당 임원 이메일", type: "email" },
    {
      name: "isPublic",
      label: "공개 회계에 정산을 표시합니다",
      type: "checkbox",
    },
    { name: "note", label: "비고", type: "textarea" },
  ];

  return (
    <AdminCrud<EventRowUI>
      rows={rows}
      idKey="eventId"
      columns={columns}
      fields={fields}
      saveAction={saveEventAction}
      toggleAction={toggleEventAction}
      isInactive={(r) => r.status === "취소"}
      addLabel="행사 등록"
      emptyIcon="📅"
      emptyTitle="등록된 행사가 없습니다"
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
    />
  );
}

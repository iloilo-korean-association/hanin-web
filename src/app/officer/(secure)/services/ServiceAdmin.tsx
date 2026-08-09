"use client";

import { Alert, Badge, formatPeso, type BadgeTone } from "@/components/ui";
import { SERVICE_CATEGORIES, SERVICE_STATUSES } from "@/lib/validators";

import { AdminCrud, type ColumnSpec, type FieldSpec } from "../../_components/AdminCrud";
import { saveServiceAction, toggleServiceAction } from "./actions";

export type ServiceRowUI = {
  serviceId: string;
  title: string;
  category: string;
  description: string;
  howToApply: string;
  contactName: string;
  contactPhone: string;
  fee: number;
  status: string;
  isPublic: boolean;
  sortOrder: number;
  note: string;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  운영중: "success",
  준비: "neutral",
  중단: "danger",
};

const columns: ColumnSpec<ServiceRowUI>[] = [
  { key: "id", label: "ID", render: (r) => <span className="font-mono text-sm">{r.serviceId}</span> },
  {
    key: "title",
    label: "서비스",
    render: (r) => (
      <div>
        <div className="font-medium">{r.title}</div>
        <div className="text-xs text-ink-faint">{r.category}</div>
      </div>
    ),
  },
  {
    key: "status",
    label: "상태",
    render: (r) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
        {r.isPublic ? null : <Badge tone="warn">비공개</Badge>}
      </span>
    ),
  },
  {
    key: "fee",
    label: "이용료",
    numeric: true,
    render: (r) => (r.fee > 0 ? formatPeso(r.fee) : "무료"),
  },
  { key: "contact", label: "담당", render: (r) => r.contactName || "—" },
];

export function ServiceAdmin({
  rows,
  readOnly,
  readOnlyReason,
}: {
  rows: ServiceRowUI[];
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const fields: FieldSpec[] = [
    { name: "title", label: "서비스명", type: "text", required: true, full: true, placeholder: "신규 이주자 온보딩 안내" },
    {
      name: "category",
      label: "분류",
      type: "select",
      options: SERVICE_CATEGORIES.map((v) => ({ value: v, label: v })),
    },
    {
      name: "status",
      label: "상태",
      type: "select",
      options: SERVICE_STATUSES.map((v) => ({
        value: v,
        label:
          v === "운영중"
            ? "운영중 — 공개 페이지에 표시"
            : v === "준비"
              ? "준비 — 아직 표시 안 함"
              : "중단 — 표시 안 함",
      })),
      help: '"운영중" + 공개여야 공개 페이지(/services)에 뜹니다.',
    },
    {
      name: "description",
      label: "설명",
      type: "textarea",
      full: true,
      help: "공개 화면에 그대로 나갑니다. 회원 개인의 실명·사례를 적지 마십시오.",
    },
    {
      name: "howToApply",
      label: "신청 방법",
      type: "textarea",
      full: true,
      placeholder: "문의 페이지(/help)로 접수하시거나 총무에게 이메일로 신청",
    },
    {
      name: "contactName",
      label: "담당 창구",
      type: "text",
      placeholder: "총무",
      help: "직책으로 적으십시오. 개인 실명은 공개 화면에 상시 노출됩니다.",
    },
    {
      name: "contactPhone",
      label: "연락처",
      type: "tel",
      help: "확인된 번호만 적으십시오. 모르면 비워 두면 화면에 나가지 않습니다.",
    },
    { name: "fee", label: "이용료 (₱)", type: "number", help: "0 이면 무료로 표시됩니다." },
    {
      name: "sortOrder",
      label: "정렬순서",
      type: "number",
      help: "같은 분류 안에서 작은 수가 먼저 나옵니다.",
    },
    {
      name: "isPublic",
      label: "공개 페이지에 표시합니다",
      type: "checkbox",
    },
    { name: "note", label: "비고", type: "textarea" },
  ];

  return (
    <AdminCrud<ServiceRowUI>
      rows={rows}
      idKey="serviceId"
      columns={columns}
      fields={fields}
      saveAction={saveServiceAction}
      toggleAction={toggleServiceAction}
      isInactive={(r) => !r.isPublic || r.status !== "운영중"}
      addLabel="서비스 등록"
      emptyIcon="🤝"
      emptyTitle="등록된 서비스가 없습니다"
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      formNote={
        <Alert tone="info" title="이 내용은 공개 페이지에 그대로 나갑니다">
          설명·신청 방법·담당·연락처가 로그인 없이 누구에게나 보입니다. 개인 실명과 확인되지 않은
          전화번호를 넣지 마십시오.
        </Alert>
      }
    />
  );
}

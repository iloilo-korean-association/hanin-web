"use client";

import { Alert, Badge } from "@/components/ui";

import { AdminCrud, type ColumnSpec, type FieldSpec } from "../../_components/AdminCrud";
import { saveContactAction, toggleContactAction } from "./actions";

export type ContactRowUI = {
  contactId: string;
  groupId: string;
  groupTitle: string;
  sortOrder: number;
  name: string;
  nameEn: string;
  numbers: string;
  note: string;
  hours: string;
  email: string;
  address: string;
  emphasis: boolean;
  grade: string;
  sourceUrl: string;
  verifiedOn: string;
  isActive: string; // "true" | "false" — select 로 다루려고 문자열
};

const GRADE_UI: Record<string, { label: string; tone: "success" | "warn" | "danger" }> = {
  verified: { label: "공식 확인", tone: "success" },
  secondary: { label: "2차 출처", tone: "warn" },
  pending: { label: "확인 중", tone: "danger" },
};

const columns: ColumnSpec<ContactRowUI>[] = [
  { key: "group", label: "분류", render: (r) => r.groupTitle },
  {
    key: "name",
    label: "기관",
    render: (r) => (
      <div>
        <div className="font-medium">{r.name}</div>
        {r.nameEn ? <div className="text-xs text-ink-faint">{r.nameEn}</div> : null}
      </div>
    ),
  },
  {
    key: "numbers",
    label: "번호",
    render: (r) =>
      r.numbers ? (
        <span className="font-mono text-sm">{r.numbers.split("|").join(" · ")}</span>
      ) : (
        <span className="text-danger">비어 있음</span>
      ),
  },
  {
    key: "grade",
    label: "검증",
    render: (r) => {
      const g = GRADE_UI[r.grade] ?? GRADE_UI.pending;
      return (
        <div>
          <Badge tone={g.tone}>{g.label}</Badge>
          {r.verifiedOn ? (
            <div className="mt-1 text-xs text-ink-faint">{r.verifiedOn}</div>
          ) : null}
        </div>
      );
    },
  },
];

export function ContactAdmin({
  rows,
  readOnly,
  readOnlyReason,
}: {
  rows: ContactRowUI[];
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const fields: FieldSpec[] = [
    {
      name: "groupId",
      label: "분류",
      type: "select",
      options: [
        { value: "national", label: "전국 긴급" },
        { value: "consular", label: "공관 (대사관·분관)" },
        { value: "police", label: "경찰·소방" },
        { value: "rescue", label: "구조·재난·해경" },
        { value: "hospital", label: "병원" },
        { value: "civil", label: "행정·생활" },
      ],
    },
    { name: "sortOrder", label: "정렬 순서", type: "number", help: "작을수록 위" },
    { name: "name", label: "기관·창구 이름", type: "text", required: true, full: true },
    { name: "nameEn", label: "현지·영문 표기", type: "text", full: true, help: "현지인에게 보여줄 때 씁니다." },
    {
      name: "numbers",
      label: "전화번호",
      type: "textarea",
      full: true,
      placeholder: "+63 33 337 1234\n0917 123 4567",
      help: "여러 개면 줄바꿈이나 세로줄(|)로 구분합니다. ★ 표기를 원문 그대로 두십시오 — 사람이 눈으로 읽고 손으로 누르는 값입니다. 비워두면 화면에 '확인 중' 으로 뜹니다.",
    },
    {
      name: "grade",
      label: "검증 등급",
      type: "select",
      options: [
        { value: "verified", label: "공식 확인 — 기관 공식 사이트에서 확인함" },
        { value: "secondary", label: "2차 출처 — 뉴스·디렉터리. 재확인 필요" },
        { value: "pending", label: "확인 중 — 번호를 화면에 표시하지 않음" },
      ],
      help: "'확인 중' 이 아니면 아래 출처와 날짜가 필수입니다.",
    },
    {
      name: "sourceUrl",
      label: "출처 URL",
      type: "url",
      full: true,
      placeholder: "https://pnp.gov.ph/",
      help: "어디서 확인했는지. 6개월 뒤에 다른 사람이 재확인할 수 있어야 합니다.",
    },
    {
      name: "verifiedOn",
      label: "마지막 확인 날짜",
      type: "date",
      help: "직접 전화를 걸어 확인했거나 공식 사이트에서 본 날",
    },
    { name: "hours", label: "운영 시간", type: "text", placeholder: "24시간 / 평일 08:00~17:00" },
    { name: "note", label: "언제 걸어야 하는가 · 주의사항", type: "textarea", full: true },
    { name: "email", label: "이메일", type: "email" },
    { name: "address", label: "주소", type: "text", full: true },
    { name: "emphasis", label: "강조해서 표시합니다 (911·공관 야간 등)", type: "checkbox" },
    {
      name: "isActive",
      label: "표시 상태",
      type: "select",
      options: [
        { value: "true", label: "표시함" },
        { value: "false", label: "숨김" },
      ],
    },
  ];

  const pending = rows.filter((r) => r.grade === "pending").length;

  return (
    <AdminCrud<ContactRowUI>
      rows={rows}
      idKey="contactId"
      columns={columns}
      fields={fields}
      saveAction={saveContactAction}
      toggleAction={toggleContactAction}
      isInactive={(r) => r.isActive === "false"}
      addLabel="연락처 등록"
      emptyIcon="☎️"
      emptyTitle="등록된 연락처가 없습니다"
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      formNote={
        <Alert tone="error" title="번호를 지어내지 마십시오">
          긴급 상황에서 틀린 번호는 사람을 죽입니다. 확인하지 못한 번호는 적지 말고 검증등급을{" "}
          <strong>&quot;확인 중&quot;</strong> 으로 두십시오 — 화면에는 번호 대신 &quot;확인
          중&quot; 이라고 표시되고, 방문자는 911 로 안내됩니다.
          {pending > 0 ? ` 현재 확인 중 ${pending}건.` : ""}
        </Alert>
      }
    />
  );
}

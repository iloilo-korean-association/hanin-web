"use client";

import { Alert, Badge } from "@/components/ui";

import { AdminCrud, type ColumnSpec, type FieldSpec } from "../../_components/AdminCrud";
import { saveVendorAction, toggleVendorAction } from "./actions";

export type VendorRowUI = {
  vendorId: string;
  name: string;
  aliases: string;
  ownerName: string;
  industry: string;
  phone: string;
  address: string;
  relatedParty: boolean;
  relatedMemberNo: string | null;
  ownershipPct: number | null;
  note: string;
  status: string;
};

const columns: ColumnSpec<VendorRowUI>[] = [
  { key: "id", label: "ID", render: (r) => <span className="font-mono text-sm">{r.vendorId}</span> },
  {
    key: "name",
    label: "업소명",
    render: (r) => (
      <div>
        <div className="font-medium">{r.name}</div>
        {r.aliases ? (
          <div className="text-xs text-ink-faint">{r.aliases.split("|").join(" · ")}</div>
        ) : (
          <div className="text-xs text-danger">별칭 없음 — 로마자 표기 우회 위험</div>
        )}
      </div>
    ),
  },
  { key: "industry", label: "업종", render: (r) => r.industry || "—" },
  {
    key: "related",
    label: "이해관계",
    render: (r) =>
      r.relatedParty ? (
        <Badge tone="danger">
          임원 관련{r.ownershipPct !== null ? ` · 지분 ${r.ownershipPct}%` : ""}
        </Badge>
      ) : (
        <span className="text-ink-faint">—</span>
      ),
  },
  { key: "phone", label: "연락처", render: (r) => r.phone || "—" },
];

export function VendorAdmin({
  rows,
  readOnly,
  readOnlyReason,
}: {
  rows: VendorRowUI[];
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const fields: FieldSpec[] = [
    { name: "name", label: "업소명", type: "text", required: true, placeholder: "오톤 하드웨어" },
    {
      name: "aliases",
      label: "다른 표기 (별칭)",
      type: "text",
      full: true,
      placeholder: "OTON Hardware|Oton Hardware|오톤철물",
      help: "★ 세로줄(|)로 구분합니다. 로마자 상호를 반드시 넣으십시오 — 이게 비면 수취인을 'OTON Hardware' 로 적었을 때 이해상충 판정을 빠져나갑니다.",
    },
    { name: "industry", label: "업종", type: "text", placeholder: "건축자재·철물" },
    { name: "ownerName", label: "대표자명", type: "text" },
    { name: "phone", label: "연락처", type: "tel", placeholder: "+63 33 320 1107" },
    { name: "address", label: "주소", type: "text", full: true },
    {
      name: "relatedParty",
      label: "임원 이해관계 업체입니다",
      type: "checkbox",
      help: "체크하면 공개 회계와 업소 안내에 배지가 뜨고, 관련 임원은 이 업소 지출을 승인할 수 없게 됩니다.",
    },
    {
      name: "relatedMemberNo",
      label: "관련 임원 회원번호",
      type: "text",
      placeholder: "M0001",
      help: "이해관계 업체로 표시했다면 필수입니다. 누가 관련됐는지 알아야 그 사람의 승인을 막을 수 있습니다.",
    },
    {
      name: "ownershipPct",
      label: "지분율 (%)",
      type: "number",
      placeholder: "70",
      help: "공개 회계 배지에 그대로 노출됩니다. 모르면 비워 두십시오.",
    },
    {
      name: "status",
      label: "상태",
      type: "select",
      options: [
        { value: "ACTIVE", label: "ACTIVE — 목록에 표시" },
        { value: "INACTIVE", label: "INACTIVE — 목록에서 숨김" },
      ],
    },
    { name: "note", label: "비고", type: "textarea" },
  ];

  return (
    <AdminCrud<VendorRowUI>
      rows={rows}
      idKey="vendorId"
      columns={columns}
      fields={fields}
      saveAction={saveVendorAction}
      toggleAction={toggleVendorAction}
      isInactive={(r) => r.status !== "ACTIVE"}
      addLabel="업소 등록"
      emptyIcon="🏪"
      emptyTitle="등록된 업소가 없습니다"
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      formNote={
        <Alert tone="warn" title="이해관계 업체는 특히 정확히 적어 주십시오">
          이 표가 공개 회계의 이해관계자 배지와 승인 회피(recusal)를 동시에 결정합니다. 별칭에
          로마자 상호를 넣지 않으면, 수취인을 영문으로 적는 것만으로 통제를 빠져나갑니다.
        </Alert>
      }
    />
  );
}

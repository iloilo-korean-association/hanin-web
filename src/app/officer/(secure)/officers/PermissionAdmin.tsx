"use client";

import { useActionState, useState } from "react";

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
  Input,
  Select,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatPeso,
} from "@/components/ui";
import { ADMIN_PERMISSIONS, MONEY_PERMISSIONS, PERMISSION_HELP } from "@/lib/validators";

import { IDLE } from "../../_lib/action-state";
import { savePermissionsAction } from "./actions";

export type OfficerRowUI = {
  officerId: string;
  name: string;
  role: string;
  email: string;
  permissions: string[];
  approvalLimit: number;
  status: string;
  isSelf: boolean;
};

export function PermissionAdmin({
  rows,
  canEdit,
  readOnlyReason,
}: {
  rows: OfficerRowUI[];
  canEdit: boolean;
  readOnlyReason?: string;
}) {
  const [editing, setEditing] = useState<OfficerRowUI | null>(null);
  const [state, save, saving] = useActionState(savePermissionsAction, IDLE);

  return (
    <>
      {state.ok !== null && state.message ? (
        <Alert tone={state.ok ? "success" : "error"} title={state.message}>
          {state.howToFix}
        </Alert>
      ) : null}

      {!canEdit ? (
        <Alert tone="warn" title="열람만 가능합니다">
          {readOnlyReason ?? '"임원관리" 권한이 없습니다.'}
        </Alert>
      ) : null}

      {editing ? (
        <Card as="section">
          <CardHeader
            title={`권한 변경 — ${editing.name} (${editing.role})`}
            description={editing.email}
            headingLevel={2}
          />
          <CardBody>
            <Alert tone="warn" title="이 변경은 감사로그에 CRITICAL 로 남습니다">
              누가 누구에게 어떤 권한을 줬는지 영구히 기록됩니다. 돈이 움직이는 문의 열쇠를 바꾸는
              일이기 때문입니다.
            </Alert>

            <form action={save} className="mt-4">
              <input type="hidden" name="officerId" value={editing.officerId} />

              <fieldset className="mb-5">
                <legend className="mb-2 font-semibold">돈에 관한 권한</legend>
                <div className="flex flex-col gap-2">
                  {MONEY_PERMISSIONS.map((p) => (
                    <Checkbox
                      key={p}
                      id={`perm_${p}`}
                      name={`perm_${p}`}
                      defaultChecked={editing.permissions.includes(p)}
                      label={p}
                      description={PERMISSION_HELP[p]}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="mb-5">
                <legend className="mb-2 font-semibold">자료 관리 권한</legend>
                <div className="flex flex-col gap-2">
                  {ADMIN_PERMISSIONS.map((p) => (
                    <Checkbox
                      key={p}
                      id={`perm_${p}`}
                      name={`perm_${p}`}
                      defaultChecked={editing.permissions.includes(p)}
                      label={p}
                      description={PERMISSION_HELP[p]}
                    />
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="승인한도 (₱)"
                  htmlFor="approvalLimit"
                  hint="승인권이 있을 때만 의미가 있습니다. 이 금액까지 단독 승인할 수 있습니다."
                >
                  <Input
                    id="approvalLimit"
                    name="approvalLimit"
                    type="number"
                    inputMode="numeric"
                    defaultValue={String(editing.approvalLimit)}
                  />
                </Field>
                <Field label="계정 상태" htmlFor="status">
                  <Select id="status" name="status" defaultValue={editing.status}>
                    <option value="ACTIVE">ACTIVE — 로그인 가능</option>
                    <option value="INACTIVE">INACTIVE — 로그인 차단</option>
                  </Select>
                </Field>
              </div>

              <ButtonRow className="mt-4">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "저장 중…" : "권한 저장"}
                </Button>
                <Button type="button" onClick={() => setEditing(null)}>
                  취소
                </Button>
              </ButtonRow>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card as="section">
        <CardHeader title={`임원 (${rows.length}명)`} headingLevel={2} />
        <TableCardBody label="임원 권한">
          <Table caption="임원 권한 목록" captionHidden>
            <THead>
              <TR>
                <TH>임원</TH>
                <TH>권한</TH>
                <TH numeric>승인한도</TH>
                <TH>상태</TH>
                {canEdit ? <TH>관리</TH> : null}
              </TR>
            </THead>
            <TBody>
              {rows.map((o) => (
                <TR key={o.officerId} className={o.status !== "ACTIVE" ? "opacity-55" : undefined}>
                  <TD>
                    <div className="font-medium">
                      {o.name}
                      {o.isSelf ? <span className="ml-1 text-xs text-ink-faint">(나)</span> : null}
                    </div>
                    <div className="text-xs text-ink-faint">
                      {o.role} · {o.email}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {o.permissions.length === 0 ? (
                        <span className="text-ink-faint">권한 없음</span>
                      ) : (
                        o.permissions.map((p) => (
                          <Badge
                            key={p}
                            tone={
                              p === "임원관리"
                                ? "danger"
                                : (ADMIN_PERMISSIONS as readonly string[]).includes(p)
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {p}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD numeric>{o.approvalLimit > 0 ? formatPeso(o.approvalLimit) : "—"}</TD>
                  <TD>
                    {o.status === "ACTIVE" ? (
                      <Badge tone="success">활성</Badge>
                    ) : (
                      <Badge tone="danger">차단</Badge>
                    )}
                  </TD>
                  {canEdit ? (
                    <TD>
                      {o.isSelf ? (
                        <span
                          className="text-xs text-ink-faint"
                          title="스스로 권한을 올릴 수 있으면 위임이 아니라 무제한이 됩니다."
                        >
                          본인 — 변경 불가
                        </span>
                      ) : (
                        <Button type="button" onClick={() => setEditing(o)}>
                          권한 변경
                        </Button>
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableCardBody>
      </Card>
    </>
  );
}

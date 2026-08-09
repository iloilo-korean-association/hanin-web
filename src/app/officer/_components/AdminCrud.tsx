"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  ButtonRow,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  fieldAria,
  FormStack,
  Input,
  Select,
  TableCardBody,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from "@/components/ui";

import { IDLE, type ActionState } from "../_lib/action-state";

/**
 * 업소·행사·연락처 관리 화면이 공유하는 표 + 편집 폼.
 *
 * 셋의 편집 항목만 다르고 흐름은 같다 — 목록에서 [수정] 을 누르면 폼에 값이 채워지고,
 * [새로 등록] 을 누르면 빈 폼이 열린다. 저장하면 목록이 갱신된다.
 *
 * ★ 삭제 버튼을 두지 않는다. 과거 거래·신청이 이 행을 참조하고 있어서
 *   지우면 장부에서 맥락이 사라진다. 대신 [목록에서 내리기](비활성)를 쓴다.
 */

export type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "checkbox" | "date" | "tel" | "email" | "url";
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  placeholder?: string;
  /** 한 줄을 통째로 쓸지 */
  full?: boolean;
};

export type ColumnSpec<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  numeric?: boolean;
};

type Props<T extends Record<string, unknown>> = {
  rows: T[];
  idKey: keyof T & string;
  columns: ColumnSpec<T>[];
  fields: FieldSpec[];
  saveAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  toggleAction?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** 이 행이 지금 '내려간' 상태인가 */
  isInactive?: (row: T) => boolean;
  /** 편집 폼 위에 띄울 경고·안내 */
  formNote?: React.ReactNode;
  addLabel?: string;
  emptyIcon?: string;
  emptyTitle?: string;
  /** 읽기 전용(권한 없음)이면 폼과 버튼을 잠근다 */
  readOnly?: boolean;
  readOnlyReason?: string;
};

export function AdminCrud<T extends Record<string, unknown>>({
  rows,
  idKey,
  columns,
  fields,
  saveAction,
  toggleAction,
  isInactive,
  formNote,
  addLabel = "새로 등록",
  emptyIcon = "📋",
  emptyTitle = "등록된 항목이 없습니다",
  readOnly = false,
  readOnlyReason,
}: Props<T>) {
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [saveState, save, saving] = useActionState(saveAction, IDLE);
  const [toggleState, toggle, toggling] = useActionState(
    toggleAction ?? (async () => IDLE),
    IDLE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const lastAt = useRef(0);

  // 저장에 성공하면 폼을 닫는다. 실패하면 열어둔 채 사유를 보여준다.
  useEffect(() => {
    if (saveState.at && saveState.at !== lastAt.current) {
      lastAt.current = saveState.at;
      if (saveState.ok) {
        setOpen(false);
        setEditing(null);
        formRef.current?.reset();
      }
    }
  }, [saveState]);

  const startNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const startEdit = (row: T) => {
    setEditing(row);
    setOpen(true);
  };

  const valueOf = (f: FieldSpec): string => {
    if (!editing) return "";
    const v = editing[f.name];
    if (v === null || v === undefined) return "";
    return String(v);
  };
  const checkedOf = (f: FieldSpec): boolean => Boolean(editing?.[f.name]);

  const result = saveState.at > toggleState.at ? saveState : toggleState;

  return (
    <>
      {result.ok !== null && result.message ? (
        <Alert tone={result.ok ? "success" : "error"} title={result.message}>
          {result.howToFix}
        </Alert>
      ) : null}

      {readOnly ? (
        <Alert tone="warn" title="열람만 가능합니다">
          {readOnlyReason ??
            "이 화면을 고칠 권한이 없습니다. 관리자에게 권한을 요청하십시오."}
        </Alert>
      ) : null}

      {/* ── 편집 폼 ─────────────────────────────────────────── */}
      {open && !readOnly ? (
        <Card as="section">
          <CardHeader
            title={editing ? `수정 — ${String(editing[idKey])}` : "새로 등록"}
            headingLevel={2}
          />
          <CardBody>
            {formNote}
            <form ref={formRef} action={save}>
              <input type="hidden" name={idKey} value={editing ? String(editing[idKey]) : ""} />
              <FormStack>
                {fields.map((f) => {
                  const id = `f_${f.name}`;
                  if (f.type === "checkbox") {
                    return (
                      <Field key={f.name} label={f.label} htmlFor={id} hint={f.help}>
                        <Checkbox
                          id={id}
                          name={f.name}
                          defaultChecked={checkedOf(f)}
                          label={f.label}
                        />
                      </Field>
                    );
                  }
                  return (
                    <Field
                      key={f.name}
                      label={f.label}
                      htmlFor={id}
                      hint={f.help}
                      required={f.required}
                    >
                      {f.type === "textarea" ? (
                        <Textarea
                          id={id}
                          name={f.name}
                          rows={3}
                          defaultValue={valueOf(f)}
                          placeholder={f.placeholder}
                          {...fieldAria(id, { hint: Boolean(f.help) })}
                        />
                      ) : f.type === "select" ? (
                        <Select
                          id={id}
                          name={f.name}
                          defaultValue={valueOf(f)}
                          {...fieldAria(id, { hint: Boolean(f.help) })}
                        >
                          {(f.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          id={id}
                          name={f.name}
                          type={f.type === "number" ? "number" : f.type}
                          inputMode={f.type === "number" ? "numeric" : undefined}
                          defaultValue={valueOf(f)}
                          placeholder={f.placeholder}
                          required={f.required}
                          {...fieldAria(id, { hint: Boolean(f.help) })}
                        />
                      )}
                    </Field>
                  );
                })}
              </FormStack>
              <ButtonRow className="mt-4">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "저장 중…" : "저장"}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setEditing(null);
                  }}
                >
                  취소
                </Button>
              </ButtonRow>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {/* ── 목록 ────────────────────────────────────────────── */}
      <Card as="section">
        <CardHeader
          title={`목록 (${rows.length}건)`}
          headingLevel={2}
          action={
            readOnly ? null : (
              <Button type="button" variant="primary" onClick={startNew}>
                {addLabel}
              </Button>
            )
          }
        />
        {rows.length === 0 ? (
          <CardBody>
            <EmptyState icon={emptyIcon} title={emptyTitle} />
          </CardBody>
        ) : (
          <TableCardBody label="관리 목록">
            <Table caption="관리 목록" captionHidden>
              <THead>
                <TR>
                  {columns.map((c) => (
                    <TH key={c.key} numeric={c.numeric}>
                      {c.label}
                    </TH>
                  ))}
                  {readOnly ? null : <TH>관리</TH>}
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const inactive = isInactive?.(row) ?? false;
                  return (
                    <TR key={String(row[idKey])} className={inactive ? "opacity-55" : undefined}>
                      {columns.map((c) => (
                        <TD key={c.key} numeric={c.numeric}>
                          {c.render(row)}
                        </TD>
                      ))}
                      {readOnly ? null : (
                        <TD>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={() => startEdit(row)}>
                              수정
                            </Button>
                            {toggleAction ? (
                              <form action={toggle} className="inline">
                                <input
                                  type="hidden"
                                  name={idKey}
                                  value={String(row[idKey])}
                                />
                                <Button
                                  type="submit"
                                  variant={inactive ? undefined : "danger"}
                                  disabled={toggling}
                                >
                                  {inactive ? "다시 올리기" : "목록에서 내리기"}
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableCardBody>
        )}
      </Card>
    </>
  );
}

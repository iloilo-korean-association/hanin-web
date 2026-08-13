"use client";

import { useActionState, useId, useRef, useState } from "react";

import { Alert, Button, Field, fieldAria } from "@/components/ui";

import { IDLE, type ActionState } from "../../_lib/action-state";
import { uploadLedgerXlsxAction } from "./actions";

/**
 * 장부 엑셀(.xlsx) 업로드 폼.
 *
 * ★ <input type="file"> 에 name 을 주지 않는다. 원본 파일이 폼과 함께 전송되면
 *   서버 액션 body 상한(1MB)을 다루기 어려워진다. 여기서 dataURL 로 바꿔
 *   hidden input 에 담아 보내고, 서버가 형식·크기를 **다시** 검사한다.
 *
 * ★ 크기 예산: 서버 upload.ts 의 MAX_DATAURL_CHARS(780,000자)보다 낮게 잡는다.
 *   dataURL 은 원본의 약 4/3 이므로 파일 기준 약 525KB 까지 통과한다.
 *   (실제 원본 『한인회비 내역』은 약 62KB — 여유가 크다)
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BUDGET = 700_000;

export function UploadForm({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    uploadLedgerXlsxAction,
    IDLE,
  );
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clear() {
    setDataUrl("");
    setFileName("");
    setInfo("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File | undefined) {
    if (!file) return clear();
    setBusy(true);
    setError(null);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("엑셀 .xlsx 파일만 올릴 수 있습니다. 구형 .xls 는 .xlsx 로 저장한 뒤 올려 주십시오.");
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      // 한 번에 spread 하면 인수 개수 상한에 걸린다. 조각내서 붙인다.
      for (let i = 0; i < buf.length; i += 8192) {
        binary += String.fromCharCode(...buf.subarray(i, i + 8192));
      }
      const url = `data:${XLSX_MIME};base64,${btoa(binary)}`;
      if (url.length > BUDGET) {
        throw new Error(
          `파일이 너무 큽니다(${formatBytes(file.size)}). 약 500KB 이하만 올릴 수 있습니다. 개발자에게 알려 주십시오.`,
        );
      }
      setDataUrl(url);
      setFileName(file.name);
      setInfo(`${formatBytes(file.size)}`);
    } catch (e) {
      clear();
      setError(e instanceof Error ? e.message : "파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.ok === false ? (
        <Alert tone="error" title={state.message}>
          {state.howToFix ? <p>{state.howToFix}</p> : null}
        </Alert>
      ) : null}
      {state.ok === true ? <Alert tone="success" title={state.message} /> : null}

      <Field
        htmlFor={id}
        label="장부 엑셀 파일"
        labelEn="Ledger .xlsx"
        hint="연도별 시트(YYYY년 한인회비)와 '금부원 교민지원' 시트가 들어 있는 원본 파일을 고르십시오. 올린 파일은 임원만 볼 수 있는 비공개 저장소에 보관되고, 반영된 거래의 증빙이 됩니다."
        error={error}
      >
        <input
          {...fieldAria(id, { hint: true, error })}
          ref={inputRef}
          id={id}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={disabled || pending}
          onChange={(e) => void handleFile(e.currentTarget.files?.[0])}
          className="block w-full min-h-touch rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-2 text-base file:mr-3 file:min-h-9 file:rounded-[var(--radius-field)] file:border-0 file:bg-brand-700 file:px-3 file:text-sm file:font-semibold file:text-white"
        />
      </Field>

      <input type="hidden" name="fileDataUrl" value={dataUrl} />
      <input type="hidden" name="fileName" value={fileName} />

      {busy ? <p className="text-sm text-ink-muted">파일을 읽는 중…</p> : null}
      {dataUrl && !busy ? (
        <p className="text-sm font-semibold text-success">
          선택됨 — {fileName} ({info})
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={disabled || pending || busy || !dataUrl}
          title={disabled ? disabledReason : undefined}
        >
          {pending ? "읽는 중… (수백 행 파싱)" : "업로드하고 검토 시작"}
        </Button>
        {dataUrl ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={pending}>
            선택 취소
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

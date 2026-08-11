"use client";

import { useId, useRef, useState } from "react";

import { Button, Field, fieldAria } from "@/components/ui";

/**
 * 증빙 사진/파일 첨부 — 모바일 카메라로 바로 찍고, **보내기 전에 브라우저에서 줄인다.**
 *
 * 왜 클라이언트에서 리사이즈하는가
 *  · 현지 회선이 느리다. 요즘 폰 사진은 한 장에 4~8MB 다. 그대로 올리면 총무가 포기한다.
 *  · Next 서버 액션 body 기본 상한이 1MB 라 원본 사진은 애초에 통과하지 못한다.
 *    (next.config.ts 를 고쳐 상한을 올리는 대신 보내는 쪽을 줄인다 — 느린 회선에서 더 낫다)
 *
 * 어떻게 보내는가
 *  · <input type="file"> 에는 name 을 주지 않는다. 원본 파일이 그대로 실려 가면 안 되기 때문.
 *  · 줄인 결과를 hidden input(name={name}) 에 dataURL 로 담아 보낸다.
 *  · 서버(_lib/upload.ts)가 형식·크기를 **다시** 검사하고 public/uploads 에 저장한다.
 */

/** dataURL 문자 수 예산. 서버의 MAX_DATAURL_CHARS(780,000)보다 낮게 잡는다. */
const BUDGET = 700_000;
const DIMENSIONS = [1600, 1280, 1024, 800, 640] as const;
const QUALITIES = [0.72, 0.6, 0.48, 0.38] as const;
/** PDF(견적서)는 리사이즈할 수 없으므로 원본 크기 그대로 상한을 건다. */
const PDF_MAX_BYTES = 480_000;

export interface PhotoFieldProps {
  /** hidden input 의 name. 서버 액션이 이 키로 읽는다. */
  name: string;
  label: string;
  labelEn?: string;
  hint?: string;
  /** PDF 도 받을 것인가 (견적서 첨부용) */
  allowPdf?: boolean;
  /** 첨부가 없을 때 화면에 띄울 경고 문장 (I3) */
  missingWarning?: string;
  /** 파일이 바뀔 때마다 부모에게 알린다 — DRAFT 미리보기 계산에 쓴다 */
  onChangeHasFile?: (has: boolean) => void;
  /** 성공 제출 뒤 부모가 값을 비우기 위한 리셋 신호 (값이 바뀌면 비운다) */
  resetKey?: number;
}

export function PhotoField({
  name,
  label,
  labelEn,
  hint,
  allowPdf,
  missingWarning,
  onChangeHasFile,
  resetKey,
}: PhotoFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seenReset, setSeenReset] = useState(resetKey ?? 0);

  // 부모가 resetKey 를 올리면 첨부를 비운다. useEffect 없이 렌더 중에 처리한다.
  if (resetKey !== undefined && resetKey !== seenReset) {
    setSeenReset(resetKey);
    if (dataUrl) setDataUrl("");
    if (info) setInfo("");
    if (error) setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function clear() {
    setDataUrl("");
    setInfo("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    onChangeHasFile?.(false);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return clear();
    setBusy(true);
    setError(null);
    try {
      const result =
        file.type === "application/pdf" ? await readPdf(file) : await shrinkImage(file);
      setDataUrl(result.dataUrl);
      setInfo(result.info);
      onChangeHasFile?.(true);
    } catch (e) {
      clear();
      setError(e instanceof Error ? e.message : "파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const accept = allowPdf ? "image/*,application/pdf" : "image/*";
  const isPdf = dataUrl.startsWith("data:application/pdf");

  return (
    <Field
      htmlFor={id}
      label={label}
      labelEn={labelEn}
      hint={
        hint ??
        (allowPdf
          ? "사진 또는 PDF. 사진은 보내기 전에 자동으로 줄입니다."
          : "휴대폰이면 카메라가 바로 열립니다. 사진은 보내기 전에 자동으로 줄입니다.")
      }
      error={error}
    >
      <input
        {...fieldAria(id, { hint: true, error })}
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        // ★ name 을 주지 않는다. 원본 파일이 폼과 함께 전송되면 1MB 상한에 걸린다.
        capture={allowPdf ? undefined : "environment"}
        onChange={(e) => void handleFile(e.currentTarget.files?.[0])}
        className="block w-full min-h-touch rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-2 text-base file:mr-3 file:min-h-9 file:rounded-[var(--radius-field)] file:border-0 file:bg-brand-700 file:px-3 file:text-sm file:font-semibold file:text-white"
      />

      {/* 서버로 실제로 나가는 값 */}
      <input type="hidden" name={name} value={dataUrl} />

      {busy ? <p className="text-sm text-ink-muted">사진을 줄이는 중…</p> : null}

      {dataUrl && !busy ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-field)] border border-success-line bg-success-bg p-3 sm:flex-row sm:items-center">
          {isPdf ? (
            <span aria-hidden="true" className="text-3xl">
              📄
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- dataURL 미리보기. next/image 는 dataURL 을 최적화하지 못한다.
            <img
              src={dataUrl}
              alt="첨부한 증빙 미리보기"
              className="h-24 w-auto max-w-[9rem] rounded border border-line object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-success">첨부됨 — {info}</p>
            <p className="text-sm text-ink-muted">
              저장하면 임원만 볼 수 있는 증빙 저장소에 보관됩니다.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={clear}>
            첨부 지우기
          </Button>
        </div>
      ) : null}

      {!dataUrl && !busy && missingWarning ? (
        <p className="text-sm font-semibold text-warn">{missingWarning}</p>
      ) : null}
    </Field>
  );
}

/* ───────────────────────── 리사이즈 ───────────────────────── */

type Shrunk = { dataUrl: string; info: string };

/**
 * 예산(BUDGET) 안에 들어올 때까지 긴 변 → 품질 순으로 낮춰 가며 JPEG 로 다시 그린다.
 * EXIF 회전은 createImageBitmap 이 알아서 적용한다(imageOrientation 기본값 'from-image').
 */
async function shrinkImage(file: File): Promise<Shrunk> {
  if (!file.type.startsWith("image/")) {
    throw new Error("사진 파일만 첨부할 수 있습니다.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("사진을 읽지 못했습니다. 다른 사진으로 다시 시도해 주십시오.");
  }

  try {
    for (const maxDim of DIMENSIONS) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("이 브라우저에서는 사진을 줄일 수 없습니다.");
      // JPEG 는 투명도가 없다. 흰 바탕을 먼저 깔지 않으면 PNG 투명 영역이 검게 나온다.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      for (const q of QUALITIES) {
        const url = canvas.toDataURL("image/jpeg", q);
        if (url.length <= BUDGET) {
          return {
            dataUrl: url,
            info: `${w}×${h}px · ${formatBytes(Math.round((url.length * 3) / 4))} (원본 ${formatBytes(file.size)})`,
          };
        }
      }
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error(
    "사진을 충분히 줄이지 못했습니다. 화면을 조금 더 가까이 찍거나 다른 사진을 써 주십시오.",
  );
}

async function readPdf(file: File): Promise<Shrunk> {
  if (file.size > PDF_MAX_BYTES) {
    throw new Error(
      `PDF 가 너무 큽니다(${formatBytes(file.size)}). ${formatBytes(PDF_MAX_BYTES)} 이하로 줄이거나 사진으로 찍어 첨부해 주십시오.`,
    );
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // 한 번에 spread 하면 인수 개수 상한에 걸린다. 조각내서 붙인다.
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192));
  }
  return {
    dataUrl: `data:application/pdf;base64,${btoa(binary)}`,
    info: `PDF · ${formatBytes(file.size)}`,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

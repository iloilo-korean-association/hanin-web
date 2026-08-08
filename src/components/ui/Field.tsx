import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "./cn";

/**
 * 폼 필드.
 *
 * 접근성 규칙 (60대 회원이 실제로 쓴다)
 * · label 은 항상 있다. placeholder 로 라벨을 대신하지 않는다 — 입력 시작하면 사라진다.
 * · 필수 항목은 * 와 "필수" 텍스트를 같이 쓴다. 별표만으로는 안 보인다.
 * · 에러는 색만으로 표시하지 않는다. 문장으로 쓴다. aria-invalid + aria-describedby 로 연결.
 * · 입력 높이 44px 이상.
 */

const CONTROL_BASE =
  "block w-full min-h-touch rounded-[var(--radius-field)] border bg-surface px-3 py-2 " +
  "text-base text-ink placeholder:text-ink-faint " +
  "disabled:bg-surface-inset disabled:text-ink-muted disabled:cursor-not-allowed";

const CONTROL_OK = "border-line-strong hover:border-brand-300";
const CONTROL_BAD = "border-danger bg-danger-bg";

export interface FieldProps {
  /** input 의 id 와 반드시 같아야 한다. */
  htmlFor: string;
  label: ReactNode;
  /** 라벨 옆 영문 병기. 예: "성명" + "Full name" */
  labelEn?: string;
  required?: boolean;
  /** 입력 전에 읽어야 할 안내. 에러와 달리 항상 보인다. */
  hint?: ReactNode;
  /** 에러 문장. 있으면 필드 전체가 오류 상태가 된다. */
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function Field({
  htmlFor,
  label,
  labelEn,
  required,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-field>
      <label htmlFor={htmlFor} className="flex flex-wrap items-baseline gap-x-2 font-semibold">
        <span>{label}</span>
        {labelEn ? <span className="text-sm font-normal text-ink-faint">{labelEn}</span> : null}
        {required ? (
          <span className="text-sm font-semibold text-danger">
            <span aria-hidden="true">*</span> 필수
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Field 안의 컨트롤에 붙일 aria 속성을 만들어 준다.
 *   <Field htmlFor="name" label="성명" error={err} hint="여권과 같게">
 *     <Input id="name" {...fieldAria("name", { hint: true, error: err })} />
 *   </Field>
 */
export function fieldAria(
  id: string,
  opts: { hint?: boolean; error?: string | null },
): { "aria-describedby"?: string; "aria-invalid"?: true } {
  const ids = [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean);
  return {
    ...(ids.length ? { "aria-describedby": ids.join(" ") } : {}),
    ...(opts.error ? { "aria-invalid": true as const } : {}),
  };
}

/* ───────────────────────── 컨트롤 ───────────────────────── */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={cn(CONTROL_BASE, invalid ? CONTROL_BAD : CONTROL_OK, className)}
    />
  );
}

/** 금액 입력. 오른쪽 정렬 + 고정폭 숫자 + 모바일 숫자 키패드. */
export function MoneyInput({ invalid, className, ...rest }: InputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        ₱
      </span>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn(
          CONTROL_BASE,
          invalid ? CONTROL_BAD : CONTROL_OK,
          "pl-8 text-right tnum",
          className,
        )}
      />
    </div>
  );
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      rows={rows}
      className={cn(CONTROL_BASE, invalid ? CONTROL_BAD : CONTROL_OK, "py-2.5", className)}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={cn(CONTROL_BASE, invalid ? CONTROL_BAD : CONTROL_OK, "pr-8", className)}
    >
      {children}
    </select>
  );
}

/**
 * 체크박스. 라벨 전체가 터치 영역이다 — 작은 네모만 눌러야 하면 노년층은 못 누른다.
 * 동의 항목(개인정보·명부공개)에 주로 쓰이므로 설명을 크게 둔다.
 */
export function Checkbox({
  id,
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-touch cursor-pointer items-start gap-3 rounded-[var(--radius-field)] " +
          "border border-line-strong bg-surface px-3 py-3 hover:border-brand-300 hover:bg-brand-50",
        className,
      )}
    >
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-[var(--color-brand-700)]"
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** 라디오 그룹. fieldset + legend 로 묶어야 스크린리더가 "무엇에 대한 선택인지" 를 읽는다. */
export function RadioGroup({
  legend,
  children,
  hint,
  error,
  className,
}: {
  legend: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)}>
      <legend className="font-semibold">{legend}</legend>
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      <div className="mt-1 flex flex-col gap-2">{children}</div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function Radio({
  id,
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-touch cursor-pointer items-start gap-3 rounded-[var(--radius-field)] " +
          "border border-line-strong bg-surface px-3 py-3 hover:border-brand-300 hover:bg-brand-50",
        className,
      )}
    >
      <input
        {...rest}
        id={id}
        type="radio"
        className="mt-1 size-5 shrink-0 accent-[var(--color-brand-700)]"
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** 폼 전체 세로 간격. */
export function FormStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-5", className)}>{children}</div>;
}

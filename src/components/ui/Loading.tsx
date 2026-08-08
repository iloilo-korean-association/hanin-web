import { cn } from "./cn";

/**
 * 로딩 표시.
 *
 * 현지 회선이 느리다. "아무것도 안 보이는 1초" 는 사용자에게 고장으로 읽힌다.
 * app/**\/loading.tsx 에 이 컴포넌트를 넣어 서버 컴포넌트 스트리밍 중에도
 * 화면이 비지 않게 한다.
 *
 * prefers-reduced-motion 은 globals.css 에서 전역으로 애니메이션을 끈다.
 */

export function Spinner({ label = "불러오는 중", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-ink-muted", className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-brand-600"
      />
      <span className="text-sm">{label}</span>
    </span>
  );
}

/** 표/목록 자리를 미리 잡아 두는 회색 막대. 레이아웃이 튀지 않는다. */
export function SkeletonLines({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="block h-4 animate-pulse rounded bg-surface-inset"
          style={{ width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

/** 페이지 통째 로딩. loading.tsx 에서 그대로 export default 하면 된다. */
export function PageLoading({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10">
      <Spinner label={label} />
      <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <SkeletonLines lines={6} />
      </div>
    </div>
  );
}

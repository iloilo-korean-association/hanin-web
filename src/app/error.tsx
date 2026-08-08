"use client";

import { useEffect } from "react";

import { Alert, Button, ButtonRow, LinkButton, PageContainer } from "@/components/ui";
import { ROUTES } from "@/lib/site";

/**
 * 오류 화면 (error boundary).
 *
 * · 클라이언트 컴포넌트여야 한다 — Next 규칙이다.
 * · 사용자에게 스택 트레이스를 보여주지 않는다. 개발 중에만 message 를 펼친다.
 * · digest 는 서버 로그와 화면을 잇는 유일한 실마리다. 반드시 보여준다 —
 *   대표가 "이 번호가 떴다" 고 알려주면 로그에서 바로 찾을 수 있다.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <PageContainer>
      <Alert
        tone="error"
        title="화면을 불러오는 중 문제가 발생했습니다"
        action={
          <ButtonRow>
            <Button variant="primary" onClick={() => reset()}>
              다시 시도
            </Button>
            <LinkButton href={ROUTES.home}>홈으로</LinkButton>
          </ButtonRow>
        }
      >
        <p>
          잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 아래 오류 번호를 알려
          주십시오.
        </p>
        {error.digest ? (
          <p className="mt-2">
            오류 번호: <code className="font-mono font-bold">{error.digest}</code>
          </p>
        ) : null}
        {isDev ? (
          <pre className="mt-3 overflow-x-auto rounded border border-danger-line bg-surface p-3 text-xs whitespace-pre-wrap text-ink-soft">
            {error.message}
          </pre>
        ) : null}
      </Alert>
    </PageContainer>
  );
}

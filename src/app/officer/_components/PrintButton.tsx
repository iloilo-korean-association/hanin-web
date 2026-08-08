"use client";

import { Button } from "@/components/ui";

/**
 * 인쇄 버튼. 감사 보고서를 종이로 뽑는 일이 실제로 있다(정전·태풍이 잦고, 총회에 종이로 낸다).
 * globals.css 의 인쇄 스타일이 네비·버튼을 지우고 표를 펼친다.
 */
export function PrintButton({ label = "인쇄" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}

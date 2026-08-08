import type { ReactNode } from "react";

/**
 * 페이지 안 목차용 앵커.
 *
 * 디자인 시스템의 Card 는 id 를 받지 않는다(공용 컴포넌트라 임의 속성을 열어 두지 않았다).
 * 공개 회계처럼 긴 화면에서는 "#지출로 바로 가기" 가 필요하므로, 카드를 감싸는 얇은 래퍼로 해결한다.
 *
 * scroll-mt 는 상단 고정 헤더 높이만큼 여유를 준다 —
 * 없으면 앵커로 점프했을 때 제목이 헤더 뒤에 가려진다.
 */
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      {children}
    </div>
  );
}

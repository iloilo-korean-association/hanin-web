/**
 * 서버 액션 ↔ 클라이언트 폼이 주고받는 상태.
 *
 * ★ 이 파일은 클라이언트 번들에도 들어간다. 서버 전용 모듈(guard·prisma·node:*)을
 *   절대 import 하지 마라. 에러 매핑은 _lib/server-utils.ts 에 있다.
 */

export type ActionState = {
  /** null = 아직 제출한 적 없음 */
  ok: boolean | null;
  message: string;
  /** GuardError.howToFix — "그래서 어떻게 하면 되는가" */
  howToFix: string | null;
  /** 서버가 정한 거래 최종 상태 (I3/I4 판정 결과). 클라이언트 값이 아니다. */
  status?: "POSTED" | "DRAFT";
  /** DRAFT 로 떨어진 이유 문장 */
  reason?: string;
  receiptNo?: string;
  approvalId?: string;
  /** 화면이 "새 결과가 도착했다" 를 감지하는 값. 같은 메시지가 두 번 와도 구분된다. */
  at: number;
};

export const IDLE: ActionState = { ok: null, message: "", howToFix: null, at: 0 };

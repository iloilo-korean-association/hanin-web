"use client";

import { useEffect, useRef } from "react";

import { adoptSessionFromToken } from "./actions";

/**
 * 매직링크로 들어온 회원에게 **세션 쿠키를 함께 발급**한다 (P1).
 *
 * 왜 클라이언트 컴포넌트인가: Next 는 서버 컴포넌트 렌더 중에 쿠키를 쓸 수 없다
 * (cookies().set 은 서버 액션·Route Handler 에서만). 그래서 화면이 뜬 뒤
 * 서버 액션을 한 번 불러 심는다. 실패해도 화면 이용에는 지장이 없다 —
 * 토큰 인증은 이미 끝났고, 세션은 "다음부터 /me 로 다니는" 편의일 뿐이다.
 */
export function SessionBridge({ token }: { token: string }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void adoptSessionFromToken(token).catch(() => {
      // 조용히 무시 — 토큰 화면은 세션 없이도 완전하다.
    });
  }, [token]);

  return null;
}

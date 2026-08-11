import type { NextConfig } from "next";

/**
 * 일로일로 한인회 — Next.js 설정
 *
 * 로컬 프로토타입이므로 외부 서비스 연결이 하나도 없다.
 * 외부 CDN·웹폰트·이미지 호스트를 쓰지 않으므로 images.remotePatterns 도 비어 있다.
 */
const nextConfig: NextConfig = {
  // 127.0.0.1 로 열어도 HMR 이 깨지지 않게 한다. Next 16 은 localhost 이외의
  // dev origin 을 기본 차단하는데, 그러면 하이드레이션이 조용히 실패한다.
  allowedDevOrigins: ["127.0.0.1"],

  // 대표가 회계 화면을 종이로 뽑는다. 인쇄 품질에 영향을 주는 요소가 없도록
  // 압축/최적화는 기본값을 그대로 쓴다.
  poweredByHeader: false,

  // 개인정보가 있는 화면(/me, /officer)이 프록시·검색엔진에 캐시되지 않게
  // 응답 헤더로 한 번 더 못을 박는다. robots.ts 는 크롤러 신사협정일 뿐이다.
  async headers() {
    // 비공개 경로에 붙일 헤더.
    // ★ Referrer-Policy: no-referrer 가 특히 중요하다 — /me/<토큰> 페이지에서
    //   외부 링크를 누르면 Referer 헤더에 회원 토큰이 통째로 실려 나간다.
    const privateHeaders = [
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      // [확인 필요] App Router 의 동적 페이지에는 Next 가 자체 Cache-Control
      // ("no-cache, must-revalidate")을 붙이고 그것이 이 값을 이긴다 — curl -D 로 확인함.
      // 매 요청 재검증이므로 실질적으로는 안전하지만, no-store 를 강제해야 한다면
      // 페이지에서 headers() 를 직접 손대거나 미들웨어에서 덮어써야 한다.
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];

    // 경로 패턴은 세그먼트 단위로 따로 적는다. 하나의 정규식으로 묶으면
    // path-to-regexp 가 여러 세그먼트를 못 잡아서 /dev/outbox 같은 하위 경로가 샌다.
    // (실제로 새는 것을 curl 로 확인하고 이렇게 바꿨다.)
    // /verify/<토큰> 은 로그인 없이 열리지만 여기 포함시킨다 (P3):
    //   · noindex  — 토큰이 검색결과에 뜨면 카드를 못 본 사람도 회원증을 열 수 있다
    //   · no-store — 회원증 유효/무효는 렌더 시점 판정이다. 캐시되면 미납 전환이 안 보인다
    //   · no-referrer — 이 페이지에서 밖으로 나가는 링크에 토큰이 실려 나가면 안 된다
    const privatePaths = [
      "/me",
      "/me/:path*",
      "/officer",
      "/officer/:path*",
      "/dev",
      "/dev/:path*",
      "/verify",
      "/verify/:path*",
    ];

    // ★ 순서가 의미를 갖는다. 여러 규칙이 같은 경로에 걸리면 **나중 규칙이 이긴다.**
    //   전역 기본값을 먼저 깔고, 비공개 경로 규칙을 뒤에 둬서 덮어쓰게 한다.
    //   (반대로 뒀다가 /dev/outbox 의 Referrer-Policy 가 전역값으로 되돌아가는 것을
    //    curl -D 로 확인했다.)
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      ...privatePaths.map((source) => ({ source, headers: privateHeaders })),
    ];
  },
};

export default nextConfig;

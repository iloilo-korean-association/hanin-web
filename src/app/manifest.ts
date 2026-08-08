import type { MetadataRoute } from "next";

import { ORG_NAME, ORG_NAME_EN, ORG_TAGLINE } from "@/lib/site";

/**
 * PWA manifest — 홈 화면에 추가할 수 있게 한다.
 *
 * 왜 중요한가: 필리핀 한인 커뮤니티는 모바일이 기본이다. 회원이 브라우저 주소를
 * 매번 입력하지 않고 홈 화면 아이콘을 누르게 만들어야 실제로 쓴다.
 *
 * 아이콘은 public/icons/*.svg 로 직접 그렸다(외부 다운로드 0).
 * · SVG 아이콘은 Chrome/Edge/Android 가 지원한다. sizes: "any" 로 선언한다.
 * · maskable 은 안전영역(가장자리 20%)을 비운 별도 파일이다 — 안 그러면
 *   안드로이드 런처가 원형으로 잘라내면서 로고 귀퉁이를 먹는다.
 * [확인 필요] iOS Safari 는 manifest 아이콘 대신 apple-touch-icon 을 본다.
 *   그건 src/app/apple-icon.tsx 가 PNG 로 생성한다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${ORG_NAME} · ${ORG_NAME_EN}`,
    short_name: ORG_NAME,
    description: ORG_TAGLINE,
    lang: "ko",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f7fa",
    theme_color: "#1b4373",
    categories: ["social", "government", "finance"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "공개 회계",
        short_name: "회계",
        description: "회비·기부금 사용 내역",
        url: "/ledger",
      },
      {
        name: "긴급 연락처",
        short_name: "긴급",
        description: "사고·질병·재해 시 연락처",
        url: "/sos",
      },
    ],
  };
}

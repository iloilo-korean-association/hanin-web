/**
 * 사이트 전역 상수 — 메타데이터·robots·sitemap·메일 링크가 전부 여기서 주소를 가져간다.
 *
 * 서버·클라이언트 양쪽에서 import 된다. 비밀값을 넣지 마라.
 */

/** 한인회 정식 명칭. og:title·manifest·메일 서명에 동일하게 쓴다. */
export const ORG_NAME = "일로일로 한인회";
export const ORG_NAME_EN = "Iloilo Korean Association";
export const ORG_TAGLINE = "필리핀 일로일로 한인 커뮤니티의 공식 창구";
export const ORG_TAGLINE_EN = "Korean Community of Iloilo, Philippines";

/**
 * 사이트 절대주소.
 * · og:image, sitemap.xml, 매직링크 메일에 들어가는 주소를 만든다.
 * · 상대주소로는 카톡 썸네일 카드가 뜨지 않는다 — 반드시 절대주소여야 한다.
 * · 배포할 때 NEXT_PUBLIC_SITE_URL 만 바꾸면 전부 따라간다.
 */
export const SITE_URL: string = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** 절대 URL 만들기. 경로 앞 슬래시 유무를 신경 쓰지 않아도 된다. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 필리핀 전국 긴급번호. 117 은 2016-08-01 폐기됐다 — 절대 쓰지 마라. */
export const EMERGENCY_NUMBER = "911";

/**
 * 라우트 규약 (모든 화면 담당자가 이 표를 따른다)
 *
 *   공개(인증 없음)   /, /ledger, /biz, /services, /sos, /join, /donate, /events, /help
 *   회원(매직링크)    /me/[token]
 *   임원(세션쿠키)    /officer, /officer/login, /officer/receipt,
 *                     /officer/expense, /officer/approve, /officer/audit
 *   개발 전용         /dev/login, /dev/outbox        ← 프로덕션에서 404
 */
export const ROUTES = {
  home: "/",
  ledger: "/ledger",
  biz: "/biz",
  services: "/services",
  sos: "/sos",
  about: "/about",
  join: "/join",
  donate: "/donate",
  events: "/events",
  help: "/help",
  me: (token: string) => `/me/${encodeURIComponent(token)}`,
  officer: "/officer",
  officerLogin: "/officer/login",
  devLogin: "/dev/login",
  devOutbox: "/dev/outbox",
} as const;

/** 공개 페이지 — sitemap.xml 과 헤더 네비가 같은 배열을 쓴다. */
export type PublicNavItem = {
  href: string;
  label: string;
  labelEn: string;
  /** 헤더 네비에 노출할지 (sitemap 에는 무조건 들어간다) */
  inNav: boolean;
  /** sitemap 우선순위 */
  priority: number;
  description: string;
};

export const PUBLIC_PAGES: PublicNavItem[] = [
  {
    href: "/",
    label: "홈",
    labelEn: "Home",
    inNav: false,
    priority: 1.0,
    description: `${ORG_NAME} 공식 홈페이지. 공지·행사·공개 회계·긴급 연락처.`,
  },
  {
    href: "/ledger",
    label: "공개 회계",
    labelEn: "Open Ledger",
    inNav: true,
    priority: 0.9,
    description: "회비와 기부금이 어디에 쓰였는지 건별로 전액 공개합니다.",
  },
  {
    href: "/biz",
    label: "업소 안내",
    labelEn: "Directory",
    inNav: true,
    priority: 0.7,
    description: "일로일로 지역 한인 업소 안내. 임원 이해관계는 배지로 상시 표시합니다.",
  },
  {
    href: "/services",
    label: "서비스",
    labelEn: "Services",
    inNav: true,
    priority: 0.7,
    description: "한인회가 제공하는 서비스 안내. 행정지원·생활정착·긴급지원·교육문화.",
  },
  {
    href: "/sos",
    label: "긴급 연락처",
    labelEn: "Emergency",
    inNav: true,
    priority: 0.9,
    description: `사고·질병·재해 시 연락처. 생명이 위험하면 먼저 ${EMERGENCY_NUMBER}.`,
  },
  {
    href: "/events",
    label: "행사",
    labelEn: "Events",
    inNav: true,
    priority: 0.6,
    description: "한인회 행사 일정과 참가 신청.",
  },
  {
    href: "/join",
    label: "회원 가입",
    labelEn: "Join",
    inNav: true,
    priority: 0.8,
    description: "일로일로 한인회 회원 가입 신청.",
  },
  {
    href: "/donate",
    label: "기부",
    labelEn: "Donate",
    inNav: false,
    priority: 0.6,
    description: "긴급구호·장학 기금 기부. 사용 내역은 공개 회계에 전액 공개됩니다.",
  },
  {
    href: "/about",
    label: "한인회 소개",
    labelEn: "About",
    // 네비에는 넣지 않는다 — 위급할 때 눌러야 하는 항목(긴급·회계)이 밀리면 안 된다.
    // 홈과 푸터에서 들어간다.
    inNav: false,
    priority: 0.5,
    description: "일로일로 한인회가 무엇을 하는 곳인지, 어떤 규칙으로 돈을 다루는지.",
  },
  {
    href: "/help",
    label: "문의",
    labelEn: "Contact",
    inNav: false,
    priority: 0.4,
    description: "한인회 문의처와 자주 묻는 질문.",
  },
];

/** 검색엔진·크롤러에서 막을 경로. robots.ts 와 next.config.ts 헤더가 함께 쓴다. */
export const PRIVATE_PATH_PREFIXES = ["/me/", "/officer", "/dev", "/api"] as const;

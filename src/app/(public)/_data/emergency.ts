/**
 * 긴급 연락처 데이터.
 *
 * ★ 출처는 단 하나다:
 *   c:\Users\DELL\Desktop\AI 프로젝트\일로일로 한인회\04_운영SOP\24시간_긴급대응_SOP.md
 *   §8-1 전국 긴급·공관 / §8-2 경찰·소방·재난·해경 / §8-3 병원 / §8-4 행정·생활
 *   (문서상 최종 연락처 검증일 2026-08-07)
 *
 * ★ 번호를 지어내지 않는다. 긴급 상황에서 틀린 번호는 사람을 죽인다.
 *   SOP 에서 `[확인 필요]` 로 남은 항목은 number 를 비우고 pending: true 로 둔다.
 *   화면은 그 항목을 "확인 중" 으로 표시하고 번호 자리를 비운다.
 *
 * ★ 등급 표기는 SOP 의 검증 등급을 그대로 옮긴 것이다.
 *   "verified" = ✅ 공식 사이트 확인
 *   "secondary" = ◐ 2차 출처(뉴스·디렉터리). 사용 전 재확인 대상
 *   "pending"  = [확인 필요] 미확인
 */

/** SOP 문서에 적힌 연락처 최종 검증일. 화면에 그대로 표시한다. */
export const CONTACTS_VERIFIED_ON = "2026-08-07";

export type Grade = "verified" | "secondary" | "pending";

export type Contact = {
  /** 기관·창구 이름 */
  name: string;
  /** 영문/현지 표기. 현지인에게 보여줄 때 쓴다 */
  nameEn?: string;
  /**
   * 전화번호 목록. 미확인이면 빈 배열.
   * 표기는 SOP 원문 그대로 둔다 — 사람이 눈으로 읽고 손으로 누르는 값이다.
   */
  numbers: string[];
  /** 언제 걸어야 하는가 / 주의사항 */
  note?: string;
  /** 운영 시간 */
  hours?: string;
  email?: string;
  address?: string;
  grade: Grade;
  /** 이 줄을 강조할지 (911·공관 야간 등) */
  emphasis?: boolean;
};

export type ContactGroup = {
  id: string;
  title: string;
  titleEn: string;
  description?: string;
  items: Contact[];
};

/** `tel:` 링크용 정규화. 문자·괄호·하이픈을 지우고 + 만 남긴다. */
export function telHref(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

/* ════════════════════════════════════════════════════════════════════════
 * §8-1 전국 긴급 · 공관 — 최우선
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 필리핀 전국 긴급번호. 이 하나만 외우면 된다.
 * 117 은 2016-08-01 에 911 로 대체됐다. 절대 안내하지 않는다.
 * (출처: SOP §3-0, https://en.wikipedia.org/wiki/911_(Philippines))
 */
export const NATIONAL_EMERGENCY: Contact = {
  name: "필리핀 전국 긴급 (경찰·소방·구급)",
  nameEn: "Philippines National Emergency Hotline",
  numbers: ["911"],
  note: "무료. 유선·무선 모두. 2016.8.1. 117을 대체했습니다.",
  grade: "verified",
  emphasis: true,
};

export const CONSULAR: ContactGroup = {
  id: "consular",
  title: "대한민국 공관 · 영사",
  titleEn: "Korean Missions",
  description:
    "체포·중상·사망·실종·여권 분실은 한인회보다 공관이 먼저입니다. 일로일로는 주세부 분관 관할입니다.",
  items: [
    {
      name: "주세부 대한민국 분관",
      nameEn: "Korean Consulate in Cebu",
      numbers: ["+63-32-231-1516", "+63-32-231-1517", "+63-32-231-1518", "+63-32-231-1519"],
      hours: "월~금 08:00~17:00",
      note: "관할: 비사야 16개 주. 내선 — 여권·재외국민·병역·국적 116 / 공증·가족관계등록 115, 116",
      email: "phi_cebu2015@mofa.go.kr",
      address:
        "12F Chinabank Corporate Center, Lot 2, Samar Loop cor. Road 5, Cebu Business Park, Cebu City 6000",
      grade: "verified",
      emphasis: true,
    },
    {
      name: "주세부분관 긴급 (야간·주말)",
      nameEn: "Cebu Consulate — After Hours",
      numbers: ["+63-917-808-3907"],
      note: "사건·사고 전용입니다. 비자 문의는 받지 않습니다.",
      grade: "verified",
      emphasis: true,
    },
    {
      name: "영사콜센터 (한국)",
      nameEn: "Consular Call Center, Seoul",
      numbers: ["+82-2-3210-0404"],
      hours: "24시간 365일",
      note: "통역 지원 · 신속해외송금지원 제도 안내. 한국 가족과 연결이 필요할 때.",
      grade: "verified",
      emphasis: true,
    },
    {
      name: "주필리핀 대한민국 대사관",
      nameEn: "Korean Embassy in the Philippines",
      numbers: ["+63-2-8856-9210"],
      hours: "월~금 08:00~17:00",
      email: "ph04@mofa.go.kr",
      address: "122 Upper McKinley Road, McKinley Town Center, Fort Bonifacio, Taguig City 1634",
      grade: "verified",
    },
    {
      name: "대사관 긴급 당직",
      nameEn: "Embassy Duty Officer",
      numbers: ["+63-917-817-5703"],
      hours: "24시간",
      note: "분관 대응이 지연될 때.",
      grade: "verified",
    },
  ],
};

export const NATIONAL_OTHER: ContactGroup = {
  id: "national",
  title: "전국 공통",
  titleEn: "Nationwide",
  items: [
    {
      name: "PNP 핫라인",
      nameEn: "Philippine National Police",
      numbers: ["166"],
      grade: "secondary",
    },
    {
      name: "필리핀 적십자",
      nameEn: "Philippine Red Cross",
      numbers: ["143"],
      grade: "secondary",
    },
  ],
};

/* ════════════════════════════════════════════════════════════════════════
 * §8-2 일로일로 경찰 · 소방 · 재난 · 해경
 * ══════════════════════════════════════════════════════════════════════ */

export const POLICE: ContactGroup = {
  id: "police",
  title: "경찰",
  titleEn: "Police",
  description:
    "경찰서 관할은 사건 발생지 바랑가이 기준입니다. 잘못 찾아가면 되돌아 나와야 합니다. 위치를 먼저 확정하세요.",
  items: [
    {
      name: "Iloilo City Police Office (ICPO) 본부",
      numbers: ["(033) 337-0400", "0908-377-0194"],
      note: "시 전체 총괄. 관할서 대응이 미흡할 때.",
      grade: "secondary",
      emphasis: true,
    },
    {
      name: "Mandurriao Police Station",
      numbers: ["(033) 333-2734"],
      note: "Iloilo Business Park / Festive Walk 관할 — 한인회 사무실 소재지",
      grade: "secondary",
      emphasis: true,
    },
    {
      name: "Iloilo City Proper Police Station",
      numbers: ["(033) 337-9022"],
      note: "시내 중심",
      grade: "secondary",
    },
    {
      name: "Jaro Police Station",
      numbers: ["(033) 329-7958"],
      note: "Jaro (병원 다수 소재)",
      grade: "secondary",
    },
    { name: "Molo Police Station", numbers: ["(033) 337-9502"], note: "Molo", grade: "secondary" },
    {
      name: "La Paz / Lapuz Police Station",
      numbers: ["(033) 508-0116", "(033) 329-0904"],
      note: "La Paz, Lapuz",
      grade: "secondary",
    },
    {
      name: "Arevalo Police Station",
      numbers: ["(033) 501-5526"],
      note: "Arevalo",
      grade: "secondary",
    },
  ],
};

export const RESCUE: ContactGroup = {
  id: "rescue",
  title: "소방 · 구조 · 재난 · 해경",
  titleEn: "Fire, Rescue, Disaster, Coast Guard",
  items: [
    {
      name: "Iloilo City CDRRMO — ICER/USAR (구조)",
      numbers: ["0919-066-1554", "(033) 333-2333", "(033) 335-1554"],
      note: "재난·구조·구급. 침수 고립·붕괴 시.",
      grade: "verified",
      emphasis: true,
    },
    {
      name: "BFP 소방 (Iloilo City Fire Station)",
      numbers: ["(033) 337-3011"],
      note: "화재·구조",
      grade: "secondary",
      emphasis: true,
    },
    {
      name: "Iloilo City Operations Center",
      numbers: ["0919-066-2333"],
      note: "재난 상황실",
      grade: "verified",
    },
    {
      name: "Coast Guard District Western Visayas",
      numbers: ["+63-33-337-6029", "(033) 336-2651", "(033) 397-0231"],
      note: "파나이 4개주 + 기마라스 관할. 해상·연안 사고, 선박 결항.",
      email: "cgdwv_iloilo@yahoo.com",
      address: "Zone II, Barrio Obrero, Lapaz, Iloilo City",
      grade: "secondary",
    },
  ],
};

/* ════════════════════════════════════════════════════════════════════════
 * §8-3 병원 — 한인회는 병원을 추천하지 않는다. 표를 통째로 보여주고 본인이 고른다.
 * ══════════════════════════════════════════════════════════════════════ */

export const HOSPITALS: ContactGroup = {
  id: "hospitals",
  title: "병원",
  titleEn: "Hospitals",
  description:
    "한인회는 특정 병원을 추천하지 않습니다. 아래 4곳을 그대로 보여드리니 상태·거리·비용을 보고 직접 고르십시오.",
  items: [
    {
      name: "Iloilo Mission Hospital",
      numbers: ["(033) 320-0315"],
      note: "사립 종합. 대표번호(0315~19)에서 응급실 연결.",
      address: "Mission Road, Jaro, Iloilo City",
      grade: "secondary",
    },
    {
      name: "The Medical City Iloilo",
      numbers: ["(033) 339-7340", "0956-276-0764", "0961-288-9592"],
      note: "사립 종합. 응급 핫라인 33-80808 · 컨시어지 번호 병기.",
      address: "Iloilo City (정확한 번지 확인 중)",
      grade: "secondary",
    },
    {
      name: "St. Paul's Hospital of Iloilo",
      numbers: ["(033) 337-2742"],
      note: "사립 종합. 대표번호(2742~49).",
      address: "Iloilo City (정확한 번지 확인 중)",
      grade: "secondary",
    },
    {
      name: "West Visayas State University Medical Center",
      numbers: ["(033) 320-2431"],
      note: "공공(국립).",
      email: "medcenter@wvsu.edu.ph",
      address: "E. Lopez St, Jaro, Iloilo City",
      grade: "secondary",
    },
  ],
};

/* ════════════════════════════════════════════════════════════════════════
 * §8-4 행정 · 생활 인프라
 * ══════════════════════════════════════════════════════════════════════ */

export const CIVIL: ContactGroup = {
  id: "civil",
  title: "행정 · 생활",
  titleEn: "Government & Utilities",
  items: [
    {
      name: "Bureau of Immigration — Iloilo District Office",
      numbers: ["(033) 8332-3353", "0915-099-3838", "0961-243-4938"],
      note: "체류자격·ACR I-Card 관련. 09:00~17:30",
      email: "iloilo.do@immigration.gov.ph",
      address:
        "3/F C14 Festive Mall Annex Bldg., Iloilo Business Park, Mandurriao, Iloilo City 5000",
      grade: "verified",
    },
    {
      name: "MORE Power (전력)",
      numbers: ["330-6673", "+63-919-072-0626", "+63-917-637-5214"],
      note: "정전 신고. 330-MORE = 330-6673. 24시간.",
      email: "customercare@morepower.ph",
      grade: "secondary",
    },
    {
      name: "DOLE Iloilo Field Office (노동)",
      numbers: [],
      note: "임금체불·부당해고 진정 창구. 번호 확인 중입니다.",
      grade: "pending",
    },
    {
      name: "Iloilo City Government",
      numbers: [],
      note: "공식 사이트 접근이 막혀 확인하지 못했습니다.",
      grade: "pending",
    },
    {
      name: "Metro Iloilo Water District (상수도)",
      numbers: [],
      note: "번호 확인 중입니다.",
      grade: "pending",
    },
  ],
};

/** 화면에서 순서대로 그린다. 위급도 순이다. */
export const CONTACT_GROUPS: ContactGroup[] = [
  CONSULAR,
  POLICE,
  RESCUE,
  HOSPITALS,
  CIVIL,
  NATIONAL_OTHER,
];

/* ════════════════════════════════════════════════════════════════════════
 * §3 상황별 1차 행동 (8종)
 * ══════════════════════════════════════════════════════════════════════ */

export type Playbook = {
  id: string;
  /** 이모지 하나. 외부 아이콘을 쓰지 않는다 */
  icon: string;
  title: string;
  /** 먼저 확인할 갈림길 */
  first: string;
  /** 순서대로 할 일 */
  steps: string[];
  /** 이 상황에서 반드시 거는 곳 */
  call: string[];
  /** 한인회가 하지 않는 것 */
  never: string[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "robbery",
    icon: "🚨",
    title: "강도 · 폭행 피해",
    first: "다쳤습니까? 다쳤으면 먼저 911.",
    steps: [
      "안전한 곳(실내·밝은 곳·사람 있는 곳)으로 이동하십시오.",
      "발생지 바랑가이 관할 경찰서에 신고합니다. 한인회가 동행·통역합니다.",
      "Police Blotter(사건접수부) 기재를 반드시 확인하고 사본 또는 사진을 확보하십시오. 이게 없으면 이후 절차가 진행되지 않습니다.",
      "여권·ACR I-Card·카드·휴대폰 분실 여부를 정리합니다. 카드 정지는 본인이 직접 하셔야 합니다.",
    ],
    call: ["911 (부상·현재진행 위협)", "관할 경찰서", "주세부분관 (여권 분실·중상)"],
    never: [
      "가해자를 직접 찾거나 대면하지 않습니다. 보복 위험이 실재합니다.",
      "합의금 협상을 대행하거나 중재하지 않습니다.",
      "피해자 카드·계좌를 대신 정지하지 않습니다.",
      "피해자 신원·사진·사건 내용을 단톡방·SNS에 공유하지 않습니다.",
    ],
  },
  {
    id: "traffic",
    icon: "🚗",
    title: "교통사고",
    first: "인명피해가 있습니까? 있으면 911.",
    steps: [
      "현장을 이탈하지 마십시오. 필리핀에서 사고 후 이탈은 매우 불리해집니다.",
      "증거를 확보하십시오 — 차량 위치 사진, 번호판, 상대 운전면허·OR·CR, 목격자 연락처.",
      "물피만 있어도 경찰 신고는 반드시 합니다. Police Report 접수를 확인하십시오.",
      "보험 접수는 사고 후 24시간 내에 본인이 직접 하십시오.",
      "상대측이 즉석에서 현금을 요구하면 응하지 말고 경찰 입회 하에만 진행하십시오.",
    ],
    call: ["911 (인명피해·차량 화재·도로 차단)", "관할 경찰서", "주세부분관 (운전자 구금 시)"],
    never: [
      "과실 비율을 판단하거나 말하지 않습니다. 나중에 증언으로 인용됩니다.",
      "합의서·각서에 한인회 명의로 서명하거나 입회인이 되지 않습니다.",
      "보험 청구를 대행하지 않습니다.",
      "견인·수리 업체를 단독 추천하지 않습니다.",
    ],
  },
  {
    id: "arrest",
    icon: "⚖️",
    title: "체포 · 구금",
    first: "가장 위험하고 가장 오해받기 쉬운 상황입니다. 공관이 먼저입니다.",
    steps: [
      "5가지를 확인합니다 — ① 누가 ② 어디서(경찰서/이민국/교도소) ③ 언제 ④ 혐의 ⑤ 현재 유치 장소.",
      "주세부분관에 즉시 통보합니다. 한인회가 먼저 움직이지 않습니다.",
      "영사 접견을 요청하십시오. 재외국민은 영사 조력을 받을 권리가 있습니다.",
      "변호사는 복수 명단에서 직접 고르십시오. 한인회는 비교할 명단만 드립니다.",
      "본인 동의를 받은 뒤 가족 연락을 돕고, 허용되는 범위에서 면회에 동행·통역합니다.",
    ],
    call: [
      "주세부분관 +63-32-231-1516 / 야간 +63-917-808-3907 (인지 즉시)",
      "영사콜센터 +82-2-3210-0404",
      "BI 일로일로 (033) 8332-3353 (이민국 구금인 경우)",
    ],
    never: [
      "보석금(bail)을 대납하지 않습니다. 한인회 자금으로도, 임원 개인 돈으로도.",
      "신원보증을 서지 않습니다.",
      "유무죄를 판단하거나 언급하지 않습니다.",
      "법률 자문을 하지 않습니다. 한인회는 변호사가 아닙니다.",
      "특정 변호사·로펌을 단독 추천하지 않습니다. 회장 배우자의 로펌 단독 추천은 명시적으로 금지되어 있습니다.",
      "경찰·이민국 직원에게 어떤 명목으로도 금품을 전달하지 않습니다.",
    ],
  },
  {
    id: "hospital",
    icon: "🏥",
    title: "입원 · 응급",
    first: "의식이 없거나 대량 출혈·호흡곤란·흉통이면 즉시 911.",
    steps: [
      "병원 4곳 목록을 보고 상태·거리·비용을 기준으로 직접 고르십시오.",
      "응급실에 동행·통역합니다. 필리핀 사립병원은 입원 보증금을 선요구하는 경우가 많습니다.",
      "여행자보험·PhilHealth·HMO 카드를 확인하십시오. 사전승인(LOA)은 본인과 보험사 사이에서 처리합니다.",
      "본인 동의를 받아 비상연락처·한국 가족에게 연결합니다.",
      "퇴원할 때까지 하루 한 번 안부를 확인합니다.",
    ],
    call: [
      "911 (생명 위중)",
      "병원 응급실 (이송 중 사전 연락 — 한국인·통역 필요 고지)",
      "주세부분관 (중환자실·수술·생명 위중)",
    ],
    never: [
      "치료비·입원 보증금을 대납하지 않습니다. 임원 개인 카드로도 하지 않습니다.",
      "의학적 판단·조언을 하지 않습니다.",
      "병원·의사를 단독 추천하지 않습니다.",
      "환자 상태·진단명을 단톡방에 공유하지 않습니다. 의료정보입니다.",
      "수술 동의서 등 의료 문서에 서명하지 않습니다.",
    ],
  },
  {
    id: "death",
    icon: "🕯️",
    title: "사망",
    first: "접수 즉시 최중대(L3)입니다. 심야라도 통보합니다.",
    steps: [
      "주세부분관에 즉시 통보합니다. 사망 사건의 공식 절차는 공관이 주관하고 한인회는 보조합니다.",
      "병원 밖 사망(사고사·변사)은 경찰 조사가 먼저입니다.",
      "유가족 통보는 공관을 통해서 합니다. 한인회가 직접 하지 않습니다.",
      "유가족 현지 도착을 돕습니다 — 공항 영접·숙소·통역·이동.",
      "사망진단서, 검시, 장의사, 화장/매장, 시신 송환, 유품 정리 — 각 단계마다 선택지를 복수로 드리고 결정은 유가족이 하십니다.",
    ],
    call: [
      "주세부분관 +63-32-231-1516 / 야간 +63-917-808-3907 (인지 즉시, 최우선)",
      "영사콜센터 +82-2-3210-0404",
      "911 / 관할 경찰서 (병원 밖 사망 시 필수)",
    ],
    never: [
      "유가족에게 직접 사망 사실을 통보하지 않습니다. 통보 주체가 잘못되면 그 자체가 2차 가해가 됩니다.",
      "사인(死因)을 추정해 말하지 않습니다.",
      "유가족 동의 없이 부고를 공지하지 않습니다.",
      "장의사·운구업체를 단독 추천하지 않습니다.",
      "시신 송환 비용을 대납하지 않습니다.",
      "언론에 답하지 않습니다. 모든 언론 문의는 회장 단일 창구로 갑니다.",
    ],
  },
  {
    id: "missing",
    icon: "🔦",
    title: "실종",
    first: "24시간을 기다리지 마십시오. 필리핀에서 그 통념은 위험합니다.",
    steps: [
      "최종 확인 정보를 모읍니다 — 마지막 연락 시각, 마지막 목격 장소, 복장, 소지품, 동행자, 최근 사진(가장 중요).",
      "휴대폰·SNS·금융 최종 활동을 가족·본인 계정 범위에서 확인합니다.",
      "최종 목격지 주변(숙소·직장·자주 가는 곳)을 확인합니다.",
      "병원 4곳과 경찰서를 순차 조회합니다 — 사고·구금 가능성.",
      "관할 경찰서 실종 신고에 동행하고 Blotter 기재를 확인합니다. 이어서 주세부분관에 통보합니다.",
    ],
    call: [
      "관할 경찰서 (인지 후 지체 없이)",
      "병원 4곳 (경찰 신고와 병행)",
      "주세부분관 (경찰 신고 후 당일)",
      "해경 +63-33-337-6029 (해상·도서 정황)",
    ],
    never: [
      "자체 수색대를 조직해 위험 지역에 진입하지 않습니다. 2차 사고가 실제로 발생합니다.",
      "실종자의 채무·사생활·범죄 연루를 추측해 말하지 않습니다.",
      "가족 동의 없이 사진·개인정보를 SNS에 배포하지 않습니다.",
      "몸값 요구가 있어도 직접 협상하지 않습니다. 즉시 경찰과 공관으로 갑니다.",
    ],
  },
  {
    id: "fraud",
    icon: "📄",
    title: "사기 · 분쟁 (금전 · 부동산 · 노동 · 한인 간 갈등)",
    first: "가장 자주 발생하고, 한인회가 가장 크게 다치는 유형입니다. 절차 안내만 합니다.",
    steps: [
      "첫 마디로 중립을 선언합니다 — \u201c저희는 어느 편도 들지 않습니다. 절차 안내와 통역만 도와드립니다.\u201d",
      "이해상충을 확인합니다. 당사자가 회장의 사업체 관계자면 회장을 대응 라인에서 제외하고 부회장이 총괄하며, 그 사실을 기록에 남깁니다.",
      "형사(사기·횡령·협박)는 경찰 신고 안내와 동행·통역.",
      "민사(계약·채무·부동산)는 변호사 복수 명단 제공.",
      "노동(임금체불·부당해고)은 DOLE 진정 절차 안내.",
      "한인 간 갈등은 양측 이야기를 각각 듣되 판단하지 않고, 임원 1인이 단독 대응하지 않습니다(2인 이상 배석).",
    ],
    call: ["관할 경찰서 (형사 혐의)", "BI 일로일로 (033) 8332-3353 (체류자격 분쟁)"],
    never: [
      "중재하지 않습니다. 조정·화해를 주선하지 않습니다. 요청받아도 거절합니다.",
      "누가 옳은지 말하지 않습니다. 사석에서도.",
      "법률 자문을 하지 않습니다.",
      "특정 변호사·로펌을 단독 추천하지 않습니다.",
      "한인회 명의로 보증·확인서·탄원서를 발급하지 않습니다.",
      "채권 추심을 대행하거나 동행 압박하지 않습니다.",
    ],
  },
  {
    id: "typhoon",
    icon: "🌀",
    title: "태풍 · 재난 (정전 · 침수 · 지진)",
    first: "개별 사건이 아니라 다수 회원을 동시에 상대하는 유일한 유형입니다. 사전 준비가 8할입니다.",
    steps: [
      "예보 단계: 예상 진로와 시각을 공지하고 물·식량·현금·배터리를 준비하시도록 안내합니다.",
      "Signal No.1 (36시간 전): 고령·환자·1인 거주·신규 이주자에게 개별 연락을 시작합니다.",
      "Signal No.2 (24시간 전): 외출 자제 공지, 대피소 위치 안내, 당번 2인 체제로 전환합니다.",
      "Signal No.3 (18시간 전): 이동 금지 공지, 전 회원 안부 확인 착수, 정전·단수 대비 최종 점검.",
      "Signal No.4~5: 안전 확인 롤콜(전수 점검), 미응답자 명단화, 공관과 상황 공유.",
      "통과 후: 롤콜 → 미응답자 순차 확인 → 최종 미확인 시 실종 절차로 전환 → 피해 접수.",
    ],
    call: [
      "911 / CDRRMO 0919-066-1554 (고립·구조)",
      "BFP (033) 337-3011 (화재·구조)",
      "MORE Power 330-6673 (정전 장기화)",
    ],
    never: [
      "구조 활동을 직접 하지 않습니다. 침수 지역·붕괴 현장에 임원을 보내지 않습니다.",
      "대피소를 자체 운영하지 않습니다.",
      "구호물자를 임의 배분하지 않습니다. 기준 없는 구호는 반드시 분쟁을 만듭니다.",
      "검증되지 않은 재난 정보를 전파하지 않습니다. PAGASA·시청 공식 발표만 인용합니다.",
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * §9-1 면책 및 서비스 범위 — SOP 의 공식 고지문을 옮긴 것
 * ══════════════════════════════════════════════════════════════════════ */

export const WE_DO: { label: string; body: string }[] = [
  {
    label: "초동 연결",
    body: "연락을 받고 상황에 맞는 기관(경찰·병원·소방·구조·영사관)에 신속히 연결해 드립니다.",
  },
  { label: "통역", body: "경찰서·병원·관공서에서 한국어-영어 의사소통을 돕습니다." },
  { label: "동행", body: "혼자 가기 어려운 자리에 함께 갑니다." },
  { label: "정보 제공", body: "절차 안내, 필요 서류 안내, 복수의 전문가 명단을 제공합니다." },
  { label: "가족 연락", body: "본인 동의 하에 한국의 가족과 연결을 돕습니다." },
  {
    label: "공관 통보",
    body: "체포·중상·사망·실종 등 중대 사안은 즉시 주세부분관에 통보합니다.",
  },
];

export const WE_DONT: { label: string; body: string }[] = [
  {
    label: "금전",
    body: "치료비·입원 보증금·보석금·합의금·송환비를 대납하지 않습니다.",
  },
  { label: "보증", body: "신원보증·채무보증·각종 보증서 발급을 하지 않습니다." },
  {
    label: "법률",
    body: "법률 자문·유무죄 판단·계약 유효성 판단을 하지 않습니다. 저희는 변호사가 아닙니다.",
  },
  {
    label: "의료",
    body: "진단·치료 방침·수술 여부 등 의학적 판단을 하지 않습니다. 저희는 의료인이 아닙니다.",
  },
  { label: "중재", body: "분쟁의 중재·조정·화해 주선을 하지 않습니다." },
  { label: "대행", body: "보험 청구·경찰 수사·소송·행정 절차를 대행하지 않습니다." },
  {
    label: "추천",
    body: "특정 변호사·병원·업체를 단독 추천하지 않습니다. 항상 복수의 선택지를 드리고 결정은 본인이 하십니다.",
  },
];

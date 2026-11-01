# 회원증 글꼴 (서브셋 TTF)

화면(`../../../_portal/MemberIdCard.tsx` → `card-fonts.ts`, next/font/local)과 PNG(`../card-image.tsx`, satori)가
**같은 파일**을 쓴다. satori 에는 CJK 폰트가 없고, 운영 서버(Vercel 리눅스)에는 한글 시스템 폰트가 없으며,
외부 CDN 호출은 금지라 **repo 에 둔다.** 어느 글꼴을 어디에 쓰는지·배율은 `_portal/card-art.ts` 의
`CARD_FONTS` / `CARD_LAYOUT(fontScale)` 이 정본이다.

| 파일 | 쓰는 곳 | 굵기 | 크기 | 라이선스 |
|---|---|---|---|---|
| `BMEuljiro.subset.ttf` | 이름(한글) | 400 (하나뿐) | 약 1,420 KB | `LICENSE_BMEULJIRO.txt` |
| `NanumMyeongjo-Bold.subset.ttf` | 회원번호 · 유효기간 | 700 | 약 12 KB | `OFL-NanumMyeongjo.txt` |
| `NotoSansKR-Regular.subset.ttf` | PNG 폴백 | 400 | 약 417 KB | `OFL.txt` |
| `NotoSansKR-Bold.subset.ttf` | PNG 의 회원구분 알약 · 영문 이름 · "사진 없음" | 700 | 약 416 KB | `OFL.txt` |

화면에서는 을지로체·나눔명조만 next/font 가 self-host 하고(해당 라우트에서만 로드), 알약·영문 이름은 시스템 고딕이다.

## 배민 을지로체 (BM EULJIRO) — `BMEuljiro.subset.ttf`

- **원본**: 우아한형제들 배포 `BMEULJIROTTF.ttf` (Version 1.000, 2,083 KB), https://www.woowahan.com/fonts
- **라이선스**: 두 겹이다 — 둘 다 `LICENSE_BMEULJIRO.txt` 에 전문이 있다.
  1. woowahan.com 게시 「배달의민족 글꼴 라이센스 정책」: 수정·영리 사용 허용, 폰트 파일 유상 판매 금지,
     재배포 시 라이선스 전문 표시(→ 그래서 동봉).
  2. TTF 안의 name 테이블(ID 13)에 **OFL 1.1 고지**가 있고 Reserved Font Name 이 `BM EULJIRO`, `BM EULJIRO TTF` 다.
     → 수정본(서브셋)은 그 이름을 쓸 수 없어서 서브셋 파일 안의 패밀리/PostScript 이름을
     **`IKA Card Name` / `IKACardName`** 으로 바꿨다(name ID 1·3·4·6). satori 등록 이름(`CARD_FONTS.name.family`)도 같다.
     저작권(0)·라이선스(13)·URL(14) 레코드는 보존했다.
- **글자 범위 (2,446자)**: ASCII 0x20–0x7E · KS X 1001 한글 2,350자(EUC-KR 0xB0A1–0xC8FE) · `·`(U+00B7).
  이름에만 쓰지만 모든 한글 이름을 덮어야 하므로 2,350자 전부를 넣었다. 빠진 글자 0 (cmap 으로 확인).
- **용량이 큰 이유**: 을지로체는 획이 복잡한 붓글씨라 음절 하나가 외곽선으로 약 590 바이트다(Noto 의 3.5배).
  화면에서는 /me, /me/<토큰>, /me/card 에서만 받고 해시 이름으로 영구 캐시된다.

## 나눔명조 Bold — `NanumMyeongjo-Bold.subset.ttf`

- **원본**: 네이버 나눔글꼴 `NanumMyeongjo-Bold.ttf` (Version 2.032, 3,003 KB), OFL 1.1. Google Fonts 배포본.
  Reserved Font Name 에 'NanumMyeongjo' 가 들어 있지만 서브셋의 이름은 바꾸지 않았다 — satori 등록 이름은
  `Nanum Myeongjo`(공백 있음)이고 화면은 next/font 가 자기 이름을 만든다. [확인 필요] 엄격하게는 이 서브셋도
  '수정본'이라 OFL FAQ 상 이름 변경 대상일 수 있다. 문제 삼으면 을지로체처럼 name 테이블을 바꾸면 된다.
- **글자 범위 (68자)**: `0-9 A-Z a-z . ~ - : ·` 와 공백 — 회원번호(`M0001`, `C0003`)와 날짜(`2026.10.15 ~ 2027.10.14`)에
  쓰이는 글자만. 한글은 없다(회원번호·날짜 요소에 한글이 들어오면 폴백 Noto/시스템 글꼴로 찍힌다).

## Noto Sans KR — `NotoSansKR-*.subset.ttf`

- **원본**: Noto Sans KR (© 2014-2021 Adobe, Reserved Font Name 'Source'), OFL 1.1.
  Google Fonts 배포본 가변폰트 `NotoSansKR-VF.ttf` (Version 2.04) 에서 wght 400/700 으로 고정(instancing)해 만들었다.
- **글자 범위 (2,472자)**: ASCII 0x20–0x7E · KS X 1001 한글 2,350자 ·
  기호 `· — – ‘ ’ “ ” … ※ ₱ № → ← • ㆍ 、。「」『』〈〉《》【】`
- Reserved Font Name 'Source' 를 파일명·폰트명에 쓰지 않는다 (현재 이름 "Noto Sans KR" 은 예약 이름이 아니다).

## 만든 방법 (공통)

harfbuzz 서브셋터(`subset-font` npm 패키지, 1회성 — 프로젝트 의존성에 넣지 않는다)로 위 글자만 남기고
힌팅·수직 메트릭(vhea/vmtx)·BASE/STAT/gasp 를 뺐다. name 테이블은 저작권(0)·라이선스(13)·라이선스 URL(14)을 보존했다.
woff2 로 줄이면 satori 가 못 읽으므로(ttf/otf/woff 만 받는다) TTF 로 둔다 — next/font/local 도 TTF 를 그대로 받는다.

```js
// node 20+, 빈 폴더에서 npm i subset-font@2 — 내려받은 원본 폴더 안에서 실행하지 말 것(경로만 인자로)
import subsetFont from "subset-font";
import { readFile, writeFile } from "node:fs/promises";

function ksx1001Hangul() {                      // KS X 1001 한글 2,350자
  const dec = new TextDecoder("euc-kr"); let out = "";
  for (let lead = 0xb0; lead <= 0xc8; lead++) for (let trail = 0xa1; trail <= 0xfe; trail++) {
    const ch = dec.decode(Uint8Array.from([lead, trail])); if (ch.length === 1 && ch >= "가" && ch <= "힣") out += ch;
  }
  return out;
}
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
const NAME_TEXT = ascii + ksx1001Hangul() + "·";                  // 을지로체 (+ 2,350자 밖 글자가 필요하면 여기 추가)
const NUM_TEXT = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.~-:· "; // 나눔명조 Bold

const opts = { targetFormat: "truetype", noLayoutClosure: true, noHinting: true,
  dropTables: ["vhea", "vmtx", "BASE", "STAT", "gasp"], preserveNameIds: [0, 13, 14] };
await writeFile("BMEuljiro.subset.ttf", await subsetFont(await readFile("BMEULJIROTTF.ttf"), NAME_TEXT, opts));
await writeFile("NanumMyeongjo-Bold.subset.ttf", await subsetFont(await readFile("NanumMyeongjo-Bold.ttf"), NUM_TEXT, opts));
// Noto: 위와 같되 variationAxes: { wght: 400 } / { wght: 700 } 로 두 번.
```

을지로체는 그 다음 name 테이블의 ID 1·4(패밀리)·6(PostScript)·3(고유 ID)을 `IKA Card Name` / `IKACardName` 으로
바꾸고 테이블 체크섬·head.checkSumAdjustment 를 다시 계산한다(OFL Reserved Font Name 회피). 바꾼 뒤
`CARD_FONTS.name.family` 와 같은지 확인한다.

## 2,350자 밖의 글자가 회원 이름에 나오면

예: '똠', '뷁' 같은 음절은 빈 칸으로 찍힌다(화면·PNG 모두). 그 글자를 `NAME_TEXT` 에 넣어 을지로체를 다시 만들고
(PNG 폴백인 Noto 도 같은 글자를 넣어 다시 만든다), 이름을 다시 바꾼 뒤 교체한다.

## 글꼴·배율을 바꿀 때

`card-art.ts` 의 `fontScale` 과 `top` 은 PNG 를 원본 디자인(1579px)과 같은 좌표계로 맞춰 잉크 bbox 를 비교해 정한 값이다.
글꼴을 바꾸면 그 비교를 다시 해서 두 값을 갱신한다 — 화면과 PNG 가 같은 숫자를 쓰므로 한 곳만 고치면 된다.

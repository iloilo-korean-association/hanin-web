# 회원증 PNG 용 한글 폰트 (서브셋)

`../card-image.tsx` 가 satori(next/og)에 넘기는 폰트다. satori 에는 CJK 폰트가 없고,
운영 서버(Vercel 리눅스)에는 한글 시스템 폰트가 없으며, 외부 CDN 호출은 금지라 **repo 에 둔다.**

| 파일 | 굵기 | 크기 |
|---|---|---|
| `NotoSansKR-Regular.subset.ttf` | 400 | 약 417 KB |
| `NotoSansKR-Bold.subset.ttf` | 700 | 약 416 KB |
| `OFL.txt` | 라이선스 (SIL Open Font License 1.1) | |

- **원본**: Noto Sans KR (© 2014-2021 Adobe, Reserved Font Name 'Source'), OFL 1.1.
  Google Fonts 배포본 가변폰트 `NotoSansKR-VF.ttf` (Version 2.04) 에서 만들었다.
- **글자 범위 (2,472자)**: ASCII 0x20–0x7E · KS X 1001 한글 2,350자(EUC-KR 0xB0A1–0xC8FE) ·
  기호 `· — – ‘ ’ “ ” … ※ ₱ № → ← • ㆍ 、。「」『』〈〉《》【】`
- **만든 방법**: harfbuzz 서브셋터(`subset-font` npm 패키지)로 wght 축을 400/700 으로 고정(instancing)
  하고 위 글자만 남겼다. 힌팅·수직 메트릭(vhea/vmtx)·BASE/STAT/gasp 는 뺐다.
  name 테이블에는 저작권(0)·라이선스(13)·라이선스 URL(14)을 보존했다.
- **용량이 이 정도인 이유**: 한글 음절 하나가 외곽선으로 약 170 바이트다. 2,350자 × 2 굵기면
  이 크기가 바닥이다. (woff2 로 줄이면 satori 가 못 읽는다 — ttf/otf/woff 만 받는다.)

## 2,350자 밖의 글자가 회원 이름에 나오면

예: '똠', '뷁' 같은 음절은 빈 칸으로 찍힌다. 그 글자를 넣어 다시 만들면 된다:

```js
// node 20+, npm i subset-font
import subsetFont from "subset-font";
const text = ascii + hangul2350 + "똠뷁"; // 위 글자 범위 + 추가 글자
const out = await subsetFont(await readFile("NotoSansKR-VF.ttf"), text, {
  targetFormat: "truetype",
  variationAxes: { wght: 400 },          // 700 으로 한 번 더
  noLayoutClosure: true,
  noHinting: true,
  dropTables: ["vhea", "vmtx", "BASE", "STAT", "gasp"],
  preserveNameIds: [0, 13, 14],
});
```

OFL 조건: 수정본을 배포할 때 이 라이선스 파일을 함께 둔다. Reserved Font Name 'Source' 를
파일명·폰트명에 쓰지 않는다 (현재 이름 "Noto Sans KR" 은 예약 이름이 아니다).

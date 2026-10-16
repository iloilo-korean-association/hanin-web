import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * apple-touch-icon (180×180 PNG).
 *
 * iOS Safari 는 manifest 의 아이콘을 보지 않는다 — apple-touch-icon 만 본다.
 * "홈 화면에 추가" 를 아이폰에서 하면 이 그림이 아이콘이 된다.
 *
 * 공식 엠블럼(public/brand/logo-emblem.svg — 둘레 글자까지 path 라 폰트가 필요 없다)을
 * 데이터 URL 로 넣는다. 외부 파일을 받지 않는다. 빌드 때 한 번 그려지는 정적 이미지다.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const svg = await readFile(join(process.cwd(), "public/brand/logo-emblem.svg"));
  const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // iOS 는 아이콘 모서리를 스스로 둥글게 깎는다 → 흰 사각형으로 꽉 채운다.
          // 엠블럼이 흰 원판이라 바탕도 흰색이어야 원판 경계가 깔끔하다.
          backgroundColor: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori 는 <img> 만 받는다 */}
        <img src={src} width={156} height={156} alt="" />
      </div>
    ),
    size,
  );
}

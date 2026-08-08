import { ImageResponse } from "next/og";

/**
 * apple-touch-icon (180×180 PNG).
 *
 * iOS Safari 는 manifest 의 아이콘을 보지 않는다 — apple-touch-icon 만 본다.
 * "홈 화면에 추가" 를 아이폰에서 하면 이 그림이 아이콘이 된다.
 *
 * 외부 파일을 받지 않고 next/og 로 그린다. 한글이 없으므로 폰트 문제도 없다.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // iOS 는 아이콘 모서리를 스스로 둥글게 깎는다 → 사각형으로 꽉 채운다.
          backgroundColor: "#1b4373",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 108,
            height: 108,
            borderRadius: 54,
            border: "10px solid #ffffff",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: "#e3a951",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}

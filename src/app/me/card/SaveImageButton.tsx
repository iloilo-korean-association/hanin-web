"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui";

/**
 * [이미지로 저장] — 회원증 PNG 를 받아 기기에 저장한다 (P3).
 *
 * 이미지는 서버(/me/card/image)가 만든다. 이 컴포넌트는 그것을 fetch 로 받아
 * **기기별로 가장 잘 되는 저장 경로**를 고르고, 어느 경로를 탔는지 한 줄로 알려 준다:
 *
 *  · PC(Chrome/Edge) · Android Chrome — <a download> 로 즉시 다운로드.
 *    Android 는 다운로드 폴더에 들어가고 갤러리에도 잡힌다.
 *  · iOS Safari — download 속성이 무시되거나 "파일" 앱으로 가 버린다. 회원이 원하는 곳은
 *    사진 앱이므로 navigator.share({files}) 로 **공유 시트**를 연다(거기에 "이미지 저장" 이 있다).
 *    공유가 안 되는 환경(구형 iOS·웹뷰·사용자 제스처 만료 NotAllowedError)이면 화면 안에
 *    이미지를 크게 띄우고 **길게 눌러 저장**하도록 안내한다.
 *    (새 탭으로 여는 방식은 fetch 가 끝난 뒤의 window.open 이라 팝업 차단에 자주 걸려서,
 *     같은 화면 안의 <dialog> 로 보여 준다 — 길게 누르면 똑같이 "사진에 저장" 이 뜬다.)
 *
 * 서버가 거절하면(세션 만료·미납 전환 등) 응답 JSON 의 message 를 그대로 보여 준다 —
 * 회색 "실패" 만 띄우면 회원은 총무에게 전화한다.
 */
export function SaveImageButton({
  /** PNG 를 주는 라우트. 매직링크로 들어온 화면이면 ?token= 이 붙어 있다 */
  imageHref,
  /** 저장될 파일명. 예: 일로일로한인회_회원증_M0001_2027-10-14.png (끝 = 유효기간 만료일) */
  fileName,
  /** 같은 줄에 나란히 놓을 다른 버튼(인쇄). 안내문은 그 줄 **아래**에 깔린다 */
  children,
}: {
  imageHref: string;
  fileName: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 폴백 이미지가 생기면 dialog 를 열고, 닫히면 blob URL 을 정리한다.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || !fallbackUrl) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      URL.revokeObjectURL(fallbackUrl);
    };
  }, [fallbackUrl]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setNotice({ tone: "info", text: "회원증 이미지를 만들고 있습니다…" });

    try {
      const res = await fetch(imageHref, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) {
        let message = `이미지를 만들 수 없습니다 (HTTP ${res.status}).`;
        try {
          const body = (await res.json()) as { message?: string; howToFix?: string | null };
          if (body.message) message = body.howToFix ? `${body.message} ${body.howToFix}` : body.message;
        } catch {
          /* JSON 이 아니면 기본 문구 */
        }
        throw new Error(message);
      }
      const blob = await res.blob();

      if (isIOS()) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: fileName });
            setNotice({
              tone: "info",
              text: "공유 시트를 열었습니다. ‘이미지 저장’을 누르시면 사진 앱에 들어갑니다.",
            });
            return;
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") {
              setNotice({ tone: "info", text: "저장을 취소하셨습니다." });
              return;
            }
            // NotAllowedError(제스처 만료) 등 — 아래 길게-눌러-저장 폴백으로
          }
        }
        setFallbackUrl(URL.createObjectURL(blob));
        setNotice({
          tone: "info",
          text: "이 기기에서는 바로 저장이 되지 않아 이미지를 띄웠습니다. 이미지를 길게 눌러 ‘사진에 저장’을 선택해 주십시오.",
        });
        return;
      }

      // PC · Android — 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 다운로드가 시작될 시간을 준 뒤 해제한다(즉시 해제하면 일부 브라우저가 빈 파일을 받는다)
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice({
        tone: "info",
        text: `다운로드했습니다 — ${fileName} (다운로드 폴더 또는 갤러리에서 확인하십시오)`,
      });
    } catch (e) {
      setNotice({
        tone: "error",
        text: e instanceof Error ? e.message : "이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주십시오.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    // 세로 묶음: 버튼 줄 + 그 아래 안내문. PageHeader 의 actions 칸은 shrink-0 이라
    // 안내문을 버튼과 같은 flex 줄에 두면 긴 문장만큼 칸이 넓어져 제목이 한 글자씩 세로로
    // 쪼개진다(헤드리스 크롬 스크린샷으로 확인). 그래서 안내문은 폭을 못 박고 아랫줄에 둔다.
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={save} disabled={busy} aria-busy={busy || undefined}>
          {busy ? "만드는 중…" : "이미지로 저장"}
        </Button>
        {children}
      </div>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          data-save-image-notice
          className={
            "max-w-xs text-sm sm:text-right " +
            (notice.tone === "error" ? "text-danger" : "text-ink-muted")
          }
        >
          {notice.text}
        </p>
      ) : null}

      {/* iOS 폴백: 화면 안에 띄워 길게 눌러 저장. 닫으면 blob URL 도 함께 정리된다 */}
      <dialog
        ref={dialogRef}
        onClose={() => setFallbackUrl(null)}
        className="m-auto w-[min(92vw,640px)] rounded-[var(--radius-card)] border border-line bg-surface p-4 text-ink backdrop:bg-black/60"
      >
        {fallbackUrl ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              아래 이미지를 <b>길게 눌러</b> ‘사진에 저장’ 또는 ‘이미지 저장’을 선택해 주십시오.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL. next/image 로 다룰 대상이 아니다 */}
            <img src={fallbackUrl} alt={`${fileName} — 길게 눌러 저장`} className="w-full rounded-[1.2em]" />
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              닫기
            </Button>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

/** iPhone/iPad (iPadOS 13+ 는 데스크톱 UA 를 쓰므로 터치 포인트로 가른다) */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

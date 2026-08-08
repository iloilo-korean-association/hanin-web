/**
 * 증빙 파일 저장.
 *
 * ── 왜 `public/uploads/` 인가 (DB blob 이 아니라) ─────────────────────────
 *  1) 시드가 이미 `/uploads/receipts/…` 형태의 상대경로를 증빙URL 로 넣어 두었고
 *     (prisma/seed.ts 의 evidence()), zEvidenceUrl 도 `/` 로 시작하는 경로를 허용한다.
 *     같은 규약을 그대로 쓰면 시드 데이터와 새로 찍은 사진이 한 화면에서 똑같이 동작한다.
 *  2) 정적 파일이라 Next 가 그냥 서빙한다 — 이미지 서빙용 Route Handler 를 따로 만들 필요가 없고,
 *     인쇄(결산을 종이로 뽑는 일이 실제로 있다)에서도 <img> 가 그대로 나온다.
 *  3) SQLite 파일 하나에 사진 blob 을 넣으면 dev.db 가 금방 수십 MB 가 된다.
 *     이 프로토타입은 대표가 폴더째 열어 보고 지우기도 해야 한다.
 *
 *  ★ 프로덕션에서는 그대로 쓰면 안 된다. 서버 파일시스템은 배포마다 날아가고,
 *    public/ 은 인증이 없어 URL 을 아는 사람은 누구나 영수증 사진을 본다.
 *    이식 시 S3/R2 + 서명 URL 로 바꾸고, 이 파일 하나만 교체하면 되도록 격리해 두었다.
 *    [확인 필요] 영수증 사진에 회원 실명·계좌번호가 찍히는 경우가 있으므로
 *    프로덕션 저장소는 반드시 비공개 버킷이어야 한다.
 *
 * ── 고아 파일이 남는 것은 의도된 선택이다 ────────────────────────────────
 *  저장은 DB 트랜잭션 **밖에서** 먼저 한다. 그래서 뒤이은 검증(I5 마감연도·이해상충·승인액 초과 …)
 *  이 거절하면 파일만 남는다. 반대로 트랜잭션 안에서 파일을 쓰면 느린 디스크 I/O 동안 SQLite
 *  쓰기 락을 잡고 있게 되고, 롤백해도 파일은 어차피 남는다(파일시스템은 트랜잭션이 아니다).
 *  → 고아 파일은 무해하고 사람이 지울 수 있다. 놓친 영수증 사진은 되돌릴 수 없다.
 *  [확인 필요] 프로덕션에서는 참조되지 않는 업로드를 주기적으로 청소하는 배치가 필요하다.
 *
 * ── 크기 상한 ────────────────────────────────────────────────────────────
 *  Next 서버 액션의 기본 body 상한이 1MB 다(next.config.ts 를 건드리지 않는다).
 *  그래서 클라이언트(PhotoField)가 업로드 전에 리사이즈해서 dataURL 문자 수를
 *  70만 자 이하로 맞춰 보낸다. 서버는 그 약속을 다시 검사한다 —
 *  클라이언트 검증만 믿지 않는다.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** dataURL 문자 수 상한. 서버 액션 body 1MB 안에서 여유를 둔 값. */
const MAX_DATAURL_CHARS = 780_000;

const MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type SaveResult = { ok: true; url: string; bytes: number } | { ok: false; message: string };

/** 업로드 하위 폴더. 자유 문자열을 받지 않는다 — 경로 탈출을 애초에 불가능하게 한다. */
export type UploadFolder = "receipts" | "expenses" | "quotes";

const DATA_URL_RE = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * dataURL 을 public/uploads/<folder>/ 아래 파일로 저장하고 웹 경로를 돌려준다.
 *
 * @param dateStr 파일명 앞에 붙일 'yyyy-MM-dd' (폴더를 열었을 때 사람이 찾을 수 있게)
 */
export async function saveDataUrl(
  dataUrl: string,
  folder: UploadFolder,
  dateStr: string,
): Promise<SaveResult> {
  const raw = String(dataUrl ?? "").trim();
  if (!raw) return { ok: false, message: "첨부 파일이 비어 있습니다." };

  if (raw.length > MAX_DATAURL_CHARS) {
    return {
      ok: false,
      message:
        "첨부 파일이 너무 큽니다. 사진은 자동으로 줄여서 보내야 합니다 — " +
        "페이지를 새로고침한 뒤 사진을 다시 선택해 주십시오.",
    };
  }

  const m = DATA_URL_RE.exec(raw);
  if (!m) return { ok: false, message: "첨부 파일 형식을 읽을 수 없습니다. 사진을 다시 선택해 주십시오." };

  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) {
    return {
      ok: false,
      message: `지원하지 않는 파일 형식입니다(${mime}). JPG·PNG·WEBP 사진 또는 PDF 만 첨부할 수 있습니다.`,
    };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(m[2], "base64");
  } catch {
    return { ok: false, message: "첨부 파일을 해독하지 못했습니다. 다시 선택해 주십시오." };
  }
  if (buf.byteLength === 0) return { ok: false, message: "첨부 파일이 비어 있습니다." };

  // 파일명에 사람이 준 문자열을 절대 넣지 않는다. 날짜 + 난수만 쓴다.
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : "0000-00-00";
  const fileName = `${safeDate}_${randomBytes(5).toString("hex")}.${ext}`;

  const dir = path.join(process.cwd(), "public", "uploads", folder);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), buf);
  } catch (e) {
    return {
      ok: false,
      message:
        "첨부 파일을 저장하지 못했습니다: " +
        (e instanceof Error ? e.message : String(e)) +
        " — public/uploads 폴더 쓰기 권한을 확인해 주십시오.",
    };
  }

  return { ok: true, url: `/uploads/${folder}/${fileName}`, bytes: buf.byteLength };
}

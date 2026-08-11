/**
 * 증빙·사진 파일 저장 — 저장소 어댑터.
 *
 * ── 두 개의 백엔드, 하나의 인터페이스 ────────────────────────────────────
 *  · BLOB_READ_WRITE_TOKEN 있음  → Vercel Blob (`put`, access:"private") 에 올리고
 *    비공개 URL 을 돌려준다. Vercel 서버리스는 파일시스템 쓰기가 배포마다
 *    날아가므로 운영은 반드시 이쪽이다.
 *  · 없음                        → 현행 그대로 `public/` 아래 로컬 저장 (개발용 폴백).
 *  호출부는 반환된 url 문자열만 쓰므로 어느 쪽이든 코드가 같다.
 *  (zEvidenceUrl 은 `https://` 와 `/` 시작을 둘 다 허용한다 — validators/common.ts)
 *
 * ── 범용화 ──────────────────────────────────────────────────────────────
 *  회원 사진(P3) 등 임원 증빙 밖에서도 쓸 수 있게 경로 프리픽스를 받는
 *  saveDataUrlTo() 를 노출한다. 기존 호출부(수납·지출·승인)는 saveDataUrl() 그대로 —
 *  인터페이스 무변경.
 *
 * ── 개인정보 ─────────────────────────────────────────────────────────────
 *  운영 스토어는 **Private 모드**다. 업로드는 access:"private" 로 하고, 반환
 *  URL(https://<id>.private.blob.vercel-storage.com/…)은 인증 없이 열면 403 이다.
 *  화면에 보여줄 때는 evidence-view.ts 의 toViewUrl() 로 렌더 시점에 짧은
 *  만료시간의 서명 URL 을 만들어 쓴다 — 영수증에 실명·계좌가 찍혀도 링크가
 *  새어나가면 몇 분 뒤 죽는다. 파일명의 시각+난수(40비트)는 스토어 안에서의
 *  추측·충돌 방지용으로 그대로 둔다. 단, 로컬 폴백의 public/ 은 여전히 누구나
 *  접근 가능하다 — 개발 전용이며 민감 사진을 오래 두지 않는다.
 *
 * ── 고아 파일이 남는 것은 의도된 선택이다 ────────────────────────────────
 *  저장은 DB 트랜잭션 **밖에서** 먼저 한다. 그래서 뒤이은 검증(I5 마감연도·이해상충·승인액 초과 …)
 *  이 거절하면 파일만 남는다. 반대로 트랜잭션 안에서 파일을 쓰면 느린 I/O 동안 DB
 *  쓰기 락을 잡고 있게 되고, 롤백해도 파일은 어차피 남는다(저장소는 트랜잭션이 아니다).
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
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { del, put } from "@vercel/blob";

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

/** 임원 증빙 업로드 하위 폴더. 자유 문자열을 받지 않는다 — 경로 탈출을 애초에 불가능하게 한다. */
export type UploadFolder = "receipts" | "expenses" | "quotes";

const DATA_URL_RE = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * 저장 경로 프리픽스 규칙: 소문자·숫자·하이픈 세그먼트를 `/` 로 이은 것.
 * `..`·선행 `/`·빈 세그먼트가 문법상 불가능하므로 경로 탈출이 성립하지 않는다.
 */
const PREFIX_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * dataURL 을 저장소(프리픽스 아래)에 저장하고 웹에서 접근 가능한 URL 을 돌려준다.
 *
 * 임원 증빙은 saveDataUrl() 을 쓰고, 다른 용도(회원 사진 등)는 이 함수를 직접 쓴다.
 *
 * @param prefix  저장 경로 프리픽스 (예: "uploads/receipts", "members/photos"). PREFIX_RE 준수.
 * @param dateStr 파일명 앞에 붙일 'yyyy-MM-dd' (저장소를 열었을 때 사람이 찾을 수 있게)
 */
export async function saveDataUrlTo(
  prefix: string,
  dataUrl: string,
  dateStr: string,
): Promise<SaveResult> {
  if (!PREFIX_RE.test(prefix)) {
    // 호출 코드의 버그다 — 사용자 입력이 여기 올 수 없다. 그래도 서버는 다시 검사한다.
    return { ok: false, message: `저장 경로 프리픽스가 규칙에 맞지 않습니다: ${prefix}` };
  }

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
  const storagePath = `${prefix}/${fileName}`;

  /* ── Vercel Blob (운영) ─────────────────────────────────────────────── */
  if (blobEnabled()) {
    try {
      const blob = await put(storagePath, buf, {
        // 스토어가 Private 모드라 "public" 은 서버가 거부한다. 조회는 evidence-view.ts 의 서명 URL 로.
        access: "private",
        contentType: mime,
        // 파일명에 우리 난수가 이미 있다. Blob 이 또 붙이면 사람이 못 찾는 이름이 된다.
        addRandomSuffix: false,
        // SDK 자동감지에 맡기면 OIDC 경로로 빠져 로컬에서 실패한다
        // ("OIDC is enabled for this project, but not for the development environment").
        // blobEnabled() 가 이미 이 변수의 존재를 보장한다 — 항상 명시해서 어디서든 같게 동작시킨다.
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return { ok: true, url: blob.url, bytes: buf.byteLength };
    } catch (e) {
      return {
        ok: false,
        message:
          "파일 저장소(Vercel Blob) 업로드에 실패했습니다: " +
          (e instanceof Error ? e.message : String(e)) +
          " — 잠시 후 다시 시도해 주십시오.",
      };
    }
  }

  /* ── 로컬 폴백 (개발) ───────────────────────────────────────────────── */
  const dir = path.join(process.cwd(), "public", ...prefix.split("/"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), buf);
  } catch (e) {
    return {
      ok: false,
      message:
        "첨부 파일을 저장하지 못했습니다: " +
        (e instanceof Error ? e.message : String(e)) +
        ` — public/${prefix} 폴더 쓰기 권한을 확인해 주십시오.`,
    };
  }

  return { ok: true, url: `/${storagePath}`, bytes: buf.byteLength };
}

/**
 * 임원 증빙 저장 — 기존 호출부(수납·지출·승인) 인터페이스 그대로.
 * 시드가 넣은 `/uploads/<folder>/…` 경로 규약과 같은 프리픽스를 쓴다.
 */
export async function saveDataUrl(
  dataUrl: string,
  folder: UploadFolder,
  dateStr: string,
): Promise<SaveResult> {
  return saveDataUrlTo(`uploads/${folder}`, dataUrl, dateStr);
}

/**
 * 저장된 파일 1건을 지운다 (P3).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *  회원 사진은 **지울 수 있어야 하는** 개인정보다. 필리핀 DPA(RA 10173) 상
 *  목적이 끝나면(탈퇴·동의 철회) 보관할 근거가 없다. 재업로드로 밀려난 옛 사진도
 *  같다 — 남겨 둘 이유가 없는 얼굴 사진이다.
 *  ★ 증빙(영수증·견적서)에는 쓰지 마라. 05_거래는 I1(행 삭제 금지)이 걸린 장부이고
 *    증빙을 지우면 그 거래는 근거를 잃는다.
 *
 * ── 절대 던지지 않는다 ──────────────────────────────────────────────────
 *  파일이 이미 없거나 네트워크가 죽어도 호출부(사진 교체·탈퇴 처리)를 실패시키면
 *  안 된다. "DB 는 바뀌었는데 액션은 실패로 보인다" 가 훨씬 나쁜 상태다.
 *  실패는 ok:false 로 돌려주고, 호출부는 로그만 남기고 진행한다.
 */
export async function deleteStoredFile(url: string): Promise<{ ok: boolean; message: string }> {
  const raw = String(url ?? "").trim();
  if (!raw) return { ok: true, message: "지울 파일이 없습니다." };

  /* ── Vercel Blob ── */
  if (/^https?:\/\//i.test(raw)) {
    if (!blobEnabled()) {
      return { ok: false, message: "BLOB_READ_WRITE_TOKEN 이 없어 원격 파일을 지울 수 없습니다." };
    }
    try {
      await del(raw, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return { ok: true, message: "저장소에서 삭제했습니다." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /* ── 로컬 폴백 ── */
  // 저장할 때 만든 형태(`/<prefix>/<날짜>_<난수>.<확장자>`)만 받는다.
  // 임의 경로를 넣어 public/ 밖 파일을 지우는 길을 문법상 막는다.
  if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/[0-9-]+_[0-9a-f]+\.[a-z]+$/.test(raw)) {
    return { ok: false, message: `저장소가 만든 경로 형태가 아닙니다: ${raw}` };
  }
  const abs = path.join(process.cwd(), "public", ...raw.replace(/^\//, "").split("/"));
  const root = path.join(process.cwd(), "public");
  if (!abs.startsWith(root + path.sep)) {
    return { ok: false, message: "public 폴더 밖의 경로입니다." };
  }
  try {
    await unlink(abs);
    return { ok: true, message: "로컬 파일을 삭제했습니다." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

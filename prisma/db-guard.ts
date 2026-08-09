/**
 * 파괴적 DB 명령 안전장치.
 *
 * ── 왜 있는가 ────────────────────────────────────────────────────────────
 * 2026-08-09 하루 동안 운영 DB가 세 번 비워졌다.
 *   ① prisma/seed.ts 실행 2회 — 시드는 시작할 때 deleteMany 로 전 테이블을 비운다
 *   ② prisma migrate diff --shadow-database-url <운영DB> 1회
 *      — 섀도 DB 는 "지워져도 되는 작업장" 이다. 운영 주소를 넣으면 초기화된다
 * 셋 다 "명령이 잘못됐다" 가 아니라 "명령이 맞는 DB 를 향하지 않았다" 였다.
 * 그래서 막아야 할 것은 명령이 아니라 **대상**이다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * 로컬 DB(localhost·127.0.0.1·file:)면 그냥 통과시킨다.
 * 원격 DB 면 ALLOW_DESTRUCTIVE_DB 에 적힌 호스트와 **정확히 같을 때만** 통과한다.
 *
 * 이 방식이 ALLOW=yes 같은 논리값보다 나은 이유:
 *   yes/true 는 한 번 켜 두면 그 뒤로 어떤 DB 를 향하든 계속 열려 있다.
 *   호스트를 적게 하면, 대상이 바뀌는 순간 다시 막힌다 — 개발 DB 를 지우려던 명령이
 *   운영 DB 를 향하게 됐을 때가 바로 그 순간이다.
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────────────
 *   .env (로컬 전용, 개발 DB 를 가리킨다):
 *       DATABASE_URL="postgresql://…@ep-dev-xxxx-pooler.…neon.tech/neondb?sslmode=require"
 *       ALLOW_DESTRUCTIVE_DB="ep-dev-xxxx-pooler.c-3.ap-southeast-1.aws.neon.tech"
 *
 *   운영 주소는 .env 에 두지 않는다. Vercel 환경변수에만 둔다.
 *   그러면 이 파일이 무엇을 하든 운영 DB 는 손이 닿지 않는다.
 *
 * 단독 실행하면 검사만 하고 끝난다(package.json 스크립트에서 전치 검사로 쓴다).
 *   npx tsx prisma/db-guard.ts
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

/** .env 를 직접 읽는다 — tsx 로 단독 실행될 때는 Next 도 Prisma 도 로드해 주지 않는다. */
function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // 이미 주어진 값(명령줄 등)이 우선
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

export type DbTarget = { host: string; database: string; isLocal: boolean };

/** 연결 문자열에서 호스트와 DB 이름만 뽑는다. 비밀번호는 만지지 않는다. */
export function describeTarget(url: string | undefined): DbTarget | null {
  if (!url) return null;
  if (url.startsWith("file:")) return { host: "file", database: url, isLocal: true };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  return {
    host,
    database: u.pathname.replace(/^\//, "") || "(이름 없음)",
    isLocal: LOCAL_HOSTS.has(host),
  };
}

/**
 * 파괴적 작업 직전에 부른다. 허용되지 않으면 **던진다** — 절대 조용히 넘어가지 않는다.
 *
 * @param action 화면에 찍을 작업 이름. "시드(전 테이블 삭제 후 재적재)" 처럼 구체적으로.
 */
export function assertDestructiveAllowed(action: string): DbTarget {
  loadDotEnv();

  const target = describeTarget(process.env.DATABASE_URL);
  if (!target) {
    throw new Error(
      `[차단] ${action}\n` +
        `  DATABASE_URL 을 읽을 수 없습니다. .env 를 확인하십시오.\n` +
        `  대상을 모르는 채로 지우는 명령은 실행하지 않습니다.`,
    );
  }

  if (target.isLocal) return target;

  const allowed = process.env.ALLOW_DESTRUCTIVE_DB?.trim();
  if (allowed && allowed === target.host) return target;

  throw new Error(
    `\n[차단] ${action}\n` +
      `\n  대상 DB 가 로컬이 아닙니다.\n` +
      `      호스트 : ${target.host}\n` +
      `      DB     : ${target.database}\n` +
      (allowed
        ? `      허용된 호스트 : ${allowed}   ← 일치하지 않습니다\n`
        : `      ALLOW_DESTRUCTIVE_DB 가 설정돼 있지 않습니다\n`) +
      `\n  이 명령은 테이블을 비웁니다. 운영 DB 라면 회비·거래 기록이 사라집니다.\n` +
      `\n  정말 이 DB 를 지우려면 .env 에 아래 줄을 넣으십시오:\n` +
      `      ALLOW_DESTRUCTIVE_DB="${target.host}"\n` +
      `\n  운영 DB 를 지우려던 것이 아니라면, .env 의 DATABASE_URL 이\n` +
      `  개발용 DB(Neon 개발 브랜치)를 가리키는지 먼저 확인하십시오.\n`,
  );
}

/* 단독 실행 — package.json 의 파괴적 스크립트 앞에 붙여 전치 검사로 쓴다. */
if (require.main === module) {
  try {
    const t = assertDestructiveAllowed("파괴적 DB 명령");
    console.log(`  [허용] 대상 ${t.host} / ${t.database}${t.isLocal ? " (로컬)" : ""}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

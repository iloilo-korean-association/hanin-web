# DB 운영 수칙

2026-08-09, 운영 DB가 하루에 세 번 비워졌다. 이 문서는 그 재발을 막기 위한 것이다.

무엇이 잘못됐는지부터 적는다. 셋 다 **명령이 틀린 게 아니라 명령이 향한 DB가 틀렸다.**

| # | 명령 | 왜 지워졌나 |
|---|---|---|
| 1·2 | `npx tsx prisma/seed.ts` (2회) | 시드는 시작할 때 `deleteMany()` 로 전 테이블을 비운다 |
| 3 | `prisma migrate diff --shadow-database-url <운영DB>` | **섀도 DB는 초기화된다.** Prisma가 마이그레이션을 재생하는 임시 작업장이다 |

세 번 모두 `.env` 의 `DATABASE_URL` 이 운영 DB를 가리키고 있었기 때문에 일어났다.

---

## 1. 개발 DB와 운영 DB를 나눈다 (근본 대책)

Neon 브랜치는 **무료이고 즉시 만들어진다.** 운영 데이터의 복사본에서 갈라져 나오므로 실제와 같은 데이터로 개발할 수 있다.

**Neon 대시보드에서 (5분):**

1. 프로젝트 → 왼쪽 **Branches** → **New Branch**
2. Branch name `dev` · Parent branch `main`(운영) · **Include data up to now** 선택
3. 만들어진 `dev` 브랜치 → **Connect** → 연결 문자열 2개를 복사
   - Pooled (`-pooler` 있음) → `DATABASE_URL`
   - Direct (`-pooler` 없음) → `DIRECT_URL`

**로컬 `.env` 에 (개발 브랜치 주소만):**

```ini
DATABASE_URL="postgresql://…@ep-dev-xxxx-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://…@ep-dev-xxxx.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
ALLOW_DESTRUCTIVE_DB="ep-dev-xxxx-pooler.c-3.ap-southeast-1.aws.neon.tech"
```

**운영 주소는 `.env` 에 두지 않는다.** Vercel 환경변수에만 둔다. 그러면 로컬에서 무엇을 실행하든 운영 DB에는 손이 닿지 않는다.

> 개발 브랜치는 운영 데이터의 복사본이므로 **실제 회원 개인정보가 들어 있다.** 로컬 PC도 개인정보 취급 장소가 된다. 회비를 실제로 받기 시작하면 `dev` 브랜치는 데이터 없이(스키마만) 만들고 시드로 채우는 쪽으로 바꾼다.

---

## 2. 안전장치 — `prisma/db-guard.ts`

데이터를 지우는 npm 스크립트는 실행 전에 대상 DB를 먼저 검사한다.

| 대상 | 결과 |
|---|---|
| 로컬 (`localhost` · `127.0.0.1` · `file:`) | 통과 |
| 원격이고 `ALLOW_DESTRUCTIVE_DB` 와 호스트가 **정확히 일치** | 통과 |
| 그 외 전부 | **차단** — 호스트·DB 이름과 해결 방법을 찍고 종료 |

허용값을 `yes/true` 가 아니라 **호스트 문자열**로 받는다. `yes` 는 한 번 켜 두면 그 뒤로 어떤 DB를 향하든 계속 열려 있다. 호스트를 적게 하면 대상이 바뀌는 순간 다시 막힌다 — 그 순간이 바로 사고가 나는 순간이다.

```
npm run db:guard      # 지금 어느 DB를 향하는지 확인만
npm run db:seed       # 시드 (내부에서 가드를 먼저 부른다)
npm run db:reset      # 스키마 초기화 + 시드 (가드 통과해야 실행)
npm run db:push       # 스키마 반영 (가드 통과해야 실행)
```

---

## 3. 가드가 막지 못하는 것 — `--shadow-database-url`

Prisma CLI를 직접 부르면 가드를 거치지 않는다. **특히 이것을 조심한다:**

```
# ★ 절대 금지 — 섀도 DB는 초기화된다
prisma migrate diff --from-migrations … --shadow-database-url <운영 또는 개발 DB>
```

섀도 DB는 "지워져도 되는 빈 DB"여야 한다. 스키마 드리프트를 확인하려면 **Neon에 일회용 브랜치를 만들어** 그 주소를 넣고, 확인이 끝나면 브랜치를 지운다.

같은 이유로 `prisma migrate dev` 도 로컬/개발 브랜치에서만 실행한다. 운영에는 `prisma migrate deploy` 만 쓴다 (이것은 지우지 않는다).

---

## 4. 시드로 날아가는 것과 복구 방법

시드는 임원·비밀번호·권한·감사로그까지 전부 새로 만든다. 시드를 돌린 뒤에는 항상 아래를 이어서 실행한다.

```
npx tsx prisma/migrate-contacts.ts          # 긴급 연락처 28건 (원본은 _data/emergency.ts)
npx tsx prisma/ensure-admin.ts <비밀번호>    # 관리자 계정 OF99 + 전체 권한
```

`ensure-admin.ts` 가 없으면 **`임원관리` 권한자가 0명**이 된다. 시드가 만드는 임원 5명 중 아무도 그 권한을 갖지 않기 때문이다. 그 상태에서는 화면으로 권한을 되돌릴 방법이 없다.

임원별 비밀번호를 따로 줄 때:

```
npx tsx prisma/set-password.ts --list
npx tsx prisma/set-password.ts treasurer@ika-iloilo.org <비밀번호>
```

시드에 비밀번호를 고정하려면 `SEED_PASSWORD` 를 준다. 안 주면 매번 새 난수가 생겨 아무도 로그인하지 못한다.

```
SEED_PASSWORD=… npx tsx prisma/seed.ts
```

---

## 5. 복구 절차 (DB가 비었을 때)

```
npx prisma migrate deploy                      # 스키마 (테이블이 이미 있으면 migrate resolve --applied)
SEED_PASSWORD=… npx tsx prisma/seed.ts         # 데모 데이터 + 임원 5명
npx tsx prisma/migrate-contacts.ts             # 긴급 연락처
npx tsx prisma/ensure-admin.ts <비밀번호>       # 관리자
npx tsx prisma/verify.ts                       # 29개 검산 — 전부 통과해야 끝
```

마지막 `verify.ts` 를 건너뛰지 않는다. "복구했다"는 말은 검산이 통과했을 때만 성립한다.

---

## 6. 아직 안 된 것

- **백업이 없다.** Neon 무료 티어의 복원 시점(PITR)은 24시간이다. 회비를 실제로 받기 시작하면 주 1회 `pg_dump` 를 외부 저장소에 남겨야 한다.
- 지금 DB에 든 것은 전부 데모 데이터다. 위 사고에서 잃은 것이 없었던 이유가 이것뿐이다. **실제 회비가 들어오는 날부터는 같은 실수가 복구 불가능하다.**

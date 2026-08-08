# Vercel 배포 가이드 — 일로일로 한인회 웹앱

> 지금 코드는 **로컬 전용**으로 만들어졌습니다. Vercel에 그냥 올리면 **작동하지 않습니다.**
> 반드시 아래 3가지를 먼저 바꿔야 합니다. 이유까지 적었으니 건너뛰지 마십시오.

---

## 0. 올리기 전에 반드시 바꿔야 하는 3가지

### ① SQLite → PostgreSQL (필수, 안 바꾸면 아예 안 돎)

지금 DB는 `prisma/dev.db` 라는 **파일 하나**입니다. 로컬에서는 완벽하지만 Vercel에서는 못 씁니다.

Vercel 서버리스 함수는 **파일 시스템이 읽기 전용**이고, 쓸 수 있는 곳은 `/tmp` 뿐인데 그마저도
요청이 끝나면 사라지고 인스턴스끼리 공유되지 않습니다.
([Vercel 공식](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel))

즉 배포하면 이렇게 됩니다.
- 회원이 가입해도 **다음 요청에서 사라짐**
- 수납을 기록해도 **다른 사용자에게는 안 보임**
- 배포할 때마다 **장부가 초기화됨**

**회계 시스템에서는 치명적입니다.** 반드시 호스팅 Postgres로 바꿔야 합니다.

### ② 영수증 사진 저장 위치 변경 (필수)

`src/app/officer/_lib/upload.ts` 가 사진을 `public/uploads/` 에 **파일로 씁니다**(102~105행).
①과 같은 이유로 Vercel에서는 **쓰기가 실패**합니다. 증빙이 안 올라가면 불변식 I3에 걸려
모든 수납이 `DRAFT` 로 떨어집니다.

바꿀 방법 세 가지 — **Vercel Blob 권장**:

| 방법 | 장점 | 단점 |
|---|---|---|
| **Vercel Blob** (권장) | Vercel 안에서 끝남. 코드 몇 줄 | 무료 1GB, 이후 유료 |
| Cloudflare R2 | 저렴, 이그레스 무료 | 계정 하나 더 |
| Postgres에 bytea 저장 | 계정 추가 0개 | DB 용량·백업이 무거워짐. **비권장** |

### ③ Git 저장소 만들기 (필수)

`06_웹앱` 폴더는 **아직 git 저장소가 아닙니다**(`git status` → `not a git repository`).
Vercel은 GitHub/GitLab/Bitbucket 저장소를 연결해서 배포합니다.

> ⚠️ **저장소를 대표님 개인 GitHub 계정에 만들지 마십시오.**
> pialms 가 `github.com/speakcls/pialms`(개인 계정)에 있는 것이 바로 우리가 피하려던 상태입니다.
> **GitHub Organization을 한인회 명의로 먼저 만들고** 거기에 저장소를 두십시오.
> "일단 내 계정에 만들고 나중에 옮기자"는 영구히 연기됩니다.

---

## 1. 요금제 — Hobby로 가능합니다 (정정)

> **앞서 "Vercel Hobby는 기부 요청 금지라 Pro가 필요하다"고 안내드렸는데 틀렸습니다.**

[Vercel 공식 Fair Use 문서](https://vercel.com/docs/limits/fair-use-guidelines) 기준:
- 상업적 이용 = **프로젝트 제작에 관여한 누군가가 금전적 이익을 얻는 경우**
  (코드를 짜고 **보수를 받는** 직원·외주 포함)
- **기부를 받는 것 자체는 상업적 이용이 아닙니다**
- 비영리 프로젝트는 **아무도 보수를 받지 않으면** Hobby로 가능

**한인회 판단:**
- 대표님이 **무보수로** 직접 만들고 유지 → **Hobby(무료) 가능**
- **외주 개발자에게 돈을 주고** 만들거나 유지 → **Pro($20/월) 필요**

앞선 의사결정 기록에서 "유지보수 담당자를 계약으로 확보"를 게이트로 걸었는데,
**그 계약을 맺는 순간 Pro가 됩니다.** 연 ₩340,800 을 예산에 넣어두십시오.

---

## 2. 단계별 절차

### STEP 1 — Postgres 데이터베이스 만들기

셋 중 하나를 고릅니다. **Neon 무료 티어**를 권합니다(한인회는 트래픽이 낮습니다).

| 서비스 | 무료 티어 | 주의 |
|---|---|---|
| **Neon** (권장) | 0.5GB, 무활동 시 자동 절전(요청 오면 깨어남) | 절전에서 깨는 데 첫 요청이 1~2초 |
| Supabase | 500MB | **7일 무활동 시 프로젝트 일시정지** — 태풍철 반년 무활동이 정상 패턴인 한인회에 위험 |
| Vercel Postgres | Vercel 안에서 관리 | 무료 한도가 작음 |

1. https://neon.tech 가입 (GitHub 계정으로 가능)
2. 프로젝트 생성 → 리전은 **Singapore** 또는 가장 가까운 곳
3. 연결 문자열 2개를 복사해 둡니다:
   - **Pooled connection** → `DATABASE_URL` 로 씁니다 (서버리스는 커넥션 풀 필수)
   - **Direct connection** → `DIRECT_URL` 로 씁니다 (마이그레이션용)

### STEP 2 — 코드 수정

**2-1. `prisma/schema.prisma`**

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

> 이 앱은 **Prisma enum을 쓰지 않고 String + zod로 만들어 뒀습니다.**
> 그래서 SQLite→Postgres 전환에 모델 수정이 거의 없습니다. 처음부터 이걸 노리고 설계했습니다.

**2-2. 업로드를 Vercel Blob으로**

```bash
npm install @vercel/blob
```

`src/app/officer/_lib/upload.ts` 의 `mkdir`/`writeFile` 부분을 `put()` 으로 교체합니다.
(구체적 코드는 제가 바꿔드릴 수 있습니다 — 아래 "제가 해드릴 수 있는 것" 참조)

**2-3. 첫 마이그레이션 생성**

지금까지는 `prisma db push` 로 스키마를 밀어넣었습니다. 실제 운영 DB에는 **마이그레이션 이력**이 있어야
나중에 스키마를 바꿀 때 데이터가 안전합니다.

```bash
npx prisma migrate dev --name init
```

**2-4. `package.json` 빌드 스크립트**

Vercel은 빌드할 때마다 의존성을 새로 받으므로 `prisma generate` 가 반드시 필요합니다. 이미 들어 있습니다:

```json
"build": "prisma generate && next build"
```

마이그레이션을 배포 때 자동 적용하려면 이렇게 바꿉니다:

```json
"build": "prisma generate && prisma migrate deploy && next build"
```

### STEP 3 — GitHub 저장소 만들기

```powershell
# 1) 한인회 명의 GitHub Organization을 먼저 만든다 (github.com → + → New organization)
#    예: iloilo-korean-association

# 2) 그 Organization 안에 비공개 저장소 생성 (예: hanin-web)

# 3) 로컬에서 연결
cd "C:\Users\DELL\Desktop\AI 프로젝트\일로일로 한인회\06_웹앱"
git init
git add .
git commit -m "일로일로 한인회 웹앱 최초 커밋"
git branch -M main
git remote add origin https://github.com/<조직명>/hanin-web.git
git push -u origin main
```

> `.gitignore` 는 이미 제대로 돼 있습니다 — `.env`, `prisma/*.db`, `public/uploads/` 가 전부 제외됩니다.
> **`.env` 와 `dev.db` 가 커밋되지 않았는지 `git status` 로 반드시 확인하십시오.**
> `dev.db` 에는 회원 이름·연락처가 들어 있어 유출되면 개인정보 사고입니다.

### STEP 4 — Vercel 연결

1. https://vercel.com 가입 → **GitHub 계정으로 로그인**
2. **Add New… → Project**
3. GitHub Organization 접근 권한 승인 → `hanin-web` 저장소 **Import**
4. 설정 화면:
   - **Framework Preset**: Next.js (자동 감지됨)
   - **Root Directory**: 그대로 (`./`)
   - **Build Command / Output**: 건드리지 않음
5. **Environment Variables** 에 아래를 입력 (아직 Deploy 누르지 말 것):

| 이름 | 값 | 비고 |
|---|---|---|
| `DATABASE_URL` | Neon **Pooled** 연결 문자열 | |
| `DIRECT_URL` | Neon **Direct** 연결 문자열 | 마이그레이션용 |
| `SESSION_SECRET` | 아래 명령으로 생성 | **로컬 값 재사용 금지** |
| `NEXT_PUBLIC_SITE_URL` | `https://<도메인>` | og 카드·매직링크 주소에 쓰임 |
| `DEV_TOOLS` | `off` | `/dev/login`·`/dev/outbox` 차단 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 연결 시 자동 주입 | |

세션 시크릿 생성:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

6. **Deploy** 클릭

### STEP 5 — 운영 DB에 초기 데이터 넣기

배포된 DB는 **비어 있습니다.** 설정·계좌·기금·과목·임원 시드가 있어야 시스템이 돕니다.

```powershell
# 로컬에서 운영 DB를 가리켜 시드
$env:DATABASE_URL="<Neon Direct 연결 문자열>"
$env:DIRECT_URL="<Neon Direct 연결 문자열>"
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

> ⚠️ **`prisma/seed.ts` 는 가짜 회원 60명·거래 122건이 들어 있는 데모 시드입니다.**
> 실제 운영에는 **설정·계좌·기금·과목·임원만** 넣고 나머지는 빼야 합니다.
> 데모 데이터를 지운 `seed.prod.ts` 가 필요합니다 — 제가 만들어 드릴 수 있습니다.

### STEP 6 — 도메인 연결

1. 도메인 구입 (예: `iloilokorean.org`, 연 약 ₩20,000)
   - **등록자(Registrant)를 한인회 명의로.** 대표님 개인 명의 금지
   - **자동 갱신 ON**, 만료 알림 수신자 2곳
2. Vercel 프로젝트 → **Settings → Domains → Add**
3. Vercel이 알려주는 DNS 레코드를 도메인 등록기관에 입력
4. 몇 분~몇 시간 뒤 HTTPS 자동 발급됨
5. **`NEXT_PUBLIC_SITE_URL` 을 새 도메인으로 바꾸고 재배포**

### STEP 7 — 배포 후 반드시 확인

- [ ] `https://<도메인>/` 열림
- [ ] `https://<도메인>/ledger` 에 숫자가 뜸
- [ ] `https://<도메인>/dev/login` → **404** (안 뜨면 `DEV_TOOLS=off` 확인)
- [ ] `https://<도메인>/officer` → 로그인 요구
- [ ] `robots.txt` 가 공개 경로 `Allow`, `/me`·`/officer`·`/dev` `Disallow`
- [ ] **카톡방에 도메인을 붙여서 썸네일 카드가 뜨는지** ← 이게 목표였습니다
- [ ] 임원 계정 비밀번호를 **반드시 변경** (시드 시 SEED_PASSWORD 로 지정하거나, 출력된 무작위 값 사용)
- [ ] Google Search Console에 sitemap 제출 → 색인 확인

---

## 3. 배포해도 아직 안 되는 것

### 메일이 실제로 나가지 않습니다
지금 메일은 **DB에 기록만 하고 `/dev/outbox` 에서 보는 구조**입니다(프로토타입용).
프로덕션에서는 `DEV_TOOLS=off` 라 outbox도 안 보이므로, **영수증·독촉·매직링크가 아무 데도 안 갑니다.**

메일을 실제로 보내려면:
1. [Resend](https://resend.com) 가입 (무료 월 3,000통 — 한인회 연간 발송 추정 3,300통이라 거의 무료)
2. **도메인 인증(SPF·DKIM·DMARC)** 설정 ← 이걸 안 하면 전부 스팸함으로 갑니다
3. `src/lib/domain/mail.ts` 의 발송부를 Resend API로 연결
4. **워밍업 필수**: 임원 3명 → 20명 → 100명 → 전체 순으로 최소 3주에 걸쳐.
   신규 도메인에서 독촉 300통을 한 번에 쏘면 스팸 판정을 받고, 한 번 굳으면 회복이 안 됩니다.

### 크론(자동 실행)이 없습니다
독촉 발송·월마감·주간 무결성 검사가 자동으로 돌지 않습니다.
`vercel.json` 에 cron을 정의해야 합니다. **Hobby 플랜은 크론이 하루 1회로 제한**됩니다.

---

## 4. 예상 비용 (연간)

| 항목 | Hobby 구성 | Pro 구성 |
|---|---|---|
| Vercel | ₩0 | ₩340,800 |
| Neon Postgres | ₩0 (무료 티어) | ₩0~323,000 |
| Vercel Blob | ₩0 (1GB 내) | 사용량 |
| Resend 메일 | ₩0 (월 3,000통 내) | ₩0 |
| 도메인 | ₩20,000 | ₩20,000 |
| **합계** | **₩20,000** | **₩360,800~** |

> Hobby가 가능한 조건: **아무도 보수를 받지 않고** 만들고 유지하는 경우.
> 유지보수를 외주 계약하면 Pro로 올라갑니다.

---

## 5. 제가 해드릴 수 있는 것

말씀해 주시면 아래를 코드로 바꿔 드립니다. **STEP 2 전체가 여기 해당합니다.**

- [ ] `schema.prisma` → PostgreSQL 전환 + 첫 마이그레이션 생성
- [ ] 업로드를 Vercel Blob으로 교체 (`upload.ts`)
- [ ] 운영용 시드 `seed.prod.ts` (데모 데이터 제외, 설정·계좌·기금·과목·임원만)
- [ ] Resend 메일 발송 연결 (환경변수 없으면 자동으로 outbox로 폴백)
- [ ] `vercel.json` 크론 설정
- [ ] 로컬은 SQLite, 배포는 Postgres로 **동시에 돌아가게** 분기 (개발 편의 유지)

대표님이 직접 하셔야 하는 것은 **계정 만들기와 클릭**뿐입니다 —
GitHub Organization, Neon, Vercel, 도메인 구입.

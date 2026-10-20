# ckp-server — CKP 업무 앱 API 서버

Node 24 · Fastify 5 · pg · TypeScript(ESM). 설계 기준: `../docs/DESIGN.md`, API 타입: `src/contract.ts`(앱과 동일 파일).

## 개발 실행

```bash
cd ckp-server
cp .env.example .env      # 선택 (없어도 개발 기본값으로 실행)
npm run dev               # http://localhost:4000/v1/meta
```

- `DATABASE_URL` 이 없으면 내장 개발 DB(PGlite)를 `.data/pglite` 에 만들고 cso_ckp 모양의 테이블 + 샘플 데이터 + `migrations/001`·`002` 를 적용한다.
- 샘플 계정(개발 DB 전용, 비밀번호 모두 `demo1234`): `ckp_demo`(승인, bcrypt) · `ckp_md5`(승인, MD5) · `ckp_wait`(승인 대기)
- 개발 DB 초기화: `npm run dev:reset`
- 사진은 `.data/uploads` 에 저장된다(`STORAGE_DRIVER=local`).

## 명령

| 명령 | 설명 |
|---|---|
| `npm run typecheck` | 타입 검사 |
| `npm test` | 테스트 (항상 인메모리 PGlite + 임시 폴더, 실제 DB/S3 접속 없음) |
| `npm run check:contract` | 앱/서버 `contract.ts` 동일 여부 확인 |
| `npm run build` / `npm start` | `dist/` 빌드 후 실행 |
| `npm run db:check` | DB 스키마 읽기 전용 점검 보고서 (필수 항목 누락 시 종료 코드 1) |
| `npm run db:migrate -- --yes` | `migrations/001_ckp_app_edi.sql`(필수) + `002_ckp_app_refresh_token.sql`(선택) 적용 (`--yes` 없으면 계획만 출력, 하나만: `-- --yes --only=001`). 백업·DBA 검토 후 실행 |
| `npm run cleanup:uploads -- --apply` | 24시간 넘은 미사용 업로드 정리 (`--apply` 없으면 목록만) |

## 운영 설정 요약

`NODE_ENV=production` 이면 `DATABASE_URL`, `JWT_SECRET`, `FILE_TOKEN_SECRET`(각 32자 이상, 서로 다른 값)이 필수이고
개발용 비밀키(`dev-only…`)·`DEV_DB`·`CORS_ORIGINS=*`·`COOKIE_SECURE=false`·`TRUST_PROXY=true` 는 거부된다. 전체 변수는 `.env.example` 참고.

- Windows 에서는 `NODE_ENV=production npm start` 형식이 동작하지 않으므로 `.env` 에 `NODE_ENV=production` 을 적는다.
- `NODE_ENV` 가 production 이 아니어도 `DATABASE_URL`(실제 DB) + 개발용 비밀키 조합이면 서버가 시작하지 않는다
  (내 PC 의 개발용 PostgreSQL 이면 `ALLOW_DEV_SECRETS=true`). `db:check`·`db:migrate`·`cleanup:uploads` 에는 적용되지 않는다.
- DB 암호화: `DATABASE_SSL` 을 비우면 `DATABASE_URL` 의 `sslmode` 를 따른다(없으면 운영 require). `sslmode=require` 와 `DATABASE_SSL=disable` 이 같이 있으면 설정 오류.
- 프록시(ALB·Nginx) 뒤: `TRUST_PROXY=1`(앞단 프록시 수) 또는 프록시 IP/CIDR(`TRUST_PROXY=10.0.0.0/8`).
  `true` 는 클라이언트가 보낸 `X-Forwarded-For` 를 그대로 믿어 로그인 시도 제한을 피할 수 있으므로 쓰지 않는다.

## 로그인 보호

- IP당 `LOGIN_IP_MAX_PER_MIN`(기본 30)회/분(아이디 무관, 본문 읽기 전에 거부), IP+아이디당 10회/분.
- 로그인 실패: 아이디+IP 5회/10분, 아이디 20회/10분(IP 를 바꿔도 누적) → 429.
- IP 는 `TRUST_PROXY` 로 계산한 신뢰 가능한 주소, IPv6 는 /64 대역 단위로 센다.
- bcrypt 비교는 동시에 2개까지만 실행하고 대기열(64)이 가득 차면 429 — 로그인 폭주가 EDI 업로드 등 다른 요청을 멈추지 않도록.
- 실패 응답 시간은 비밀번호 형식(bcrypt/MD5)이나 계정 존재 여부와 관계없이 bcrypt 1회 수준으로 맞춘다.
  (저장된 bcrypt 해시의 cost 가 10 이 아니면 그 계정은 응답 시간이 달라진다 — `db:check` 의 해시 형식 분포 참고)

## 회원가입 (승인 대기 신청)

- `GET /v1/auth/check-id?usrId=` → 사용 가능 여부, `POST /v1/auth/register` → 201 (토큰은 발급하지 않음). 인증 불필요.
- 기존 방식(참고 Next.js·구 앱)과 같이 `sys_app_usr_mng` 에 **승인 대기(`apr_yn='N'`)** 로 저장한다. 관리자가 기존 관리자 화면(앱 회원 관리)에서
  `apr_yn='Y'` 로 승인해야 로그인된다(그 전에는 로그인 시 403 '관리자 승인 대기중입니다.').
- 저장 컬럼(명시 목록만): `usr_id, usr_pwd(bcrypt cost 10), usr_nam, phone(010-1234-5678 형식), email(소문자), cpy_nam, apr_yn='N', join_ymd(KST 오늘), role_id`.
  요청 본문의 다른 항목(aprYn·roleId 등)은 무시한다. 계좌·신분증·사진 정보는 받지 않는다. MD5 는 쓰지 않는다.
- 아이디: 2~20자, 한글·영문·숫자·`_`·`-`·`.`·가운데 공백. 로그인은 대소문자까지 정확히 일치해야 하지만,
  비슷한 계정을 막기 위해 가입 중복은 대소문자·앞뒤 공백을 무시하고 판단한다(동시 가입도 잠금으로 1건만 등록).
- 비밀번호: 4~64자, 앞뒤 공백 불가. 휴대폰 숫자 10~11자리, 개인정보 동의 필수.
- 설정: `SELF_REGISTRATION_ENABLED`(기본 true, false 면 403 + `/v1/meta` `features.selfRegistration=false`),
  `REGISTER_ROLE_ID`(기본 `R0004`=일반사용자, 빈 값이면 NULL), `REGISTER_IP_MAX_PER_10MIN`(기본 5, 성공·실패 모두 셈),
  `REGISTER_MAX_PER_HOUR`(서버 전체 가입 완료 수, 기본 100). 아이디 확인은 IP당 30회/분.
- 제한 카운터는 로그인 보호와 같이 메모리(단일 프로세스) 기준이다. 비밀번호·요청 본문은 로그에 남기지 않는다(가입 아이디만 info 로그).

## refresh 토큰

- `migrations/002`(`ckp_app_refresh_token`, 선택)가 있으면: 재발급 때마다 이전 토큰 폐기, 폐기된 토큰이 다시 오면(60초 유예 후)
  같은 로그인에서 발급된 토큰 전체 폐기, 로그아웃은 그 로그인 전체 폐기 — 서버를 다시 시작해도 유지. 토큰 원문은 저장하지 않는다(sha256).
- 없으면 무상태 방식(재발급해도 이전 토큰은 만료까지 유효, 로그아웃 폐기는 메모리 — 재시작 시 초기화). 시작 로그에 경고가 나온다.
- 롤백: `migrations/002_ckp_app_refresh_token.rollback.sql` 후 서버 재시작.

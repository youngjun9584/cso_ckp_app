# CKP 업무 앱 — 설계 명세 (구현 기준 문서)

> 이 문서는 구현자가 따라야 하는 **확정 설계**다. 근거는 참고 코드 분석 결과(§2)이며, 확인되지 않은 항목은 §9에 모았다.
> 앱↔서버 요청/응답 타입은 `ckp-app/src/lib/api/contract.ts`(= `ckp-server/src/contract.ts`)가 단일 기준이다.

## 1. 저장소 구성

```
cso_ckp_app/
├─ ckp-app/        Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript (Android / iOS / Web)
├─ ckp-server/     Node 24 · Fastify 5 · pg · TypeScript  (HTTPS API: 인증·권한·업무 처리)
│   └─ migrations/ 001_ckp_app_edi.sql (+ rollback) — 추가 전용 테이블
└─ docs/           DESIGN.md(이 문서), API.md, 운영 체크리스트
```

구조: `Android / iOS / Web → HTTPS(JSON) → ckp-server → PostgreSQL(cso_ckp) / 사진 저장소(S3 또는 로컬)`.
앱은 DB·S3 자격 증명을 절대 갖지 않는다.

## 2. 기존 시스템에서 확인한 사실 (구현이 지켜야 할 호환 규칙)

근거: 참고 Next.js 앱(`C:\CSO_Pharm_Zone\@source\nextApp`, DB cso_pamco)과 cso_ckp 를 바라보는 Java 관리자
(`C:\csoKorea\source\backEnd\webWorkspace2\Daejeon.GeodtTFM`). cso_ckp 실 DB 는 접속하지 않았다(계정 미확인).

### 2.1 사용자·인증 — `public.sys_app_usr_mng` (현장 영업 사용자 = 앱 사용자)
- 로그인 키 `usr_id`(varchar 20, PK, trim 후 정확히 일치). 이름 `usr_nam`, 회사 `cpy_nam`, `phone`, `email`, `role_id`, `apr_yn`.
- 비밀번호 `usr_pwd` 는 **두 형식이 섞여 있을 수 있다**:
  - bcrypt `$2a$/$2b$/$2y$` (Next.js 가입/변경) → `bcrypt.compare(원문 그대로)`.
  - **MD5 소문자 hex 32자** (Java 관리자 비밀번호 초기화, 구 앱) → `md5(trim(원문))`, UTF-8 우선, 실패 시 CP949 바이트로 재시도.
  - 그 외 형식 → 로그인 거부.
- `apr_yn` 이 `'Y'` 일 때만 로그인 허용. 거부 메시지(관리자와 동일 문구):
  N `관리자 승인 대기중입니다.` / D `삭제 요청된 상태입니다.` / R `승인 보류된 상태입니다.` / S `접속차단 상태입니다.` / 기타 `관리자에게 승인 상태를 확인하십시오.`
- 비밀번호 검증 실패와 없는 아이디는 **같은 401 메시지**(계정 존재 노출 금지): `아이디 또는 비밀번호가 올바르지 않습니다.`
- 절대 조회/반환 금지 컬럼: `usr_pwd`(검증용 외), `bankbook_*`, `cpy_image`, `bankbook_image`, `cpy_number`. `SELECT *` 금지.
- 관리자 사용자(`sys_usr_mng`)는 앱 로그인 대상이 아니다.

### 2.2 거래처 — `public.mannager_by_hospital` (테이블명 오타가 실제 이름)
| 컬럼 | 의미(관리자 라벨) | 앱 필드 |
|---|---|---|
| idx int PK | | idx |
| hospital varchar(100) | 거래처명 | name (필수) |
| user_id varchar(100) NOT NULL | 담당자 = sys_app_usr_mng.usr_id | ownerUsrId (= 로그인 사용자) |
| doctor_name varchar(100) | 원장명/대표자명 | representative |
| cpy_number varchar(100) | 사업자번호 | bizNo |
| address varchar(100) | 주소 | address + addressDetail 합쳐 저장 |
| zip_code varchar(10) | 우편번호 | zipCode |
| care_code varchar(50) | 요양기관번호 | careCode |
| dispensary varchar(100) | 문전약국 | dispensary |
| phone varchar(20) | 전화번호 | phone |
| ee varchar(200) | 기타/비고 | memo |
| approval boolean | 승인여부 (true 승인 / false 승인대기 / null 미지정) | approval |
| hospital_type (cso_ckp 에만 존재 추정) | 거래처종류 | clientType — **서버 시작 시 컬럼 존재 확인 후에만 사용** |

- 앱에서 등록 시 `approval = false`(기존 Next.js 규칙). 수정 API 는 이번 범위 밖.
- 기존 규칙: EDI 거래처 선택은 `approval !== false`(null 은 선택 가능) → 서버 설정 `CLIENT_APPROVAL_REQUIRED_FOR_EDI`(기본 true)로 동일하게 적용. false 로 두면 승인 대기 거래처도 선택 가능.
- EDI ↔ 거래처 연결은 **이름 문자열**(`edi.hospital_name = hospital`, 같은 `user_id`). 따라서 **같은 사용자 안에서 거래처명 중복을 금지**(409 DUPLICATE_CLIENT_NAME, 공백/대소문자 정규화 비교).
- 사업자번호: 기존엔 검증 없음. 앱은 입력 시 숫자 10자리 + 국세청 검증번호 확인, 같은 사용자 거래처 중 동일 번호(숫자만 비교) 있으면 409 DUPLICATE_BIZ_NO. 다른 담당자 거래처와의 중복은 확인·노출하지 않는다(타 사용자 데이터 노출 방지).

### 2.3 의약품 — `public.medicine` (조회 전용)
PK `medicine_code`(보험코드). 표시 필드: `name`, `company`(제약사), `medicine_packing`(포장·규격), `ingredient`(성분 및 함량),
`pay`(약가, **문자열**·쉼표/‘미정’ 가능), `type1`/`type2`(구분), `medicine_class`(복지부 분류), `welfare_code`, `contrast_medicine`(대조약),
`medicine_add`(첨가제), `ee`(비고), `medicine_is`(정산여부 Y/N), `is_maker`(자사생산 O/X), `image_url`, `reg_ymd`.
- **반환 금지**: `ee2`(관리자 전용 메모), `is_live`(의미 불명), `decrease_tax`.
- 수수료: `frees` 테이블에서 `list = true` 인 행의 `idx`(값: tax/tax_2/tax_3/tax_4 중 하나로 추정)와 `name`(라벨)을 읽어 해당 컬럼만 노출.
  `frees` 조회 실패·해당 행 없음·값 없음 → fee = null(표시 안 함). `MEDICINE_FEE_VISIBLE=false` 이면 항상 null.
- 이름 정렬은 `regexp_replace(btrim(name), '^([[][^][]*[]]|◎|★|[[:space:]])+', '') COLLATE "C"`, 동률 `medicine_code`.
- 검색 필드: name(기본) / company / code / all(이름·제약사·보험코드·성분). `ILIKE '%' || $q || '%'` (와일드카드 이스케이프).

### 2.4 공지사항 — `public.notice` (조회 전용)
`idx`, `title`, `author`, `contents`(Quill HTML, 이미지가 **base64 data: URI** 로 내장될 수 있음), `reg_ymd`(date), `important`(문자열 'true'/'false').
- 목록에는 `contents` 제외. 정렬 `(important = 'true') DESC, reg_ymd DESC NULLS LAST, idx DESC`. 제목 검색 ILIKE.
- 첨부파일 테이블/컬럼 없음 → `attachments: []`.
- HTML 은 서버에서 sanitize-html 로 정화 후 반환(§5.6).

### 2.5 EDI — `public.edi` (사진 1장 = 1행, 관리자 화면이 이 테이블을 직접 읽음)
관리자가 계속 동작하려면 앱 제출 시 **정확히** 아래 값으로 사진마다 1행을 넣는다:

| 컬럼 | 값 |
|---|---|
| deal_type | `'기존'` (Next.js 와 동일. `EDI_DEAL_TYPE` 환경변수로 변경 가능) |
| hospital_name | 선택한 거래처의 `mannager_by_hospital.hospital` (서버가 idx 로 다시 조회) |
| pharmacist | `''` (관리자가 AI 분석/검토로 채움 → "검토필요" 큐에 들어감) |
| user_id | 토큰의 usr_id (요청 본문 값 절대 신뢰 금지) |
| edi_image | NULL |
| reg_ymd | `(now() AT TIME ZONE 'Asia/Seoul')::date` |
| is_ocr | false |
| month | `'당월' / '전월' / '전전월'` (서버가 targetYm 으로부터 KST 기준 계산) |
| move_month | false |
| aws_url | 저장소 공개 URL (S3: `https://<bucket>.s3.<region>.amazonaws.com/<key>`, **쿼리스트링 금지, ≤200자**) |
| ocr | NULL (관리자 AI 분석이 덮어씀 — 순번 저장 용도로 쓰지 않는다) |
| create_at | `'YYYY-MM-DD HH:mm:ss'` KST, **한 제출 건의 모든 행 동일** |
| print | false |
| is_copy | false — **컬럼이 존재할 때만** (서버 시작 시 확인) |
| region | 넣지 않음 |

- 행은 **한 트랜잭션 안에서 seq 순서대로 순차 INSERT** → `idx` 오름차순 = 사진 순서.
- 관리자 표시 규칙(앱 내역에도 동일 적용): `pharmacist` 를 쉼표로 나눈 비어있지 않은 항목이 정확히 1개이고 숫자만이 아니면 "검토완료", 아니면 "검토필요".
  `deal_type = '삭제요청'` 이면 "삭제요청". `print` 출력여부, `is_ocr` AI분석 여부.
- EDI 차단 스위치: `SELECT COALESCE(bool_or(edi), false) AS blocked FROM public.is_edi` 가 true 면 등록 차단(업로드·제출 모두 403 EDI_DISABLED). 관리자 토글은 WHERE 없이 모든 행을 같은 값으로 바꾸므로 bool_or 가 결정적이다. 조회 오류 시에도 차단(fail-closed).
- 월 라벨 의미(기존 업무): 오늘(KST) 기준 **당월 = 직전 달**, 전월 = 2개월 전, 전전월 = 3개월 전.
- 관리자 화면·OCR 이 `aws_url` 을 **서명 없이** 직접 읽는다 → 운영 저장소는 기존 `edi-img` 버킷 규칙(공개 읽기)과 같아야 관리자에서 보인다. 이는 운영 확인 사항(§9).
- 관리자가 edi 행을 삭제할 수 있음(이월 토글 버그 포함) → 앱 내역은 행이 사라져도 오류 없이 "삭제됨(missing)" 으로 표시.
- 관리자 crop 은 `aws_url` 을 다른 키로 바꾼다 → 이미지 조회 시 항상 현재 `edi.aws_url` 을 기준으로 한다(앱 업로드 키가 아니라).

## 3. 핵심 결정

1. **인증**: 새 서버가 `sys_app_usr_mng` 로 직접 로그인(이중 해시 검증 + apr_yn). JWT(HS256, jose) access 30분 + refresh 14일(`typ` 구분). 선택 마이그레이션 002(`ckp_app_refresh_token`)가 있으면 refresh 토큰을 해시로 저장해 회전·재사용 탐지(같은 로그인 전체 폐기)·로그아웃 폐기를 하고, 없으면 무상태로 동작한다(기동 시 경고 로그).
   refresh 시 DB 에서 사용자 상태를 다시 확인. 모든 인증 요청은 사용자 상태를 60초 캐시로 재확인(차단 즉시 반영).
   native: refresh 토큰을 SecureStore 에 저장. web: refresh 토큰은 httpOnly·SameSite=Lax 쿠키 `ckp_rt`(Path=/v1/auth), access 토큰은 메모리.
   MD5→bcrypt 재해시는 하지 않는다(구 앱이 MD5 만 검증할 수 있음) — `PASSWORD_REHASH_ON_LOGIN` 기본 false.
2. **사진 업로드는 서버 경유**(multipart 1장씩): 서버가 형식(매직 바이트)·크기·해상도를 검증하고, EXIF 회전 보정·메타데이터 제거·JPEG 정규화·썸네일을 만든 뒤 저장소에 넣는다. S3 버킷 CORS 변경이 필요 없고, 로컬/S3 저장소가 같은 코드 경로를 탄다.
3. **중복 방지 2중**: (a) 사진 업로드는 `(usr_id, clientPhotoId)` 유일 → 재시도해도 1개. (b) 제출은 `Idempotency-Key`(작성 건당 1개) + 요청 해시 → 재시도는 기존 결과 반환, 같은 키 다른 내용은 409. 성공한 경우에만 키를 저장한다.
4. **순서 보장**: 앱에서 확정한 순서 → `photos[].seq` → 트랜잭션 내 순차 INSERT(idx 증가) + `ckp_app_edi_submission_photo.seq`. 조회는 항상 seq 순.
5. **추가 테이블 3개**(`migrations/001_ckp_app_edi.sql`, 필수) + 선택 1개(`migrations/002_ckp_app_refresh_token.sql`, 권장): 기존 테이블 무변경. `npm run db:migrate -- --yes` 는 001·002 를 적용(`--only=001` 로 001 만). 없으면 EDI 제출/내역 API 는 503 SCHEMA_NOT_READY 로 명확히 실패(조회 전용 기능은 동작).
6. **스키마 자동 확인**: 서버 시작 시 `information_schema.columns` 로 필요한 테이블/컬럼과 선택 컬럼(`edi.is_copy`, `mannager_by_hospital.hospital_type`)을 읽기 전용으로 확인해 기능을 켜고 끈다. `npm run db:check` 로 보고서 출력.
7. **개발용 DB**: `DATABASE_URL` 이 없고 `DEV_DB=pglite` 이면 서버가 PGlite(내장 PostgreSQL)를 띄우고 cso_ckp 와 같은 모양의 테이블 + 샘플 데이터 + 마이그레이션을 적용한다. `/v1/meta.dataSource = 'development'` → 앱에 "개발 서버(테스트 데이터)" 배너.
8. **앱 샘플 모드**: `EXPO_PUBLIC_API_MODE=sample`(또는 API 주소 미설정)이면 서버 없이 앱 내 메모리 샘플 API 로 동작. 상단에 항상 "샘플 모드 · 서버에 저장되지 않음" 배너, 등록 결과 화면도 "샘플 모드에서 저장을 흉내냈습니다(실제 서버 저장 아님)" 로 표시.
9. **대상 연월**: 서버 `GET /v1/edi/month-options`(KST) 3개 중 선택. 저장은 `edi.month`(라벨) + `ckp_app_edi_submission.target_ym`(절대 연월).
10. **메모**: `ckp_app_edi_submission.memo` 에만 저장(관리자 화면에는 표시되지 않음 — §9 보고).

## 4. 제한값 (서버·앱 동일, `/v1/meta.limits`)
- 제출 1건 사진: 최소 1, 최대 30 (앱: 선택 누적 합계 30 초과 불가 / 서버: 제출 시 1..30 검증, seq 1..N 연속·중복 없음).
- 업로드 1장(클라이언트 처리 후) 최대 15 MB (`PHOTO_MAX_BYTES`). 원본 선택 파일은 앱에서 50 MB 초과 시 거부.
- 긴 변 최소 400 px(`PHOTO_MIN_LONG_SIDE`), 서버 정규화 최대 긴 변 3200 px.
- 앱 처리: 긴 변 2560 px 로 축소(작으면 유지), JPEG 품질 0.85 — 처방·거래명세 글자 판독 가능한 수준.
- 지원 입력 형식(앱): JPEG, PNG, WEBP, HEIC/HEIF(네이티브는 OS 디코더로 변환, 웹은 heic2any 로 변환 시도 → 실패 시 안내). GIF·BMP·TIFF·동영상 등은 "지원하지 않는 형식".
- 서버 수신 형식: JPEG/PNG/WEBP(매직 바이트 확인). 그 외 415 UNSUPPORTED_FILE_TYPE. 출력은 항상 JPEG.
- 메모 500자, 거래처 필드 길이는 §2.2 컬럼 길이.

## 5. 서버 명세 (`ckp-server`)

### 5.1 구성
```
src/
  index.ts              진입점: config → db → schema check → buildApp → listen
  app.ts                buildApp(deps): Fastify 인스턴스(테스트에서 inject 사용)
  config.ts             환경변수(zod 검증, 비밀값 로그 금지)
  contract.ts           API 타입 (앱과 동일 파일)
  db/pool.ts            pg.Pool 래퍼: query<T>(sql, params), tx(fn) — tx 안에서는 반드시 tx client 사용
  db/devdb.ts           PGlite + pglite-socket 개발 DB 기동, 스키마·시드 적용
  db/dev-schema.sql     cso_ckp 호환 최소 스키마(기존 테이블 모양 재현, 개발/테스트 전용)
  db/dev-seed.ts        샘플 데이터(의약품 120+, 공지 25+, 사용자 3, 거래처, is_edi, frees)
  db/schema-check.ts    information_schema 확인 → capabilities
  lib/errors.ts         AppError(code,status,message,fields) + 전역 에러 핸들러(ApiErrorBody)
  lib/kst.ts            KST 날짜/연월/월라벨 계산 (서버 TZ 와 무관하게 동작)
  lib/password.ts       bcrypt/MD5(UTF-8→CP949) 검증, timingSafeEqual
  lib/tokens.ts         access/refresh 발급·검증, 이미지 서명 토큰(HMAC, 만료)
  lib/bizno.ts          사업자번호 정규화·검증번호·표시 형식
  lib/sanitize.ts       공지 HTML 정화
  lib/image.ts          sharp 검증·정규화·썸네일, JPEG 무손실 메타 제거
  storage/index.ts      Storage 인터페이스: put(key, buf, type), get(key) → stream/buffer, delete(key), publicUrl(key)
  storage/local.ts      .data/uploads 하위 저장 (개발)
  storage/s3.ts         @aws-sdk/client-s3 PutObject/GetObject/DeleteObject (ACL 미지정)
  plugins/auth.ts       Bearer 검증 decorator(request.user), 사용자 상태 60초 캐시
  routes/meta.ts, auth.ts, medicines.ts, notices.ts, clients.ts, edi.ts, files.ts
  scripts/db-check.ts, db-migrate.ts(001 적용, 확인 프롬프트 없이 실행하지 않음: --yes 필요), cleanup-uploads.ts
test/                   vitest: PGlite 개발 DB 로 app.inject() 통합 테스트
```

### 5.2 환경변수 (`.env.example` 제공, 실제 값은 커밋 금지)
`PORT`(4000), `HOST`(0.0.0.0), `NODE_ENV`, `DATABASE_URL`(운영: postgres://…/cso_ckp?sslmode=require), `DATABASE_SSL`(require|disable),
`DEV_DB`(pglite — DATABASE_URL 없을 때만), `DEV_DB_DIR`(.data/pglite), `JWT_SECRET`(32자 이상 필수), `FILE_TOKEN_SECRET`(32자 이상),
`ACCESS_TOKEN_TTL_MIN`(30), `REFRESH_TOKEN_TTL_DAYS`(14), `CORS_ORIGINS`(쉼표 목록, 예: http://localhost:8081),
`COOKIE_SECURE`(운영 true), `STORAGE_DRIVER`(local|s3), `LOCAL_STORAGE_DIR`(.data/uploads), `S3_BUCKET`, `S3_REGION`(ap-northeast-2),
`S3_KEY_PREFIX`(uploads/users/ckp), `S3_PUBLIC_BASE_URL`(비우면 https://<bucket>.s3.<region>.amazonaws.com), `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`(또는 IAM 역할),
`LEGACY_IMAGE_URL_PREFIXES`(관리자/이전 등록 이미지 허용 접두어, 쉼표), `PHOTO_MAX_BYTES`(15728640), `PHOTO_MIN_LONG_SIDE`(400),
`CLIENT_APPROVAL_REQUIRED_FOR_EDI`(true), `MEDICINE_FEE_VISIBLE`(true), `EDI_DEAL_TYPE`(기존), `PASSWORD_REHASH_ON_LOGIN`(false), `TRUST_PROXY`(false | 앞단 프록시 수 | IP/CIDR 목록 — `true` 는 운영에서 거부), `LOGIN_IP_MAX_PER_MIN`(30), `ALLOW_DEV_SECRETS`(실 DB 에 개발용 비밀키 사용 금지 — 예외 허용 시에만 true).
운영(`NODE_ENV=production`)에서 DATABASE_URL·JWT_SECRET·FILE_TOKEN_SECRET 누락 시 기동 실패. DEV_DB 는 production 에서 금지.

### 5.3 공통 규칙
- 모든 SQL 은 파라미터 바인딩. LIKE 검색어는 `%`, `_`, `\` 이스케이프.
- 날짜/시각은 SQL 에서 KST 문자열로 변환해 반환: `to_char(reg_ymd, 'YYYY-MM-DD')`. JS Date 직렬화에 의존하지 않는다.
- 응답에 스택/SQL/내부 메시지 노출 금지. 서버 로그에 비밀번호·토큰·해시·파일 URL+개인정보 동시 기록 금지.
- `@fastify/helmet`, CORS 허용 목록 + `credentials: true`, JSON body 1 MB, multipart 파일 1개·`PHOTO_MAX_BYTES`.
- rate limit: 로그인 IP당 30회/분(본문 읽기 전), IP+아이디당 10회/분·실패 5회/10분, 아이디당 실패 20회/10분(IP 무관), bcrypt 동시 2건(대기 64건 초과 시 429), 업로드 사용자당 180회/분, 그 외 600회/분. 계정 존재 여부가 응답 시간으로 드러나지 않도록 실패 시 동일한 bcrypt 비교를 수행한다.
- 404 경로는 `NOT_FOUND` ApiErrorBody.

### 5.4 인증 라우트
- 회원가입(사용자 요청으로 추가): `GET /v1/auth/check-id?usrId=`, `POST /v1/auth/register` → 201 승인 대기. 기존 방식 그대로 `sys_app_usr_mng` 에 `apr_yn='N'`, `role_id=R0004`, bcrypt(cost 10) 저장, 토큰 미발급. 관리자가 기존 관리자 화면에서 승인해야 로그인 가능. 아이디 중복은 대소문자 무시(lower). 설정: `SELF_REGISTRATION_ENABLED`(기본 true, false 면 403 + `meta.features.selfRegistration=false` 로 앱의 가입 버튼 숨김), `REGISTER_ROLE_ID`, `REGISTER_IP_MAX_PER_10MIN`(5), `REGISTER_MAX_PER_HOUR`(100). 앱·서버 검증 규칙은 `ckp-app/src/features/auth/signup-validation.ts` = `ckp-server/src/domain/users/registration.ts`.
- `POST /v1/auth/login` → AuthTokensResponse. 로그인 실패 5회/10분 이상이면 429(메모리 카운터).
- `POST /v1/auth/refresh`, `POST /v1/auth/logout`(204, 쿠키 삭제), `GET /v1/auth/me`.
- 로그인 성공 시 `last_ymd` 갱신은 하지 않는다(컬럼 존재 미확인 · 관리자 무관).

### 5.5 조회/등록 라우트
- `GET /v1/meta` (공개).
- `GET /v1/medicines`, `GET /v1/medicines/:code` (인증 필요). 없으면 404 `의약품을 찾을 수 없습니다.`
- `GET /v1/notices`, `GET /v1/notices/:idx` (인증 필요).
- `GET /v1/clients` (내 거래처, 이름 가나다순 `hospital COLLATE "C"`, q 는 이름·대표자·주소·전화·사업자번호(숫자만 비교) 검색),
  `GET /v1/clients/:idx`(소유자 아니면 404), `GET /v1/clients/check-duplicate`, `POST /v1/clients`.
  거래처 입력 검증 메시지는 필드별 한국어(예: `거래처명을 입력해 주세요.`, `사업자등록번호 10자리를 정확히 입력해 주세요.`, `사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.`, `연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.`, `주소와 상세주소를 합쳐 100자 이하로 입력해 주세요.`).

### 5.6 공지 HTML 정화
sanitize-html 허용 목록: p, br, h1~h4, strong, b, em, i, u, s, ul, ol, li, blockquote, a, img, hr, table, thead, tbody, tr, th, td, span, code, pre.
속성: a[href,title,target,rel], img[src,alt,width,height]. 스킴: https, mailto, tel. img 는 https 또는 `data:image/(png|jpeg|jpg|gif|webp);base64,` 만.
a 에 `rel="noopener noreferrer nofollow" target="_blank"` 강제. src 없는 img 제거. iframe(영상)은 `<p><a href="(https 원본 주소)">동영상 보기</a></p>` 로 대체(https 일 때만).
Quill 의 `ql-align-center|right|justify` class 는 `style="text-align:..."` 로 변환(이 style 속성만 허용), 그 외 class·style 은 제거. data: 이미지 1개 최대 5 MB(초과 시 제거 후 `[이미지 생략]`).

### 5.7 EDI 라우트
- `GET /v1/edi/status`, `GET /v1/edi/month-options`.
- `POST /v1/edi/uploads`: 인증 → is_edi 확인 → clientPhotoId(uuid) 검증 → 같은 (usr, clientPhotoId) PENDING/USED 가 있으면 그대로 반환(200 reused) →
  파일 수신(크기 초과 413 FILE_TOO_LARGE) → 매직 바이트(JPEG/PNG/WEBP, 아니면 415; HEIC 는 `HEIC 형식은 서버에서 변환할 수 없습니다. 앱에서 JPG로 변환해 다시 올려 주세요.`) →
  sharp 메타(디코드 실패 422 IMAGE_DECODE_FAILED, 긴 변 < 최소 422 IMAGE_TOO_SMALL) →
  정규화: JPEG 이고 EXIF orientation 이 1/없음이고 긴 변 ≤3200 이면 원본 바이트에서 APP1/APP13 등 메타 세그먼트만 무손실 제거, 아니면 `rotate()`+축소(3200)+JPEG q88 재인코딩 →
  썸네일 긴 변 480 JPEG q72 → 저장소 키 `${prefix}/edi/${YYYYMM(KST)}/${uploadId}.jpg`, `..._thumb.jpg` → put → `ckp_app_edi_upload` INSERT(PENDING).
  동시 같은 clientPhotoId 경쟁은 UNIQUE 충돌 시 기존 행 반환 + 방금 올린 객체 삭제.
- `POST /v1/edi/submissions`: 인증 → Idempotency-Key(uuid) 필수(없으면 400) → 본문 검증(photos 1..30, seq 1..N 연속 유일, uploadId 유일, memo ≤500, targetYm ∈ month-options) →
  requestHash = sha256(정규화 JSON{clientIdx,targetYm,memo,photos(seq순 uploadId)}) →
  **트랜잭션**: `pg_advisory_xact_lock(hashtext(usr_id||key))` → 기존 (usr,key) 있으면 hash 같으면 저장된 결과 재구성해 200 replayed, 다르면 409 →
  is_edi 재확인 → 거래처 소유·선택 가능 확인(아니면 404 / 409 CLIENT_NOT_SELECTABLE) → uploads `SELECT … FOR UPDATE` (usr 소유, PENDING; 없으면 422 UPLOAD_NOT_FOUND + details.missing, USED 면 409 UPLOAD_ALREADY_USED) →
  create_at·reg_ymd KST 1회 계산 → seq 순서대로 edi INSERT RETURNING idx → submission/photo INSERT → uploads USED → COMMIT → 201.
- `GET /v1/edi/submissions?ym=`: 등록월(reg_ymd, KST) 기준. 앱 제출 건(submission 테이블, `usr_id` 기준 — 거래처 소유자가 바뀌어도 내역 유지) + **이전 방식 등록분**(같은 `edi.user_id`, 해당 월, `COALESCE(is_copy,false)=false`(관리자 복사본 제외), submission_photo 에 없는 edi 행)을 `(hospital_name, month, create_at, reg_ymd)` 로 묶은 legacy 그룹을 합쳐 최신순. legacy id = `legacy-` + sha1(user|hospital|month|create_at|reg_ymd) 앞 24자, 상세 조회 시 같은 규칙으로 다시 찾는다(idx 오름차순).
- `GET /v1/edi/submissions/:id`: 사진 seq 순. edi 행이 없으면 missing. 현재 `edi.aws_url` 기준으로 이미지 서명 URL 생성.
- `GET /v1/files/:token`: 토큰(HMAC-SHA256, 만료 1시간, payload {k:'u'|'e', id, v:'thumb'|'full', u:usrId})을 검증 →
  'u' = 업로드 원장의 object/thumb 키를 저장소에서 읽어 전송. 'e' = edi 행(소유 확인) → aws_url 이 앱 저장소 키면 저장소에서, `LEGACY_IMAGE_URL_PREFIXES` 로 시작하는 https 면 서버가 가져와 전달(10MB·10초 제한), `edi_image`(data URL bytea)면 디코드해 전달, 그 외 404.
  응답 `Cache-Control: private, max-age=3600`, `Content-Type: image/jpeg` 등.
- `scripts/cleanup-uploads.ts`: 24시간 넘은 PENDING 업로드의 객체 삭제 후 DELETED 처리(기본 dry-run, `--apply` 필요).

### 5.8 테스트(필수, PGlite)
로그인(bcrypt/MD5/CP949/apr_yn 각 상태/잘못된 비번), 의약품 검색·페이지, 공지 정렬·정화(XSS 제거), 거래처 등록 검증·중복·소유 범위,
EDI: 1장·30장 성공, 31장 400, seq 불연속 400, 업로드 재시도 reused, 제출 재시도 replayed(행 수 불변), 같은 키 다른 내용 409,
타인 uploadId 422, 승인대기 거래처 409, is_edi 차단 403, 제출 후 내역 순서 = seq, edi 행 값(§2.5) 검증, 관리자가 edi 행 삭제 후 내역 missing.

## 6. 앱 명세 (`ckp-app`)

### 6.1 라우트 (Expo Router, `src/app`)
```
_layout.tsx                 루트: GestureHandlerRootView, SafeAreaProvider, QueryClientProvider, AuthProvider, StatusBar
                            Stack: (app) 보호(Stack.Protected guard=로그인됨) / login 공개
login.tsx                   로그인 (앱형 디자인: 그라데이션 로고 영역 + 아이콘 중심 카드, 안내 문장 없음, 회원가입 버튼, 계정 문의는 ? 아이콘 대화상자)
signup.tsx                  회원가입(가입 신청) — 공개 화면. features/auth/SignupScreen.tsx
(app)/_layout.tsx           반응형 셸: expo-router JS Tabs + 커스텀 tabBar (모바일 하단 5탭 / 넓은 웹 좌측 사이드바), initialRouteName 'home'
(app)/home/_layout.tsx      Stack  ─ index.tsx(첫 화면, 홈 · 메인 메뉴)
(app)/medicines/_layout.tsx Stack  ─ index.tsx(목록·검색) · [code].tsx(상세)
(app)/notices/_layout.tsx   Stack  ─ index.tsx · [idx].tsx
(app)/edi/_layout.tsx       Stack  ─ index.tsx(등록 내역, "새 EDI 등록" 버튼) · new.tsx(3단계 등록) · [id].tsx(제출 건 상세)
(app)/clients/_layout.tsx   Stack  ─ index.tsx · new.tsx(등록) · [idx].tsx(상세)
(app)/account.tsx           계정(보조 화면, 탭 아님): 사용자 정보, 연결 서버/모드, 로그아웃 — 헤더 우측 아이콘/사이드바 하단에서 진입
index.tsx                   → /home 으로 Redirect (로그인 직후 첫 화면도 /home)
+not-found.tsx              한국어 안내
```
- 탭 5개 순서: 홈 · 의약품 · 공지사항 · EDI 등록 · 거래처 (홈 아이콘: Ionicons home / home-outline). 별도 대시보드/통계/채팅/주문/결제 없음.
- **변경 기록**: 초기 명세는 "첫 화면 = 의약품" 이었으나, 사용자 요청("메인 메뉴도 있음 좋겠으")으로 **홈(메인 메뉴) 탭을 첫 탭·첫 화면**으로 추가했다(이 요청이 이전 명세보다 우선).
  홈은 업무 바로가기만 둔다(사용자 선택): 인사말 한 줄(`김영업님, 안녕하세요`, 이름이 없으면 `안녕하세요`) + 큰 바로가기 4개(모바일 2×2 / 넓은 웹 4열 —
  의약품 "의약품 검색", 공지사항 "공지 확인", EDI 등록 "등록 내역·새 등록", 거래처 "거래처 조회·등록", 높이 ≥ 88) + "새 EDI 등록" 버튼 1개. 통계·차트·공지 미리보기·최근 목록은 두지 않는다.
  바로가기는 탭 바와 같이 이탈 확인(confirmLeave)을 거쳐 해당 탭의 첫 화면으로 이동한다. "새 EDI 등록"은 EDI 스택에 작성 화면이 이미 있으면 그 화면으로 돌아간다(중복으로 쌓지 않음). 모드 배너는 홈에도 표시.
- 넓은 화면 기준: 웹이고 창 너비 ≥ 1024. (web.output = single 이므로 정적 렌더 하이드레이션 문제 없음)
- 탭 이동 가드: EDI 작성 중(사진 있음/입력 있음) 또는 업로드 중에 다른 탭·뒤로가기·새로고침(웹 beforeunload) 시 확인 대화상자.
  업로드 진행 중이면 "업로드가 진행 중입니다. 화면을 나가도 업로드는 계속되지만 등록 완료 전까지 앱을 종료하지 마세요." 안내 후 선택.

### 6.2 디자인 토큰 (`src/theme`)
- 색: primary `#0873B9`(로고 블루 기반, 흰 글자 대비 ≥4.5), primaryStrong `#065A91`, primarySoft `#E6F2FA`, teal `#0AB6C2`, tealSoft `#E3F7F8`,
  navy(본문) `#0F2342`, textSecondary `#51627D`, textMuted `#7A8AA3`, border `#DFE5EE`, divider `#EDF1F6`, bg(밝은 회색) `#F3F5F8`, card `#FFFFFF`,
  accent(노랑·오렌지, 제한적 사용) `#FDA100` / accentSoft `#FFF4DB` / accentText `#8A5300`, success `#0E8A5F`/`#E4F5EE`, danger `#C8323B`/`#FCEBEC`, warning `#8A5300`/`#FFF4DB`,
  sidebar/navy 배경 `#0F2342`(로고 흰 글자 가독), sidebar 선택 `#1B3558`.
- 간격 4의 배수(4,8,12,16,20,24,32). 카드 radius 14, 입력/버튼 radius 10, 배지 radius 999.
- 입력창 높이 48, 버튼 높이 48(큰 버튼 52), 최소 터치 영역 44×44. 본문 16, 보조 14, 캡션 12, 제목 20~24 굵게.
- 그림자 최소(카드 1dp 수준), 테두리 1px border 색.
- 로고: 로고 비율 유지. 전체 로고(`logo_full.png`, 흰 글자 포함)는 **네이비 배경에만** 배치(로그인, 사이드바). 밝은 배경(모바일 헤더)에는 심볼(`logo_symbol.png`) + "CKP" 네이비 텍스트.

### 6.3 공통 UI (`src/components/ui`)
Screen(안전영역·배경·키보드 회피), AppHeader(심볼 로고 + 제목 + 우측 작업 버튼, 넓은 화면에서는 사이드바가 로고 담당), Button(primary/secondary/ghost/danger, loading, disabled), IconButton,
TextField(라벨·필수 표시 `*`·도움말·오류 메시지(입력란 아래, danger 색, accessibilityLiveRegion)), SearchBar(지우기 버튼, 제출/디바운스), Card, Badge(tone: neutral/primary/success/warning/danger/accent),
SegmentedControl, ListRow, EmptyState / NoResults / ErrorState(재시도 버튼) / LoadingState(스켈레톤 또는 스피너 + 문구), ConfirmDialog(웹·네이티브 공통 모달), Toast,
ModeBanner(샘플 모드/개발 서버 표시), FormScroll(KeyboardAvoidingView + ScrollView, keyboardShouldPersistTaps='handled', 하단 고정 버튼이 키보드에 가리지 않음 — 헤더·배너 아래 위치를 창 기준으로 재서 keyboardVerticalOffset 자동 적용).
- 모든 문구 한국어. 접근성 라벨 제공. 웹에서 hover/focus 스타일, 키보드 포커스 가능.

### 6.4 데이터 계층 (`src/lib`)
- `api/contract.ts`(타입), `api/client.ts`(인터페이스 `CkpApi`), `api/http.ts`(실서버 구현: fetch JSON, 401 시 refresh 1회 후 재시도, 타임아웃 20초, 오류 → `ApiError{code,message,fields,status}`; 네트워크 오류 `네트워크에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.`),
  `api/upload.ts`(XHR multipart: 진행률, 타임아웃 90초, abort; native 는 FormData `{uri,name,type}`, web 은 Blob), `api/sample/*`(샘플 구현: 메모리 데이터, 150~500ms 지연, 계정 화면에서 "업로드 실패 흉내" 토글).
- `config.ts`: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_MODE`(live|sample). base URL 없으면 sample.
- `auth/`: AuthProvider(부팅 시 토큰 복원 → me), 토큰 저장소(native SecureStore / web 메모리 + 쿠키 refresh).
- React Query: staleTime 30초, 목록 useInfiniteQuery, 재시도 1회(4xx 제외).

### 6.5 화면별 요구
- **홈**(첫 화면): §6.1 참고.
- **의약품**: 상단 SearchBar(placeholder `의약품명으로 검색`) + 검색 기준 SegmentedControl(의약품명·제약사·보험코드·전체). 모바일 카드(이름 굵게, 제약사·포장/규격·보험코드, 약가·수수료는 값 있을 때만), 넓은 화면은 표(제품명, 제약사, 포장·규격, 보험코드, 약가, 수수료).
  무한 스크롤 + "N건". 상세: 확인된 필드만(값 없으면 행 자체 숨김). 로딩/검색결과 없음(`'xxx'에 대한 검색 결과가 없습니다.`)/오류 재시도.
- **공지사항**: 중요 공지 상단 고정(중요 배지 accent), 제목·작성일. 제목 검색. 상세: 제목, 작성일, 작성자, 본문 HTML(@native-html/render, 이미지 폭 맞춤, 링크는 https/mailto/tel 만 열기), 첨부 없으면 영역 숨김.
- **거래처**: 목록(이름, 승인 배지: 승인대기 accent / 승인 success, 대표자·주소·전화), 검색, "거래처 등록" 버튼. 등록 폼: 필수 `*` 표시, 입력란 아래 오류, 사업자번호 자동 하이픈·blur 시 중복/유효성 확인, 연락처 자동 하이픈, 저장 버튼 하단 고정(키보드 위).
  등록 성공 → 상세로 이동 + "등록되었습니다. 관리자 승인 후 EDI 등록에 사용할 수 있습니다." (승인 필요 설정일 때). 상세: 모든 값 + "이 거래처로 EDI 등록" 버튼(선택 가능할 때).
- **EDI 등록 내역**(EDI 탭 첫 화면): 등록월 이동(◀ 2026년 9월 ▶), 제출 건 카드(거래처, 대상월 라벨, 사진 N장, 등록 시각, 상태 요약 배지, 첫 사진 썸네일). 상세: 요약 + 사진 그리드(seq 배지 1..N, 서버 순서 그대로) + 확대 보기.
- **EDI 새 등록** — §7.

## 7. EDI 사진 등록 흐름 (가장 중요)

### 7.1 상태 (zustand `useEdiDraft`, 탭 전환에도 유지)
```
draft = { idempotencyKey(uuid), client:{idx,name}|null, targetYm|null, memo,
          photos: Photo[], phase: 'editing' | 'submitting' | 'done', result?: EdiSubmissionDetail, sample?: boolean }
Photo = { localId(uuid = clientPhotoId), sourceName, sourceUri, width, height, bytes,
          state: 'processing' | 'ready' | 'invalid',
          processed?: { uri, width, height, bytes, thumbUri }, invalidReason?,
          upload: { state: 'idle'|'queued'|'uploading'|'uploaded'|'failed', progress 0..1, uploadId?, error?, attempts } }
```
- 사진 배열 순서 = 화면 순번(1..N). 삭제·이동 즉시 번호 재계산(배열 인덱스+1).
- `invalid` 사진은 합계에 포함하지 않으며 이유를 표시하고 "제거" 버튼 제공(설명 없이 버리지 않음).

### 7.2 단계
1. **기본 정보**: 거래처 검색·선택(내 거래처 목록; 선택 불가 항목은 흐리게 + "승인 대기" 사유), 대상 연월(month-options 3개 버튼, 기본 당월), 메모(선택, 500자 카운터). EDI 차단 상태면 상단 경고 + 다음 단계 불가.
2. **사진 선택·순서**: 헤더 `선택한 사진 12 / 30` 카운터. 버튼: 앨범에서 선택 / 카메라로 촬영(웹: 파일 선택·촬영 input) / (웹) 드래그 앤 드롭 영역.
   - 앨범: `launchImageLibraryAsync({ mediaTypes:['images'], allowsMultipleSelection:true, selectionLimit: 남은 수, orderedSelection:true, quality:1, exif:false, preferredAssetRepresentationMode: Compatible })`.
     취소 → 아무 변화 없음(안내 없음). 권한 거절 → 설정 이동 안내.
   - **남은 수보다 많이 가져온 경우(웹 등)**: 초과 안내 시트 — `선택한 사진 35장 중 18장만 더 추가할 수 있습니다(최대 30장).` 옵션: [앞에서부터 18장 추가] / [직접 고르기(체크 해제로 초과분 제거, 18장 이하가 되어야 추가 가능)] / [취소하고 다시 선택]. 절대 조용히 버리지 않는다.
   - 가져온 순서 = 초기 순서(뒤에 이어 붙임). 선택 즉시 썸네일 자리 표시 후 처리(동시 2장): 형식 확인 → HEIC 변환(웹) → `ImageManipulator.manipulate(uri).resize(긴 변 2560 초과 시)` → `renderAsync()` → `saveAsync({format: JPEG, compress: 0.85})` + 썸네일(긴 변 360, 0.7).
   - 그리드(모바일 3열, 넓은 화면 5~6열): 썸네일 + **순번 배지** + 삭제(×) + 앞으로/뒤로 이동 버튼(접근성 라벨 `3번 사진을 앞으로 이동`). 드래그 재정렬(react-native-sortables Grid, 길게 눌러 드래그, 웹은 짧은 지연). 사진 탭 → 확대 보기(좌우 넘김, 순번 표시, 닫기).
   - 목록 방식 보기 전환(선택): 순번·파일명·크기·[맨 앞][앞][뒤][맨 뒤] — 키보드/스크린리더용.
3. **확인·등록**: 요약(거래처, 대상 연월, 메모, 사진 수, 최종 순서 썸네일 스트립 1..N). 하단 고정 버튼 `사진 12장 등록하기`.
   - 누르면 phase=submitting(모든 편집 잠금, 버튼 비활성 + 중복 탭 가드 ref).
   - 업로드: 미업로드 사진만 동시 3장, 사진별 진행률·상태(대기/업로드 중 %/완료/실패), 전체 진행률 바(완료 장수/전체 + 바이트 기준). 네트워크성 실패는 자동 재시도 2회(1s, 3s), 이후 실패 표시.
   - 하나라도 실패 → phase=editing 으로 복귀(입력·사진 유지), `사진 2장 업로드에 실패했습니다.` + [실패한 사진만 다시 시도] 버튼(업로드 완료분은 재전송하지 않음).
   - 모두 업로드 → `POST /v1/edi/submissions`(Idempotency-Key = draft.idempotencyKey). 응답이 불확실(네트워크 오류/타임아웃/5xx)하면 **편집 잠금 유지**하고 같은 요청을 재시도(자동 2회 후 [다시 시도] 버튼) — 내용이 바뀌지 않으므로 서버가 중복 생성하지 않는다.
     4xx 확정 실패(거래처 선택 불가, 차단 등)는 메시지 표시 후 편집 복귀. UPLOAD_NOT_FOUND 면 해당 사진 uploadId 초기화 후 재업로드 유도.
   - 201/200 수신 후에만 완료 화면: `EDI 등록이 완료되었습니다` + 거래처·대상월·사진 N장 + 서버가 돌려준 순서 그리드(서버 seq) + [등록 내역 보기] [새 EDI 등록]. 샘플 모드면 "샘플 모드: 실제 서버에 저장되지 않았습니다".
   - 완료 후 새 등록 시 draft 초기화(새 idempotencyKey).

### 7.3 플랫폼 처리
- 카메라: native `requestCameraPermissionsAsync` → `launchCameraAsync({ quality:1, exif:false })`; web 은 `<input type=file accept="image/*" capture="environment">`(모바일 브라우저 카메라, 데스크톱은 파일 선택).
- 웹 드래그 앤 드롭: 드롭 영역(점선 박스 `여기로 사진을 끌어다 놓으세요`), `dragover` 강조, image/* 외 파일은 "지원하지 않는 형식" 목록으로 안내.
- 업로드 전송: XHR. native FormData `{ uri, name, type:'image/jpeg' }`, web 은 처리된 Blob.
- 메모리: 원본은 그리드에 렌더하지 않는다(썸네일 URI 만), 확대 보기에서만 처리본 표시. 처리 동시성 2.
- 웹 blob URL 은 사진 제거/초기화 시 revoke.

## 8. 실행/빌드 (요약 — 자세한 내용은 README)
- 서버 개발: `cd ckp-server && cp .env.example .env && npm run dev` (DEV_DB=pglite 로 즉시 실행, 로그인 샘플 계정 안내 출력)
- 앱: `cd ckp-app && npx expo start` (웹 `w`, Android/iOS 는 Expo Go 또는 개발 빌드). `EXPO_PUBLIC_API_BASE_URL=http://<PC IP>:4000`.
- 웹 배포: `npx expo export -p web` → dist(SPA, 모든 경로 index.html 로 rewrite).
- 네이티브 배포: EAS Build (`npx eas-cli build -p android|ios`).

## 9. 확인되지 않은 사항 (운영 전 확정 필요)
0. **회원가입 접수 여부**: 서버가 운영 DB 를 가리키면 앱의 가입 신청이 운영 `sys_app_usr_mng` 에 승인 대기 행으로 바로 저장된다. 아직 받지 않으려면 `SELF_REGISTRATION_ENABLED=false`. 개인정보 동의 문구(`PrivacyConsent.tsx`)는 회사 확정 필요.
1. cso_ckp 접속 계정/권한(앱 서버용 최소 권한 계정 권장: 대상 테이블 SELECT + edi INSERT + ckp_app_* 소유).
2. cso_ckp 실제 스키마: `edi.is_copy`, `mannager_by_hospital.hospital_type`, `sys_app_usr_mng` 컬럼, `is_edi` 행 구조 → `npm run db:check` 로 확인.
3. `usr_pwd` 해시 형식 분포(bcrypt/MD5/기타), 관리자 JVM 인코딩(CP949 여부).
4. 사진 저장소: 기존 `edi-img` 버킷 사용 여부·앱 전용 접두어(`uploads/users/ckp/`) 허용·공개 읽기 정책·IAM 최소 권한. 로컬 저장소 사용 시 관리자 화면에서 사진이 보이지 않는다.
5. `deal_type` 값(앱 등록분 '기존' 유지 여부), 월 라벨 의미(당월=직전 달) CKP 에서도 동일한지.
6. 신규 거래처 승인 전 EDI 사용 허용 여부(`CLIENT_APPROVAL_REQUIRED_FOR_EDI`).
7. 의약품 수수료 노출 여부와 `frees` 설정.
8. 메모를 관리자 화면에 표시하려면 관리자 수정 필요(현재 관리자는 ckp_app_* 를 읽지 않음).
9. 관리자 메뉴가 구 `/appManagement/ediMangement`(edi_image 만 표시) 를 쓰고 있지 않은지.
11. 담당자 매칭: `sys_app_usr_mng.usr_id = manager.user_id = mannager_by_hospital.user_id = edi.user_id`. 승인 사용자 로그인·토큰 재발급·거래처/EDI 등록 시 누락된 `manager` 행을 추가한다. 기존 `manager.name/company/manager`는 덮어쓰지 않는다. 기존 승인 사용자는 `npm run db:match-managers -- --apply`로 일괄 매칭한다. 이름 유사도로 소유자를 추정하거나 다른 계정 거래처를 재배정하지 않는다.
12. `mannager_by_hospital.address` 는 100자(도로명 주소+상세주소에 짧을 수 있음) — 실제 컬럼 길이 확인.
13. API 서버 전용 최소 권한 DB 계정(권장 권한은 docs/OPERATIONS.md).
10. 참고 코드에 평문 비밀값(DB 비밀번호, AWS 키, AI API 키 등)이 커밋되어 있음 → 교체 권장. 이 저장소에는 복사하지 않았다.

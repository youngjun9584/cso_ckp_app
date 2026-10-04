# CKP 운영 연동 체크리스트

이 저장소는 **개발 DB(PGlite)·로컬 사진 저장소**로 검증했다. 운영 cso_ckp DB 와 사진 저장소에는 한 번도 연결하지 않았다.
아래 순서대로 확인·설정한 뒤 운영 연결을 진행한다.

## 1. DB 확인 (읽기 전용, DBA)

1. 앱 서버 전용 계정 발급 (권장 최소 권한)
   - `SELECT`: `medicine`, `notice`, `frees`, `is_edi`
   - `SELECT (usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn, role_id, classification, coalition_company)` on `sys_app_usr_mng` (열 단위 권한)
   - `SELECT, INSERT` on `mannager_by_hospital`, `edi`, `manager` (+ 각 `idx` 시퀀스 `USAGE`). `manager.user_id`는 PK/UNIQUE여야 한다. 로그인 시 담당자 자동 매칭에 필요하다.
   - `SELECT, INSERT, UPDATE, DELETE` on `ckp_app_*` (마이그레이션 후)
   - DDL 권한은 주지 않는다(마이그레이션은 DBA 계정으로 1회 실행).
2. `ckp-server/.env` 에 `DATABASE_URL=postgres://<계정>:<비밀번호>@<호스트>:5432/cso_ckp?sslmode=require` 설정 (비밀번호는 저장소에 커밋하지 않는다).
3. `npm run db:check` — 필요한 테이블/컬럼, 선택 컬럼(`edi.is_copy`, `mannager_by_hospital.hospital_type`), `ckp_app_*` 존재 여부를 읽기 전용으로 보고한다.
4. 추가로 확인할 데이터 (DESIGN.md §9):
   - `usr_pwd` 형식 분포: `SELECT CASE WHEN usr_pwd ~ '^\$2[aby]\$' THEN 'bcrypt' WHEN usr_pwd ~ '^[0-9a-f]{32}$' THEN 'md5' ELSE 'other' END k, count(*) FROM sys_app_usr_mng GROUP BY 1;`
   - `SELECT * FROM is_edi;` (행 구조와 값)
   - `SELECT deal_type, month, is_copy, count(*) FROM edi GROUP BY 1,2,3;` (현재 EDI 기록 관례 확인)
   - `SELECT approval, count(*) FROM mannager_by_hospital GROUP BY 1;`
   - `SELECT * FROM frees;` (수수료 표시 열)
   - `SHOW timezone;`
   - 관리자 메뉴가 `/lab/ediMangement` 를 쓰는지 (`SELECT * FROM sys_prgr_mng WHERE prgr_url LIKE '%ediMangement%';`)

## 2. 마이그레이션 (DBA, 백업 후)

담당자 연결은 `sys_app_usr_mng.usr_id = manager.user_id` 기준이다. 승인된 사용자 로그인·토큰 재발급 및 거래처/EDI 등록에서 빠진 담당자를 자동 추가한다. 기존 담당자의 이름·회사·본사 담당자 지정 값은 유지한다. `manager.manager`는 관리자 화면의 별도 지정 필드이며 로그인 ID를 덮어쓰는 칸이 아니다.

기존 승인 사용자를 한 번에 연결하려면 `DATABASE_URL` 설정 후 아래 명령을 실행한다.

```bash
npm run db:match-managers             # 매칭 현황만 조회
npm run db:match-managers -- --apply  # 빠진 승인 사용자 manager 행 추가
```

보고서의 `missingManagers`는 승인 사용자 중 담당자 행이 없는 수, `orphanManagers/orphanClients/orphanEdi`는 해당 로그인 ID가 없는 행 수다. 고아 데이터는 ID를 확인해 처리해야 하며 자동 재배정하지 않는다. 의약품·공지사항은 기존 공용 조회 범위를 유지하고, 거래처·EDI·사진은 인증된 사용자 ID 범위를 유지한다.

```bash
cd ckp-server
npm run db:migrate            # 적용 계획만 출력
npm run db:migrate -- --yes   # 001_ckp_app_edi.sql(필수)·002_ckp_app_refresh_token.sql(선택) 적용 (기존 테이블은 변경하지 않음, 001만: -- --yes --only=001)
npm run db:check              # 다시 확인 → 서버 재시작(기능 확인 결과는 시작 시 1회 읽음)
```

- 추가되는 테이블: `ckp_app_edi_upload`, `ckp_app_edi_submission`, `ckp_app_edi_submission_photo` (002 선택: `ckp_app_refresh_token` — 없으면 refresh 토큰은 무상태, 롤백 `migrations/002_ckp_app_refresh_token.rollback.sql`)
- 롤백: `migrations/001_ckp_app_edi.rollback.sql` (앱 전용 테이블만 삭제, `edi` 행과 사진 파일은 남음)
- 마이그레이션 전에는 의약품·공지·거래처는 동작하고, EDI 등록/내역은 `503 SCHEMA_NOT_READY` 로 명확히 실패한다.

## 3. 사진 저장소

관리자 화면·OCR 은 `edi.aws_url` 을 **서명 없이** 직접 읽는다. 관리자에서 앱 등록 사진이 보이려면 기존 규칙과 같아야 한다.

| 항목 | 값 |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` / `S3_REGION` | 기존 EDI 버킷(참고 코드 기준 `edi-img` / `ap-northeast-2`) — **운영 담당자 확인 필요** |
| `S3_KEY_PREFIX` | `uploads/users/ckp` (키: `…/edi/YYYYMM/<uuid>.jpg`, 썸네일 `_thumb.jpg`) |
| 버킷 정책 | 관리자·OCR 을 위해 기존과 같은 익명 GET 허용 여부 확인 |
| IAM | 앱 서버 전용: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/uploads/users/ckp/*` |
| `LEGACY_IMAGE_URL_PREFIXES` | `https://<bucket>.s3.<region>.amazonaws.com/` (관리자 crop·이전 등록 사진 조회 허용) |

- 사진은 서버를 거쳐 업로드되므로 버킷 CORS 변경은 필요 없다.
- `STORAGE_DRIVER=local` 로 운영하면 관리자 화면에서 사진이 보이지 않는다(개발 전용).
- 미사용 업로드 정리: 매일 1회 `npm run cleanup:uploads -- --apply` (24시간 지난 PENDING 업로드 삭제). 예: Windows 작업 스케줄러 / cron.

## 4. 서버 배포

```bash
cd ckp-server
npm ci
npm run build
NODE_ENV=production npm start      # .env 또는 환경변수로 설정
```

- 필수: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `FILE_TOKEN_SECRET`(각 32자 이상 무작위, 서로 다른 값), `CORS_ORIGINS`(웹 앱 주소), `COOKIE_SECURE=true`.
- HTTPS 는 앞단 프록시(ALB, Nginx 등)에서 종료하고 `TRUST_PROXY=1`(앞단 프록시 수) 또는 프록시 IP/CIDR(예: `TRUST_PROXY=10.0.0.0/8`)로 설정한다. `TRUST_PROXY=true` 는 클라이언트가 보낸 X-Forwarded-For 를 그대로 믿게 되므로 운영에서는 기동이 거부된다.
- 기동 로그에 스키마 확인 결과(선택 컬럼·앱 테이블 유무)가 한국어로 출력된다.
- 업무 설정: `CLIENT_APPROVAL_REQUIRED_FOR_EDI`(기본 true — 승인 전 거래처 EDI 불가), `MEDICINE_FEE_VISIBLE`(기본 true), `EDI_DEAL_TYPE`(기본 `기존`).

## 5. 앱 배포

- 웹: `ckp-app/.env` 에 `EXPO_PUBLIC_API_BASE_URL=https://<API 주소>`, `EXPO_PUBLIC_API_MODE=live` → `npx expo export -p web` → `dist/` 를 정적 호스팅(모든 경로를 `index.html` 로 rewrite).
- Android/iOS: EAS Build (`npx eas-cli@latest build -p android` / `-p ios`). 첫 빌드 전 `npx eas-cli@latest init` 으로 프로젝트를 연결하고 `app.json` 의 `android.package` / `ios.bundleIdentifier`(현재 `com.ckp.app`)를 회사 값으로 확정한다. iOS 는 Apple 개발자 계정이 필요하다.
- 네이티브 기능(카메라·앨범·HEIC·드래그 정렬·키보드)은 **실기기에서 반드시 확인**한다(이 환경에는 Android/iOS 기기·에뮬레이터가 없어 번들 빌드까지만 확인함).

## 4-1. 기존 EDI 사진이 앱에서 안 보일 때

- 증상: EDI 등록 내역/상세에서 사진이 비어 보이고 `/v1/files/...` 가 404.
- 원인 1 (설정): `LEGACY_IMAGE_URL_PREFIXES` 가 비어 있으면 서버가 기존 S3 주소(`edi.aws_url`)를 가져오지 않는다. → `https://edi-img.s3.ap-northeast-2.amazonaws.com/` 로 설정 후 **서버 재시작**(`.env` 는 시작 시 1회만 읽음). 2026-09-27 확인: 버킷은 익명 GET 허용, 설정 후 썸네일·원본 모두 200.
- 원인 2 (데이터): 앱은 `edi.user_id` 가 **로그인 아이디와 같은** 행만 보여준다. 운영 cso_ckp 확인(읽기 전용) 결과 `sys_app_usr_mng` 에는 로그인 계정이 1개(`ckp901`)뿐이고, EDI 403건 중 118건만 이 계정 소유였다. 나머지 285건의 `user_id`(예: `장윤희`, `J고병효`, `ckp903`)는 `manager` 테이블의 담당자 이름/코드일 뿐 로그인 계정이 아니므로 어떤 사용자로도 볼 수 없다. → 담당자별 로그인 계정을 만들고 `usr_id` 를 기존 `edi.user_id` 값과 맞추거나, 관리자 화면에서 담당자를 재지정해야 한다(업무 결정 필요).

## 5-1. 회원가입 접수

- 앱 로그인 화면의 회원가입은 `POST /v1/auth/register` 로 `sys_app_usr_mng` 에 `apr_yn='N'`(승인 대기), `role_id=R0004`, bcrypt 비밀번호로 저장한다. 관리자 승인 전에는 로그인되지 않는다.
- 접수를 받지 않으려면 `SELF_REGISTRATION_ENABLED=false` (앱의 가입 버튼도 숨겨짐). 역할 코드는 `REGISTER_ROLE_ID`, 제한은 `REGISTER_IP_MAX_PER_10MIN`·`REGISTER_MAX_PER_HOUR`.
- 개인정보 수집·이용 동의 문구는 `ckp-app/src/features/auth/PrivacyConsent.tsx` — 회사 확정 후 반영.

## 6. 보안 권고 (참고 코드에서 발견)

참고 프로젝트에 DB 비밀번호, AWS 키, AI API 키가 평문으로 커밋되어 있다(`nextApp/.env`, Java `globals.properties`·`AwsS3Config.java`·컨트롤러 등).
이 저장소에는 복사하지 않았다. 교체(rotate)를 권장한다. Java 관리자 JSON 엔드포인트 다수가 인증 없이 호출 가능하므로 앱은 관리자 API 를 호출하지 않는다.

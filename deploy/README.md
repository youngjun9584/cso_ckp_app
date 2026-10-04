# CKP 웹 우선 배포 / Android·iOS 빌드 준비

현재 상태: 배포용 설정을 작성한 단계입니다. 공개 주소에 배포하지 않았습니다. 실제 서버·도메인, DB 계정, 사진 저장소, Expo 계정이 필요합니다. 현재 PC에는 Docker CLI가 없어 컨테이너 실행은 검증하지 못했습니다.

## 1. 배포 구조

하나의 도메인(예: `https://실제도메인`)에서 Caddy가 HTTPS와 웹 정적 파일을 제공합니다. `/v1/*`만 내부 API 서버로 전달합니다. 웹과 API가 같은 출처이므로 별도 도메인 간 로그인 쿠키 설정이 필요 없습니다. Android/iOS도 같은 HTTPS 주소를 사용합니다.

- 웹: `ckp-app`, Expo 정적 SPA
- API: `ckp-server`, Node 24 / Fastify
- DB: 기존 PostgreSQL(RDS), 컨테이너 안에 새 DB를 만들지 않음
- 이미지: 운영 S3 저장소, 기존 관리자와 호환성 확인 필요
- 외부 공개 포트: 80/443. API의 4000 포트는 외부에 노출하지 않음
- 인증서: Caddy 자동 발급·갱신. 인증서 볼륨을 유지해야 합니다.

## 2. 운영 서버에 준비할 것

Docker Engine + Compose 플러그인이 있는 Linux 서버를 준비합니다. 도메인의 A 레코드를 서버 IP로 연결하고, AAAA 레코드가 있다면 실제 IPv6 주소와 일치시킵니다. 80/443은 웹 접속을 허용하고, RDS 5432는 앱 서버에서만 접속하도록 설정합니다. 기존 서비스가 80/443을 사용 중이면 이 구성으로 바로 실행하지 말고 기존 프록시에 웹 정적 파일과 `/v1/*` 경로를 연결하세요.

프로젝트 전체를 서버로 복사하되 로컬 `.env`, `node_modules`, `.data`, 개인 키 파일은 제외하세요. 프로젝트 루트에서:

```bash
cp deploy/.env.example deploy/.env
cp deploy/.env.server.example deploy/.env.server
chmod 600 deploy/.env deploy/.env.server
```

Windows에서 설정 파일만 준비할 때:

```powershell
Copy-Item deploy/.env.example deploy/.env
Copy-Item deploy/.env.server.example deploy/.env.server
```

`deploy/.env`의 `APP_DOMAIN`에 실제 도메인만 입력합니다. `deploy/.env.server`의 `REPLACE_...` 값은 모두 실제 값으로 바꿉니다. DB URL의 아이디·비밀번호에 `@`, `#`, `:` 등 특수문자가 있으면 URL 인코딩하세요.

서명 비밀키는 아래 명령을 두 번 실행해 **각기 다른 값**으로 설정합니다(운영 터미널에서만 실행하고 외부에 공유하지 않음).

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

S3는 기존 관리자 화면의 사진 URL 규칙을 먼저 확인합니다. 설정 파일은 버킷을 만들거나 공개 정책을 변경하지 않습니다. IAM 역할 사용 시 컨테이너에서 역할 자격 증명을 읽을 수 있는지 확인하세요. 최소 권한과 기존 URL 호환성은 `docs/OPERATIONS.md`를 따릅니다.

## 3. 설정 확인과 빌드

프로젝트 루트에서 실행합니다. `check-config.mjs`는 값을 출력하지 않고 형식만 검사합니다.

```bash
node deploy/check-config.mjs
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build
```

이미지에는 `.env`와 DB 비밀번호가 복사되지 않습니다. 웹 이미지에는 공개 API 주소만 포함됩니다. 잘못된 예시 주소, HTTP 주소, 샘플 모드로는 운영 웹 빌드가 실패합니다.

## 4. 실제 DB 확인 → 필요한 마이그레이션

운영 데이터를 변경하기 전에 읽기 전용 검사를 수행합니다.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm api node dist/scripts/db-check.js
```

앱 전용 테이블이 없다면 `docs/OPERATIONS.md`의 백업·DBA 검토 절차에 따라 준비합니다. **컨테이너 시작 시 마이그레이션을 자동 실행하지 않습니다.**

```bash
# 계획 확인
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm api node dist/scripts/db-migrate.js
# 승인된 계획만 적용. 일반 앱 DB 계정 대신 적절한 권한의 계정 필요.
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm api node dist/scripts/db-migrate.js --yes
```

## 5. 웹과 API 실행

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 100 api web
```

브라우저에서 다음을 확인하세요.

1. `https://실제도메인/login` 접속과 새로고침이 정상인지
2. `https://실제도메인/v1/meta`에서 운영 데이터 출처가 표시되는지
3. 실제 계정 로그인 후 의약품·공지·거래처 조회가 가능한지
4. 허가된 시험 거래처로 사진 1장/30장 제출, 사진 순서와 관리자 조회가 일치하는지
5. 로그아웃·재로그인, 업로드 재시도 동작

`/v1/meta` 헬스체크는 프로세스 응답 확인용입니다. DB·S3의 실제 작업 성공을 대신하지 않습니다.

웹/API 갱신은 검증한 소스 버전을 서버에 반영한 뒤 `build`, `up -d`를 다시 실행합니다. 이전 소스 버전과 이미지 ID를 보관하고 문제가 생기면 이전 버전을 다시 실행하세요. DB 스키마 변경은 별도 롤백 검토가 필요합니다. `down -v`는 인증서 볼륨까지 지우므로 사용하지 않습니다. 미사용 업로드 정리는 기존 `cleanup:uploads` 절차를 따릅니다.

## 6. Android / iOS 준비

`ckp-app/eas.json`에 두 프로필을 준비했습니다.

| 프로필 | 용도 |
|---|---|
| preview | 내부 시험 배포. Android APK, iOS 등록 기기용 빌드 |
| production | Google Play AAB / App Store·TestFlight용 빌드, 빌드 번호 자동 증가 |

Expo 계정에 로그인하고 이 회사 프로젝트에 연결하세요. Google/Apple 스토어 업로드는 별도 개발자 계정과 서명이 필요합니다.

```bash
cd ckp-app
npx eas-cli@latest login
npx eas-cli@latest init
```

Expo 대시보드 프로젝트의 Environment variables에서 **preview와 production 각각** `EXPO_PUBLIC_API_BASE_URL=https://실제도메인`을 생성하세요(Plain text 공개 변수). `EXPO_PUBLIC_API_MODE=live`는 `eas.json`에 지정되어 있습니다. API 주소에는 `/v1`을 붙이지 않습니다. DB 비밀번호나 AWS 키는 앱 환경변수에 넣지 않습니다.

```bash
# 내부 Android APK
npx eas-cli@latest build --platform android --profile preview
# 내부 iOS: Apple 개발자 계정과 시험 기기 등록 필요
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
# 스토어용 서명 빌드
npx eas-cli@latest build --platform all --profile production
```

설치 후 카메라·사진 접근 권한, HEIC, 30장 선택·정렬, 업로드 실패 재시도를 실기기에서 확인합니다. 앱 이름·식별자(`com.ckp.app`) 소유 여부, 개인정보 처리방침, 스토어 설명·스크린샷·데이터 수집 신고를 확정한 뒤 제출하세요.

```bash
npx eas-cli@latest submit --platform android --profile production
npx eas-cli@latest submit --platform ios --profile production
```

EAS 제출은 스토어 심사 및 최종 공개와 다릅니다. Apple/Google 콘솔에서 시험 배포·심사·출시 상태를 확인해야 합니다. 현재 작업에서 클라우드 빌드나 스토어 제출은 실행하지 않았습니다.

공식 참고: [Expo 빌드](https://docs.expo.dev/build/setup/), [EAS 프로필](https://docs.expo.dev/build/eas-json/), [EAS 환경변수](https://docs.expo.dev/eas/environment-variables/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https).

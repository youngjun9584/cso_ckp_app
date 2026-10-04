# CKP 배포 가이드 (서버 · 웹 · Android · iOS)

> 앱(웹·Android·iOS)은 모두 **API 서버를 통해서만** 동작한다. 지금 서버는 이 PC(`localhost:4000`)에서만 돌고 있어
> 휴대폰이나 다른 사람의 브라우저에서는 접속할 수 없다. 따라서 순서는 **① 서버 → ② 웹 → ③ Android → ④ iOS** 다.
> 운영 DB·사진 저장소 연결 조건은 `docs/OPERATIONS.md` 를 먼저 끝내야 한다.

---

## 0. 배포 전 공통 준비 (한 번만)

| 항목 | 내용 |
|---|---|
| API 도메인 | 예: `https://api.ckp.co.kr` — **HTTPS 필수**. 앱 빌드 스크립트가 `http://`, `localhost`, 사설 IP 를 거부한다(`ckp-app/tools/check-release-env.mjs`). |
| 웹 도메인 | 예: `https://app.ckp.co.kr` — 서버 `CORS_ORIGINS` 에 이 주소를 넣어야 웹 로그인이 된다. |
| 운영 DB | `docs/OPERATIONS.md` §1~2 (앱 전용 계정, `npm run db:check`, `npm run db:migrate -- --yes`) |
| 사진 저장소 | `STORAGE_DRIVER=s3` + 버킷/IAM (`docs/OPERATIONS.md` §3). `local` 로 운영하면 관리자 화면에서 사진이 안 보인다. |
| 비밀키 2개 | `JWT_SECRET`, `FILE_TOKEN_SECRET` — 각각 32자 이상 무작위, 서로 다르게. 생성: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| 계정 | Expo 계정(무료, EAS 빌드용), Google Play 개발자 계정(1회 $25), Apple Developer Program(연 $99) |

---

## 1. 서버 배포 (가장 먼저)

서버는 Node 24 로 동작하는 단일 프로세스다. 방법 A(Docker)를 권장하고, Docker 를 못 쓰면 B(직접 실행)로 한다.

### 운영 환경변수 (`.env` 또는 호스팅의 환경변수 설정)

```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://<앱계정>:<비밀번호>@database-1.c5gx6m1iccdy.ap-northeast-2.rds.amazonaws.com:5432/cso_ckp?sslmode=require
JWT_SECRET=<32자 이상 무작위>
FILE_TOKEN_SECRET=<32자 이상 무작위, JWT_SECRET 과 다르게>
CORS_ORIGINS=https://app.ckp.co.kr
COOKIE_SECURE=true
TRUST_PROXY=1                        # 앞단 프록시(ALB/Nginx) 1대. true 는 거부됨
PUBLIC_BASE_URL=https://api.ckp.co.kr
STORAGE_DRIVER=s3
S3_BUCKET=edi-img
S3_REGION=ap-northeast-2
S3_KEY_PREFIX=uploads/users/ckp
AWS_ACCESS_KEY_ID=<앱 서버 전용 IAM>
AWS_SECRET_ACCESS_KEY=<…>
LEGACY_IMAGE_URL_PREFIXES=https://edi-img.s3.ap-northeast-2.amazonaws.com/
SELF_REGISTRATION_ENABLED=true       # 회원가입 접수 안 받으려면 false
```

운영 모드에서는 필수값이 빠지거나 개발용 키(`dev-only…`)가 섞이면 **서버가 기동을 거부**한다. 잘못 설정된 채로 뜨는 일은 없다.

### 방법 A — Docker (권장, AWS ECS/EC2·Cloud Run·어떤 VPS 든 동일)

`ckp-server/Dockerfile` 이 이미 있다(멀티스테이지, `node` 사용자, 4000 포트).

```bash
cd ckp-server
docker build -t ckp-server:1.0.0 .
docker run -d --name ckp-server --restart unless-stopped -p 4000:4000 --env-file .env ckp-server:1.0.0
curl https://api.ckp.co.kr/v1/meta        # dataSource: "production" 확인
```

> 이 PC 에는 Docker 가 설치돼 있지 않다. 서버 장비(또는 배포 파이프라인)에서 빌드한다.

### 방법 B — 직접 실행 (Node 24 가 있는 리눅스/윈도우 서버)

```bash
cd ckp-server
npm ci
npm run build                 # → dist/  (이 PC 에서 성공 확인함)
NODE_ENV=production npm start # 또는 pm2: pm2 start dist/index.js --name ckp-server
```

### 서버 앞단 (공통)

- HTTPS 는 앞단에서 종료한다: AWS ALB + ACM 인증서, 또는 Nginx + Let's Encrypt. 서버 자체는 HTTP 4000 만 연다.
- 앞단 → 서버로 `X-Forwarded-For` 를 넘기고 `TRUST_PROXY=1` 로 설정(로그인 시도 제한이 실제 IP 기준으로 동작).
- 서버 1대면 충분하다. 단, 로그인 제한 카운터가 메모리에 있으므로 2대 이상으로 늘리면 제한이 대당 적용된다.
- 매일 1회: `npm run cleanup:uploads -- --apply` (24시간 지난 미사용 업로드 정리) — cron 또는 Windows 작업 스케줄러.
- 시작 로그에 "DB 스키마 확인 결과" 가 한국어로 찍힌다. `앱 전용 테이블: 있음` 인지 확인.

---

## 2. 웹 배포 (정적 파일 — 서버 불필요)

웹은 빌드하면 **정적 파일 묶음(SPA)** 이 나온다. 아무 정적 호스팅에 올리면 된다.

```bash
cd ckp-app
# 빌드 시점에 API 주소가 파일 안에 새겨진다 (비밀값 아님, 주소만)
set EXPO_PUBLIC_API_BASE_URL=https://api.ckp.co.kr     # PowerShell: $env:EXPO_PUBLIC_API_BASE_URL='https://api.ckp.co.kr'
set EXPO_PUBLIC_API_MODE=live
npm run check:release          # 주소 검증 (localhost/http 면 여기서 막힘)
npx expo export -p web         # → ckp-app/dist/  (약 5.5MB, 이 PC 에서 성공 확인함)
```

`dist/` 폴더를 통째로 올린다. **반드시 SPA rewrite 설정** — 모든 경로(`/login`, `/edi/…`)를 `index.html` 로 돌려야 새로고침·딥링크가 동작한다.

| 호스팅 | rewrite 설정 |
|---|---|
| **AWS S3 + CloudFront** (추천) | S3 정적 웹 호스팅 → CloudFront Custom error response: 403/404 → `/index.html`, 응답 코드 200 |
| Nginx | `location / { try_files $uri /index.html; }` |
| Vercel | `vercel.json`: `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` |
| Netlify | `_redirects` 파일: `/*  /index.html  200` |

배포 후 확인: `https://app.ckp.co.kr/login` 새로고침 → 로그인 화면, 상단에 "개발 서버" 배너가 **없어야** 정상(운영 모드).

> 웹 로그인은 httpOnly 쿠키를 쓰므로 서버 `CORS_ORIGINS` 에 웹 도메인이 정확히 들어가야 한다. 다르면 로그인 후 바로 풀린다.

---

## 3. Android 배포 (Google Play)

빌드는 **EAS Build(Expo 클라우드)** 로 한다. 이 PC 에 Android Studio 가 없어도 된다. `ckp-app/eas.json` 이 이미 준비돼 있다.

### 3-1. 최초 1회 설정

```bash
cd ckp-app
npx eas-cli login                    # Expo 계정 (현재 로그인 안 된 상태)
npx eas-cli init                     # 프로젝트를 Expo 계정에 연결 (app.json 에 projectId 추가됨)
```

- `app.json` 의 `android.package` = `com.ckp.app` 을 회사 도메인 기준으로 확정한다(예: `kr.co.ckp.app`). **한 번 스토어에 올리면 바꿀 수 없다.**
- 서명 키(keystore)는 EAS 가 만들어 보관한다. 직접 관리하지 않아도 된다.

### 3-2. 운영 API 주소 등록 (빌드마다 쓰임)

```bash
npx eas-cli env:create --scope project --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.ckp.co.kr --visibility plaintext
npx eas-cli env:create --scope project --environment production --name EXPO_PUBLIC_API_MODE --value live --visibility plaintext
```
(`preview` 환경도 같은 식으로 등록하면 내부 테스트 빌드도 운영 서버에 붙는다.)

### 3-3. 내부 테스트용 APK (스토어 없이 바로 설치)

```bash
npx eas-cli build -p android --profile preview
```
끝나면 APK 다운로드 링크가 나온다. 담당자 휴대폰에서 설치해 **실기기 점검**(카메라·앨범·HEIC·드래그 정렬·키보드)을 먼저 한다. 지금까지 실기기에서 돌려본 적이 없으므로 이 단계를 건너뛰면 안 된다.

### 3-4. 스토어 제출용 AAB

```bash
npx eas-cli build -p android --profile production     # AAB, versionCode 자동 증가
npx eas-cli submit -p android --latest                # Google Play Console 로 업로드
```

- 첫 제출은 Play Console 에서 직접: 앱 만들기 → 개인정보처리방침 URL, 스크린샷, 앱 설명(한국어) 입력 → **내부 테스트 트랙**에 먼저 올린 뒤 프로덕션으로 승격.
- `eas submit` 자동화는 Play Console 에서 서비스 계정 JSON 을 발급해 `eas.json` `submit.production.android.serviceAccountKeyPath` 에 지정하면 된다.
- 회사 직원 전용 앱이면 **Google Play 비공개 앱(Managed Google Play)** 또는 내부 테스트 트랙으로만 배포해도 된다.

---

## 4. iOS 배포 (App Store / TestFlight)

Mac 없이 **EAS Build 로 빌드·제출**한다. 다만 **Apple Developer Program 계정(연 $99)** 은 반드시 있어야 한다.

### 4-1. 최초 1회 설정

- Apple Developer 에 가입하고, `app.json` 의 `ios.bundleIdentifier` = `com.ckp.app` 을 확정한다(Android 와 같은 규칙, 변경 불가).
- App Store Connect 에서 앱 레코드 생성(이름 "CKP", 번들 ID 선택).
- 인증서·프로비저닝 프로파일은 EAS 가 Apple 계정으로 로그인해 **자동 생성**한다. 첫 빌드 때 Apple ID 로그인을 물어본다.

### 4-2. 빌드 → TestFlight → 심사

```bash
npx eas-cli build -p ios --profile production      # Apple 로그인 → 인증서 자동 → .ipa
npx eas-cli submit -p ios --latest                 # App Store Connect 업로드
```

- 업로드 후 **TestFlight** 에서 내부 테스터(최대 100명, 심사 없음)에게 배포해 실기기 점검을 한다. iOS 는 특히 확인할 것이 많다: 흑백/CMYK 사진 대체 업로드, 거래처 선택창 안의 확인 창, 한국어 권한 문구, 키보드와 하단 버튼.
- 심사 제출 시 필요한 것: 스크린샷(6.7", 6.5", 5.5" iPhone), 앱 설명, 개인정보처리방침 URL, **심사용 테스트 계정**(승인된 계정 하나를 만들어 심사관에게 준다 — 승인 대기 계정은 로그인이 안 되므로 심사가 거절된다).
- 사진 보관함·카메라 권한 문구는 `app.json` 에 한국어로 이미 들어가 있다.
- 회사 직원 전용이면 App Store 공개 대신 **Apple Business Manager(비공개 앱)** 또는 TestFlight 지속 배포도 가능하다.

### 4-3. 심사 없이 앱 수정본 내보내기 (선택)

JS 코드만 바뀐 수정(화면·문구·로직)은 스토어 심사 없이 **EAS Update(OTA)** 로 밀어넣을 수 있다. 원하면 `expo-updates` 를 추가해 설정한다(지금은 미설정). 네이티브 모듈이 바뀌면 다시 스토어 제출이 필요하다.

---

## 5. 배포 순서 체크리스트

```
[ ] docs/OPERATIONS.md §1~3 완료 (DB 계정·마이그레이션·S3)
[ ] 서버: 운영 .env 작성 → Docker 빌드/실행 → https://api…/v1/meta 가 dataSource:"production"
[ ] 서버: 시작 로그 "앱 전용 테이블: 있음", 회원가입 접수 여부(SELF_REGISTRATION_ENABLED) 결정
[ ] 웹: EXPO_PUBLIC_API_BASE_URL 설정 → npm run check:release → expo export → dist/ 업로드 + SPA rewrite
[ ] 웹: 실제 도메인에서 로그인·EDI 사진 확인 (CORS_ORIGINS 일치)
[ ] Android: eas login/init → 패키지명 확정 → preview APK 실기기 점검 → production AAB → Play 내부 테스트
[ ] iOS: Apple 계정 → 번들 ID 확정 → production 빌드 → TestFlight 점검 → 심사(테스트 계정 첨부)
[ ] 담당자 계정 정리: edi.user_id 와 로그인 usr_id 매칭 (docs/OPERATIONS.md §4-1) — 안 하면 사진 대부분이 안 보임
```

## 6. 비용 요약

| 항목 | 비용 |
|---|---|
| EAS Build | 무료 플랜 월 30빌드(대기열 있음). 자주 빌드하면 Production 플랜($99/월) |
| Google Play 개발자 | 1회 $25 |
| Apple Developer Program | 연 $99 |
| 서버 | AWS 기준 t3.small EC2 또는 ECS Fargate 0.5vCPU — 월 2~3만원대. 웹 정적 호스팅(S3+CloudFront)은 월 수천원 |

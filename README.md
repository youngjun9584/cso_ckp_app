# CKP 업무 앱

(주)CKP 영업 담당자용 업무 앱입니다. **Android · iOS · 웹**을 하나의 코드로 제공합니다.

- 메뉴: 홈(메인 메뉴) · 의약품 · 공지사항 · EDI 등록 · 거래처
- 휴대폰: 하단 탭 5개
- 넓은 웹 화면(1024px 이상): 왼쪽 네이비 사이드바

```
cso_ckp_app/
├─ ckp-app/      앱 — Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript
├─ ckp-server/   API 서버 — Node 24 · Fastify 5 · pg · TypeScript (인증·권한·업무 처리)
│   └─ migrations/  001(필수)·002(선택) — 앱 전용 테이블만 추가, 기존 테이블 무변경
└─ docs/
    ├─ DESIGN.md      설계 명세(기존 시스템 분석 결과·호환 규칙·결정 사항)
    └─ OPERATIONS.md  운영 DB·사진 저장소 연동 체크리스트
```

구조는 `앱 → HTTPS(JSON) → ckp-server → PostgreSQL(cso_ckp) / 사진 저장소` 입니다. 앱은 DB에 직접 연결하지 않습니다.

---

## 1. 바로 실행해 보기 (이 PC)

Node.js 24 기준입니다. 의존성은 이미 설치되어 있습니다(다른 PC에서는 각 폴더에서 `npm install`).

### ① 개발 API 서버

```bash
cd ckp-server
npm run dev
```

- `http://localhost:4000/v1/meta` 에서 응답을 확인합니다.
- 내장 개발 DB(PGlite)에 cso_ckp와 같은 모양의 테이블과 **가상의 샘플 데이터**가 자동으로 만들어집니다. 운영 DB에는 연결하지 않습니다.
- 샘플 계정(개발 DB 전용, 비밀번호 모두 `demo1234`)
  - `ckp_demo`: 승인됨, bcrypt
  - `ckp_md5`: 승인됨, MD5 — 관리자 비밀번호 초기화 방식
  - `ckp_wait`: 승인 대기 — 로그인이 거부되는지 확인하는 용도
- 개발 DB를 처음 상태로 되돌리기: `npm run dev:reset`

### ② 앱 — 웹

```bash
cd ckp-app
npx expo start --web
```

- `http://localhost:8081` 로 접속합니다.
- `ckp-app/.env` 가 `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`, `EXPO_PUBLIC_API_MODE=live` 로 설정되어 있어 개발 서버에 연결됩니다.
- 화면 상단에 **"개발 서버 · 테스트 데이터"** 가 표시됩니다.

### ③ 앱 — 휴대폰 (Expo Go)

1. 휴대폰에 **Expo Go**(SDK 57)를 설치합니다.
2. PC와 휴대폰을 같은 Wi‑Fi에 연결합니다.
3. `ckp-app/.env` 의 주소를 PC IP로 바꿉니다. 예: `EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:4000`. IP는 `ipconfig` 로 확인합니다.
4. `npx expo start` 를 실행하고 QR 코드를 스캔합니다.

Windows 방화벽이 4000·8081 포트를 막으면 허용해야 합니다. **실기기에서는 아직 실행해 보지 않았습니다**(§5 참고).

### 서버 없이 보기: 샘플 모드

`ckp-app/.env` 에서 `EXPO_PUBLIC_API_MODE=sample` 로 두거나 API 주소를 비웁니다.

- 앱 안의 샘플 데이터로 모든 화면이 동작합니다. 로그인은 `ckp_demo` / `demo1234` 입니다.
- 화면 상단에 항상 **"샘플 모드 · 서버에 저장되지 않습니다"** 가 표시됩니다.
- 등록을 완료해도 실제로 저장되지 않았다고 안내합니다.
- 계정 화면에서 "업로드 실패 흉내" 와 "EDI 등록 차단 흉내" 를 켜면 실패·재시도 흐름을 볼 수 있습니다.

---

## 2. 환경변수

| 위치 | 예시 파일 | 핵심 값 |
|---|---|---|
| 앱 `ckp-app/.env` | `ckp-app/.env.example` | `EXPO_PUBLIC_API_BASE_URL`(API 주소), `EXPO_PUBLIC_API_MODE`(`live` \| `sample`) — 앱에 그대로 포함되므로 비밀값을 넣지 않는다 |
| 서버 `ckp-server/.env` | `ckp-server/.env.example` | `DATABASE_URL`, `JWT_SECRET`, `FILE_TOKEN_SECRET`, `CORS_ORIGINS`, `STORAGE_DRIVER`(`local` \| `s3`), `S3_*`, `TRUST_PROXY`, 업무 설정(`CLIENT_APPROVAL_REQUIRED_FOR_EDI`, `MEDICINE_FEE_VISIBLE`, `EDI_DEAL_TYPE`) |

- 운영(`NODE_ENV=production`)에서는 필수값이 없거나 개발용 비밀키를 쓰면 서버가 기동을 거부합니다.
- 실제 DB 주소에 개발용 비밀키를 함께 써도 기동을 거부합니다.
- 전달받은 DB 주소(`…rds.amazonaws.com:5432/cso_ckp?sslmode=require`)는 계정·비밀번호를 확인한 뒤 `DATABASE_URL` 에 넣습니다. **저장소에는 커밋하지 않습니다.**

## 3. API 연결 위치

| 역할 | 파일 |
|---|---|
| 요청/응답 타입(앱·서버 공통, 두 파일 동일 유지) | `ckp-app/src/lib/api/contract.ts`, `ckp-server/src/contract.ts` (`npm run check:contract`) |
| 앱 → 서버 호출 | `ckp-app/src/lib/api/http.ts`: 토큰 갱신, 오류를 한국어로 변환 |
| 사진 업로드 | `ckp-app/src/lib/api/upload.ts`: XHR, 진행률, 90초 제한 |
| 샘플 모드 구현 | `ckp-app/src/lib/api/sample/` |
| 모드·주소 선택 | `ckp-app/src/lib/config.ts`, `ckp-app/src/lib/api/index.ts` |
| 서버 라우트 | `ckp-server/src/routes/{auth,meta,medicines,notices,clients,edi,files}.ts` |
| DB 접속 | `ckp-server/src/db/pool.ts` |
| 스키마 자동 점검 | `ckp-server/src/db/schema-check.ts` |
| 사진 저장소 | `ckp-server/src/storage/{local,s3}.ts` |

주요 API는 다음과 같습니다. 모두 `/v1` 아래에 있습니다.
- `auth/login|refresh|logout|me`, `auth/check-id`, `auth/register`(회원가입 → 승인 대기), `meta`
- `medicines`, `notices`, `clients`
- `edi/status`, `edi/month-options`, `edi/uploads`, `edi/submissions`
- `files/:token`: 서명된 이미지 주소

## 4. 빌드

```bash
# 서버
cd ckp-server && npm run build && npm start          # 운영은 docs/OPERATIONS.md 의 환경변수 설정 후

# 웹 (정적 SPA, 모든 경로를 index.html 로 rewrite)
cd ckp-app && npx expo export -p web                  # → ckp-app/dist

# Android / iOS (EAS 클라우드 빌드)
cd ckp-app && npx eas-cli@latest build -p android     # iOS: -p ios (Apple 개발자 계정 필요)
```

## 5. 실제 연동 여부와 검증 결과

| 항목 | 상태 |
|---|---|
| **운영 cso_ckp DB** | **연결하지 않음.** 계정·비밀번호·권한을 확인하지 못했습니다. 개발 DB(PGlite)에 참고 코드로 파악한 cso_ckp 테이블 구조를 재현해 검증했습니다. |
| **사진 저장소(S3)** | **연결하지 않음.** 로컬 저장소(`ckp-server/.data/uploads`)로 검증했습니다. S3 드라이버는 구현했지만 실제 버킷으로는 시험하지 않았습니다. |
| 기존 인증 | 참고 코드 분석대로 `sys_app_usr_mng` 로그인을 구현했습니다. bcrypt와 MD5(관리자 초기화) 두 방식을 모두 검증하고, `apr_yn='Y'` 인 사용자만 로그인됩니다. |
| 관리자 화면 호환 | EDI는 사진 1장당 `edi` 1행으로, 관리자가 읽는 값 그대로 기록합니다(`deal_type='기존'`, `pharmacist=''`, `month`=당월/전월/전전월 등). 제출 건 묶음·순번·메모·중복 방지는 추가 테이블에만 저장합니다. |
| 서버 자동 테스트 | **273개 통과.** 인증, 의약품, 공지, 거래처, EDI(1장·30장·31장 거부, 순서, 재시도·중복 방지, 동시 제출, 차단, 승인 대기 등), 이미지 전달, 보안 항목 |
| 앱 정적 검사 | TypeScript 오류 0건, ESLint 오류 0건, EDI 로직 자체 점검 112개 통과 |
| 번들 빌드 | 웹·Android·iOS 번들 빌드 성공(Hermes). **기기에서 실행하지는 않았습니다.** |
| 웹 실제 동작(개발 서버 연결) | 아래 항목을 브라우저에서 확인했습니다. 서버에 저장된 순서는 사진 색으로 판별해 대조했습니다. |

웹에서 확인한 항목:
- 31장 선택 → 초과 안내 → '직접 고르기'로 1장 해제 → 30/30
- 30장 상태에서 추가 → 30장 유지
- 이동·맨 앞·삭제 후 번호가 즉시 다시 매겨짐
- 29장 등록 → 서버 저장 순서와 등록 내역 조회 순서가 화면 순서와 일치
- 등록 버튼 3연타 → 제출 요청 1회
- 사진 2장 네트워크 실패 → 입력값 유지 → '실패한 사진만 다시 시도' → 그 2장만 재전송, 제출 1건
- 1장 등록
- 거래처 등록: 필수 표시, 사업자번호 형식·검증번호·중복 확인, 하이픈 자동 입력 → 승인 대기로 등록 → EDI 선택창에 사유와 함께 선택 불가로 표시
- 공지 HTML 정화: script·onerror 제거, iframe은 링크로, `javascript:` 링크 무력화
- 홈 화면, 휴대폰·넓은 화면 레이아웃

**아직 확인하지 못한 것(실기기 필요):**
- 카메라·앨범 선택, HEIC 변환(iOS/Android OS 디코더), 흑백·CMYK 사진 대체 업로드
- 길게 눌러 끌기 정렬, 키보드와 하단 버튼 위치, 권한 거절 안내
- iOS 한국어 시스템 문구, 캐시 정리

## 6. 남은 설정·확인 항목

0. **회원가입:** 로그인 화면의 회원가입 버튼으로 가입 신청을 받습니다. 신청은 `sys_app_usr_mng` 에 **승인 대기**로 저장되고 관리자가 기존 관리자 화면(앱 회원 관리)에서 승인해야 로그인됩니다. 아직 받지 않으려면 `ckp-server/.env` 에 `SELF_REGISTRATION_ENABLED=false`. 개인정보 수집·이용 동의 문구는 회사에서 확정해야 합니다.

자세한 절차는 `docs/OPERATIONS.md`, 근거는 `docs/DESIGN.md` §9에 있습니다.

1. **DB:** cso_ckp 앱 서버용 최소 권한 계정 발급 → `npm run db:check` 로 실제 스키마 확인 → DBA 검토 후 `npm run db:migrate -- --yes`
2. **사진 저장소:** 기존 `edi-img` 버킷 사용 여부, `uploads/users/ckp/` 접두어 허용, 공개 읽기 정책, IAM 최소 권한. 관리자 화면이 `aws_url` 을 서명 없이 읽으므로 이 규칙이 필요합니다.
3. **업무 규칙 확정:**
   - 신규 거래처를 승인 전에도 EDI에 쓸지 여부. 기본은 승인 후이며, `CLIENT_APPROVAL_REQUIRED_FOR_EDI=false` 이면 등록 직후 선택할 수 있습니다.
   - 월 라벨 의미(당월 = 직전 달)
   - `deal_type` 값(`기존`)
   - 의약품 수수료 노출 여부(`frees` 설정)
4. **메모 노출:** 메모는 앱 전용 테이블에 저장되어 관리자 화면에는 보이지 않습니다. 필요하면 관리자 화면을 수정해야 합니다.
5. **실기기 점검:** §5 목록 → EAS 빌드 → 스토어 배포 정보(`com.ckp.app` 식별자 확정)
6. **보안:** 참고 프로젝트에 평문으로 커밋된 DB 비밀번호·AWS 키·AI API 키 교체. 이 저장소에는 복사하지 않았습니다.

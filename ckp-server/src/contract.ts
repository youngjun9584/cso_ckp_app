/**
 * CKP API 계약 (앱 ↔ 서버 공통 타입).
 *
 * 이 파일은 ckp-app/src/lib/api/contract.ts 와 ckp-server/src/contract.ts 에 **동일하게** 존재해야 한다.
 * 변경 시 두 파일을 함께 수정하고 `npm run check:contract`(ckp-server)로 일치 여부를 확인한다.
 *
 * 규칙
 * - 모든 경로는 `/v1` 로 시작한다. 요청·응답 본문은 JSON(UTF-8). 사진 업로드만 multipart/form-data.
 * - 날짜/시각 문자열은 모두 한국 표준시(KST) 기준: 날짜 'YYYY-MM-DD', 시각 'YYYY-MM-DD HH:mm:ss', 연월 'YYYY-MM'.
 * - 목록은 page(1부터) / pageSize(기본 30, 최대 100) 페이지네이션을 사용한다.
 * - 오류 응답은 항상 ApiErrorBody 형태이며 message 는 사용자에게 그대로 보여줄 수 있는 한국어 문장이다.
 * - 인증이 필요한 요청은 `Authorization: Bearer <accessToken>` 헤더를 사용한다.
 */

export const API_VERSION = '1.0.0';

// ─────────────────────────────── 공통 ───────────────────────────────

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED' // 토큰 없음/만료/위조 → 앱은 refresh 후 1회 재시도, 실패 시 로그인 화면
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_NOT_APPROVED' // apr_yn != 'Y' (details.status 에 N/D/R/S/기타)
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_CLIENT_NAME'
  | 'DUPLICATE_BIZ_NO'
  | 'CLIENT_NOT_SELECTABLE' // 승인 대기 등으로 EDI에 사용할 수 없는 거래처
  | 'EDI_DISABLED' // is_edi.edi = true (관리자가 EDI 등록 차단)
  | 'IDEMPOTENCY_CONFLICT' // 같은 Idempotency-Key 로 다른 내용 제출
  | 'UPLOAD_NOT_FOUND' // 제출에 포함된 uploadId 중 없는 것/다른 사용자 것
  | 'UPLOAD_ALREADY_USED' // 이미 다른 제출 건에 사용된 사진
  | 'PHOTO_COUNT_OUT_OF_RANGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'IMAGE_TOO_SMALL'
  | 'IMAGE_DECODE_FAILED'
  | 'RATE_LIMITED'
  | 'DUPLICATE_USER_ID' // 회원가입: 이미 사용 중인 아이디
  | 'REGISTRATION_DISABLED' // 회원가입: 서버 설정으로 가입 신청을 받지 않음
  | 'SCHEMA_NOT_READY' // 서버 DB에 필요한 테이블(마이그레이션) 없음
  | 'SERVER_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** 사용자에게 보여줄 한국어 메시지 */
    message: string;
    /** 입력란별 오류 (필드명 → 한국어 메시지) */
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ─────────────────────────────── 메타 ───────────────────────────────

/** GET /v1/meta (인증 불필요) */
export interface MetaResponse {
  apiVersion: string;
  /** production: 운영 DB, development: 개발용 로컬 DB(PGlite)·테스트 데이터 */
  dataSource: 'production' | 'development';
  /** 사진 저장소 종류 (s3: 객체 저장소, local: 서버 로컬 디스크-개발용) */
  storage: 's3' | 'local';
  serverTime: string; // KST 'YYYY-MM-DD HH:mm:ss'
  features: {
    /** true 면 승인되지 않은(approval=false) 거래처는 EDI 등록에 선택할 수 없다 (기존 업무 규칙) */
    clientApprovalRequiredForEdi: boolean;
    /** 거래처 구분(hospital_type) 컬럼 사용 가능 여부 (DB 스키마 확인 결과) */
    clientTypeField: boolean;
    /** 의약품 수수료(frees.list=true 인 tax 컬럼) 표시 여부 */
    medicineFeeVisible: boolean;
    /** 앱에서 회원가입(승인 대기 신청)을 받을지 여부 — false 면 로그인 화면에 가입 링크를 숨긴다 */
    selfRegistration: boolean;
  };
  limits: EdiLimits;
}

export interface EdiLimits {
  ediMinPhotos: number; // 1
  ediMaxPhotos: number; // 30
  /** 서버가 받는 업로드 1장 최대 바이트 (클라이언트 처리 후 JPEG 기준) */
  photoMaxBytes: number;
  /** 긴 변 최소 픽셀 */
  photoMinLongSide: number;
  /** 업로드 형식 (클라이언트는 JPEG 로 변환해 보낸다) */
  acceptedUploadTypes: string[]; // ['image/jpeg', 'image/png', 'image/webp']
  memoMaxLength: number; // 500
}

// ─────────────────────────────── 인증 ───────────────────────────────

export type ClientPlatform = 'native' | 'web';

/** POST /v1/auth/login */
export interface LoginRequest {
  usrId: string;
  password: string;
  /** web 이면 refreshToken 을 본문 대신 httpOnly 쿠키(ckp_rt)로 설정한다 */
  platform: ClientPlatform;
}

export interface AuthUser {
  usrId: string;
  name: string | null; // usr_nam
  companyName: string | null; // cpy_nam
  phone: string | null;
  email: string | null;
  roleId: string | null;
}

export interface AuthTokensResponse {
  accessToken: string;
  /** ISO 8601 (UTC) */
  accessTokenExpiresAt: string;
  /** platform=native 일 때만 포함. web 은 httpOnly 쿠키 사용 */
  refreshToken?: string;
  user: AuthUser;
}

/** POST /v1/auth/refresh  — native: body.refreshToken, web: 쿠키 ckp_rt (credentials: 'include') */
export interface RefreshRequest {
  refreshToken?: string;
  platform: ClientPlatform;
}

/** GET /v1/auth/me */
export interface MeResponse {
  user: AuthUser;
}

// POST /v1/auth/logout → 204 (web 쿠키 삭제)

// ─────────────────────────────── 회원가입 ───────────────────────────────
// 기존 업무 방식(참고 Next.js·구 앱)과 동일하게 sys_app_usr_mng 에 승인 대기(apr_yn='N')로 등록한다.
// 관리자가 기존 관리자 화면(앱 회원 관리)에서 승인(apr_yn='Y')해야 로그인할 수 있다. 가입 직후 토큰은 발급하지 않는다.

/** GET /v1/auth/check-id?usrId=  (인증 불필요, 속도 제한) — 형식이 틀리면 400 VALIDATION_FAILED */
export interface CheckUserIdResponse {
  usrId: string; // trim 된 값
  available: boolean;
  /** '사용할 수 있는 아이디입니다.' | '이미 사용 중인 아이디입니다.' */
  message: string;
}

/**
 * POST /v1/auth/register  (인증 불필요, 속도 제한) → 201 RegisterResponse
 * 400 VALIDATION_FAILED(fields) · 409 DUPLICATE_USER_ID(fields.usrId) · 403 REGISTRATION_DISABLED · 429 RATE_LIMITED
 */
export interface RegisterRequest {
  /** 로그인 아이디(usr_id): trim 후 2~20자, 한글·영문·숫자·밑줄(_)·하이픈(-)·마침표(.)만, 공백 불가 */
  usrId: string;
  /** 8~64자, 영문과 숫자를 모두 포함 (앞뒤 공백 불가) — 서버는 bcrypt 로만 저장 */
  password: string;
  /** 이름(usr_nam): 1~20자 */
  name: string;
  /** 휴대폰(phone): 숫자·하이픈, 숫자 10~11자리, 저장은 ≤15자 */
  phone: string;
  /** 이메일(email): 선택, ≤200자 */
  email?: string | null;
  /** 회사명(cpy_nam): 선택, ≤50자 */
  companyName?: string | null;
  /** 개인정보 수집·이용 동의 — true 여야 한다 */
  agreePrivacy: boolean;
}

export interface RegisterResponse {
  usrId: string;
  status: 'pending';
  /** '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' */
  message: string;
}

// ─────────────────────────────── 의약품 ───────────────────────────────

export type MedicineSearchField = 'name' | 'company' | 'code' | 'all';

/** GET /v1/medicines?q=&field=name|company|code|all&page=&pageSize= */
export interface MedicineSummary {
  /** 보험코드 (medicine.medicine_code, PK) */
  code: string;
  name: string; // medicine.name
  company: string | null; // 제약사
  /** 포장·규격 (medicine.medicine_packing) */
  packing: string | null;
  /** 성분 및 함량 (medicine.ingredient) */
  ingredient: string | null;
  /** 약가 원문 (medicine.pay, 문자열) */
  priceText: string | null;
  /** 약가 숫자 (파싱 가능할 때만) */
  price: number | null;
  /** 수수료 (features.medicineFeeVisible && 값이 있을 때만) */
  fee: { label: string; value: string } | null;
  /** 자사생산 (medicine.is_maker === 'O') */
  inHouse: boolean;
  /** 대조의약품 (medicine.contrast_medicine) */
  contrastMedicine: string | null;
  /** 제품 이미지 URL (https 만) */
  imageUrl: string | null;
}

export type MedicineListResponse = Paged<MedicineSummary>;

/** GET /v1/medicines/:code  (code 는 encodeURIComponent) */
export interface MedicineDetail extends MedicineSummary {
  type1: string | null; // 전문/일반 구분 등
  type2: string | null; // 급여 구분 등
  medicineClass: string | null; // 복지부 분류
  welfareCode: string | null; // 복지부코드
  additives: string | null; // 첨가제 medicine_add
  note: string | null; // 비고 ee
  /** 정산여부 medicine_is: 'Y' | 'N' | 기타 원문 */
  settlement: string | null;
  regYmd: string | null;
}

export interface MedicineDetailResponse {
  medicine: MedicineDetail;
}

// ─────────────────────────────── 공지사항 ───────────────────────────────

/** GET /v1/notices?q=&page=&pageSize=   (정렬: 중요 → 등록일 desc → idx desc) */
export interface NoticeSummary {
  idx: number;
  title: string;
  author: string | null;
  regYmd: string | null;
  important: boolean; // notice.important === 'true'
}

export type NoticeListResponse = Paged<NoticeSummary>;

export interface NoticeAttachment {
  name: string;
  url: string;
  bytes: number | null;
}

/** GET /v1/notices/:idx */
export interface NoticeDetail extends NoticeSummary {
  /** 서버에서 sanitize 한 HTML (script/style/iframe/이벤트 속성 제거) */
  contentHtml: string;
  /** 현재 DB 구조에는 첨부 테이블이 없어 항상 빈 배열 */
  attachments: NoticeAttachment[];
}

export interface NoticeDetailResponse {
  notice: NoticeDetail;
}

// ─────────────────────────────── 거래처 ───────────────────────────────

/** approval: true → approved, false → pending, null → unset(관리자 등록 등, 기존 규칙상 선택 가능) */
export type ClientApproval = 'approved' | 'pending' | 'unset';

/** GET /v1/clients?q=&page=&pageSize=   (로그인 사용자 소유 거래처만) */
export interface ClientSummary {
  idx: number;
  name: string; // mannager_by_hospital.hospital
  clientType: string | null; // hospital_type (지원 시)
  representative: string | null; // doctor_name (대표자/원장)
  /** 사업자등록번호 표시용 '123-45-67890' (원문이 10자리가 아니면 원문) */
  bizNo: string | null;
  address: string | null;
  phone: string | null;
  approval: ClientApproval;
  /** EDI 등록에 선택 가능한지 (features.clientApprovalRequiredForEdi 반영) */
  selectableForEdi: boolean;
}

export type ClientListResponse = Paged<ClientSummary>;

/** GET /v1/clients/:idx */
export interface ClientDetail extends ClientSummary {
  zipCode: string | null;
  careCode: string | null; // 요양기관번호
  dispensary: string | null; // 문전약국
  memo: string | null; // ee
  ownerUsrId: string; // user_id (담당자)
}

export interface ClientDetailResponse {
  client: ClientDetail;
}

/**
 * POST /v1/clients  → 201 ClientDetailResponse
 * 필수: name. 서버 검증(길이·형식·중복) 실패 시 400/409 + error.fields
 */
export interface ClientCreateRequest {
  name: string; // ≤100
  clientType?: string | null; // ≤50, features.clientTypeField 일 때만 저장
  bizNo?: string | null; // 숫자 10자리(하이픈 허용) + 검증번호
  representative?: string | null; // ≤100
  phone?: string | null; // 숫자·하이픈, ≤20
  address?: string | null; // 주소
  addressDetail?: string | null; // 상세주소 (address 와 합쳐 ≤100 로 저장)
  zipCode?: string | null; // 숫자 5자리(구 6자리 허용), ≤10
  careCode?: string | null; // ≤50
  dispensary?: string | null; // ≤100
  memo?: string | null; // ≤200
}

/** GET /v1/clients/check-duplicate?name=&bizNo=&excludeIdx= */
export interface ClientDuplicateCheckResponse {
  name: { checked: boolean; duplicate: boolean; message: string | null };
  bizNo: { checked: boolean; valid: boolean; duplicate: boolean; message: string | null };
}

// ─────────────────────────────── EDI ───────────────────────────────

/** GET /v1/edi/status — 오류 시 서버는 enabled=false 로 응답(fail-closed) */
export interface EdiStatusResponse {
  enabled: boolean;
  message: string | null;
}

export type EdiMonthLabel = '당월' | '전월' | '전전월';

/** GET /v1/edi/month-options — 서버가 KST 기준으로 계산 (당월 = 직전 달, 기존 업무 기준) */
export interface EdiMonthOption {
  label: EdiMonthLabel;
  ym: string; // 'YYYY-MM'
  display: string; // '당월 (2026년 8월)'
}

export interface EdiMonthOptionsResponse {
  options: EdiMonthOption[];
  defaultLabel: EdiMonthLabel;
}

/**
 * POST /v1/edi/uploads  (multipart/form-data, 사진 1장)
 *   fields: clientPhotoId (uuid v4, 앱이 사진 선택 시 생성 — 재시도 시 동일 값 재사용)
 *   file:   file (image/jpeg 권장)
 * 같은 사용자·clientPhotoId 로 다시 올리면 기존 업로드를 그대로 반환(200, reused=true) → 중복 저장 없음.
 * 201 | 200 → EdiUploadResponse
 */
export interface EdiUpload {
  uploadId: string; // uuid
  clientPhotoId: string;
  bytes: number;
  width: number;
  height: number;
  /** 서명된 썸네일 URL (만료 있음) */
  thumbUrl: string;
}

export interface EdiUploadResponse {
  upload: EdiUpload;
  reused: boolean;
}

/**
 * POST /v1/edi/submissions
 *   headers: Idempotency-Key: <uuid v4>  (앱이 작성 건마다 1회 생성, 재시도 시 동일 값)
 * 한 트랜잭션에서 edi 행(사진당 1행, seq 순서) + 제출 건 + 사진 순번을 저장한다.
 * 201 (새로 생성) | 200 (같은 키·같은 내용 재요청 → 기존 결과 반환, replayed=true)
 * 409 IDEMPOTENCY_CONFLICT (같은 키·다른 내용)
 */
export interface EdiSubmissionCreateRequest {
  clientIdx: number;
  targetYm: string; // month-options 중 하나의 ym
  memo?: string | null; // ≤500
  /** 사진 순서: seq 1..N 연속, 중복 없음, N ∈ [1, 30] */
  photos: { uploadId: string; seq: number }[];
}

export interface EdiSubmissionCreateResponse {
  submission: EdiSubmissionDetail;
  replayed: boolean;
}

export type EdiPhotoReviewStatus = 'needs_review' | 'reviewed' | 'delete_requested' | 'missing';

export interface EdiPhoto {
  seq: number;
  ediIdx: number | null; // edi.idx (관리자가 삭제한 경우 status=missing 이며 null 일 수 있음)
  thumbUrl: string | null; // 서명된 URL
  imageUrl: string | null; // 서명된 URL (원본 크기)
  reviewStatus: EdiPhotoReviewStatus;
  printed: boolean; // edi.print
  analyzed: boolean; // edi.is_ocr
  /** 관리자가 지정한 제약사 목록 (edi.pharmacist 쉼표 구분) */
  pharmaCompanies: string[];
}

export interface EdiSubmissionSummary {
  /** 앱 제출 건: uuid / 이전 방식(앱 외부) 등록분: 'legacy-<해시>' */
  id: string;
  kind: 'app' | 'legacy';
  clientIdx: number | null;
  clientName: string;
  targetYm: string | null;
  monthLabel: string | null;
  memo: string | null;
  photoCount: number;
  createdAt: string | null; // KST 'YYYY-MM-DD HH:mm:ss' (edi.create_at)
  regYmd: string; // KST 'YYYY-MM-DD'
  coverThumbUrl: string | null;
  statusCounts: Record<EdiPhotoReviewStatus, number>;
}

/** GET /v1/edi/submissions?ym=YYYY-MM(등록월)&page=&pageSize= */
export type EdiSubmissionListResponse = Paged<EdiSubmissionSummary>;

/** GET /v1/edi/submissions/:id  — photos 는 seq 오름차순(서버 저장 순서) */
export interface EdiSubmissionDetail extends EdiSubmissionSummary {
  photos: EdiPhoto[];
}

export interface EdiSubmissionDetailResponse {
  submission: EdiSubmissionDetail;
}

// GET /v1/files/:token  — 서명 토큰으로 이미지 바이트 전달 (Authorization 불필요, 만료 있음)

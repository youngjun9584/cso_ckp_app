/**
 * CkpApi — 앱이 사용하는 모든 서버 기능의 인터페이스 (contract.ts 의 모든 엔드포인트).
 * 실서버 구현은 http.ts, 샘플 구현은 sample/ 에 있고 getApi() 가 둘 중 하나를 돌려준다.
 */
import type {
  AuthTokensResponse,
  AuthUser,
  CheckUserIdResponse,
  ClientCreateRequest,
  ClientDetailResponse,
  ClientDuplicateCheckResponse,
  ClientListResponse,
  EdiMonthOptionsResponse,
  EdiStatusResponse,
  EdiSubmissionCreateRequest,
  EdiSubmissionCreateResponse,
  EdiSubmissionDetailResponse,
  EdiSubmissionListResponse,
  EdiUploadResponse,
  MeResponse,
  MedicineDetailResponse,
  MedicineListResponse,
  MedicineSearchField,
  MetaResponse,
  NoticeDetailResponse,
  NoticeListResponse,
  RegisterRequest,
  RegisterResponse,
} from './contract';

export interface RequestOptions {
  /** React Query 의 signal 등을 넘기면 요청을 취소할 수 있다 */
  signal?: AbortSignal;
}

export interface PageParams {
  page?: number; // 1부터
  pageSize?: number; // 기본 30, 최대 100
}

export interface MedicineListParams extends PageParams {
  q?: string;
  field?: MedicineSearchField;
}

export interface NoticeListParams extends PageParams {
  q?: string;
}

export interface ClientListParams extends PageParams {
  q?: string;
}

export interface ClientDuplicateCheckParams {
  name?: string;
  bizNo?: string;
  excludeIdx?: number;
}

export interface EdiSubmissionListParams extends PageParams {
  /** 등록월 'YYYY-MM' (KST) */
  ym: string;
}

/**
 * 업로드할 파일(앱에서 처리한 JPEG).
 * - native: uri = file:// 경로 (XHR FormData 에 {uri,name,type} 으로 들어간다)
 * - web: blob 을 넘기거나, uri(blob:/data: URL)에서 Blob 을 읽는다
 */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
  blob?: Blob;
  /** 샘플 모드 응답을 채우는 데 쓰는 선택 정보(실서버는 무시하고 서버가 직접 계산) */
  width?: number;
  height?: number;
  bytes?: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  fraction: number;
}

export type UploadProgressHandler = (progress: UploadProgress) => void;

export interface CkpApi {
  readonly mode: 'live' | 'sample';
  /** live 모드의 서버 주소 (sample 은 null) */
  readonly baseUrl: string | null;
  /** 서버가 '/v1/files/…' 처럼 상대 경로를 돌려준 경우 절대 URL 로 바꾼다 */
  resolveUrl(url: string | null | undefined): string | null;

  // ── 메타 ──
  /** GET /v1/meta (인증 불필요) */
  getMeta(opts?: RequestOptions): Promise<MetaResponse>;

  // ── 인증 ── (토큰 저장은 구현이 알아서 처리한다)
  /** POST /v1/auth/login */
  login(credentials: { usrId: string; password: string }): Promise<AuthTokensResponse>;
  /** POST /v1/auth/refresh — 저장된 refresh 토큰(native)/쿠키(web)로 갱신 */
  refresh(): Promise<AuthTokensResponse>;
  /** 앱 시작 시 로그인 복원. 저장된 세션이 없거나 만료되면 null, 네트워크 오류는 ApiError 로 throw */
  restoreSession(): Promise<AuthUser | null>;
  /** POST /v1/auth/logout — 실패해도 로컬 토큰은 지운다 */
  logout(): Promise<void>;
  /** GET /v1/auth/me */
  me(opts?: RequestOptions): Promise<MeResponse>;

  // ── 회원가입 ── (인증 불필요, 토큰을 발급·저장하지 않는다)
  /** GET /v1/auth/check-id?usrId= — 형식이 틀리면 400 VALIDATION_FAILED(fields.usrId) */
  checkUserId(usrId: string, opts?: RequestOptions): Promise<CheckUserIdResponse>;
  /**
   * POST /v1/auth/register → 201 승인 대기(pending). 가입 직후 로그인되지 않는다.
   * 400 VALIDATION_FAILED(fields) · 409 DUPLICATE_USER_ID(fields.usrId) · 403 REGISTRATION_DISABLED · 429 RATE_LIMITED
   */
  register(body: RegisterRequest, opts?: RequestOptions): Promise<RegisterResponse>;

  // ── 의약품 ──
  /** GET /v1/medicines */
  listMedicines(params: MedicineListParams, opts?: RequestOptions): Promise<MedicineListResponse>;
  /** GET /v1/medicines/:code */
  getMedicine(code: string, opts?: RequestOptions): Promise<MedicineDetailResponse>;

  // ── 공지사항 ──
  /** GET /v1/notices */
  listNotices(params: NoticeListParams, opts?: RequestOptions): Promise<NoticeListResponse>;
  /** GET /v1/notices/:idx */
  getNotice(idx: number, opts?: RequestOptions): Promise<NoticeDetailResponse>;

  // ── 거래처 ──
  /** GET /v1/clients (내 거래처) */
  listClients(params: ClientListParams, opts?: RequestOptions): Promise<ClientListResponse>;
  /** GET /v1/clients/:idx */
  getClient(idx: number, opts?: RequestOptions): Promise<ClientDetailResponse>;
  /** GET /v1/clients/check-duplicate */
  checkClientDuplicate(params: ClientDuplicateCheckParams, opts?: RequestOptions): Promise<ClientDuplicateCheckResponse>;
  /** POST /v1/clients → 201 */
  createClient(body: ClientCreateRequest, opts?: RequestOptions): Promise<ClientDetailResponse>;

  // ── EDI ──
  /** GET /v1/edi/status */
  getEdiStatus(opts?: RequestOptions): Promise<EdiStatusResponse>;
  /** GET /v1/edi/month-options */
  getEdiMonthOptions(opts?: RequestOptions): Promise<EdiMonthOptionsResponse>;
  /**
   * POST /v1/edi/uploads (multipart, 사진 1장). 같은 clientPhotoId 로 다시 올리면 기존 업로드를 돌려준다(reused=true).
   * 진행률은 onProgress, 취소는 signal. 타임아웃 90초.
   */
  uploadEdiPhoto(
    file: UploadFile,
    clientPhotoId: string,
    onProgress?: UploadProgressHandler,
    signal?: AbortSignal,
  ): Promise<EdiUploadResponse>;
  /** POST /v1/edi/submissions (Idempotency-Key 헤더) → 201 새로 생성 / 200 replayed */
  createEdiSubmission(
    body: EdiSubmissionCreateRequest,
    idempotencyKey: string,
    opts?: RequestOptions,
  ): Promise<EdiSubmissionCreateResponse>;
  /** GET /v1/edi/submissions?ym= */
  listEdiSubmissions(params: EdiSubmissionListParams, opts?: RequestOptions): Promise<EdiSubmissionListResponse>;
  /** GET /v1/edi/submissions/:id (사진은 seq 오름차순) */
  getEdiSubmission(id: string, opts?: RequestOptions): Promise<EdiSubmissionDetailResponse>;
}

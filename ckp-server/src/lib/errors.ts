/**
 * 오류 표준화: 모든 오류 응답은 contract 의 ApiErrorBody 형태이며 message 는 사용자에게 그대로 보여줄 한국어 문장이다.
 *
 * 사용법 (라우트)
 *   throw new AppError('NOT_FOUND', '의약품을 찾을 수 없습니다.');
 *   throw new AppError('VALIDATION_FAILED', undefined, { fields: { name: '거래처명을 입력해 주세요.' } });
 *   throw new AppError('SCHEMA_NOT_READY');           // 기본 한국어 메시지·상태 코드 사용
 * 상태 코드는 code 별 기본값(DEFAULT_STATUS)을 쓰고, 필요하면 options.status 로 바꾼다.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '../contract.js';

export const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_NOT_APPROVED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_CLIENT_NAME: 409,
  DUPLICATE_BIZ_NO: 409,
  CLIENT_NOT_SELECTABLE: 409,
  EDI_DISABLED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  UPLOAD_NOT_FOUND: 422,
  UPLOAD_ALREADY_USED: 409,
  PHOTO_COUNT_OUT_OF_RANGE: 400,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  IMAGE_TOO_SMALL: 422,
  IMAGE_DECODE_FAILED: 422,
  RATE_LIMITED: 429,
  DUPLICATE_USER_ID: 409,
  REGISTRATION_DISABLED: 403,
  SCHEMA_NOT_READY: 503,
  SERVER_ERROR: 500,
};

export const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: '입력한 내용을 확인해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다.',
  INVALID_CREDENTIALS: '아이디 또는 비밀번호가 올바르지 않습니다.',
  ACCOUNT_NOT_APPROVED: '관리자에게 승인 상태를 확인하십시오.',
  FORBIDDEN: '이 작업을 할 권한이 없습니다.',
  NOT_FOUND: '요청한 정보를 찾을 수 없습니다.',
  CONFLICT: '이미 처리되었거나 다른 내용과 충돌합니다.',
  DUPLICATE_CLIENT_NAME: '이미 같은 이름으로 등록된 거래처가 있습니다.',
  DUPLICATE_BIZ_NO: '이미 같은 사업자등록번호로 등록된 거래처가 있습니다.',
  CLIENT_NOT_SELECTABLE: '승인 대기 중인 거래처는 EDI 등록에 사용할 수 없습니다.',
  EDI_DISABLED: '현재 EDI 등록이 중지되어 있습니다. 관리자에게 문의해 주세요.',
  IDEMPOTENCY_CONFLICT: '같은 등록 요청이 다른 내용으로 이미 처리되었습니다. 새로 등록해 주세요.',
  UPLOAD_NOT_FOUND: '업로드한 사진을 찾을 수 없습니다. 사진을 다시 올려 주세요.',
  UPLOAD_ALREADY_USED: '이미 다른 EDI 등록에 사용된 사진입니다.',
  PHOTO_COUNT_OUT_OF_RANGE: '사진은 1장 이상 30장 이하로 등록할 수 있습니다.',
  UNSUPPORTED_FILE_TYPE: '지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 사진만 올릴 수 있습니다.',
  FILE_TOO_LARGE: '파일 용량이 너무 큽니다.',
  IMAGE_TOO_SMALL: '사진 해상도가 너무 낮습니다. 더 선명한 사진을 올려 주세요.',
  IMAGE_DECODE_FAILED: '사진 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  DUPLICATE_USER_ID: '이미 사용 중인 아이디입니다.',
  REGISTRATION_DISABLED: '현재 앱에서 회원가입을 받지 않습니다. 관리자에게 계정 발급을 요청해 주세요.',
  SCHEMA_NOT_READY: '서버 데이터베이스 준비가 완료되지 않아 이 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.',
  SERVER_ERROR: '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

export interface AppErrorOptions {
  status?: number;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  /** 로그용 원인(응답에는 절대 포함되지 않음) */
  cause?: unknown;
  /** 응답 헤더 (예: Retry-After) */
  headers?: Record<string, string>;
}

export class AppError extends Error {
  readonly code: ApiErrorCode;
  /** Fastify 가 인식하는 상태 코드 속성 */
  readonly statusCode: number;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(code: ApiErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGE[code], options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.status ?? DEFAULT_STATUS[code];
    if (options.fields) this.fields = options.fields;
    if (options.details) this.details = options.details;
    if (options.headers) this.headers = options.headers;
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length > 0) error.fields = this.fields;
    if (this.details) error.details = this.details;
    return { error };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// ───────────────────────── 오류 변환 ─────────────────────────

export interface ErrorMappingOptions {
  photoMaxBytes: number;
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

interface PgLikeError {
  code?: unknown;
  severity?: unknown;
  routine?: unknown;
}

function isPgError(err: unknown): err is PgLikeError & Error {
  return typeof err === 'object' && err !== null && 'severity' in err && 'code' in err && typeof (err as PgLikeError).code === 'string';
}

/** 알 수 없는 오류를 AppError 로 변환한다(응답용). 원본 오류는 cause 로 보존한다. */
export function toAppError(err: unknown, opts: ErrorMappingOptions): AppError {
  if (err instanceof AppError) return err;

  const fe = err as Partial<FastifyError> & { validation?: unknown };
  const code = typeof fe?.code === 'string' ? fe.code : '';

  // Fastify 스키마 검증 실패 (라우트가 JSON schema 를 쓴 경우)
  if (fe && fe.validation) {
    return new AppError('VALIDATION_FAILED', '입력한 내용을 확인해 주세요.', { cause: err });
  }

  switch (code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new AppError('VALIDATION_FAILED', '요청 데이터가 너무 큽니다.', { status: 413, cause: err });
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new AppError('VALIDATION_FAILED', '지원하지 않는 요청 형식입니다.', { status: 415, cause: err });
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
      return new AppError('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { cause: err });
    case 'FST_REQ_FILE_TOO_LARGE':
      return new AppError('FILE_TOO_LARGE', `사진 용량이 너무 큽니다. 1장당 최대 ${formatMb(opts.photoMaxBytes)}까지 올릴 수 있습니다.`, {
        details: { maxBytes: opts.photoMaxBytes },
        cause: err,
      });
    case 'FST_FILES_LIMIT':
      return new AppError('VALIDATION_FAILED', '사진은 한 번에 1장씩 올려 주세요.', { status: 413, cause: err });
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return new AppError('VALIDATION_FAILED', '업로드 요청에 항목이 너무 많습니다.', { status: 413, cause: err });
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return new AppError('VALIDATION_FAILED', '사진은 multipart/form-data 형식으로 보내야 합니다.', { status: 415, cause: err });
    case 'FST_PROTO_VIOLATION':
    case 'FST_INVALID_JSON_FIELD_ERROR':
      return new AppError('VALIDATION_FAILED', '업로드 요청 형식이 올바르지 않습니다.', { cause: err });
    case 'FST_MP_PREMATURE_CLOSE':
      return new AppError('VALIDATION_FAILED', '업로드가 중간에 끊겼습니다. 다시 시도해 주세요.', { cause: err });
    default:
      break;
  }

  if (isPgError(err)) {
    // 42P01 테이블 없음, 42703 컬럼 없음 → DB 스키마 미준비
    if (err.code === '42P01' || err.code === '42703') {
      return new AppError('SCHEMA_NOT_READY', undefined, { cause: err });
    }
    return new AppError('SERVER_ERROR', undefined, { cause: err });
  }

  const status = typeof fe?.statusCode === 'number' ? fe.statusCode : 500;
  if (status >= 500) return new AppError('SERVER_ERROR', undefined, { cause: err });
  switch (status) {
    case 401:
      return new AppError('UNAUTHORIZED', undefined, { cause: err });
    case 403:
      return new AppError('FORBIDDEN', undefined, { cause: err });
    case 404:
      return new AppError('NOT_FOUND', undefined, { cause: err });
    case 405:
      return new AppError('NOT_FOUND', '지원하지 않는 요청 방식입니다.', { status: 405, cause: err });
    case 413:
      return new AppError('VALIDATION_FAILED', '요청 데이터가 너무 큽니다.', { status: 413, cause: err });
    case 415:
      return new AppError('VALIDATION_FAILED', '지원하지 않는 요청 형식입니다.', { status: 415, cause: err });
    case 429:
      return new AppError('RATE_LIMITED', undefined, { cause: err });
    default:
      return new AppError('VALIDATION_FAILED', '요청이 올바르지 않습니다.', { status: status >= 400 ? status : 400, cause: err });
  }
}

/** 전역 오류/404 처리기를 등록한다 (buildApp 에서 호출). */
export function registerErrorHandling(app: FastifyInstance, opts: ErrorMappingOptions): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appErr = toAppError(err, opts);
    if (appErr.statusCode >= 500) {
      request.log.error({ err: appErr.cause ?? err, code: appErr.code }, '요청 처리 중 서버 오류');
    } else if (appErr.cause !== undefined && !(err instanceof AppError)) {
      request.log.info({ code: appErr.code, reason: (err as Error)?.message }, '요청 오류');
    }
    if (appErr.headers) reply.headers(appErr.headers);
    reply.status(appErr.statusCode).type('application/json; charset=utf-8').send(appErr.toBody());
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body = new AppError('NOT_FOUND', '요청한 주소를 찾을 수 없습니다.').toBody();
    reply.status(404).type('application/json; charset=utf-8').send(body);
  });
}

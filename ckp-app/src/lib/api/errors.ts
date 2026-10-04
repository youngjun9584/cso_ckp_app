import type { ApiErrorBody, ApiErrorCode } from './contract';

/** 서버 오류 코드 + 앱에서만 생기는 오류 코드 */
export type ApiClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'ABORTED' | 'INVALID_RESPONSE';

export const MSG = {
  network: '네트워크에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  timeout: '서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.',
  aborted: '요청이 취소되었습니다.',
  server: '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  invalidResponse: '서버 응답을 해석할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  sessionExpired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  forbidden: '이 작업을 할 수 있는 권한이 없습니다.',
  notFound: '요청한 정보를 찾을 수 없습니다.',
  rateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  unknown: '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
} as const;

export interface ApiErrorInit {
  code: ApiClientErrorCode;
  message: string;
  status?: number;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
}

/**
 * API 호출 실패. message 는 사용자에게 그대로 보여줄 수 있는 한국어 문장이다.
 * - status: HTTP 상태 (응답을 받지 못했으면 0)
 * - isNetwork: 응답을 받지 못함(연결 실패 또는 타임아웃) — 같은 요청을 다시 보내도 안전한 경우에 재시도
 * - isTimeout: 타임아웃
 * - isAborted: 호출한 쪽에서 취소(AbortSignal)
 */
export class ApiError extends Error {
  readonly code: ApiClientErrorCode;
  readonly status: number;
  readonly fields: Record<string, string>;
  readonly details: Record<string, unknown>;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status ?? 0;
    this.fields = init.fields ?? {};
    this.details = init.details ?? {};
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  get isTimeout(): boolean {
    return this.code === 'TIMEOUT';
  }

  get isAborted(): boolean {
    return this.code === 'ABORTED';
  }

  /** 결과가 불확실하거나 일시적인 실패(네트워크·타임아웃·5xx) */
  get isRetryable(): boolean {
    return this.isNetwork || this.status >= 500;
  }

  /** 입력값 문제 등 요청 자체가 거부된 실패(4xx) */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  static network(): ApiError {
    return new ApiError({ code: 'NETWORK_ERROR', message: MSG.network });
  }

  static timeout(): ApiError {
    return new ApiError({ code: 'TIMEOUT', message: MSG.timeout });
  }

  static aborted(): ApiError {
    return new ApiError({ code: 'ABORTED', message: MSG.aborted });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false;
  const err = (value as { error?: unknown }).error;
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

function fallbackForStatus(status: number): { code: ApiClientErrorCode; message: string } {
  if (status === 401) return { code: 'UNAUTHORIZED', message: MSG.sessionExpired };
  if (status === 403) return { code: 'FORBIDDEN', message: MSG.forbidden };
  if (status === 404) return { code: 'NOT_FOUND', message: MSG.notFound };
  if (status === 429) return { code: 'RATE_LIMITED', message: MSG.rateLimited };
  if (status >= 500) return { code: 'SERVER_ERROR', message: MSG.server };
  return { code: 'VALIDATION_FAILED', message: MSG.unknown };
}

/** HTTP 오류 응답(본문 파싱 결과) → ApiError */
export function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorBody(body)) {
    return new ApiError({
      code: body.error.code,
      message: body.error.message || fallbackForStatus(status).message,
      status,
      fields: body.error.fields,
      details: body.error.details,
    });
  }
  return new ApiError({ ...fallbackForStatus(status), status });
}

/** 어떤 오류든 사용자에게 보여줄 한국어 문장으로 */
export function getErrorMessage(error: unknown, fallback: string = MSG.unknown): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/** JSON 이 아닐 수도 있는 응답 본문 파싱 */
export function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

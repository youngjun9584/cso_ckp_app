/**
 * 재시도·대기 도우미 (순수 함수, React Native 의존 없음).
 * 오류는 ApiError 를 직접 import 하지 않고 모양(code/status/isRetryable…)으로 판단한다.
 */

/** 업로드 네트워크성 실패 자동 재시도 간격 (DESIGN §7.2: 2회, 1초·3초) */
export const UPLOAD_RETRY_DELAYS_MS: readonly number[] = [1000, 3000];
/** 제출 결과 불확실 시 같은 요청 자동 재시도 간격 */
export const SUBMIT_RETRY_DELAYS_MS: readonly number[] = [1000, 3000];

export interface ErrorLike {
  code?: string;
  status?: number;
  message?: string;
  isNetwork?: boolean;
  isRetryable?: boolean;
  isAborted?: boolean;
  details?: Record<string, unknown>;
  name?: string;
}

export function asErrorLike(error: unknown): ErrorLike {
  if (!error || typeof error !== 'object') return {};
  return error as ErrorLike;
}

export function isAbortError(error: unknown): boolean {
  const e = asErrorLike(error);
  return e.isAborted === true || e.code === 'ABORTED' || e.name === 'AbortError';
}

/** 응답을 못 받았거나 서버 일시 오류 — 같은 요청을 다시 보내면 되는 경우 */
export function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const e = asErrorLike(error);
  if (e.isRetryable === true || e.isNetwork === true) return true;
  if (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT' || e.code === 'INVALID_RESPONSE' || e.code === 'RATE_LIMITED') return true;
  const status = e.status ?? 0;
  return status >= 500 || status === 429;
}

export function errorMessage(error: unknown, fallback: string): string {
  const e = asErrorLike(error);
  return typeof e.message === 'string' && e.message.trim() ? e.message : fallback;
}

export class AbortedError extends Error {
  readonly isAborted = true;
  readonly code = 'ABORTED';
  constructor() {
    super('요청이 취소되었습니다.');
    this.name = 'AbortError';
  }
}

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

/** signal 로 취소할 수 있는 대기 */
export const sleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new AbortedError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface RetryOptions {
  /** 재시도 전 대기 시간들 — 길이 = 최대 재시도 횟수 */
  delays: readonly number[];
  shouldRetry: (error: unknown) => boolean;
  signal?: AbortSignal;
  sleep?: SleepFn;
  /** 재시도 직전 (attempt 는 다음 시도 번호, 1부터) */
  onRetry?: (nextAttempt: number, error: unknown, delayMs: number) => void;
}

/** fn 을 실행하고, shouldRetry 인 실패면 delays 만큼 기다렸다가 다시 실행한다. attempt 는 1부터. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const wait = options.sleep ?? sleep;
  let attempt = 1;
  for (;;) {
    if (options.signal?.aborted) throw new AbortedError();
    try {
      return await fn(attempt);
    } catch (error) {
      const retryIndex = attempt - 1;
      if (retryIndex >= options.delays.length || !options.shouldRetry(error) || options.signal?.aborted) throw error;
      const delay = options.delays[retryIndex];
      options.onRetry?.(attempt + 1, error, delay);
      await wait(delay, options.signal);
      attempt += 1;
    }
  }
}

/** 타임아웃이 있는 Promise (시간이 지나면 onTimeout 오류로 reject) */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

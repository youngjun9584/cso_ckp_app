/**
 * 제출 파이프라인 핵심 (DESIGN §7.2) — 의존성을 주입받는 순수 로직이라 단위 점검이 가능하다.
 *   1) runUploadBatch: 아직 업로드되지 않은 사진만 동시 3장, 네트워크성 실패는 자동 재시도(1s, 3s)
 *   2) buildSubmissionRequest: 화면 순서 그대로 seq 1..N
 *   3) submitWithRetry: 같은 Idempotency-Key·같은 본문으로만 재시도(결과 불확실 시)
 */
import type {
  EdiSubmissionCreateRequest,
  EdiSubmissionCreateResponse,
} from '@/lib/api/contract';
import { runPool } from './pool';
import { asErrorLike, errorMessage, isAbortError, isTransientError, withRetry, type SleepFn } from './retry';
import type { DraftData, DraftPhoto, PhotoUpload } from './types';
import { uploadCandidates } from './progress';

export const UPLOAD_CONCURRENCY = 3;

/** 이 오류가 나면 남은 업로드를 모두 멈춘다 (차단·로그인 만료·서버 DB 미준비 등 — 계속 보내도 같은 결과) */
const FATAL_UPLOAD_CODES = new Set(['EDI_DISABLED', 'UNAUTHORIZED', 'FORBIDDEN', 'SCHEMA_NOT_READY']);
/**
 * 5xx 지만 결과가 확정된 제출 오류 — 서버가 트랜잭션 전에 거절했거나 롤백했으므로 저장되지 않았고, 다시 보내도 같은 결과다.
 * (SCHEMA_NOT_READY: 필요한 테이블·컬럼 없음 → 관리자 조치 필요)
 */
const DEFINITE_SERVER_CODES = new Set(['SCHEMA_NOT_READY']);
/** 같은 사진을 다시 보내도 같은 결과인 업로드 오류 → 사진 제거 안내 */
const PERMANENT_UPLOAD_CODES = new Set([
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
  'IMAGE_TOO_SMALL',
  'IMAGE_DECODE_FAILED',
  'VALIDATION_FAILED',
]);

export function isFatalUploadError(error: unknown): boolean {
  return FATAL_UPLOAD_CODES.has(asErrorLike(error).code ?? '');
}

/** 제출 응답이 불확실해 같은 요청으로 다시 확인해야 하는 오류인지 (확정 5xx 는 제외) */
export function isUncertainSubmitError(error: unknown): boolean {
  return isTransientError(error) && !DEFINITE_SERVER_CODES.has(asErrorLike(error).code ?? '');
}

export interface UploadBatchDeps {
  upload: (photo: DraftPhoto, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<{ uploadId: string }>;
  onPhotoUpdate: (localId: string, patch: Partial<PhotoUpload>) => void;
  signal: AbortSignal;
  delays: readonly number[];
  concurrency?: number;
  sleep?: SleepFn;
}

export interface UploadBatchResult {
  /** 이번에 업로드한 사진 localId */
  uploaded: string[];
  failed: { localId: string; message: string; retryable: boolean }[];
  /** 전체를 멈추게 한 오류 (EDI_DISABLED 등) */
  fatal: unknown;
  aborted: boolean;
}

const UPLOAD_FAILED_FALLBACK = '사진을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 업로드되지 않은 사진만 올린다. 예외를 던지지 않고 결과를 모아 돌려준다. */
export async function runUploadBatch(photos: readonly DraftPhoto[], deps: UploadBatchDeps): Promise<UploadBatchResult> {
  const candidates = uploadCandidates(photos);
  const result: UploadBatchResult = { uploaded: [], failed: [], fatal: null, aborted: false };
  if (candidates.length === 0) return result;

  // 치명적 오류가 나면 나머지를 멈추기 위한 내부 신호 (바깥 signal 도 따른다)
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  if (deps.signal.aborted) inner.abort();
  else deps.signal.addEventListener('abort', onOuterAbort, { once: true });

  const started = new Set<string>();
  for (const p of candidates) {
    deps.onPhotoUpdate(p.localId, { state: 'queued', progress: 0, error: undefined, retryable: undefined });
  }

  try {
    await runPool(
      candidates,
      deps.concurrency ?? UPLOAD_CONCURRENCY,
      async (photo) => {
        if (inner.signal.aborted) return;
        started.add(photo.localId);
        const baseAttempts = photo.upload.attempts;
        deps.onPhotoUpdate(photo.localId, { state: 'uploading', progress: 0 });
        try {
          const res = await withRetry(
            (attempt) => {
              deps.onPhotoUpdate(photo.localId, { attempts: baseAttempts + attempt });
              return deps.upload(photo, (fraction) => deps.onPhotoUpdate(photo.localId, { progress: fraction }), inner.signal);
            },
            {
              delays: deps.delays,
              shouldRetry: (e) => isTransientError(e) && !isFatalUploadError(e),
              signal: inner.signal,
              sleep: deps.sleep,
              onRetry: () => deps.onPhotoUpdate(photo.localId, { progress: 0 }),
            },
          );
          deps.onPhotoUpdate(photo.localId, {
            state: 'uploaded',
            uploadId: res.uploadId,
            progress: 1,
            error: undefined,
            retryable: undefined,
          });
          result.uploaded.push(photo.localId);
        } catch (error) {
          if (isAbortError(error) || inner.signal.aborted) {
            if (isFatalUploadError(error) && !result.fatal) result.fatal = error;
            deps.onPhotoUpdate(photo.localId, { state: 'idle', progress: 0 });
            if (!result.fatal) result.aborted = true;
            return;
          }
          if (isFatalUploadError(error)) {
            if (!result.fatal) result.fatal = error;
            deps.onPhotoUpdate(photo.localId, { state: 'idle', progress: 0 });
            inner.abort();
            return;
          }
          const code = asErrorLike(error).code ?? '';
          const retryable = !PERMANENT_UPLOAD_CODES.has(code);
          const message = errorMessage(error, UPLOAD_FAILED_FALLBACK);
          deps.onPhotoUpdate(photo.localId, { state: 'failed', progress: 0, error: message, retryable });
          result.failed.push({ localId: photo.localId, message, retryable });
        }
      },
      inner.signal,
    );
  } finally {
    deps.signal.removeEventListener('abort', onOuterAbort);
  }

  // 멈춰서 시작하지 못한 사진은 '대기' 표시를 지운다
  for (const p of candidates) {
    if (!started.has(p.localId)) deps.onPhotoUpdate(p.localId, { state: 'idle', progress: 0 });
  }
  if (inner.signal.aborted && !result.fatal) result.aborted = true;
  return result;
}

/**
 * 화면 순서대로 제출 본문을 만든다. 준비된 사진이 모두 업로드되어 있어야 한다(아니면 null).
 * 처리 중·처리 불가 사진이 남아 있어도 null (2단계에서 막지만 한 번 더 확인).
 */
export function buildSubmissionRequest(
  draft: Pick<DraftData, 'client' | 'memo' | 'photos'>,
  targetYm: string | null,
): EdiSubmissionCreateRequest | null {
  if (!draft.client || !targetYm) return null;
  if (draft.photos.length === 0 || draft.photos.some((p) => p.state !== 'ready')) return null;
  const photos: EdiSubmissionCreateRequest['photos'] = [];
  for (const [i, p] of draft.photos.entries()) {
    if (p.upload.state !== 'uploaded' || !p.upload.uploadId) return null;
    photos.push({ uploadId: p.upload.uploadId, seq: i + 1 });
  }
  const memo = draft.memo.trim();
  return { clientIdx: draft.client.idx, targetYm, memo: memo ? memo : null, photos };
}

export type SubmitOutcome =
  | { kind: 'success'; response: EdiSubmissionCreateResponse; attempts: number }
  /** 자동 재시도까지 응답이 불확실 — 편집 잠금 유지, 같은 요청으로 다시 시도해야 함 */
  | { kind: 'uncertain'; error: unknown; attempts: number }
  /** 서버가 확정적으로 거절 (4xx, SCHEMA_NOT_READY 같은 확정 5xx) */
  | { kind: 'rejected'; error: unknown; code: string; message: string; missingUploadIds: string[] }
  | { kind: 'aborted' };

export interface SubmitDeps {
  create: (request: EdiSubmissionCreateRequest, idempotencyKey: string, signal: AbortSignal) => Promise<EdiSubmissionCreateResponse>;
  delays: readonly number[];
  signal: AbortSignal;
  sleep?: SleepFn;
  onAttempt?: (attempt: number) => void;
}

const REJECTED_FALLBACK = '등록하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.';

/** 같은 request·같은 idempotencyKey 로만 보낸다(재시도 포함). 예외를 던지지 않는다. */
export async function submitWithRetry(
  request: EdiSubmissionCreateRequest,
  idempotencyKey: string,
  deps: SubmitDeps,
): Promise<SubmitOutcome> {
  let attempts = 0;
  try {
    const response = await withRetry(
      (attempt) => {
        attempts = attempt;
        deps.onAttempt?.(attempt);
        return deps.create(request, idempotencyKey, deps.signal);
      },
      { delays: deps.delays, shouldRetry: isUncertainSubmitError, signal: deps.signal, sleep: deps.sleep },
    );
    return { kind: 'success', response, attempts };
  } catch (error) {
    if (isAbortError(error)) return { kind: 'aborted' };
    if (isUncertainSubmitError(error)) return { kind: 'uncertain', error, attempts };
    const e = asErrorLike(error);
    const missing = Array.isArray(e.details?.missing) ? (e.details.missing as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return {
      kind: 'rejected',
      error,
      code: e.code ?? 'UNKNOWN',
      message: errorMessage(error, REJECTED_FALLBACK),
      missingUploadIds: missing,
    };
  }
}

/** 확정 거절 코드별 앱 동작 */
export type RejectAction = 'reupload' | 'back-to-step1' | 'conflict' | 'stay';

export function rejectAction(code: string): RejectAction {
  if (code === 'UPLOAD_NOT_FOUND') return 'reupload';
  if (code === 'EDI_DISABLED' || code === 'SCHEMA_NOT_READY' || code === 'CLIENT_NOT_SELECTABLE' || code === 'NOT_FOUND') return 'back-to-step1';
  // 같은 키로 다른 내용이 이미 등록됨 / 사진이 이미 등록에 쓰임 → 이 작성 건은 이미 등록되었을 수 있다.
  // 새 키로 조용히 다시 보내면 두 번 등록될 수 있으므로 키를 바꾸지 않고 사용자에게 내역 확인·새 작성 건 시작을 맡긴다.
  if (code === 'IDEMPOTENCY_CONFLICT' || code === 'UPLOAD_ALREADY_USED') return 'conflict';
  return 'stay';
}

/**
 * EDI 제출 컨트롤러 (DESIGN §7.2) — 유일한 제출 진입점.
 * 화면과 무관하게 모듈 수준에서 돈다: 사용자가 화면을 나가도 업로드·제출은 계속되고 결과는 useEdiDraft 에 반영된다.
 *
 *   startSubmit()                  편집 잠금 → 미업로드 사진만 업로드(동시 3, 자동 재시도 2회) → 제출
 *   retryPendingSubmission()       결과 불확실 상태에서 **같은 키·같은 본문**으로 다시 확인
 *   unlockUncertainSubmission()    결과 불확실 상태에서 사용자가 고른 [편집으로 돌아가기] (키 유지)
 *   abortSubmission()              초기화·사용자 변경 시에만 사용
 *   abortSubmissionForSessionEnd() 로그아웃·세션 만료 시 (다음 로그인 사용자의 세션으로 이어지지 않게)
 *
 * 규칙
 * - 업로드 실패가 하나라도 있으면 편집으로 돌아가고 '사진 N장 업로드에 실패했습니다.' (업로드 완료분은 다시 보내지 않음)
 * - 제출 응답이 불확실(네트워크·타임아웃·5xx·로그인 만료)하면 잠금을 유지하고 pendingRequest 를 그대로 다시 보낸다 — 키를 바꾸지 않는다.
 * - 409 IDEMPOTENCY_CONFLICT 는 새 키로 다시 보내지 않는다 → 'conflict' 안내(내역 확인 / 새로 작성하기).
 * - 201/200 을 받은 뒤에만 완료(phase='done').
 */
import { Platform } from 'react-native';

import { getApi } from '@/lib/api';
import type { EdiSubmissionCreateRequest } from '@/lib/api/contract';
import { queryClient } from '@/lib/query';
import { buildSubmissionRequest, runUploadBatch, submitWithRetry, type SubmitOutcome } from '../draft/pipeline';
import { LEAVE_MESSAGE_UPLOADING, leaveMessage, step2Blocker } from '../draft/progress';
import { SUBMIT_RETRY_DELAYS_MS, UPLOAD_RETRY_DELAYS_MS, asErrorLike, errorMessage } from '../draft/retry';
import { ediDraftStore } from '../draft/store';
import { applySubmitFailure, uncertainNotice, unlockUncertain } from '../draft/submit-state';
import type { PhotoUpload, SubmitNotice } from '../draft/types';
import { releaseProcessed } from '../media/cleanup';
import { EDI_HISTORY_QUERY_KEY, EDI_STATUS_QUERY_KEY } from './queries';

const MSG_UNEXPECTED = '등록 중 문제가 발생했습니다. 입력 내용은 그대로 있으니 다시 시도해 주세요.';
const MSG_UPLOAD_STOPPED_SESSION = '로그인이 끝나 업로드를 멈췄습니다. 다시 로그인한 뒤 등록해 주세요. 이미 올린 사진은 다시 보내지 않습니다.';

let running = false;
let controller: AbortController | null = null;
/** 로그아웃·세션 만료로 멈췄는지 (안내 문구용, 다음 시작 때 초기화) */
let sessionEnded = false;

export function isSubmitRunning(): boolean {
  return running;
}

/** 진행 중인 업로드·제출 요청을 취소한다 (작성 건 초기화·로그인 사용자 변경 시) */
export function abortSubmission(): void {
  controller?.abort();
}

/** 로그아웃·세션 만료: 남은 업로드·제출 재시도가 다음 사용자의 토큰으로 나가지 않게 멈춘다 (결과 불확실이면 잠금은 유지) */
export function abortSubmissionForSessionEnd(): void {
  sessionEnded = true;
  controller?.abort();
}

// ── 웹: 새로고침/탭 닫기 확인 — 업로드·제출 중이거나 작성 내용이 있으면 (화면을 나가 있어도 동작, draft 는 메모리에만 있다) ──
let unloadHandler: ((event: BeforeUnloadEvent) => string) | null = null;

function currentUnloadMessage(): string | null {
  return running ? LEAVE_MESSAGE_UPLOADING : leaveMessage(ediDraftStore.get());
}

function syncUnloadGuard(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const on = currentUnloadMessage() !== null;
  if (on && !unloadHandler) {
    unloadHandler = (event: BeforeUnloadEvent) => {
      const message = currentUnloadMessage() ?? LEAVE_MESSAGE_UPLOADING;
      event.preventDefault();
      // 일부 브라우저는 returnValue 를 설정해야 확인창을 띄운다 (문구는 브라우저 기본 문구로 표시됨)
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', unloadHandler);
  } else if (!on && unloadHandler) {
    window.removeEventListener('beforeunload', unloadHandler);
    unloadHandler = null;
  }
}

// 작성 내용이 생기거나 비워질 때마다 맞춘다 (리스너를 붙이고 떼는 일은 켜짐/꺼짐이 바뀔 때만 한다)
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  ediDraftStore.subscribe(() => syncUnloadGuard());
}

const isCurrent = (key: string) => ediDraftStore.get().idempotencyKey === key;

function backToEditing(notice: SubmitNotice | null): void {
  const store = ediDraftStore.get();
  store.setPhase('editing');
  store.setSubmit({ stage: 'idle', notice, pendingRequest: null });
}

/** 진행률 이벤트가 매우 잦으므로 사진별로 3% 또는 150ms 단위로만 반영한다 */
function createUploadUpdater(key: string) {
  const last = new Map<string, { progress: number; at: number }>();
  return (localId: string, patch: Partial<PhotoUpload>) => {
    if (!isCurrent(key)) return;
    if (patch.progress !== undefined) {
      const now = Date.now();
      const onlyProgress = Object.keys(patch).length === 1;
      const prev = last.get(localId);
      if (onlyProgress && prev && patch.progress < 1 && Math.abs(patch.progress - prev.progress) < 0.03 && now - prev.at < 150) return;
      last.set(localId, { progress: patch.progress, at: now });
    }
    ediDraftStore.get().patchUpload(localId, patch);
  };
}

export interface SubmitLimits {
  minPhotos: number;
  maxPhotos: number;
}

/** [사진 N장 등록하기] / [실패한 사진만 다시 시도] / [다시 등록하기] */
export async function startSubmit(limits: SubmitLimits): Promise<void> {
  if (running) return;
  const state = ediDraftStore.get();
  if (state.phase === 'submitting') {
    if (state.submit.stage === 'uncertain') await retryPendingSubmission();
    return;
  }
  if (state.phase !== 'editing') return;
  // 이미 등록되었을 수 있는 작성 건 — 사용자가 내역을 확인하고 새 작성 건을 직접 시작해야 한다(키를 바꿔 다시 보내지 않음)
  if (state.submit.notice?.kind === 'conflict') return;

  if (!state.client || !state.targetYm) {
    state.setStep(1);
    state.setSubmit({ notice: { kind: 'rejected', code: 'CLIENT_CHECK', message: '거래처와 대상 연월을 확인해 주세요.' } });
    return;
  }
  const blocker = step2Blocker(state.photos, limits.minPhotos, limits.maxPhotos);
  if (blocker) {
    state.setStep(2);
    state.setSubmit({ notice: { kind: 'rejected', code: 'PHOTO_CHECK', message: blocker } });
    return;
  }

  running = true;
  sessionEnded = false;
  const ac = new AbortController();
  controller = ac;
  const key = state.idempotencyKey;
  state.setPhase('submitting');
  state.setSubmit({ stage: 'uploading', notice: null, pendingRequest: null });
  syncUnloadGuard();

  const api = getApi();
  try {
    const batch = await runUploadBatch(ediDraftStore.get().photos, {
      signal: ac.signal,
      delays: UPLOAD_RETRY_DELAYS_MS,
      onPhotoUpdate: createUploadUpdater(key),
      upload: async (photo, onProgress, signal) => {
        const processed = photo.processed;
        if (!processed) throw Object.assign(new Error('처리된 사진이 없습니다. 사진을 제거하고 다시 선택해 주세요.'), { code: 'IMAGE_DECODE_FAILED' });
        const res = await api.uploadEdiPhoto(
          {
            uri: processed.uri,
            name: `edi-${photo.localId}.jpg`,
            type: 'image/jpeg',
            width: processed.width,
            height: processed.height,
            bytes: processed.bytes,
          },
          photo.localId,
          (progress) => onProgress(progress.fraction),
          signal,
        );
        return { uploadId: res.upload.uploadId };
      },
    });
    if (!isCurrent(key)) return;

    if (batch.fatal) {
      const code = asErrorLike(batch.fatal).code ?? 'UNKNOWN';
      if (code === 'EDI_DISABLED' || code === 'SCHEMA_NOT_READY') {
        void queryClient.invalidateQueries({ queryKey: EDI_STATUS_QUERY_KEY });
        ediDraftStore.get().setStep(1);
      }
      backToEditing({ kind: 'rejected', code, message: errorMessage(batch.fatal, '사진을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.') });
      return;
    }
    if (batch.aborted) {
      backToEditing(sessionEnded ? { kind: 'rejected', code: 'UNAUTHORIZED', message: MSG_UPLOAD_STOPPED_SESSION } : null);
      return;
    }
    if (batch.failed.length > 0) {
      backToEditing({ kind: 'upload-failed', count: batch.failed.length, message: `사진 ${batch.failed.length}장 업로드에 실패했습니다.` });
      return;
    }

    const fresh = ediDraftStore.get();
    const request = buildSubmissionRequest(fresh, fresh.targetYm);
    if (!request) {
      backToEditing({ kind: 'rejected', code: 'PHOTO_CHECK', message: '등록할 사진 정보를 확인하지 못했습니다. 다시 시도해 주세요.' });
      return;
    }
    fresh.setSubmit({ stage: 'creating', pendingRequest: request });
    await sendSubmission(request, key, ac.signal);
  } catch {
    if (isCurrent(key)) {
      // 제출 요청을 이미 만들었다면 서버에 도착했을 수 있으므로 잠금을 유지한다
      if (ediDraftStore.get().submit.pendingRequest) ediDraftStore.get().setSubmit({ stage: 'uncertain', notice: uncertainNotice(null, { sessionEnded }) });
      else backToEditing({ kind: 'rejected', code: 'UNEXPECTED', message: MSG_UNEXPECTED });
    }
  } finally {
    running = false;
    if (controller === ac) controller = null;
    syncUnloadGuard();
  }
}

/** 결과 불확실 상태에서 [다시 시도] — 저장해 둔 본문과 키를 그대로 보낸다 */
export async function retryPendingSubmission(): Promise<void> {
  if (running) return;
  const state = ediDraftStore.get();
  const request = state.submit.pendingRequest;
  if (state.phase !== 'submitting' || state.submit.stage !== 'uncertain' || !request) return;

  running = true;
  sessionEnded = false;
  const ac = new AbortController();
  controller = ac;
  const key = state.idempotencyKey;
  state.setSubmit({ stage: 'creating', notice: null });
  syncUnloadGuard();
  try {
    await sendSubmission(request, key, ac.signal);
  } catch {
    if (isCurrent(key)) ediDraftStore.get().setSubmit({ stage: 'uncertain', notice: uncertainNotice(null, { sessionEnded }) });
  } finally {
    running = false;
    if (controller === ac) controller = null;
    syncUnloadGuard();
  }
}

/**
 * 결과 불확실 상태에서 [편집으로 돌아가기] — 서버가 같은 오류를 계속 돌려줄 때의 탈출구(화면에서 확인 대화상자 뒤에 호출).
 * 키는 그대로 둔다: 같은 내용이면 서버가 기존 결과를 돌려주고, 내용을 바꿨는데 이미 등록돼 있으면 409 → 'conflict' 안내.
 */
export function unlockUncertainSubmission(): boolean {
  if (running) return false;
  return unlockUncertain(ediDraftStore.get);
}

async function sendSubmission(request: EdiSubmissionCreateRequest, key: string, signal: AbortSignal): Promise<void> {
  const api = getApi();
  const outcome = await submitWithRetry(request, key, {
    create: (body, idempotencyKey, s) => api.createEdiSubmission(body, idempotencyKey, { signal: s }),
    delays: SUBMIT_RETRY_DELAYS_MS,
    signal,
  });
  if (!isCurrent(key)) return;
  applyOutcome(outcome);
}

function applyOutcome(outcome: SubmitOutcome): void {
  if (outcome.kind !== 'success') {
    // 불확실·로그인 만료 → 잠금·pendingRequest·키 유지 / 확정 거절 → 편집 복귀 (draft/submit-state.ts)
    const effects = applySubmitFailure(ediDraftStore.get, outcome, { sessionEnded });
    if (effects.refreshStatus) void queryClient.invalidateQueries({ queryKey: EDI_STATUS_QUERY_KEY });
    return;
  }
  const store = ediDraftStore.get();
  const sample = getApi().mode === 'sample';
  for (const photo of store.photos) {
    // 샘플 모드(native)는 내역 사진이 이 파일을 가리키므로 업로드된 파일은 남긴다
    releaseProcessed(photo.processed, { keepFiles: sample && photo.upload.state === 'uploaded' });
  }
  store.complete(outcome.response.submission, { sample, replayed: outcome.response.replayed });
  void queryClient.invalidateQueries({ queryKey: EDI_HISTORY_QUERY_KEY });
}

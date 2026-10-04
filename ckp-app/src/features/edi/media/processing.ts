/**
 * 사진 처리 큐 (동시 2장, DESIGN §7.2). 화면과 무관하게 모듈 수준에서 돈다 — 탭을 옮겨도 계속 처리된다.
 * 결과는 useEdiDraft 에 반영하며, 그 사이 사진이 지워졌거나 작성 건이 초기화됐으면 결과 파일을 바로 정리한다.
 * native: 처리가 끝나면(성공·실패·취소 모두) 선택기가 캐시에 만든 원본 복사본을 지운다 — 이후에는 처리본만 쓴다.
 *         (원본을 그대로 올리는 경우만 예외: 그때는 처리본 = 원본이라 사진을 지울 때 함께 정리된다)
 */
import { TaskQueue } from '../draft/pool';
import { withTimeout } from '../draft/retry';
import { ediDraftStore } from '../draft/store';
import { releaseProcessed, releaseSource } from './cleanup';
import { processPhoto } from './process';
import { MSG_PROCESS_FAILED, MSG_PROCESS_TIMEOUT, type ProcessInput, type ProcessLimits, type ProcessResult } from './types';

const PROCESS_CONCURRENCY = 2;
/** 한 장이 이보다 오래 걸리면 처리할 수 없는 사진으로 표시 (디코더가 멈추는 경우 대비) */
const PROCESS_TIMEOUT_MS = 90_000;

const queue = new TaskQueue(PROCESS_CONCURRENCY);
/** 아직 시작하지 않은 작업의 원본 (취소되면 여기서 지운다) */
const queuedSources = new Map<string, string>();

class ProcessTimeoutError extends Error {}

function stillWaiting(localId: string, draftKey: string): boolean {
  const state = ediDraftStore.get();
  return state.idempotencyKey === draftKey && state.photos.some((p) => p.localId === localId && p.state === 'processing');
}

function usesSource(result: ProcessResult, uri: string): boolean {
  return result.ok && (result.processed.uri === uri || result.processed.thumbUri === uri);
}

/** 사진 1장 처리를 예약한다. 사진은 이미 'processing' 상태로 draft 에 들어가 있어야 한다. */
export function enqueueProcessing(input: ProcessInput, limits: ProcessLimits): void {
  const draftKey = ediDraftStore.get().idempotencyKey;
  queuedSources.set(input.localId, input.uri);
  queue.add(input.localId, async () => {
    queuedSources.delete(input.localId);
    if (!stillWaiting(input.localId, draftKey)) {
      releaseSource(input.uri);
      return;
    }

    const work = processPhoto(input, limits);
    let result: ProcessResult;
    let decoderBusy = false;
    try {
      result = await withTimeout(work, PROCESS_TIMEOUT_MS, () => new ProcessTimeoutError());
    } catch (error) {
      if (error instanceof ProcessTimeoutError) {
        // 늦게 끝나더라도 만든 파일은 버리고, 디코더가 원본을 다 읽은 뒤에 원본 복사본도 지운다
        decoderBusy = true;
        void work
          .then((late) => (late.ok ? releaseProcessed(late.processed) : undefined))
          .catch(() => undefined)
          .finally(() => releaseSource(input.uri));
        result = { ok: false, reason: MSG_PROCESS_TIMEOUT };
      } else {
        result = { ok: false, reason: MSG_PROCESS_FAILED };
      }
    }
    if (!decoderBusy && !usesSource(result, input.uri)) releaseSource(input.uri);

    if (!stillWaiting(input.localId, draftKey)) {
      if (result.ok) releaseProcessed(result.processed);
      return;
    }
    const store = ediDraftStore.get();
    if (result.ok) store.updatePhoto(input.localId, { state: 'ready', processed: result.processed, invalidReason: undefined });
    else store.updatePhoto(input.localId, { state: 'invalid', invalidReason: result.reason });
  });
}

/** 아직 시작하지 않은 처리를 취소 (이미 처리 중이면 끝난 뒤 결과를 버린다) */
export function cancelProcessing(localId: string): void {
  if (queue.cancel(localId)) releaseSource(queuedSources.get(localId));
  queuedSources.delete(localId);
}

export function cancelAllProcessing(): void {
  queue.cancelAll();
  for (const uri of queuedSources.values()) releaseSource(uri);
  queuedSources.clear();
}

/** 대기·실행 중인 처리 작업이 없는지 */
export function isProcessingIdle(): boolean {
  return queue.size === 0;
}

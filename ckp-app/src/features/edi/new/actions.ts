/**
 * 작성 화면의 상위 동작: 사진 추가·삭제·초기화. 상태 변경(store)과 부수 효과(처리 큐·파일 정리)를 한곳에서 묶는다.
 * 사진을 지우는 모든 경로는 여기를 거쳐야 blob URL/처리 파일/선택기 임시 복사본이 새지 않는다.
 */
import type { EdiLimits } from '@/lib/api';
import { sessionEvents } from '@/lib/auth/session-events';
import { remainingCapacity } from '../draft/overflow';
import { countPhotos } from '../draft/progress';
import { newUuid } from '../draft/random';
import { ediDraftStore } from '../draft/store';
import type { DraftPhoto } from '../draft/types';
import { releaseProcessed, releaseSource, sweepStaleMediaCache } from '../media/cleanup';
import { SOURCE_MAX_BYTES, checkDeclaredType, displayName, sourceTooLargeReason, unsupportedReason } from '../media/file-type';
import { cancelAllProcessing, cancelProcessing, enqueueProcessing, isProcessingIdle } from '../media/processing';
import type { PickedFile } from '../media/types';
import { abortSubmission, abortSubmissionForSessionEnd } from './submit';

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface PreparedFiles {
  /** 추가할 수 있는 파일(형식·크기 1차 통과), 가져온 순서 그대로 */
  acceptable: PickedFile[];
  /** 추가하지 않은 파일과 이유 (화면에 목록으로 안내) */
  rejected: RejectedFile[];
}

/**
 * 선택 직후 1차 확인: 동영상·지원하지 않는 형식·50MB 초과 파일은 이유와 함께 따로 모은다.
 * 거절한 파일의 선택기 임시 복사본(native)은 여기서 바로 지운다(화면은 이름·이유만 보여 준다).
 */
export function prepareFiles(files: readonly PickedFile[]): PreparedFiles {
  const acceptable: PickedFile[] = [];
  const rejected: RejectedFile[] = [];
  files.forEach((file, i) => {
    const name = displayName(file.name, i + 1);
    let reason: string | null = null;
    if (file.assetType === 'video' || file.assetType === 'pairedVideo') {
      reason = unsupportedReason('video');
    } else {
      const type = checkDeclaredType(file.name, file.mimeType);
      if (!type.supported) reason = type.reason ?? unsupportedReason('other');
      else if (file.size !== null && file.size > SOURCE_MAX_BYTES) reason = sourceTooLargeReason(file.size);
    }
    if (reason === null) {
      acceptable.push(file);
    } else {
      rejected.push({ name, reason });
      releaseSource(file.uri);
    }
  });
  return { acceptable, rejected };
}

/** draft 에 넣지 않기로 한 파일(초과분·취소 등)의 선택기 임시 복사본을 지운다 (웹은 할 일 없음) */
export function discardPickedFiles(files: readonly PickedFile[]): void {
  for (const file of files) releaseSource(file.uri);
}

export interface AddResult {
  added: number;
  /** 추가하는 사이 남은 수가 줄어 넣지 못한 장수 (화면에서 안내) */
  notAdded: number;
}

/**
 * 파일을 순서대로 draft 뒤에 붙이고 처리 큐에 넣는다.
 * 호출 전에 화면이 초과 안내로 개수를 맞추지만, 그 사이 상태가 바뀌었을 수 있어 여기서 한 번 더 30장을 지킨다.
 */
export function addFiles(files: readonly PickedFile[], limits: EdiLimits): AddResult {
  const state = ediDraftStore.get();
  if (state.phase !== 'editing' || files.length === 0) {
    discardPickedFiles(files);
    return { added: 0, notAdded: files.length };
  }
  const counts = countPhotos(state.photos);
  const room = remainingCapacity(counts.counted, limits.ediMaxPhotos);
  const accepted = files.slice(0, room);
  discardPickedFiles(files.slice(accepted.length));

  const photos: DraftPhoto[] = accepted.map((file, i) => {
    const localId = newUuid();
    return {
      localId,
      sourceName: displayName(file.name, state.photos.length + i + 1),
      sourceUri: file.uri || `web-file:${localId}`,
      sourceMime: file.mimeType,
      width: file.width,
      height: file.height,
      bytes: file.size,
      state: 'processing',
      upload: { state: 'idle', progress: 0, attempts: 0 },
    };
  });
  state.addPhotos(photos);

  const processLimits = { minLongSide: limits.photoMinLongSide, maxBytes: limits.photoMaxBytes };
  photos.forEach((photo, i) => {
    const file = accepted[i];
    enqueueProcessing(
      {
        localId: photo.localId,
        name: file.name,
        uri: file.uri,
        mimeType: file.mimeType,
        size: file.size,
        width: file.width,
        height: file.height,
        blob: file.blob,
      },
      processLimits,
    );
  });
  return { added: photos.length, notAdded: files.length - accepted.length };
}

/**
 * 사진 1장의 파일을 모두 정리한다: 처리본·썸네일 + 선택기 임시 복사본.
 * 아직 처리 중인 사진의 원본은 처리 작업이 끝나면서 지운다(대기 중이던 작업은 cancelProcessing 이 지운다).
 */
function releasePhotoFiles(photo: DraftPhoto): void {
  releaseProcessed(photo.processed);
  if (photo.state !== 'processing') releaseSource(photo.sourceUri);
}

/** 사진 삭제 (제출 중에는 store 가 무시한다) */
export function removePhotos(localIds: readonly string[]): number {
  const removed = ediDraftStore.get().removePhotos(localIds);
  for (const photo of removed) {
    cancelProcessing(photo.localId);
    releasePhotoFiles(photo);
  }
  return removed.length;
}

export function removeInvalidPhotos(): number {
  const ids = ediDraftStore
    .get()
    .photos.filter((p) => p.state === 'invalid')
    .map((p) => p.localId);
  return removePhotos(ids);
}

function releaseAll(photos: readonly DraftPhoto[]): void {
  for (const photo of photos) releasePhotoFiles(photo);
}

/** 새 작성 건으로 초기화 (새 idempotencyKey). 진행 중인 제출·처리는 멈춘다. */
export function resetDraft(): void {
  abortSubmission();
  cancelAllProcessing();
  releaseAll(ediDraftStore.get().reset());
}

let staleCacheChecked = false;

/** 로그인 사용자가 바뀌었으면 이전 사용자의 작성 내용을 버린다 (작성 화면이 열릴 때 호출) */
export function ensureDraftOwner(usrId: string | null): void {
  const state = ediDraftStore.get();
  // 이전 실행(강제 종료 등)이 캐시에 남긴 처리 파일·선택기 복사본을 정리한다. draft·샘플 내역은 메모리에만 있으므로
  // 이번 실행에서 처음 작성 화면이 열린 시점(아직 사진을 하나도 넣기 전)에는 그 파일을 가리키는 곳이 없다 — 한 번만.
  if (!staleCacheChecked) {
    staleCacheChecked = true;
    if (state.photos.length === 0 && isProcessingIdle()) sweepStaleMediaCache();
  }
  if (state.ownerUsrId === usrId) return;
  if (state.ownerUsrId !== null) {
    abortSubmission();
    cancelAllProcessing();
  }
  releaseAll(state.ensureOwner(usrId));
}

/**
 * 로그아웃: 이 기기에 남은 작성 건을 버린다. 진행 중인 업로드·제출 재시도를 먼저 멈춰
 * 이전 사용자의 사진이 다음에 로그인한 사용자의 세션으로 올라가지 않게 한다.
 */
export function discardDraftForSignOut(): void {
  abortSubmissionForSessionEnd();
  cancelAllProcessing();
  releaseAll(ediDraftStore.get().reset(null));
}

// 로그인 상태가 끝나면(AuthProvider) 화면 밖에서 도는 업로드·제출을 멈춘다.
// 세션 만료는 같은 사용자가 다시 로그인해 [다시 시도]할 수 있게 작성 건을 남기고(잠금·키 유지), 로그아웃은 작성 건을 버린다.
sessionEvents.onSignedOut((reason) => {
  if (reason === 'logout') discardDraftForSignOut();
  else abortSubmissionForSessionEnd();
});

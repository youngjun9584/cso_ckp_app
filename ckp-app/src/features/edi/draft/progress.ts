/**
 * 사진 상태 집계·단계 검증 (순수 함수). 화면 문구는 한국어로 여기서 만든다.
 */
import type { DraftData, DraftPhoto, SubmitStatus } from './types';

/** 합계·순번에 포함되는 사진 (처리 중 + 준비됨). invalid 는 제외. */
export const isCountedPhoto = (photo: DraftPhoto): boolean => photo.state !== 'invalid';

export interface PhotoCounts {
  /** 합계(카운터) = 처리 중 + 준비됨 */
  counted: number;
  processing: number;
  ready: number;
  invalid: number;
}

export function countPhotos(photos: readonly DraftPhoto[]): PhotoCounts {
  let processing = 0;
  let ready = 0;
  let invalid = 0;
  for (const p of photos) {
    if (p.state === 'processing') processing += 1;
    else if (p.state === 'ready') ready += 1;
    else invalid += 1;
  }
  return { counted: processing + ready, processing, ready, invalid };
}

/** 이번 제출에서 업로드해야 하는 사진 (준비됨 && 아직 업로드 안 됨), 화면 순서대로 */
export function uploadCandidates(photos: readonly DraftPhoto[]): DraftPhoto[] {
  return photos.filter((p) => p.state === 'ready' && !(p.upload.state === 'uploaded' && p.upload.uploadId));
}

export interface UploadSummary {
  /** 제출 대상(준비된 사진) 수 */
  total: number;
  uploaded: number;
  failed: number;
  uploading: number;
  queued: number;
  /** 바이트 기준 진행률 0..1 (크기를 모르면 장수 기준) */
  fraction: number;
  /** 0..100 정수 */
  percent: number;
}

export function summarizeUploads(photos: readonly DraftPhoto[]): UploadSummary {
  const targets = photos.filter((p) => p.state === 'ready');
  let uploaded = 0;
  let failed = 0;
  let uploading = 0;
  let queued = 0;
  let bytesTotal = 0;
  let bytesDone = 0;
  for (const p of targets) {
    const s = p.upload.state;
    if (s === 'uploaded') uploaded += 1;
    else if (s === 'failed') failed += 1;
    else if (s === 'uploading') uploading += 1;
    else if (s === 'queued') queued += 1;
    const size = Math.max(1, p.processed?.bytes ?? 1);
    bytesTotal += size;
    bytesDone += size * (s === 'uploaded' ? 1 : Math.min(1, Math.max(0, p.upload.progress)));
  }
  const fraction = targets.length === 0 ? 0 : bytesTotal > 0 ? bytesDone / bytesTotal : uploaded / targets.length;
  const clamped = Math.min(1, Math.max(0, fraction));
  // 모두 끝나기 전에는 100% 로 보이지 않게 한다
  const percent = uploaded === targets.length && targets.length > 0 ? 100 : Math.min(99, Math.floor(clamped * 100));
  return { total: targets.length, uploaded, failed, uploading, queued, fraction: clamped, percent };
}

/** 1단계(기본 정보) 입력 오류 — 없으면 빈 객체 */
export interface Step1Errors {
  client?: string;
  targetYm?: string;
  memo?: string;
}

export function validateStep1(
  draft: Pick<DraftData, 'client' | 'memo'>,
  targetYm: string | null,
  memoMaxLength: number,
): Step1Errors {
  const errors: Step1Errors = {};
  if (!draft.client) errors.client = '거래처를 선택해 주세요.';
  else if (draft.client.selectable === false) errors.client = '관리자 승인 전인 거래처는 EDI 등록에 사용할 수 없습니다. 다른 거래처를 선택해 주세요.';
  if (!targetYm) errors.targetYm = '대상 연월을 선택해 주세요.';
  if (draft.memo.length > memoMaxLength) errors.memo = `메모는 ${memoMaxLength}자 이하로 입력해 주세요.`;
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}

/** 2단계에서 다음으로 갈 수 없는 이유 (없으면 null) */
export function step2Blocker(photos: readonly DraftPhoto[], minPhotos: number, maxPhotos: number): string | null {
  const c = countPhotos(photos);
  if (c.counted === 0) return c.invalid > 0 ? '처리할 수 없는 사진만 있습니다. 사진을 제거하고 다시 선택해 주세요.' : '등록할 사진을 1장 이상 선택해 주세요.';
  if (c.processing > 0) return `사진 ${c.processing}장을 처리하는 중입니다. 잠시만 기다려 주세요.`;
  if (c.invalid > 0) return `처리할 수 없는 사진 ${c.invalid}장을 제거한 뒤 다음 단계로 진행할 수 있습니다.`;
  if (c.ready < minPhotos) return `사진을 ${minPhotos}장 이상 선택해 주세요.`;
  if (c.ready > maxPhotos) return `사진은 최대 ${maxPhotos}장까지 등록할 수 있습니다. ${c.ready - maxPhotos}장을 지워 주세요.`;
  return null;
}

/** 작성 중인 내용이 있는지 (이탈 확인용) */
export function hasDraftContent(draft: Pick<DraftData, 'client' | 'memo' | 'photos' | 'phase'>): boolean {
  if (draft.phase === 'done') return false;
  return draft.photos.length > 0 || draft.memo.trim().length > 0 || draft.client !== null;
}

export const LEAVE_MESSAGE_EDITING = '작성 중인 EDI 등록 내용이 있습니다. 나가도 내용은 유지되며 다시 들어오면 이어서 작성할 수 있습니다.';
export const LEAVE_MESSAGE_UPLOADING = '업로드가 진행 중입니다. 화면을 나가도 업로드는 계속되지만 등록 완료 전까지 앱을 종료하지 마세요.';
export const LEAVE_MESSAGE_UNCERTAIN =
  '등록 결과를 확인하지 못한 EDI 작성 건이 있습니다. 나가도 내용은 유지되며, 다시 들어와 [다시 시도]를 누르면 같은 내용으로 확인합니다.';

/** 이탈 확인에 쓰는 작성 상태 (submit 이 없으면 업로드 중으로 본다) */
export type LeaveDraft = Pick<DraftData, 'client' | 'memo' | 'photos' | 'phase'> & { submit?: Pick<SubmitStatus, 'stage'> };

/** 이탈 확인 문구 (확인이 필요 없으면 null) */
export function leaveMessage(draft: LeaveDraft): string | null {
  if (draft.phase === 'submitting') return draft.submit?.stage === 'uncertain' ? LEAVE_MESSAGE_UNCERTAIN : LEAVE_MESSAGE_UPLOADING;
  return hasDraftContent(draft) ? LEAVE_MESSAGE_EDITING : null;
}

/** 로그아웃 확인에 덧붙일 문구 — 로그아웃하면 이 기기의 작성 건은 버려진다 (없으면 null) */
export function signOutWarning(draft: LeaveDraft): string | null {
  if (draft.phase === 'submitting') {
    return draft.submit?.stage === 'uncertain'
      ? '등록 결과를 확인하지 못한 EDI 작성 건이 있습니다. 로그아웃하면 이 작성 건이 사라지니, 먼저 등록 내역에서 등록되었는지 확인해 주세요.'
      : 'EDI 사진 업로드·등록이 진행 중입니다. 로그아웃하면 진행 중인 등록이 멈추고 작성 중인 내용이 사라집니다.';
  }
  return hasDraftContent(draft) ? '작성 중인 EDI 등록 내용이 있습니다. 로그아웃하면 작성 중인 내용이 사라집니다.' : null;
}

/** 다른 사용자가 남긴 작성 건인지 (완료 결과·빈 작성 건 포함 — 화면에 보여 주지 않고 초기화를 기다린다) */
export function isForeignDraft(ownerUsrId: string | null, usrId: string | null): boolean {
  return ownerUsrId !== null && ownerUsrId !== usrId;
}

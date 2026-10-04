/**
 * EDI 작성 상태 (zustand, 메모리) — 탭을 옮겨도 유지된다 (DESIGN §7.1).
 * 이 파일은 상태 전이만 담당한다. 파일 정리·업로드 같은 부수 효과는 features/edi/new/* 에서 처리한다.
 * phase 가 'submitting' 인 동안에는 내용(거래처·연월·메모·사진 구성/순서)을 바꾸는 동작이 무시된다.
 */
import { create } from 'zustand';

import type { EdiSubmissionDetail } from '@/lib/api/contract';
import { movePhoto as movePhotoInList, reorderByKeys as reorderList, removeByIds, type MoveDirection } from './order';
import { isCountedPhoto } from './progress';
import { newUuid } from './random';
import type {
  DraftClient,
  DraftData,
  DraftPhase,
  DraftPhoto,
  DraftStep,
  PhotoUpload,
  SubmitStatus,
} from './types';

export interface DraftActions {
  /** 로그인 사용자가 바뀌었으면 초기화하고 버린 사진을 돌려준다(파일 정리용) */
  ensureOwner: (usrId: string | null) => DraftPhoto[];
  setClient: (client: DraftClient | null) => void;
  setTargetYm: (ym: string | null) => void;
  setMemo: (memo: string) => void;
  setStep: (step: DraftStep) => void;
  addPhotos: (photos: DraftPhoto[]) => void;
  updatePhoto: (localId: string, patch: Partial<Omit<DraftPhoto, 'localId' | 'upload'>>) => boolean;
  patchUpload: (localId: string, patch: Partial<PhotoUpload>) => void;
  /** 지운 사진을 돌려준다(파일 정리용) */
  removePhotos: (localIds: readonly string[]) => DraftPhoto[];
  movePhoto: (localId: string, direction: MoveDirection) => void;
  reorderByKeys: (keys: readonly string[]) => void;
  setPhase: (phase: DraftPhase) => void;
  setSubmit: (patch: Partial<SubmitStatus>) => void;
  /** UPLOAD_NOT_FOUND: 해당 uploadId 를 가진 사진의 업로드 정보를 지운다 → 다음 제출 때 다시 올림. 초기화한 장수 */
  resetUploads: (uploadIds: readonly string[]) => number;
  complete: (result: EdiSubmissionDetail, options: { sample: boolean; replayed: boolean }) => void;
  /**
   * 새 작성 건(새 idempotencyKey) — 키를 새로 만드는 유일한 경로. 버린 사진을 돌려준다(파일 정리용).
   * ownerUsrId 를 주면 소유자도 바꾼다(로그아웃 시 null).
   */
  reset: (ownerUsrId?: string | null) => DraftPhoto[];
}

export type DraftStore = DraftData & DraftActions;

export const IDLE_SUBMIT: SubmitStatus = { stage: 'idle', notice: null, pendingRequest: null };

export function createEmptyDraft(ownerUsrId: string | null): DraftData {
  return {
    idempotencyKey: newUuid(),
    ownerUsrId,
    client: null,
    targetYm: null,
    memo: '',
    photos: [],
    phase: 'editing',
    step: 1,
    submit: IDLE_SUBMIT,
    result: undefined,
    sample: undefined,
    replayed: undefined,
  };
}

export const useEdiDraft = create<DraftStore>()((set, get) => {
  /** 편집 가능한 상태인지 (제출 중·완료 후에는 내용 변경 금지) */
  const editable = () => get().phase === 'editing';

  return {
    ...createEmptyDraft(null),

    ensureOwner: (usrId) => {
      const state = get();
      if (state.ownerUsrId === usrId) return [];
      if (state.ownerUsrId === null && state.photos.length === 0 && !state.client && !state.memo) {
        set({ ownerUsrId: usrId });
        return [];
      }
      const dropped = state.photos;
      set(createEmptyDraft(usrId));
      return dropped;
    },

    setClient: (client) => {
      if (!editable()) return;
      set({ client });
    },

    setTargetYm: (targetYm) => {
      if (!editable()) return;
      set({ targetYm });
    },

    setMemo: (memo) => {
      if (!editable()) return;
      set({ memo });
    },

    setStep: (step) => {
      if (get().phase === 'done') return;
      set({ step });
    },

    addPhotos: (photos) => {
      if (!editable() || photos.length === 0) return;
      const existing = new Set(get().photos.map((p) => p.localId));
      const fresh = photos.filter((p) => !existing.has(p.localId));
      set({ photos: [...get().photos, ...fresh] });
    },

    updatePhoto: (localId, patch) => {
      const photos = get().photos;
      const index = photos.findIndex((p) => p.localId === localId);
      if (index < 0) return false;
      const next = [...photos];
      next[index] = { ...photos[index], ...patch };
      set({ photos: next });
      return true;
    },

    patchUpload: (localId, patch) => {
      const photos = get().photos;
      const index = photos.findIndex((p) => p.localId === localId);
      if (index < 0) return;
      const current = photos[index];
      const next = [...photos];
      next[index] = { ...current, upload: { ...current.upload, ...patch } };
      set({ photos: next });
    },

    removePhotos: (localIds) => {
      if (!editable() || localIds.length === 0) return [];
      const ids = new Set(localIds);
      const photos = get().photos;
      const removed = photos.filter((p) => ids.has(p.localId));
      if (removed.length === 0) return [];
      set({ photos: removeByIds(photos, ids) });
      return removed;
    },

    movePhoto: (localId, direction) => {
      if (!editable()) return;
      set({ photos: movePhotoInList(get().photos, localId, direction, isCountedPhoto) });
    },

    reorderByKeys: (keys) => {
      if (!editable()) return;
      set({ photos: reorderList(get().photos, keys) });
    },

    setPhase: (phase) => set({ phase }),

    setSubmit: (patch) => set({ submit: { ...get().submit, ...patch } }),

    resetUploads: (uploadIds) => {
      const ids = new Set(uploadIds);
      let count = 0;
      const photos = get().photos.map((p) => {
        if (!p.upload.uploadId || !ids.has(p.upload.uploadId)) return p;
        count += 1;
        return { ...p, upload: { ...p.upload, state: 'idle' as const, uploadId: undefined, progress: 0, error: undefined } };
      });
      if (count > 0) set({ photos });
      return count;
    },

    complete: (result, { sample, replayed }) => {
      // 완료 화면은 서버가 돌려준 사진(서버 순서)만 쓴다 — 로컬 사진 목록은 비운다(파일 정리는 호출한 쪽이 먼저 한다)
      set({
        phase: 'done',
        step: 3,
        result,
        sample,
        replayed,
        photos: [],
        submit: IDLE_SUBMIT,
      });
    },

    reset: (ownerUsrId) => {
      const dropped = get().photos;
      set(createEmptyDraft(ownerUsrId === undefined ? get().ownerUsrId : ownerUsrId));
      return dropped;
    },
  };
});

/** 컴포넌트 밖(제출 파이프라인 등)에서 쓰는 접근자 */
export const ediDraftStore = {
  get: () => useEdiDraft.getState(),
  subscribe: useEdiDraft.subscribe,
};

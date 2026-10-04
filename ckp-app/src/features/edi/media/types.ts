/** 사진 선택·처리 공통 타입 (플랫폼별 구현이 같은 모양을 따른다) */
import type { ProcessedImage } from '../draft/types';

/** 선택기/드롭/파일 입력에서 받은 원본 파일 */
export interface PickedFile {
  name: string;
  /** native: file:// (선택기 임시 파일) / web: 빈 문자열 (blob 사용) */
  uri: string;
  mimeType: string | null;
  /** 바이트 (모르면 null) */
  size: number | null;
  /** 모르면 0 */
  width: number;
  height: number;
  /** web: 원본 File */
  blob?: Blob;
  /** 선택기가 알려준 종류 ('image' | 'video' | 'livePhoto' …) */
  assetType?: string | null;
}

export type PickOutcome =
  | { kind: 'picked'; files: PickedFile[] }
  | { kind: 'canceled' }
  /** 권한 거절 (설정에서 허용해야 함) */
  | { kind: 'denied'; target: 'camera' | 'library' }
  | { kind: 'error'; message: string };

export interface ProcessInput {
  localId: string;
  name: string;
  uri: string;
  mimeType: string | null;
  size: number | null;
  width: number;
  height: number;
  blob?: Blob;
}

export interface ProcessLimits {
  /** 긴 변 최소 픽셀 (서버 PHOTO_MIN_LONG_SIDE) */
  minLongSide: number;
  /** 처리 후 1장 최대 바이트 (서버 PHOTO_MAX_BYTES) */
  maxBytes: number;
}

export type ProcessResult = { ok: true; processed: ProcessedImage } | { ok: false; reason: string };

export type ProcessPhotoFn = (input: ProcessInput, limits: ProcessLimits) => Promise<ProcessResult>;

export interface DropZoneProps {
  onFiles: (files: PickedFile[]) => void;
  disabled?: boolean;
}

export const MSG_DECODE_FAILED = '사진을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다. 사진을 제거하고 다른 사진을 선택해 주세요.';
export const MSG_HEIC_FAILED = 'HEIC 사진을 JPG로 변환하지 못했습니다. 기기에서 JPG로 저장(또는 공유 시 "호환성 우선")한 뒤 다시 선택해 주세요.';
export const MSG_PROCESS_FAILED = '사진을 처리하지 못했습니다. 사진을 제거하고 다시 선택해 주세요.';
export const MSG_PROCESS_TIMEOUT = '사진 처리 시간이 너무 오래 걸립니다. 사진을 제거하고 다시 선택해 주세요.';

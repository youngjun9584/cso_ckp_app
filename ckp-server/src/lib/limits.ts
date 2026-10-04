/** 업무 제한값 (DESIGN §4) — /v1/meta.limits 와 서버 검증이 같은 값을 쓴다 */
import type { EdiLimits } from '../contract.js';
import type { AppConfig } from '../config.js';
import { ACCEPTED_MIME_TYPES } from './image.js';

export const EDI_MIN_PHOTOS = 1;
export const EDI_MAX_PHOTOS = 30;
export const EDI_MEMO_MAX_LENGTH = 500;

export function ediLimits(config: AppConfig): EdiLimits {
  return {
    ediMinPhotos: EDI_MIN_PHOTOS,
    ediMaxPhotos: EDI_MAX_PHOTOS,
    photoMaxBytes: config.photo.maxBytes,
    photoMinLongSide: config.photo.minLongSide,
    acceptedUploadTypes: [...ACCEPTED_MIME_TYPES],
    memoMaxLength: EDI_MEMO_MAX_LENGTH,
  };
}

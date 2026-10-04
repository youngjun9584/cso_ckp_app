import type { EdiLimits, MetaResponse } from './contract';

/** /v1/meta 를 아직 받지 못했을 때 쓰는 제한값 (DESIGN §4 와 동일) */
export const DEFAULT_EDI_LIMITS: EdiLimits = {
  ediMinPhotos: 1,
  ediMaxPhotos: 30,
  photoMaxBytes: 15 * 1024 * 1024,
  photoMinLongSide: 400,
  acceptedUploadTypes: ['image/jpeg', 'image/png', 'image/webp'],
  memoMaxLength: 500,
};

export const DEFAULT_FEATURES: MetaResponse['features'] = {
  clientApprovalRequiredForEdi: true,
  clientTypeField: true,
  medicineFeeVisible: true,
  /** meta 를 받기 전에는 로그인 화면에 가입 링크를 보여 준다 (서버가 false 를 주면 숨김) */
  selfRegistration: true,
};

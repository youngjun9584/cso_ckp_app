/**
 * EDI 작성(draft) 상태 타입 (DESIGN §7.1).
 * 순수 타입만 둔다 — React Native 모듈을 import 하지 않는다(단위 점검 스크립트에서 사용).
 */
import type { EdiSubmissionCreateRequest, EdiSubmissionDetail } from '@/lib/api/contract';

export type PhotoState = 'processing' | 'ready' | 'invalid';

export type PhotoUploadState = 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed';

/**
 * 앱에서 처리한 결과(긴 변 ≤2560 JPEG + 긴 변 360 썸네일).
 * 기기에서 변환하지 못한 JPEG/PNG/WEBP(예: iOS 흑백·CMYK 사진)는 원본 파일을 그대로 쓴다(uri = thumbUri = 선택기 복사본,
 * 서버가 회전·메타데이터 제거·JPEG 재인코딩을 한다).
 */
export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
  bytes: number;
  thumbUri: string;
}

export interface PhotoUpload {
  state: PhotoUploadState;
  /** 0..1 */
  progress: number;
  uploadId?: string;
  /** 실패 사유(한국어) */
  error?: string;
  /** 지금까지 보낸 횟수(자동 재시도 포함) */
  attempts: number;
  /** false 면 다시 보내도 같은 결과(형식·해상도 문제 등) → 제거 안내 */
  retryable?: boolean;
}

export interface DraftPhoto {
  /** uuid v4 — 서버의 clientPhotoId 로도 쓴다(재시도해도 같은 값) */
  localId: string;
  sourceName: string;
  /** native: file:// (선택기 임시 파일) / web: 'web-file:<localId>' 표식(원본은 메모리 레지스트리) */
  sourceUri: string;
  sourceMime: string | null;
  /** 원본 크기(모르면 0) */
  width: number;
  height: number;
  /** 원본 바이트(모르면 null) */
  bytes: number | null;
  state: PhotoState;
  processed?: ProcessedImage;
  invalidReason?: string;
  upload: PhotoUpload;
}

export interface DraftClient {
  idx: number;
  name: string;
  /** EDI 에 쓸 수 있는지 (모르면 null — 서버가 제출 시 다시 확인) */
  selectable: boolean | null;
}

export type DraftPhase = 'editing' | 'submitting' | 'done';

export type DraftStep = 1 | 2 | 3;

/** 제출 진행 단계 (phase = 'submitting' 동안) */
export type SubmitStage = 'idle' | 'uploading' | 'creating' | 'uncertain';

/** 제출 흐름이 화면에 남기는 안내 */
export type SubmitNotice =
  /** 업로드 실패 → 편집으로 복귀, [실패한 사진만 다시 시도] */
  | { kind: 'upload-failed'; count: number; message: string }
  /** 제출 결과 불확실 → 잠금 유지, [다시 시도] (같은 키·같은 내용). serverError: 서버가 5xx 로 답함(응답은 받음) */
  | { kind: 'uncertain'; message: string; serverError?: boolean }
  /** 서버가 확정적으로 거절(4xx) → 편집으로 복귀 */
  | { kind: 'rejected'; message: string; code: string }
  /**
   * 같은 키로 다른 내용이 이미 등록됨(409 IDEMPOTENCY_CONFLICT 등) → 편집으로 복귀하되 키를 바꾸지 않고 다시 보내지 않는다.
   * 사용자가 등록 내역을 확인하고 [새로 작성하기]로 새 작성 건을 직접 시작한다.
   */
  | { kind: 'conflict'; message: string; code: string }
  /** 결과 불확실 상태에서 사용자가 [편집으로 돌아가기]를 고름 → 키 유지(같은 내용이면 서버가 기존 결과를 돌려준다) */
  | { kind: 'unlocked'; message: string }
  /** 서버에 없는 업로드(UPLOAD_NOT_FOUND) → 해당 사진 다시 올리기 */
  | { kind: 'reupload'; count: number; message: string };

export interface SubmitStatus {
  stage: SubmitStage;
  notice: SubmitNotice | null;
  /**
   * 결과가 불확실할 때 그대로 다시 보낼 요청 본문.
   * 같은 Idempotency-Key 로 **같은 내용**을 보내야 서버가 중복 생성하지 않는다.
   */
  pendingRequest: EdiSubmissionCreateRequest | null;
}

export interface DraftData {
  /** 작성 건마다 1개 (새 작성 건을 시작할 때만 새로 만든다 — 제출 오류로 바꾸지 않는다) */
  idempotencyKey: string;
  /** 이 작성 건을 만든 사용자 (다른 사용자가 로그인하면 초기화) */
  ownerUsrId: string | null;
  client: DraftClient | null;
  targetYm: string | null;
  memo: string;
  /** 배열 순서 = 화면 순번(1..N) */
  photos: DraftPhoto[];
  phase: DraftPhase;
  step: DraftStep;
  submit: SubmitStatus;
  result?: EdiSubmissionDetail;
  /** 샘플 모드에서 완료된 경우 (실제 서버 저장 아님) */
  sample?: boolean;
  /** 서버가 replayed=true 로 돌려준 경우 */
  replayed?: boolean;
}

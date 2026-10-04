/**
 * 제출 결과(성공 제외)를 작성 상태에 반영하는 순수 로직 (DESIGN §7.2) — submit.ts 가 쓰고 __selfcheck__ 가 점검한다.
 * React Native 모듈을 import 하지 않는다.
 *
 * 규칙 (같은 작성 건이 서버에 두 번 등록되지 않게)
 * - 결과가 불확실하면(네트워크·타임아웃·5xx·취소, 그리고 로그인이 끝나 거절된 경우) 잠금·pendingRequest·Idempotency-Key 를
 *   그대로 두고 같은 요청으로만 다시 확인한다.
 * - 확정 거절만 편집으로 돌려보낸다. 여기서는 키를 절대 바꾸지 않는다 — 새 키는 사용자가 새 작성 건을 시작할 때(resetDraft)만.
 * - 409 IDEMPOTENCY_CONFLICT(같은 키로 다른 내용이 이미 등록됨)는 조용히 새 키로 다시 보내지 않고 'conflict' 안내로 멈춘다.
 */
import { rejectAction, type SubmitOutcome } from './pipeline';
import { asErrorLike, errorMessage } from './retry';
import type { DraftClient, DraftPhase, DraftPhoto, DraftStep, SubmitNotice, SubmitStatus } from './types';

export const MSG_UNCERTAIN =
  '등록 결과를 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 [다시 시도]를 눌러 주세요. 같은 내용으로 다시 확인하므로 중복 등록되지 않습니다.';
export const MSG_UNCERTAIN_RELOGIN =
  '로그인이 만료되어 등록 결과를 확인하지 못했습니다. 다시 로그인한 뒤 [다시 시도]를 눌러 주세요. 같은 내용으로 다시 확인하므로 중복 등록되지 않습니다.';
const MSG_SERVER_FALLBACK = '서버에 일시적인 문제가 발생했습니다.';
const MSG_UNCERTAIN_SERVER_TAIL =
  '[다시 시도]는 같은 내용으로 다시 확인하므로 중복 등록되지 않습니다. 계속 실패하면 등록 내역을 확인하고 관리자에게 문의해 주세요.';
export const MSG_UNLOCKED =
  '앞서 보낸 등록 요청이 서버에 이미 처리되었을 수 있습니다. 내용을 그대로 두고 등록하면 같은 요청으로 다시 확인하므로 중복 등록되지 않습니다. 내용을 바꿔 등록하면 서버가 이미 처리된 요청인지 먼저 확인합니다.';
export const MSG_CONFLICT =
  '이 작성 건은 앞서 보낸 내용으로 이미 등록되었을 수 있습니다. 같은 EDI가 두 번 등록되지 않도록 먼저 등록 내역에서 확인해 주세요. 다시 등록해야 하면 [새로 작성하기]로 새 작성 건을 시작해 주세요.';

/** 로그인이 끝나(만료·권한·승인 상태 변경) 거절된 경우 — 앞서 보낸 요청의 결과는 여전히 알 수 없다 */
const AUTH_LOSS_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'ACCOUNT_NOT_APPROVED']);

/** 이 로직이 쓰는 작성 상태 (useEdiDraft 의 일부 — 점검 스크립트에서는 가짜 객체) */
export interface SubmitDraftOps {
  readonly phase: DraftPhase;
  readonly photos: readonly DraftPhoto[];
  readonly client: DraftClient | null;
  readonly submit: SubmitStatus;
  setPhase(phase: DraftPhase): void;
  setSubmit(patch: Partial<SubmitStatus>): void;
  setClient(client: DraftClient | null): void;
  setTargetYm(ym: string | null): void;
  setStep(step: DraftStep): void;
  resetUploads(uploadIds: readonly string[]): number;
}

export type FailureOutcome = Exclude<SubmitOutcome, { kind: 'success' }>;

export interface FailureOptions {
  /** 로그아웃·세션 만료로 요청을 멈췄음 */
  sessionEnded?: boolean;
}

export interface FailureEffects {
  /** EDI 사용 가능 여부(/v1/edi/status)를 다시 불러와야 함 (EDI_DISABLED, SCHEMA_NOT_READY) */
  refreshStatus: boolean;
}

type UncertainNotice = Extract<SubmitNotice, { kind: 'uncertain' }>;

/** 응답이 불확실할 때의 안내 — 서버가 5xx 로 답했으면 '네트워크를 확인' 대신 서버 메시지를 보여 준다 */
export function uncertainNotice(error: unknown, options: FailureOptions = {}): UncertainNotice {
  const e = asErrorLike(error);
  if (options.sessionEnded || AUTH_LOSS_CODES.has(e.code ?? '')) {
    return { kind: 'uncertain', message: MSG_UNCERTAIN_RELOGIN, serverError: false };
  }
  if ((e.status ?? 0) >= 500) {
    return { kind: 'uncertain', message: `${errorMessage(error, MSG_SERVER_FALLBACK)} ${MSG_UNCERTAIN_SERVER_TAIL}`, serverError: true };
  }
  return { kind: 'uncertain', message: MSG_UNCERTAIN, serverError: false };
}

/** 성공이 아닌 제출 결과를 반영한다 (phase='submitting' 인 작성 건에만 호출) */
export function applySubmitFailure(get: () => SubmitDraftOps, outcome: FailureOutcome, options: FailureOptions = {}): FailureEffects {
  switch (outcome.kind) {
    case 'uncertain':
      // 서버에 도착했는지 모름 → 잠금 유지(setSubmit 은 병합이므로 pendingRequest 그대로), 같은 요청으로만 다시 확인
      get().setSubmit({ stage: 'uncertain', notice: uncertainNotice(outcome.error, options) });
      return { refreshStatus: false };
    case 'aborted':
      get().setSubmit({ stage: 'uncertain', notice: uncertainNotice(null, options) });
      return { refreshStatus: false };
    case 'rejected':
      if (AUTH_LOSS_CODES.has(outcome.code)) {
        // 401/403 은 앞서 시간 초과된 요청이 저장됐는지 알려 주지 않는다 → 잠금·pendingRequest·키 유지,
        // 다시 로그인한 뒤 [다시 시도]가 같은 본문·같은 키로 확인한다.
        get().setSubmit({ stage: 'uncertain', notice: uncertainNotice(outcome.error, options) });
        return { refreshStatus: false };
      }
      return applyRejection(get, outcome);
  }
}

function applyRejection(get: () => SubmitDraftOps, outcome: Extract<SubmitOutcome, { kind: 'rejected' }>): FailureEffects {
  const action = rejectAction(outcome.code);
  const fields = (outcome.error as { fields?: Record<string, string> } | null)?.fields ?? {};
  get().setPhase('editing');

  if (action === 'reupload') {
    const photos = get().photos;
    const ids = outcome.missingUploadIds.length ? outcome.missingUploadIds : photos.flatMap((p) => (p.upload.uploadId ? [p.upload.uploadId] : []));
    const count = get().resetUploads(ids);
    get().setSubmit({
      stage: 'idle',
      pendingRequest: null,
      notice: { kind: 'reupload', count, message: `${outcome.message} [다시 등록하기]를 누르면 사진 ${count}장을 다시 올린 뒤 등록합니다.` },
    });
    return { refreshStatus: false };
  }

  if (action === 'conflict') {
    // 키는 그대로 둔다: 같은 키로는 서버가 두 번 만들지 않는다. 새 작성 건은 사용자가 직접 시작한다.
    const message = outcome.code === 'IDEMPOTENCY_CONFLICT' ? MSG_CONFLICT : `${outcome.message} ${MSG_CONFLICT}`;
    get().setSubmit({ stage: 'idle', pendingRequest: null, notice: { kind: 'conflict', code: outcome.code, message } });
    return { refreshStatus: false };
  }

  let refreshStatus = false;
  if (action === 'back-to-step1' || fields.targetYm || fields.clientIdx) {
    const client = get().client;
    if (outcome.code === 'CLIENT_NOT_SELECTABLE' && client) get().setClient({ ...client, selectable: false });
    if (outcome.code === 'NOT_FOUND') get().setClient(null);
    if (fields.targetYm) get().setTargetYm(null);
    if (outcome.code === 'EDI_DISABLED' || outcome.code === 'SCHEMA_NOT_READY') refreshStatus = true;
    get().setStep(1);
  }
  get().setSubmit({ stage: 'idle', pendingRequest: null, notice: { kind: 'rejected', code: outcome.code, message: outcome.message } });
  return { refreshStatus };
}

/**
 * [편집으로 돌아가기] — 결과 불확실 상태의 잠금을 사용자가 직접 푼다(확인 대화상자 뒤에서만 호출).
 * 키는 그대로 둔다: 내용을 바꾸지 않고 다시 등록하면 서버가 기존 결과를 돌려주고, 바꿨으면 409 로 알려 준다(→ 'conflict').
 */
export function unlockUncertain(get: () => SubmitDraftOps): boolean {
  const state = get();
  if (state.phase !== 'submitting' || state.submit.stage !== 'uncertain') return false;
  state.setPhase('editing');
  state.setSubmit({ stage: 'idle', pendingRequest: null, notice: { kind: 'unlocked', message: MSG_UNLOCKED } });
  return true;
}

/**
 * EDI 작성 순수 로직 자체 점검 (React Native 없이 Node 에서 실행).
 *   실행: ..\ckp-server\node_modules\.bin\tsx src\features\edi\draft\__selfcheck__.ts   (ckp-app 폴더에서)
 * 실패하면 예외로 종료(코드 1), 모두 통과하면 'SELFCHECK OK' 를 출력한다. 앱 번들에는 포함되지 않는다(어디서도 import 하지 않음).
 */
import type { EdiSubmissionCreateRequest, EdiSubmissionCreateResponse, EdiSubmissionDetail } from '@/lib/api/contract';
import {
  checkContentType,
  checkDeclaredType,
  fitLongSide,
  kindFromMagic,
  originalUploadCheck,
} from '../media/file-type';
import { isUuidV4, uuidV4FromBytes } from './ids';
import { canMove, movePhoto, reorderByKeys, removeById, seqMap } from './order';
import { manualSelectionState, overflowMessage, pickSelected, planAddition, remainingCapacity, takeFirst } from './overflow';
import { buildSubmissionRequest, isUncertainSubmitError, rejectAction, runUploadBatch, submitWithRetry, type SubmitOutcome } from './pipeline';
import { TaskQueue, runPool } from './pool';
import {
  LEAVE_MESSAGE_UNCERTAIN,
  countPhotos,
  isCountedPhoto,
  isForeignDraft,
  leaveMessage,
  signOutWarning,
  step2Blocker,
  summarizeUploads,
  uploadCandidates,
  validateStep1,
} from './progress';
import { isTransientError, withRetry, type SleepFn } from './retry';
import { MSG_CONFLICT, MSG_UNCERTAIN, MSG_UNCERTAIN_RELOGIN, applySubmitFailure, unlockUncertain, type SubmitDraftOps } from './submit-state';
import type { DraftClient, DraftPhase, DraftPhoto, DraftStep, PhotoUpload, SubmitStatus } from './types';

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(`SELFCHECK FAILED: ${label}`);
  passed += 1;
}
function eq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`SELFCHECK FAILED: ${label}\n  expected ${e}\n  actual   ${a}`);
  passed += 1;
}

class FakeApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code} 오류`);
  }
  get isNetwork() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
  get isRetryable() {
    return this.isNetwork || this.status >= 500;
  }
  get isAborted() {
    return this.code === 'ABORTED';
  }
}

function photo(i: number, state: DraftPhoto['state'] = 'ready'): DraftPhoto {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  return {
    localId: id,
    sourceName: `IMG_${i}.jpg`,
    sourceUri: `file:///p${i}.jpg`,
    sourceMime: 'image/jpeg',
    width: 4000,
    height: 3000,
    bytes: 3_000_000,
    state,
    processed: state === 'ready' ? { uri: `file:///out${i}.jpg`, thumbUri: `file:///t${i}.jpg`, width: 2560, height: 1920, bytes: 1_000_000 + i } : undefined,
    invalidReason: state === 'invalid' ? '지원하지 않는 형식' : undefined,
    upload: { state: 'idle', progress: 0, attempts: 0 },
  };
}

/** 파이프라인 onPhotoUpdate 를 받아 목록에 반영하는 작은 가짜 store */
function fakeStore(initial: DraftPhoto[]) {
  let photos = initial;
  return {
    get photos() {
      return photos;
    },
    patch(localId: string, patch: Partial<PhotoUpload>) {
      photos = photos.map((p) => (p.localId === localId ? { ...p, upload: { ...p.upload, ...patch } } : p));
    },
    set(next: DraftPhoto[]) {
      photos = next;
    },
  };
}

const delaysSeen: number[] = [];
const fastSleep: SleepFn = async (ms) => {
  delaysSeen.push(ms);
};

/** 제출 결과 반영(submit-state)을 점검하는 가짜 작성 건 — store.ts 와 같은 규칙(setSubmit 병합, 편집 중에만 내용 변경) */
class FakeDraft implements SubmitDraftOps {
  phase: DraftPhase = 'submitting';
  step: DraftStep = 3;
  client: DraftClient | null = { idx: 5003, name: '가나의원', selectable: true };
  targetYm: string | null = '2026-08';
  memo = '';
  submit: SubmitStatus;
  constructor(
    public photos: DraftPhoto[],
    readonly idempotencyKey: string,
    request: EdiSubmissionCreateRequest,
  ) {
    this.submit = { stage: 'creating', notice: null, pendingRequest: request };
  }
  setPhase(phase: DraftPhase) {
    this.phase = phase;
  }
  setSubmit(patch: Partial<SubmitStatus>) {
    this.submit = { ...this.submit, ...patch };
  }
  setClient(client: DraftClient | null) {
    if (this.phase === 'editing') this.client = client;
  }
  setTargetYm(ym: string | null) {
    if (this.phase === 'editing') this.targetYm = ym;
  }
  setStep(step: DraftStep) {
    this.step = step;
  }
  resetUploads(uploadIds: readonly string[]) {
    return uploadIds.length;
  }
  /** 사용자가 편집 화면에서 사진 1장을 지운 것처럼 */
  removeFirstPhoto() {
    if (this.phase === 'editing') this.photos = this.photos.slice(1);
  }
}

type ServerStep = 'ok' | 'commit-lose-response' | 'offline' | 'unauthorized' | 'server-error' | 'schema-not-ready';

/**
 * 서버의 Idempotency-Key 규칙을 흉내 낸다: 같은 키·같은 내용 → 저장된 결과 재생(replayed), 같은 키·다른 내용 → 409.
 * plan 에 호출별 동작을 넣는다(비면 'ok'). created = 실제로 만들어진 제출 건 수.
 */
function fakeSubmitServer() {
  const byKey = new Map<string, { hash: string; response: EdiSubmissionCreateResponse }>();
  const server = {
    plan: [] as ServerStep[],
    created: 0,
    calls: 0,
    create: async (body: EdiSubmissionCreateRequest, key: string): Promise<EdiSubmissionCreateResponse> => {
      server.calls += 1;
      const step = server.plan.shift() ?? 'ok';
      if (step === 'offline') throw new FakeApiError('NETWORK_ERROR', 0);
      if (step === 'unauthorized') throw new FakeApiError('UNAUTHORIZED', 401);
      if (step === 'schema-not-ready') throw new FakeApiError('SCHEMA_NOT_READY', 503);
      if (step === 'server-error') throw new FakeApiError('SERVER_ERROR', 500); // 서버·DB 오류 — 아무것도 만들지 않음(롤백)
      const hash = JSON.stringify(body);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.hash !== hash) throw new FakeApiError('IDEMPOTENCY_CONFLICT', 409);
        return { ...existing.response, replayed: true };
      }
      server.created += 1;
      const response = { submission: { id: `s${server.created}`, photos: [] } as unknown as EdiSubmissionDetail, replayed: false };
      byKey.set(key, { hash, response });
      if (step === 'commit-lose-response') throw new FakeApiError('TIMEOUT', 0); // 저장은 됐지만 응답을 못 받음
      return response;
    },
  };
  return server;
}

function asFailure(outcome: SubmitOutcome): Exclude<SubmitOutcome, { kind: 'success' }> {
  if (outcome.kind === 'success') throw new Error('SELFCHECK FAILED: 실패 결과를 기대했지만 성공');
  return outcome;
}

async function main(): Promise<void> {
  // ── ids ──
  const id = uuidV4FromBytes(new Uint8Array(16).map((_, i) => i * 17));
  check(isUuidV4(id), 'uuidV4FromBytes → 유효한 v4');
  check(!isUuidV4('not-a-uuid'), 'isUuidV4 거부');

  // ── 순서: 1장, 이동, 삭제 후 번호 재계산, invalid 건너뛰기 ──
  const one = [photo(1)];
  eq([...seqMap(one).values()], [1], '1장 순번');
  let list = [photo(1), photo(2), photo(3), photo(4)];
  list = movePhoto(list, list[2].localId, 'earlier');
  eq(list.map((p) => p.sourceName), ['IMG_1.jpg', 'IMG_3.jpg', 'IMG_2.jpg', 'IMG_4.jpg'], '3번 앞으로 이동');
  list = movePhoto(list, list[3].localId, 'first');
  eq(list.map((p) => p.sourceName), ['IMG_4.jpg', 'IMG_1.jpg', 'IMG_3.jpg', 'IMG_2.jpg'], '맨 앞으로 이동');
  list = movePhoto(list, list[0].localId, 'last');
  eq(list.map((p) => p.sourceName), ['IMG_1.jpg', 'IMG_3.jpg', 'IMG_2.jpg', 'IMG_4.jpg'], '맨 뒤로 이동');
  eq(movePhoto(list, list[0].localId, 'earlier').map((p) => p.localId), list.map((p) => p.localId), '맨 앞에서 앞으로 → 변화 없음');
  check(!canMove(list, list[0].localId, 'earlier') && canMove(list, list[0].localId, 'later'), 'canMove 가장자리');
  list = removeById(list, list[1].localId);
  eq([...seqMap(list).entries()].map(([, s]) => s), [1, 2, 3], '삭제 후 즉시 1..N 재계산');

  const withInvalid = [photo(1), photo(2, 'invalid'), photo(3)];
  const seqs = seqMap(withInvalid, isCountedPhoto);
  eq([seqs.get(withInvalid[0].localId), seqs.get(withInvalid[1].localId), seqs.get(withInvalid[2].localId)], [1, undefined, 2], 'invalid 는 순번 제외');
  const movedPastInvalid = movePhoto(withInvalid, withInvalid[2].localId, 'earlier', isCountedPhoto);
  eq(movedPastInvalid.map((p) => p.sourceName), ['IMG_3.jpg', 'IMG_1.jpg', 'IMG_2.jpg'], 'invalid 를 건너뛰어 번호가 실제로 바뀜');

  // 드래그 결과 적용: 없는 키 무시, 빠진 항목은 뒤에 붙임(버리지 않음)
  const base = [photo(1), photo(2), photo(3)];
  const reordered = reorderByKeys(base, [base[2].localId, 'ghost', base[0].localId, base[2].localId]);
  eq(reordered.map((p) => p.sourceName), ['IMG_3.jpg', 'IMG_1.jpg', 'IMG_2.jpg'], 'reorderByKeys 견고성');

  // ── 30장 제한: 1장 / 30장 / 31장 / 여러 번 나눠 추가 ──
  eq(planAddition(1, 0, 30).kind, 'fits', '1장 추가');
  eq(planAddition(30, 0, 30).kind, 'fits', '30장 한 번에');
  const p31 = planAddition(31, 0, 30);
  check(p31.kind === 'overflow' && p31.remaining === 30, '31장 → 초과 안내(30장 가능)');
  const p35 = planAddition(35, 12, 30);
  check(p35.kind === 'overflow' && p35.remaining === 18, '12장 있는 상태에서 35장 → 18장 가능');
  eq(overflowMessage(35, 18, 30), '선택한 사진 35장 중 18장만 더 추가할 수 있습니다(최대 30장).', '초과 안내 문구');
  eq(planAddition(1, 30, 30).kind, 'full', '30장 꽉 참 → 추가 불가');
  eq(remainingCapacity(31, 30), 0, '남은 수 음수 없음');
  // 여러 번 나눠 추가해도 30장 이하: 10 → 15 → 10(초과 5)
  let counted = 0;
  for (const incoming of [10, 15, 10]) {
    const plan = planAddition(incoming, counted, 30);
    counted += plan.kind === 'fits' ? incoming : plan.kind === 'overflow' ? takeFirst(Array.from({ length: incoming }), plan.remaining).length : 0;
    check(counted <= 30, `누적 ${counted} ≤ 30`);
  }
  eq(counted, 30, '나눠 추가 합계 30');
  const files = Array.from({ length: 35 }, (_, i) => `f${i}`);
  eq(takeFirst(files, 18).length, 18, '[앞에서부터 18장]');
  eq(pickSelected(files, new Set([34, 0, 5])), ['f0', 'f5', 'f34'], '[직접 고르기] 원래 순서 유지');
  const manual = manualSelectionState(35, 18);
  check(!manual.canAdd && manual.excess === 17, '직접 고르기: 17장 더 해제해야 함');
  check(manualSelectionState(18, 18).canAdd && !manualSelectionState(0, 18).canAdd, '직접 고르기: 18장이면 추가 가능, 0장은 불가');

  // ── 재시도·대기 ──
  delaysSeen.length = 0;
  let calls = 0;
  await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new FakeApiError('NETWORK_ERROR', 0);
      return 'ok';
    },
    { delays: [1000, 3000], shouldRetry: isTransientError, sleep: fastSleep },
  );
  eq([calls, delaysSeen], [3, [1000, 3000]], '네트워크 오류 자동 재시도 2회(1s, 3s)');
  calls = 0;
  let clientErr: unknown = null;
  try {
    await withRetry(
      async () => {
        calls += 1;
        throw new FakeApiError('VALIDATION_FAILED', 400);
      },
      { delays: [1000, 3000], shouldRetry: isTransientError, sleep: fastSleep },
    );
  } catch (e) {
    clientErr = e;
  }
  check(calls === 1 && clientErr instanceof FakeApiError, '4xx 는 재시도하지 않음');
  check(isTransientError(new FakeApiError('SERVER_ERROR', 503)) && !isTransientError(new FakeApiError('ABORTED', 0)), '5xx 재시도 / 취소는 재시도 안 함');

  // ── 동시 실행 제한 ──
  let active = 0;
  let peak = 0;
  await runPool(Array.from({ length: 12 }), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    active -= 1;
  });
  check(peak === 3, `업로드 동시 3장 (최대 ${peak})`);
  const q = new TaskQueue(2);
  let qActive = 0;
  let qPeak = 0;
  let qDone = 0;
  for (let i = 0; i < 7; i += 1) {
    q.add(`t${i}`, async () => {
      qActive += 1;
      qPeak = Math.max(qPeak, qActive);
      await new Promise((r) => setTimeout(r, 2));
      qActive -= 1;
      qDone += 1;
    });
  }
  check(q.cancel('t6'), '대기 중 처리 작업 취소');
  await q.whenIdle();
  check(qPeak === 2 && qDone === 6, `사진 처리 동시 2장 (최대 ${qPeak}, 완료 ${qDone})`);

  // ── 상태 집계·단계 검증 ──
  check(step2Blocker([], 1, 30) !== null, '사진 0장 → 다음 불가');
  check(step2Blocker([photo(1, 'processing')], 1, 30)?.includes('처리하는 중') === true, '처리 중 → 다음 불가');
  check(step2Blocker([photo(1), photo(2, 'invalid')], 1, 30)?.includes('제거') === true, '처리 불가 남음 → 제거 안내');
  check(step2Blocker([photo(1)], 1, 30) === null, '1장 준비됨 → 다음 가능');
  check(step2Blocker(Array.from({ length: 30 }, (_, i) => photo(i + 1)), 1, 30) === null, '30장 → 다음 가능');
  eq(countPhotos([photo(1), photo(2, 'processing'), photo(3, 'invalid')]), { counted: 2, processing: 1, ready: 1, invalid: 1 }, '카운터(invalid 제외)');
  check(!!validateStep1({ client: null, memo: '' }, null, 500).client, '거래처 필수');
  check(!!validateStep1({ client: { idx: 1, name: 'A', selectable: false }, memo: '' }, '2026-08', 500).client, '승인 대기 거래처 선택 불가');
  check(!!validateStep1({ client: { idx: 1, name: 'A', selectable: true }, memo: 'x'.repeat(501) }, '2026-08', 500).memo, '메모 500자 초과');
  check(leaveMessage({ client: null, memo: '', photos: [], phase: 'editing' }) === null, '빈 작성 → 이탈 확인 없음');
  check(leaveMessage({ client: null, memo: '', photos: [photo(1)], phase: 'submitting' })?.includes('업로드가 진행 중') === true, '업로드 중 이탈 문구');

  // ── 업로드: 12장 중 3번째가 3회 연속 실패 → 실패 1장, 다시 시도하면 실패한 사진만 전송 ──
  const store = fakeStore(Array.from({ length: 12 }, (_, i) => photo(i + 1)));
  const sent: string[] = [];
  const failuresLeft = new Map<string, number>([[store.photos[2].localId, 3]]);
  const upload = async (p: DraftPhoto, onProgress: (f: number) => void) => {
    sent.push(p.localId);
    onProgress(0.5);
    const left = failuresLeft.get(p.localId) ?? 0;
    if (left > 0) {
      failuresLeft.set(p.localId, left - 1);
      throw new FakeApiError('NETWORK_ERROR', 0);
    }
    onProgress(1);
    return { uploadId: `u-${p.localId}` };
  };
  const ac = new AbortController();
  const first = await runUploadBatch(store.photos, { upload, onPhotoUpdate: store.patch, signal: ac.signal, delays: [1000, 3000], sleep: fastSleep });
  eq([first.uploaded.length, first.failed.length], [11, 1], '1차: 11장 성공, 1장 실패');
  eq(store.photos[2].upload.state, 'failed', '실패 사진 상태');
  eq(store.photos[2].upload.attempts, 3, '실패 사진 시도 3회(자동 재시도 2회 포함)');
  eq(summarizeUploads(store.photos).uploaded, 11, "진행률 '11 / 12장'");
  eq(uploadCandidates(store.photos).map((p) => p.localId), [store.photos[2].localId], '다시 시도 대상 = 실패한 사진만');
  sent.length = 0;
  const second = await runUploadBatch(store.photos, { upload, onPhotoUpdate: store.patch, signal: ac.signal, delays: [1000, 3000], sleep: fastSleep });
  eq([second.uploaded.length, second.failed.length, sent.length], [1, 0, 1], '2차: 실패한 1장만 전송, 업로드 완료분 재전송 없음');
  eq(summarizeUploads(store.photos).percent, 100, '모두 업로드 → 100%');

  // 치명적 오류(EDI 차단)는 나머지를 멈춘다
  const blocked = fakeStore(Array.from({ length: 6 }, (_, i) => photo(i + 1)));
  let blockedCalls = 0;
  const fatal = await runUploadBatch(blocked.photos, {
    upload: async () => {
      blockedCalls += 1;
      throw new FakeApiError('EDI_DISABLED', 403);
    },
    onPhotoUpdate: blocked.patch,
    signal: new AbortController().signal,
    delays: [1000, 3000],
    sleep: fastSleep,
    concurrency: 3,
  });
  check(!!fatal.fatal && blockedCalls <= 3 && blocked.photos.every((p) => p.upload.state === 'idle'), 'EDI 차단 → 즉시 중단, 실패 표시 없이 대기 상태로');

  // ── 제출 본문: 화면 순서 = seq 1..N (이동 후에도) ──
  const draftPhotos = reorderByKeys(store.photos, [store.photos[11].localId]);
  const request = buildSubmissionRequest({ client: { idx: 5003, name: '가나의원', selectable: true }, memo: '  메모  ', photos: draftPhotos }, '2026-08');
  check(!!request, '제출 본문 생성');
  eq(request?.photos.map((p) => p.seq), Array.from({ length: 12 }, (_, i) => i + 1), 'seq 1..12 연속');
  eq(request?.photos[0].uploadId, `u-${store.photos[11].localId}`, '맨 앞으로 옮긴 사진이 seq 1');
  eq(request?.memo, '메모', '메모 앞뒤 공백 정리');
  check(buildSubmissionRequest({ client: { idx: 1, name: 'A', selectable: true }, memo: '', photos: [photo(1)] }, '2026-08') === null, '업로드 안 된 사진이 있으면 본문 없음');
  const thirty = Array.from({ length: 30 }, (_, i) => ({ ...photo(i + 1), upload: { state: 'uploaded' as const, progress: 1, attempts: 1, uploadId: `u${i}` } }));
  eq(buildSubmissionRequest({ client: { idx: 1, name: 'A', selectable: true }, memo: '', photos: thirty }, '2026-08')?.photos.length, 30, '30장 제출 본문');

  // ── 제출: 불확실하면 같은 키·같은 본문으로만 재시도, 확정 거절은 재시도 없음 ──
  const submission = { id: 's1', photos: [] } as unknown as EdiSubmissionDetail;
  const seenKeys: string[] = [];
  const seenBodies: EdiSubmissionCreateRequest[] = [];
  let attemptsLeftToFail = 5;
  const create = async (body: EdiSubmissionCreateRequest, key: string): Promise<EdiSubmissionCreateResponse> => {
    seenKeys.push(key);
    seenBodies.push(body);
    if (attemptsLeftToFail > 0) {
      attemptsLeftToFail -= 1;
      throw new FakeApiError('TIMEOUT', 0);
    }
    return { submission, replayed: seenKeys.length > 1 };
  };
  const req = request as EdiSubmissionCreateRequest;
  const key = '11111111-1111-4111-8111-111111111111';
  const r1 = await submitWithRetry(req, key, { create: (b, k) => create(b, k), delays: [1000, 3000], signal: ac.signal, sleep: fastSleep });
  eq([r1.kind, seenKeys.length], ['uncertain', 3], '응답 불확실 → 자동 2회 재시도 후 uncertain');
  attemptsLeftToFail = 0;
  const r2 = await submitWithRetry(req, key, { create: (b, k) => create(b, k), delays: [1000, 3000], signal: ac.signal, sleep: fastSleep });
  check(r2.kind === 'success' && r2.response.replayed, '[다시 시도] → 같은 키로 replayed 결과');
  check(seenKeys.every((k) => k === key) && seenBodies.every((b) => b === req), '모든 재시도가 같은 키·같은 본문');
  const r3 = await submitWithRetry(req, key, {
    create: async () => {
      throw new FakeApiError('UPLOAD_NOT_FOUND', 422, { missing: ['u-x', 7] });
    },
    delays: [1000, 3000],
    signal: ac.signal,
    sleep: fastSleep,
  });
  check(r3.kind === 'rejected' && r3.missingUploadIds.length === 1 && r3.missingUploadIds[0] === 'u-x', 'UPLOAD_NOT_FOUND → missing 목록');
  eq(
    ['UPLOAD_NOT_FOUND', 'EDI_DISABLED', 'SCHEMA_NOT_READY', 'CLIENT_NOT_SELECTABLE', 'IDEMPOTENCY_CONFLICT', 'UPLOAD_ALREADY_USED', 'PHOTO_COUNT_OUT_OF_RANGE'].map(rejectAction),
    ['reupload', 'back-to-step1', 'back-to-step1', 'back-to-step1', 'conflict', 'conflict', 'stay'],
    '확정 거절 처리 (409 충돌은 새 키 발급 없이 conflict)',
  );

  // ── 제출 결과 반영: 같은 작성 건이 서버에 두 번 만들어지지 않는다 ──
  check(isUncertainSubmitError(new FakeApiError('SERVER_ERROR', 500)) && isUncertainSubmitError(new FakeApiError('TIMEOUT', 0)), '5xx·타임아웃 → 결과 불확실');
  check(!isUncertainSubmitError(new FakeApiError('SCHEMA_NOT_READY', 503)), 'SCHEMA_NOT_READY(503) → 확정 거절(롤백됨)');
  const submitOpts = (server: ReturnType<typeof fakeSubmitServer>) => ({
    create: (b: EdiSubmissionCreateRequest, k: string) => server.create(b, k),
    delays: [1000, 3000],
    signal: ac.signal,
    sleep: fastSleep,
  });
  const readyUploaded = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...photo(i + 1), upload: { state: 'uploaded' as const, progress: 1, attempts: 1, uploadId: `up-${i + 1}` } }));
  const bodyOf = (d: FakeDraft) => buildSubmissionRequest(d, d.targetYm) as EdiSubmissionCreateRequest;

  // (1) 첫 요청은 저장됐지만 응답을 못 받고 자동 재시도도 오프라인 → 불확실. 이후 [다시 시도]가 로그인 만료(401)로 거절돼도 잠금 유지.
  {
    const server = fakeSubmitServer();
    const photos = readyUploaded(3);
    const draftKey = '22222222-2222-4222-8222-222222222222';
    const body = buildSubmissionRequest({ client: { idx: 5003, name: '가나의원', selectable: true }, memo: '', photos }, '2026-08') as EdiSubmissionCreateRequest;
    const d = new FakeDraft(photos, draftKey, body);
    server.plan = ['commit-lose-response', 'offline', 'offline'];
    applySubmitFailure(() => d, asFailure(await submitWithRetry(body, draftKey, submitOpts(server))));
    check(d.phase === 'submitting' && d.submit.stage === 'uncertain' && d.submit.pendingRequest === body, '응답 유실 → 불확실, 잠금·pendingRequest 유지');
    eq(d.submit.notice?.message, MSG_UNCERTAIN, '네트워크 불확실 안내');
    d.setSubmit({ stage: 'creating', notice: null }); // [다시 시도]
    server.plan = ['unauthorized'];
    const authLoss = await submitWithRetry(body, draftKey, submitOpts(server));
    check(authLoss.kind === 'rejected' && authLoss.code === 'UNAUTHORIZED', '[다시 시도] 중 로그인 만료 → 401 거절');
    applySubmitFailure(() => d, asFailure(authLoss));
    check(d.phase === 'submitting' && d.submit.stage === 'uncertain' && d.submit.pendingRequest === body, '로그인 만료로 거절돼도 잠금·pendingRequest 유지(편집 잠금 해제 안 함)');
    eq(d.submit.notice?.message, MSG_UNCERTAIN_RELOGIN, '다시 로그인 후 [다시 시도] 안내');
    eq(d.idempotencyKey, draftKey, '로그인 만료 후에도 키 유지');
    for (const code of ['FORBIDDEN', 'ACCOUNT_NOT_APPROVED']) {
      applySubmitFailure(() => d, { kind: 'rejected', error: new FakeApiError(code, 403), code, message: 'x', missingUploadIds: [] });
      check(d.phase === 'submitting' && d.submit.pendingRequest === body, `${code} → 잠금 유지`);
    }
    // 다시 로그인한 뒤 같은 키·같은 본문 → 서버가 저장된 결과를 재생, 새로 만들지 않음
    const replay = await submitWithRetry(d.submit.pendingRequest as EdiSubmissionCreateRequest, d.idempotencyKey, submitOpts(server));
    check(replay.kind === 'success' && replay.response.replayed && server.created === 1, '다시 로그인 후 [다시 시도] → replayed, 제출 건 1개');
    applySubmitFailure(() => d, { kind: 'aborted' }, { sessionEnded: true });
    eq(d.submit.notice?.message, MSG_UNCERTAIN_RELOGIN, '로그아웃·세션 만료로 멈춤 → 불확실(다시 로그인 안내)');
  }

  // (2) 5xx 가 반복되는 불확실 상태 → [편집으로 돌아가기](키 유지) → 그대로 다시 등록하면 같은 키·같은 본문이라 중복 없음
  {
    const server = fakeSubmitServer();
    const draftKey = '33333333-3333-4333-8333-333333333333';
    const photos = readyUploaded(3);
    const body = buildSubmissionRequest({ client: { idx: 5003, name: '가나의원', selectable: true }, memo: '', photos }, '2026-08') as EdiSubmissionCreateRequest;
    const d = new FakeDraft(photos, draftKey, body);
    server.plan = ['commit-lose-response', 'server-error', 'server-error'];
    const repeated = await submitWithRetry(body, draftKey, submitOpts(server));
    check(repeated.kind === 'uncertain' && server.calls === 3, '5xx 반복 → 자동 2회 후 불확실');
    applySubmitFailure(() => d, asFailure(repeated));
    const n = d.submit.notice;
    check(n?.kind === 'uncertain' && n.serverError === true && !n.message.includes('네트워크 연결') && n.message.includes('중복 등록되지 않습니다'), '5xx 불확실 → 네트워크 문구 대신 서버 안내 + 탈출구 표시');
    check(d.phase === 'submitting' && d.submit.pendingRequest === body, '5xx 불확실 → 기본은 잠금 유지');
    check(unlockUncertain(() => d) && d.phase === 'editing' && d.submit.notice?.kind === 'unlocked' && d.idempotencyKey === draftKey, '[편집으로 돌아가기] → 편집 복귀, 키 유지');
    check(!unlockUncertain(() => d), '불확실 상태가 아니면 잠금 해제 동작 없음');
    const same = bodyOf(d);
    eq(same, body, '내용을 바꾸지 않으면 같은 본문');
    d.setPhase('submitting');
    const resent = await submitWithRetry(same, d.idempotencyKey, submitOpts(server));
    check(resent.kind === 'success' && resent.response.replayed && server.created === 1, '같은 키·같은 본문 다시 등록 → replayed, 두 번 만들지 않음');

    // (3) 편집 후 다시 등록 → 같은 키·다른 본문 → 409. 새 키로 조용히 다시 보내지 않고 'conflict' 안내에서 멈춘다.
    d.setPhase('editing');
    d.removeFirstPhoto();
    const edited = bodyOf(d);
    check(JSON.stringify(edited) !== JSON.stringify(body), '편집하면 본문이 달라짐');
    d.setPhase('submitting');
    d.setSubmit({ stage: 'creating', pendingRequest: edited, notice: null });
    const conflictOutcome = await submitWithRetry(edited, d.idempotencyKey, submitOpts(server));
    check(conflictOutcome.kind === 'rejected' && conflictOutcome.code === 'IDEMPOTENCY_CONFLICT', '같은 키·다른 본문 → 409 IDEMPOTENCY_CONFLICT');
    const callsBefore = server.calls;
    applySubmitFailure(() => d, asFailure(conflictOutcome));
    check(d.phase === 'editing' && d.submit.notice?.kind === 'conflict' && d.submit.notice.message === MSG_CONFLICT, '409 → 편집 복귀 + 이미 등록되었을 수 있음 안내(내역 확인·새로 작성)');
    check(d.idempotencyKey === draftKey && d.submit.pendingRequest === null && server.calls === callsBefore && server.created === 1, '409 → 키를 바꾸지 않고 다시 보내지 않음(제출 건 1개 그대로)');
  }

  // (4) SCHEMA_NOT_READY(503) → 재시도 없이 확정 거절, 1단계로 돌아가 EDI 상태를 다시 확인
  {
    const server = fakeSubmitServer();
    const photos = readyUploaded(1);
    const body = buildSubmissionRequest({ client: { idx: 5003, name: '가나의원', selectable: true }, memo: '', photos }, '2026-08') as EdiSubmissionCreateRequest;
    const d = new FakeDraft(photos, '44444444-4444-4444-8444-444444444444', body);
    server.plan = ['schema-not-ready', 'schema-not-ready', 'schema-not-ready'];
    const schema = await submitWithRetry(body, d.idempotencyKey, submitOpts(server));
    check(schema.kind === 'rejected' && schema.code === 'SCHEMA_NOT_READY' && server.calls === 1, 'SCHEMA_NOT_READY → 자동 재시도 없음');
    const effects = applySubmitFailure(() => d, asFailure(schema));
    check(d.phase === 'editing' && d.step === 1 && effects.refreshStatus && d.submit.notice?.kind === 'rejected', 'SCHEMA_NOT_READY → 편집 복귀(1단계) + EDI 상태 다시 확인');
    check(d.submit.notice?.message === 'SCHEMA_NOT_READY 오류', 'SCHEMA_NOT_READY → 서버 안내 문구 그대로');
  }

  // ── 이탈·로그아웃 안내, 다른 사용자의 작성 건 ──
  eq(leaveMessage({ client: null, memo: '', photos: [photo(1)], phase: 'submitting', submit: { stage: 'uncertain' } }), LEAVE_MESSAGE_UNCERTAIN, '결과 불확실 이탈 문구');
  check(signOutWarning({ client: null, memo: '', photos: [], phase: 'editing' }) === null, '빈 작성 → 로그아웃 경고 없음');
  check(signOutWarning({ client: null, memo: '', photos: [photo(1)], phase: 'editing' })?.includes('로그아웃하면') === true, '작성 중 → 로그아웃 경고');
  check(signOutWarning({ client: null, memo: '', photos: [photo(1)], phase: 'submitting', submit: { stage: 'uncertain' } })?.includes('등록 내역') === true, '불확실 → 로그아웃 전 내역 확인 안내');
  check(isForeignDraft('userA', 'userB') && !isForeignDraft(null, 'userB') && !isForeignDraft('userB', 'userB'), '다른 사용자의 작성 건(완료 결과 포함) 판별');

  // ── 기기 변환 실패 시 원본 그대로 올리기 (iOS 흑백·CMYK) ──
  const photoLimits = { minLongSide: 1000, maxBytes: 15 * 1024 * 1024 };
  eq(originalUploadCheck('jpeg', 4_000_000, 3024, 4032, photoLimits), { ok: true, bytes: 4_000_000 }, '흑백 JPEG 원본 → 그대로 올림');
  check(originalUploadCheck('png', 2_000_000, 2000, 1500, photoLimits).ok && originalUploadCheck('webp', 2_000_000, 2000, 1500, photoLimits).ok, 'PNG·WEBP 원본 → 그대로 올림');
  const tooBig = originalUploadCheck('jpeg', 20 * 1024 * 1024, 4000, 3000, photoLimits);
  check(!tooBig.ok && !!tooBig.reason?.includes('원본이 너무 커서'), '서버 최대 용량 초과 원본 → 이유와 함께 처리 불가');
  const small = originalUploadCheck('jpeg', 100_000, 800, 600, photoLimits);
  check(!small.ok && !!small.reason?.includes('해상도가 너무 낮습니다'), '해상도 부족 원본 → 이유와 함께 처리 불가');
  check(!originalUploadCheck('heic', 2_000_000, 4000, 3000, photoLimits).ok && !originalUploadCheck(null, 2_000_000, 4000, 3000, photoLimits).ok, 'HEIC·형식 불명 → 원본 업로드 안 함');
  check(!originalUploadCheck('jpeg', null, 4000, 3000, photoLimits).ok && !originalUploadCheck('jpeg', 2_000_000, 0, 0, photoLimits).ok, '크기·해상도를 모르면 원본 업로드 안 함');

  // ── 형식 판별 ──
  eq(kindFromMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg', 'JPEG 매직');
  eq(kindFromMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'png', 'PNG 매직');
  const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  eq(kindFromMagic(ascii('RIFF\0\0\0\0WEBPVP8 ')), 'webp', 'WEBP 매직');
  eq(kindFromMagic(ascii('\0\0\0\x18ftypheic\0\0\0\0')), 'heic', 'HEIC 매직');
  eq(kindFromMagic(ascii('GIF89a')), 'gif', 'GIF 매직');
  check(!checkDeclaredType('a.gif', 'image/gif').supported, 'GIF 는 지원하지 않음');
  check(checkDeclaredType('IMG_0001.HEIC', '').supported, 'HEIC(확장자, MIME 없음) 지원');
  check(!checkDeclaredType('clip.mov', 'video/quicktime').supported, '동영상 거부');
  check(!checkContentType(ascii('GIF89a'), 'jpeg').supported, '확장자가 jpg 여도 내용이 GIF 면 거부');
  eq(fitLongSide(4032, 3024, 2560), { width: 2560, height: 1920 }, '긴 변 2560 축소(비율 유지)');
  eq(fitLongSide(3024, 4032, 2560), { width: 1920, height: 2560 }, '세로 사진 축소');
  eq(fitLongSide(1600, 1200, 2560), null, '작은 사진은 확대하지 않음');

  console.log(`SELFCHECK OK (${passed} checks)`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  throw error;
});

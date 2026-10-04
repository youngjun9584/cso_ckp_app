/**
 * EDI 제출 (DESIGN §2.5, §3.3, §3.4, §5.7)
 *  한 트랜잭션: advisory lock(사용자+Idempotency-Key) → 재요청 확인(같은 해시 → 기존 결과, 다르면 409)
 *  → is_edi 재확인 → 거래처 소유·선택 가능 → 업로드 FOR UPDATE(소유·PENDING)
 *  → edi 행을 seq 순서대로 한 행씩 INSERT(idx 오름차순 = 사진 순서) → 제출 건·사진 순번 → 업로드 USED.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from '../../app.js';
import type { EdiMonthLabel, EdiSubmissionDetail } from '../../contract.js';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { ediMonthLabelForYm, isValidYm, nowKst, todayKst } from '../../lib/kst.js';
import { EDI_MAX_PHOTOS, EDI_MEMO_MAX_LENGTH, EDI_MIN_PHOTOS } from '../../lib/limits.js';
import { optionalText, parseInput } from '../../lib/validation.js';
import { matchManagers } from '../../services/managers.js';
import { awsUrlMaxLength, isUuid, normalizeUuid, type PhotoUrlSigner } from './common.js';
import { loadAppSubmission, publicDetail } from './history.js';
import { assertEdiEnabled } from './status.js';

// ───────────────────────── 입력 검증 ─────────────────────────

export const IDEMPOTENCY_KEY_MESSAGE = '등록 요청 식별값(Idempotency-Key)이 없거나 올바르지 않습니다. 앱을 다시 실행한 뒤 시도해 주세요.';
export const PHOTO_ORDER_MESSAGE = '사진 순서 정보가 올바르지 않습니다. 사진 순서를 확인한 뒤 다시 등록해 주세요.';
export const DUPLICATE_PHOTO_MESSAGE = '같은 사진이 두 번 포함되어 있습니다. 중복된 사진을 빼고 다시 등록해 주세요.';
export const TARGET_YM_MESSAGE = '대상 연월을 다시 선택해 주세요.';
export const CLIENT_NOT_FOUND_MESSAGE = '거래처를 찾을 수 없습니다. 거래처를 다시 선택해 주세요.';
export const CLIENT_PENDING_MESSAGE = '승인 대기 중인 거래처는 EDI 등록에 사용할 수 없습니다. 관리자 승인 후 다시 시도해 주세요.';
export const CLIENT_NO_NAME_MESSAGE = '거래처명이 없는 거래처는 EDI 등록에 사용할 수 없습니다.';

const INT4_MAX = 2_147_483_647;

const SubmissionBodySchema = z.object({
  clientIdx: z
    .number({ error: '거래처를 선택해 주세요.' })
    .int('거래처를 다시 선택해 주세요.')
    .min(1, '거래처를 다시 선택해 주세요.')
    .max(INT4_MAX, '거래처를 다시 선택해 주세요.'),
  targetYm: z.string({ error: '대상 연월을 선택해 주세요.' }).refine(isValidYm, TARGET_YM_MESSAGE),
  memo: optionalText(EDI_MEMO_MAX_LENGTH, `메모는 ${EDI_MEMO_MAX_LENGTH}자 이하로 입력해 주세요.`).optional(),
  photos: z.array(
    z.object({
      uploadId: z.string({ error: PHOTO_ORDER_MESSAGE }).refine(isUuid, '사진 정보가 올바르지 않습니다. 사진을 다시 올려 주세요.'),
      seq: z.number({ error: PHOTO_ORDER_MESSAGE }).int(PHOTO_ORDER_MESSAGE),
    }),
    { error: '등록할 사진을 선택해 주세요.' },
  ),
});

export interface SubmissionInput {
  idempotencyKey: string;
  clientIdx: number;
  targetYm: string;
  memo: string | null;
  /** seq 오름차순으로 정렬된 uploadId (소문자) */
  uploadIds: string[];
  requestHash: string;
}

function photoCountError(count: number): AppError {
  return new AppError('PHOTO_COUNT_OUT_OF_RANGE', `사진은 ${EDI_MIN_PHOTOS}장 이상 ${EDI_MAX_PHOTOS}장 이하로 등록할 수 있습니다.`, {
    details: { min: EDI_MIN_PHOTOS, max: EDI_MAX_PHOTOS, count },
  });
}

/** 헤더·본문 검증 + 요청 해시. targetYm 이 현재 선택 가능한 월인지는 트랜잭션 안에서(재요청 확인 뒤) 본다. */
export function parseSubmissionRequest(idempotencyHeader: unknown, body: unknown): SubmissionInput {
  const rawKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!isUuid(key)) throw new AppError('VALIDATION_FAILED', IDEMPOTENCY_KEY_MESSAGE, { details: { header: 'Idempotency-Key' } });

  const rawPhotos = (body as { photos?: unknown } | null | undefined)?.photos;
  if (Array.isArray(rawPhotos) && (rawPhotos.length < EDI_MIN_PHOTOS || rawPhotos.length > EDI_MAX_PHOTOS)) {
    throw photoCountError(rawPhotos.length);
  }
  const input = parseInput(SubmissionBodySchema, body ?? {});
  if (input.photos.length < EDI_MIN_PHOTOS || input.photos.length > EDI_MAX_PHOTOS) throw photoCountError(input.photos.length);

  const sorted = [...input.photos].sort((a, b) => a.seq - b.seq);
  if (sorted.some((p, i) => p.seq !== i + 1)) {
    throw new AppError('VALIDATION_FAILED', PHOTO_ORDER_MESSAGE, { fields: { photos: PHOTO_ORDER_MESSAGE } });
  }
  const uploadIds = sorted.map((p) => normalizeUuid(p.uploadId));
  if (new Set(uploadIds).size !== uploadIds.length) {
    throw new AppError('VALIDATION_FAILED', DUPLICATE_PHOTO_MESSAGE, { fields: { photos: DUPLICATE_PHOTO_MESSAGE } });
  }
  const memo = input.memo ?? null;
  return {
    idempotencyKey: normalizeUuid(key),
    clientIdx: input.clientIdx,
    targetYm: input.targetYm,
    memo,
    uploadIds,
    requestHash: requestHash({ clientIdx: input.clientIdx, targetYm: input.targetYm, memo, uploadIds }),
  };
}

/** sha256(정규화 JSON{clientIdx, targetYm, memo, photos(seq 순 uploadId)}) */
export function requestHash(v: { clientIdx: number; targetYm: string; memo: string | null; uploadIds: string[] }): string {
  const canonical = JSON.stringify({ clientIdx: v.clientIdx, targetYm: v.targetYm, memo: v.memo, photos: v.uploadIds });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ───────────────────────── 제출 트랜잭션 ─────────────────────────

interface ClientRow {
  idx: number;
  hospital: string | null;
  user_id: string;
  approval: boolean | null;
}

interface UploadLockRow {
  upload_id: string;
  usr_id: string;
  status: string;
  public_url: string | null;
}

export interface CreateSubmissionResult {
  submission: EdiSubmissionDetail;
  replayed: boolean;
}

function insertEdiSql(withIsCopy: boolean): string {
  // DESIGN §2.5 표의 값 그대로. region 은 넣지 않는다. is_copy 는 컬럼이 있을 때만.
  const cols = [
    'deal_type', 'hospital_name', 'pharmacist', 'user_id', 'edi_image', 'reg_ymd', 'is_ocr', 'month', 'move_month', 'aws_url', 'ocr', 'create_at', 'print',
  ];
  const vals = ['$1', '$2', "''", '$3', 'NULL', '$4::date', 'false', '$5', 'false', '$6', 'NULL', '$7', 'false'];
  if (withIsCopy) {
    cols.push('is_copy');
    vals.push('false');
  }
  return `INSERT INTO public.edi (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING idx`;
}

async function assertClientSelectable(q: Queryable, deps: Pick<RouteDeps, 'config'>, usrId: string, clientIdx: number): Promise<ClientRow & { hospital: string }> {
  const { rows } = await q.query<ClientRow>(
    'SELECT idx, hospital, user_id, approval FROM public.mannager_by_hospital WHERE idx = $1',
    [clientIdx],
  );
  const c = rows[0];
  if (!c || c.user_id !== usrId) throw new AppError('NOT_FOUND', CLIENT_NOT_FOUND_MESSAGE, { fields: { clientIdx: CLIENT_NOT_FOUND_MESSAGE } });
  if (deps.config.features.clientApprovalRequiredForEdi && c.approval === false) {
    throw new AppError('CLIENT_NOT_SELECTABLE', CLIENT_PENDING_MESSAGE, { details: { approval: 'pending' } });
  }
  if (c.hospital === null || c.hospital.trim() === '') {
    throw new AppError('CLIENT_NOT_SELECTABLE', CLIENT_NO_NAME_MESSAGE, { details: { reason: 'NO_NAME' } });
  }
  return { ...c, hospital: c.hospital };
}

async function lockUploads(q: Queryable, usrId: string, uploadIds: string[]): Promise<Map<string, UploadLockRow>> {
  const { rows } = await q.query<UploadLockRow>(
    `SELECT upload_id::text AS upload_id, usr_id, status, public_url
       FROM public.ckp_app_edi_upload
      WHERE upload_id = ANY($1::uuid[])
      ORDER BY upload_id
      FOR UPDATE`,
    [uploadIds],
  );
  const byId = new Map(rows.map((r) => [r.upload_id, r]));
  const missing = uploadIds.filter((id) => {
    const r = byId.get(id);
    return !r || r.usr_id !== usrId || r.status === 'DELETED';
  });
  if (missing.length > 0) throw new AppError('UPLOAD_NOT_FOUND', undefined, { details: { missing } });
  const used = uploadIds.filter((id) => byId.get(id)?.status === 'USED');
  if (used.length > 0) throw new AppError('UPLOAD_ALREADY_USED', undefined, { details: { used } });
  return byId;
}

export async function createSubmission(
  deps: Pick<RouteDeps, 'config' | 'db' | 'capabilities'>,
  usrId: string,
  input: SubmissionInput,
  now: Date,
  signer: PhotoUrlSigner,
  log: FastifyBaseLogger,
): Promise<CreateSubmissionResult> {
  const { db, capabilities } = deps;
  const createAt = nowKst(now);
  const regYmd = todayKst(now);
  const maxUrl = awsUrlMaxLength(capabilities);
  const insertEdi = insertEdiSql(capabilities.ediIsCopy);

  return db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ckp-edi-submission:${usrId}:${input.idempotencyKey}`]);
    await matchManagers(q, usrId);

    const prev = await q.query<{ submission_id: string; request_hash: string }>(
      `SELECT submission_id::text AS submission_id, request_hash FROM public.ckp_app_edi_submission
        WHERE usr_id = $1 AND idempotency_key = $2::uuid`,
      [usrId, input.idempotencyKey],
    );
    const existing = prev.rows[0];
    if (existing) {
      if (existing.request_hash.trim() !== input.requestHash) throw new AppError('IDEMPOTENCY_CONFLICT');
      const detail = await loadAppSubmission(q, usrId, existing.submission_id, signer);
      if (!detail) throw new AppError('SERVER_ERROR');
      return { submission: publicDetail(detail), replayed: true };
    }

    await assertEdiEnabled(q, log);

    const monthLabel: EdiMonthLabel | null = ediMonthLabelForYm(input.targetYm, now);
    if (!monthLabel) {
      throw new AppError('VALIDATION_FAILED', TARGET_YM_MESSAGE, { fields: { targetYm: TARGET_YM_MESSAGE } });
    }

    const client = await assertClientSelectable(q, deps, usrId, input.clientIdx);
    const uploads = await lockUploads(q, usrId, input.uploadIds);

    const ediIdxs: number[] = [];
    for (const uploadId of input.uploadIds) {
      const url = uploads.get(uploadId)?.public_url ?? null;
      if (!url || url.length > maxUrl || url.includes('?')) {
        log.error({ uploadId, length: url?.length ?? null, maxUrl }, 'edi.aws_url 에 기록할 수 없는 업로드 URL — 제출 중단');
        throw new AppError('SERVER_ERROR', '사진 저장 경로에 문제가 있어 등록할 수 없습니다. 관리자에게 문의해 주세요.');
      }
      const ins = await q.query<{ idx: number }>(insertEdi, [deps.config.edi.dealType, client.hospital, usrId, regYmd, monthLabel, url, createAt]);
      const idx = ins.rows[0]?.idx;
      if (typeof idx !== 'number') throw new AppError('SERVER_ERROR');
      ediIdxs.push(idx);
    }

    const submissionId = randomUUID();
    await q.query(
      `INSERT INTO public.ckp_app_edi_submission
              (submission_id, usr_id, idempotency_key, request_hash, client_idx, client_name, target_ym, month_label, memo,
               photo_count, create_at_kst, reg_ymd, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13)`,
      [
        submissionId,
        usrId,
        input.idempotencyKey,
        input.requestHash,
        client.idx,
        client.hospital,
        input.targetYm,
        monthLabel,
        input.memo,
        input.uploadIds.length,
        createAt,
        regYmd,
        now,
      ],
    );
    await q.query(
      `INSERT INTO public.ckp_app_edi_submission_photo (submission_id, seq, edi_idx, upload_id)
       SELECT $1::uuid, t.seq, t.edi_idx, t.upload_id
         FROM unnest($2::int[], $3::int[], $4::uuid[]) AS t(seq, edi_idx, upload_id)`,
      [submissionId, input.uploadIds.map((_, i) => i + 1), ediIdxs, input.uploadIds],
    );
    await q.query(`UPDATE public.ckp_app_edi_upload SET status = 'USED', used_at = $2 WHERE upload_id = ANY($1::uuid[])`, [
      input.uploadIds,
      now,
    ]);

    const detail = await loadAppSubmission(q, usrId, submissionId, signer);
    if (!detail) throw new AppError('SERVER_ERROR');
    return { submission: publicDetail(detail), replayed: false };
  });
}

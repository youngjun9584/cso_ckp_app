/**
 * /v1/edi — EDI (DESIGN §2.5, §3.2–§3.4, §5.7). 모든 경로 인증 필요.
 *   GET  /status            등록 가능 여부 (조회 오류·스키마 미준비 → enabled=false)
 *   GET  /month-options     대상 연월 3개 (KST, 당월 = 직전 달)
 *   POST /uploads           사진 1장 (multipart: clientPhotoId + file) → 201 | 200(reused)
 *   POST /submissions       제출 (Idempotency-Key) → 201 | 200(replayed)
 *   GET  /submissions?ym=   등록월 내역 (앱 제출 건 + 이전 방식 묶음, 최신순)
 *   GET  /submissions/:id   상세 (uuid | legacy-<해시>), 사진 seq 순
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteOptions } from '../app.js';
import type {
  EdiMonthOptionsResponse,
  EdiStatusResponse,
  EdiSubmissionCreateResponse,
  EdiSubmissionDetailResponse,
  EdiSubmissionListResponse,
  EdiUploadResponse,
} from '../contract.js';
import { assertEdiSchemaReady, createPhotoUrlSigner, isUuid, normalizeUuid } from '../domain/edi/common.js';
import { getSubmissionDetail, listSubmissions } from '../domain/edi/history.js';
import { assertEdiEnabled, ediStatus } from '../domain/edi/status.js';
import { createSubmission, parseSubmissionRequest } from '../domain/edi/submissions.js';
import { findReusableUpload, storeNewUpload, toEdiUpload, type UploadRow } from '../domain/edi/uploads.js';
import { AppError } from '../lib/errors.js';
import { currentYmKst, ediMonthOptions, isValidYm } from '../lib/kst.js';
import { pagingQuery, parseInput } from '../lib/validation.js';
import { requireUser, userRateLimitKey } from '../plugins/auth.js';

export const CLIENT_PHOTO_ID_MESSAGE = '사진 식별값(clientPhotoId)이 없거나 올바르지 않습니다. 사진을 다시 선택해 주세요.';
export const NO_FILE_MESSAGE = '사진 파일이 없습니다. 사진을 선택해 다시 올려 주세요.';
export const SUBMISSION_NOT_FOUND_MESSAGE = 'EDI 등록 내역을 찾을 수 없습니다.';
const YM_QUERY_MESSAGE = '조회할 연월 형식이 올바르지 않습니다. (예: 2026-09)';

const ListQuerySchema = pagingQuery.extend({
  ym: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || isValidYm(v), YM_QUERY_MESSAGE),
});

const DetailParamsSchema = z.object({ id: z.string().min(1).max(100) });

/** 읽지 않을 파일 스트림을 끝까지 흘려보낸다(다음 part 로 진행하기 위해 필요) */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // 버림
  }
}

export default async function ediRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const deps = opts.deps;
  const { db, capabilities, clock } = deps;

  app.get('/status', { onRequest: app.authenticate }, async (request): Promise<EdiStatusResponse> => {
    requireUser(request);
    return ediStatus(db, capabilities, request.log);
  });

  app.get('/month-options', { onRequest: app.authenticate }, async (request): Promise<EdiMonthOptionsResponse> => {
    requireUser(request);
    return ediMonthOptions(clock.now());
  });

  app.post(
    '/uploads',
    {
      onRequest: app.authenticate,
      config: { rateLimit: { max: 180, timeWindow: 60_000, keyGenerator: userRateLimitKey(app) } },
    },
    async (request, reply): Promise<EdiUploadResponse> => {
      const user = requireUser(request);
      assertEdiSchemaReady(capabilities);
      await assertEdiEnabled(db, request.log);
      if (!request.isMultipart()) {
        throw new AppError('VALIDATION_FAILED', '사진은 multipart/form-data 형식으로 보내야 합니다.', { status: 415 });
      }
      const now = clock.now();
      const signer = createPhotoUrlSigner(request, deps, user.usrId);
      const invalidCid = () => new AppError('VALIDATION_FAILED', CLIENT_PHOTO_ID_MESSAGE, { fields: { clientPhotoId: CLIENT_PHOTO_ID_MESSAGE } });

      let clientPhotoId: string | null = null;
      let file: Buffer | null = null;
      let reused: UploadRow | null = null;
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          // clientPhotoId 가 파일보다 먼저 왔으면 파일을 받기 전에 재사용 여부를 확인한다
          if (clientPhotoId && !reused) reused = await findReusableUpload(db, user.usrId, clientPhotoId);
          if (reused || file) {
            await drain(part.file);
            continue;
          }
          file = await part.toBuffer(); // PHOTO_MAX_BYTES 초과 → 413 FILE_TOO_LARGE
        } else if (part.fieldname === 'clientPhotoId' && clientPhotoId === null) {
          const v = typeof part.value === 'string' ? part.value.trim() : '';
          if (!isUuid(v)) throw invalidCid();
          clientPhotoId = normalizeUuid(v);
        }
      }
      if (!clientPhotoId) throw invalidCid();

      reused ??= await findReusableUpload(db, user.usrId, clientPhotoId);
      if (reused) {
        reply.status(200);
        return { upload: toEdiUpload(reused, signer), reused: true };
      }
      if (!file || file.length === 0) throw new AppError('VALIDATION_FAILED', NO_FILE_MESSAGE, { fields: { file: NO_FILE_MESSAGE } });

      const stored = await storeNewUpload(deps, { usrId: user.usrId, clientPhotoId, buffer: file, now }, request.log);
      reply.status(stored.reused ? 200 : 201);
      return { upload: toEdiUpload(stored.row, signer), reused: stored.reused };
    },
  );

  app.post('/submissions', { onRequest: app.authenticate }, async (request, reply): Promise<EdiSubmissionCreateResponse> => {
    const user = requireUser(request);
    assertEdiSchemaReady(capabilities);
    const input = parseSubmissionRequest(request.headers['idempotency-key'], request.body);
    const signer = createPhotoUrlSigner(request, deps, user.usrId);
    const result = await createSubmission(deps, user.usrId, input, clock.now(), signer, request.log);
    reply.status(result.replayed ? 200 : 201);
    return result;
  });

  app.get('/submissions', { onRequest: app.authenticate }, async (request): Promise<EdiSubmissionListResponse> => {
    const user = requireUser(request);
    assertEdiSchemaReady(capabilities);
    const query = parseInput(ListQuerySchema, request.query ?? {});
    const ym = query.ym ?? currentYmKst(clock.now());
    const signer = createPhotoUrlSigner(request, deps, user.usrId);
    return listSubmissions(db, capabilities, user.usrId, ym, { page: query.page, pageSize: query.pageSize }, signer);
  });

  app.get('/submissions/:id', { onRequest: app.authenticate }, async (request): Promise<EdiSubmissionDetailResponse> => {
    const user = requireUser(request);
    assertEdiSchemaReady(capabilities);
    const { id } = parseInput(DetailParamsSchema, request.params);
    const signer = createPhotoUrlSigner(request, deps, user.usrId);
    const submission = await getSubmissionDetail(db, capabilities, user.usrId, id.trim(), signer);
    if (!submission) throw new AppError('NOT_FOUND', SUBMISSION_NOT_FOUND_MESSAGE);
    return { submission };
  });
}

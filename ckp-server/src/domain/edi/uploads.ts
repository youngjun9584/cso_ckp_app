/**
 * EDI 사진 업로드 원장 (ckp_app_edi_upload). DESIGN §3.2, §5.7
 *  - (usr_id, client_photo_id) 유일: 같은 사진 재업로드는 기존 행 반환(reused)
 *  - 동시 경쟁은 ON CONFLICT 로 한 행만 남기고, 진 쪽은 방금 올린 객체를 지운다
 *  - 정리 스크립트가 DELETED 로 바꾼 행은 같은 clientPhotoId 로 다시 올리면 새 파일로 되살린다
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { RouteDeps } from '../../app.js';
import type { EdiUpload } from '../../contract.js';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { processPhoto } from '../../lib/image.js';
import { compactYmKst } from '../../lib/kst.js';
import { ediObjectKeys } from '../../storage/index.js';
import { awsUrlMaxLength, type PhotoUrlSigner } from './common.js';

export type UploadStatus = 'PENDING' | 'USED' | 'DELETED';

export interface UploadRow {
  upload_id: string;
  usr_id: string;
  client_photo_id: string;
  storage_driver: string;
  object_key: string;
  thumb_key: string;
  public_url: string | null;
  bytes: number;
  width: number;
  height: number;
  status: UploadStatus;
}

export const UPLOAD_COLUMNS = `upload_id::text AS upload_id, usr_id, client_photo_id::text AS client_photo_id, storage_driver,
  object_key, thumb_key, public_url, bytes, width, height, status`;

export const STORAGE_URL_ERROR_MESSAGE = '사진 저장소 설정 문제로 지금은 사진을 올릴 수 없습니다. 관리자에게 문의해 주세요.';

/** 같은 사용자·clientPhotoId 로 이미 올린(PENDING/USED) 사진 */
export async function findReusableUpload(q: Queryable, usrId: string, clientPhotoId: string): Promise<UploadRow | null> {
  const { rows } = await q.query<UploadRow>(
    `SELECT ${UPLOAD_COLUMNS} FROM public.ckp_app_edi_upload
      WHERE usr_id = $1 AND client_photo_id = $2::uuid AND status IN ('PENDING', 'USED')`,
    [usrId, clientPhotoId],
  );
  return rows[0] ?? null;
}

export function toEdiUpload(row: UploadRow, signer: PhotoUrlSigner): EdiUpload {
  return {
    uploadId: row.upload_id,
    clientPhotoId: row.client_photo_id,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    thumbUrl: signer.upload(row.upload_id, 'thumb'),
  };
}

export interface StoreUploadInput {
  usrId: string;
  clientPhotoId: string;
  buffer: Buffer;
  now: Date;
}

/**
 * 검증·정규화 → 저장소 기록 → 원장 INSERT. 반환값 reused=true 면 동시 요청에 져서 기존 행을 돌려준 것.
 * 오류는 AppError(415/422 등). 저장 후 DB 실패 시 방금 올린 객체를 지운다.
 */
export async function storeNewUpload(
  deps: Pick<RouteDeps, 'config' | 'db' | 'storage' | 'capabilities'>,
  input: StoreUploadInput,
  log: FastifyBaseLogger,
): Promise<{ row: UploadRow; reused: boolean }> {
  const { config, db, storage, capabilities } = deps;
  const processed = await processPhoto(input.buffer, { minLongSide: config.photo.minLongSide });

  const uploadId = randomUUID();
  const { objectKey, thumbKey } = ediObjectKeys(config.storage.keyPrefix, compactYmKst(input.now), uploadId);
  const publicUrl = storage.publicUrl(objectKey);
  const maxLen = awsUrlMaxLength(capabilities);
  if (!publicUrl || publicUrl.length > maxLen) {
    // edi.aws_url 에 넣을 수 없는 URL → 제출이 반드시 실패하므로 업로드 단계에서 크게 실패시킨다
    log.error({ driver: storage.driver, length: publicUrl?.length ?? null, maxLen }, 'EDI 사진 공개 URL 이 edi.aws_url 한도를 넘거나 없습니다 — S3_KEY_PREFIX/S3_PUBLIC_BASE_URL 확인 필요');
    throw new AppError('SERVER_ERROR', STORAGE_URL_ERROR_MESSAGE, { status: 500 });
  }

  const removeObjects = async () => {
    await Promise.allSettled([storage.delete(objectKey), storage.delete(thumbKey)]);
  };

  try {
    await storage.put(objectKey, processed.image.buffer, processed.image.contentType);
    await storage.put(thumbKey, processed.thumb.buffer, processed.thumb.contentType);
  } catch (err) {
    await removeObjects();
    throw err;
  }

  let inserted: UploadRow | undefined;
  try {
    const { rows } = await db.query<UploadRow>(
      `INSERT INTO public.ckp_app_edi_upload AS u
              (upload_id, usr_id, client_photo_id, storage_driver, object_key, thumb_key, public_url, content_type,
               bytes, width, height, sha256, status, created_at, used_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING', $13, NULL)
       ON CONFLICT (usr_id, client_photo_id) DO UPDATE SET
              upload_id = EXCLUDED.upload_id, storage_driver = EXCLUDED.storage_driver, object_key = EXCLUDED.object_key,
              thumb_key = EXCLUDED.thumb_key, public_url = EXCLUDED.public_url, content_type = EXCLUDED.content_type,
              bytes = EXCLUDED.bytes, width = EXCLUDED.width, height = EXCLUDED.height, sha256 = EXCLUDED.sha256,
              status = 'PENDING', created_at = EXCLUDED.created_at, used_at = NULL
        WHERE u.status = 'DELETED'
       RETURNING ${UPLOAD_COLUMNS}`,
      [
        uploadId,
        input.usrId,
        input.clientPhotoId,
        storage.driver,
        objectKey,
        thumbKey,
        publicUrl,
        processed.image.contentType,
        processed.image.bytes,
        processed.image.width,
        processed.image.height,
        processed.sha256,
        input.now,
      ],
    );
    inserted = rows[0];
  } catch (err) {
    await removeObjects();
    throw err;
  }

  if (inserted) return { row: inserted, reused: false };

  // 같은 clientPhotoId 의 동시 요청이 먼저 저장했다 → 방금 올린 객체는 버리고 기존 행을 돌려준다
  await removeObjects();
  const existing = await findReusableUpload(db, input.usrId, input.clientPhotoId);
  if (!existing) throw new AppError('CONFLICT', '같은 사진을 동시에 올리는 중입니다. 잠시 후 다시 시도해 주세요.');
  return { row: existing, reused: true };
}

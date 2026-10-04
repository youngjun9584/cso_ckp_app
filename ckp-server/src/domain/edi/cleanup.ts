/**
 * 제출에 쓰이지 않은 채 오래된 PENDING 업로드 정리 (scripts/cleanup-uploads.ts 에서 사용).
 * 제출과 동시에 돌아도 안전하도록 PENDING 인 행만 DELETED 로 바꾼 뒤(행 잠금 경합 시 제출이 이기면 0행) 객체를 지운다.
 */
import type { Queryable } from '../../db/pool.js';
import type { Storage } from '../../storage/index.js';

export interface CleanupCandidate {
  uploadId: string;
  objectKey: string;
  thumbKey: string;
  storageDriver: string;
  createdKst: string;
}

export interface CleanupOptions {
  now: Date;
  olderThanHours: number;
  apply: boolean;
  limit?: number;
  onSkip?: (c: CleanupCandidate, reason: string) => void;
}

export interface CleanupResult {
  candidates: CleanupCandidate[];
  deleted: number;
  skipped: number;
  /** 원장은 DELETED 로 바꿨지만 저장소 객체 삭제에 실패한 건 */
  failed: number;
}

export async function cleanupPendingUploads(q: Queryable, storage: Storage, opts: CleanupOptions): Promise<CleanupResult> {
  const cutoff = new Date(opts.now.getTime() - opts.olderThanHours * 60 * 60 * 1000);
  const { rows } = await q.query<{ upload_id: string; object_key: string; thumb_key: string; storage_driver: string; created_kst: string }>(
    `SELECT upload_id::text AS upload_id, object_key, thumb_key, storage_driver,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS created_kst
       FROM public.ckp_app_edi_upload
      WHERE status = 'PENDING' AND created_at < $1
      ORDER BY created_at
      LIMIT $2`,
    [cutoff, opts.limit ?? 5000],
  );
  const candidates: CleanupCandidate[] = rows.map((r) => ({
    uploadId: r.upload_id,
    objectKey: r.object_key,
    thumbKey: r.thumb_key,
    storageDriver: r.storage_driver,
    createdKst: r.created_kst,
  }));
  if (!opts.apply) return { candidates, deleted: 0, skipped: 0, failed: 0 };

  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  for (const c of candidates) {
    if (c.storageDriver !== storage.driver) {
      skipped++;
      opts.onSkip?.(c, `저장소 종류가 다릅니다 (${c.storageDriver})`);
      continue;
    }
    const upd = await q.query(`UPDATE public.ckp_app_edi_upload SET status = 'DELETED' WHERE upload_id = $1::uuid AND status = 'PENDING'`, [c.uploadId]);
    if (upd.rowCount === 0) {
      skipped++; // 그 사이 제출에 쓰였다
      continue;
    }
    try {
      await storage.delete(c.objectKey);
      await storage.delete(c.thumbKey);
      deleted++;
    } catch (err) {
      // 원장은 이미 DELETED (다시 쓰이지 않음). 남은 객체는 다음 점검 때 수동 정리 대상으로 알린다
      failed++;
      opts.onSkip?.(c, `저장소 객체 삭제 실패: ${(err as Error)?.message ?? '알 수 없는 오류'}`);
    }
  }
  return { candidates, deleted, skipped, failed };
}

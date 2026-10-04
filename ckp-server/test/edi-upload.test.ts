/**
 * EDI 상태·대상 월·사진 업로드 (DESIGN §2.5, §4, §5.7)
 * 시계: 2026-09-30 15:30 UTC = 2026-10-01 00:30 KST (UTC 로 계산하면 틀리는 경계 시각)
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdiMonthOptionsResponse, EdiStatusResponse, EdiUploadResponse } from '../src/contract.js';
import { cleanupPendingUploads } from '../src/domain/edi/cleanup.js';
import { HEIC_MESSAGE, readImageMeta } from '../src/lib/image.js';
import type { Storage } from '../src/storage/index.js';
import { createTestApp, type TestContext } from './helpers.js';
import { count, errorOf, getFile, jpeg, listStoredFiles, uploadOk, uploadRaw } from './edi-fixtures.js';

const NOW = '2026-09-30T15:30:00Z';
const MAX_BYTES = 256 * 1024;

let t: TestContext;

beforeAll(async () => {
  t = await createTestApp({ now: NOW, env: { PHOTO_MAX_BYTES: String(MAX_BYTES) } });
});

afterAll(async () => {
  await t?.close();
});

async function status(): Promise<EdiStatusResponse> {
  const res = await t.app.inject({ method: 'GET', url: '/v1/edi/status', headers: await t.authHeaders('ckp_demo') });
  expect(res.statusCode).toBe(200);
  return res.json<EdiStatusResponse>();
}

describe('GET /v1/edi/status (is_edi 차단 스위치)', () => {
  it('기본은 등록 가능', async () => {
    expect(await status()).toEqual({ enabled: true, message: null });
  });

  it('관리자가 차단(edi=true)하면 enabled=false + 한국어 안내, 업로드 403', async () => {
    await t.db.query('UPDATE public.is_edi SET edi = true');
    try {
      const s = await status();
      expect(s.enabled).toBe(false);
      expect(s.message).toContain('EDI 등록이 중지');
      const res = await uploadRaw(t, 'ckp_demo');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('EDI_DISABLED');
    } finally {
      await t.db.query('UPDATE public.is_edi SET edi = false');
    }
  });

  it('행이 여러 개면 하나라도 true 이면 차단 (bool_or)', async () => {
    await t.db.query("INSERT INTO public.is_edi (edi, coalition_company) VALUES (true, 'x')");
    try {
      expect((await status()).enabled).toBe(false);
    } finally {
      await t.db.query("DELETE FROM public.is_edi WHERE coalition_company = 'x'");
    }
    expect((await status()).enabled).toBe(true);
  });

  it('조회 오류면 차단으로 응답(fail-closed), 업로드도 403', async () => {
    await t.db.query('ALTER TABLE public.is_edi RENAME TO is_edi_off');
    try {
      const s = await status();
      expect(s.enabled).toBe(false);
      expect(s.message).toBeTruthy();
      const res = await uploadRaw(t, 'ckp_demo');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('EDI_DISABLED');
    } finally {
      await t.db.query('ALTER TABLE public.is_edi_off RENAME TO is_edi');
    }
    expect((await status()).enabled).toBe(true);
  });

  it('인증 필요', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/edi/status' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/edi/month-options', () => {
  it('KST 기준: 당월 = 직전 달 (10월 1일 00:30 KST → 9월/8월/7월)', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/edi/month-options', headers: await t.authHeaders('ckp_demo') });
    expect(res.statusCode).toBe(200);
    expect(res.json<EdiMonthOptionsResponse>()).toEqual({
      options: [
        { label: '당월', ym: '2026-09', display: '당월 (2026년 9월)' },
        { label: '전월', ym: '2026-08', display: '전월 (2026년 8월)' },
        { label: '전전월', ym: '2026-07', display: '전전월 (2026년 7월)' },
      ],
      defaultLabel: '당월',
    });
  });
});

describe('POST /v1/edi/uploads', () => {
  it('정상 업로드: 201, 원장 PENDING, 저장소 키는 KST 연월(202610), 서명 썸네일 URL', async () => {
    const cid = randomUUID();
    const res = await uploadRaw(t, 'ckp_demo', { clientPhotoId: cid, data: await jpeg(1000, 750) });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<EdiUploadResponse>();
    expect(body.reused).toBe(false);
    expect(body.upload).toMatchObject({ clientPhotoId: cid, width: 1000, height: 750 });
    expect(body.upload.bytes).toBeGreaterThan(0);
    expect(body.upload.thumbUrl).toMatch(/^http:\/\/localhost(:80)?\/v1\/files\/[\w-]+\.[\w-]+$/);

    const { rows } = await t.db.query<{ status: string; object_key: string; thumb_key: string; public_url: string; usr_id: string; storage_driver: string }>(
      'SELECT status, object_key, thumb_key, public_url, usr_id, storage_driver FROM public.ckp_app_edi_upload WHERE upload_id = $1',
      [body.upload.uploadId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ status: 'PENDING', usr_id: 'ckp_demo', storage_driver: 'local' });
    expect(row.object_key).toBe(`uploads/users/ckp/edi/202610/${body.upload.uploadId}.jpg`);
    expect(row.thumb_key).toBe(`uploads/users/ckp/edi/202610/${body.upload.uploadId}_thumb.jpg`);
    expect(row.public_url).toBe(`local:${row.object_key}`);
    expect(row.public_url.length).toBeLessThanOrEqual(200);

    const thumb = await getFile(t, body.upload.thumbUrl);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    const meta = await readImageMeta(thumb.rawPayload);
    expect(Math.max(meta.width, meta.height)).toBe(480);
  });

  it('같은 clientPhotoId 재시도 → 200 reused, 같은 uploadId, DB 1행·저장 객체 추가 없음', async () => {
    const cid = randomUUID();
    const first = await uploadOk(t, 'ckp_demo', { clientPhotoId: cid });
    const filesBefore = await listStoredFiles(t.storageDir);
    const again = await uploadRaw(t, 'ckp_demo', { clientPhotoId: cid });
    expect(again.statusCode).toBe(200);
    const body = again.json<EdiUploadResponse>();
    expect(body.reused).toBe(true);
    expect(body.upload.uploadId).toBe(first.uploadId);
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_upload WHERE client_photo_id = $1', [cid])).toBe(1);
    expect(await listStoredFiles(t.storageDir)).toEqual(filesBefore);
  });

  it('파일 part 가 clientPhotoId 보다 먼저 와도 재사용 판단이 같다', async () => {
    const cid = randomUUID();
    const first = await uploadOk(t, 'ckp_demo', { clientPhotoId: cid, fileFirst: true });
    const again = await uploadRaw(t, 'ckp_demo', { clientPhotoId: cid, fileFirst: true });
    expect(again.statusCode).toBe(200);
    expect(again.json<EdiUploadResponse>().upload.uploadId).toBe(first.uploadId);
  });

  it('같은 clientPhotoId 를 동시에 두 번 올려도 원장 1행, 저장 객체 1쌍', async () => {
    const cid = randomUUID();
    const data = await jpeg();
    const before = (await listStoredFiles(t.storageDir)).length;
    const [a, b] = await Promise.all([uploadRaw(t, 'ckp_demo', { clientPhotoId: cid, data }), uploadRaw(t, 'ckp_demo', { clientPhotoId: cid, data })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    const ids = [a, b].map((r) => r.json<EdiUploadResponse>().upload.uploadId);
    expect(ids[0]).toBe(ids[1]);
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_upload WHERE client_photo_id = $1', [cid])).toBe(1);
    expect((await listStoredFiles(t.storageDir)).length).toBe(before + 2);
  });

  it('다른 사용자가 같은 clientPhotoId 를 쓰면 별개의 업로드', async () => {
    const cid = randomUUID();
    const mine = await uploadOk(t, 'ckp_demo', { clientPhotoId: cid });
    const theirs = await uploadOk(t, 'ckp_md5', { clientPhotoId: cid });
    expect(theirs.uploadId).not.toBe(mine.uploadId);
  });

  it('clientPhotoId 누락/형식 오류 → 400, 파일 누락 → 400', async () => {
    const noCid = await uploadRaw(t, 'ckp_demo', { omitClientPhotoId: true });
    expect(noCid.statusCode).toBe(400);
    expect(errorOf(noCid).fields?.clientPhotoId).toBeTruthy();
    const badCid = await uploadRaw(t, 'ckp_demo', { clientPhotoId: 'not-a-uuid' });
    expect(badCid.statusCode).toBe(400);
    const noFile = await uploadRaw(t, 'ckp_demo', { omitFile: true });
    expect(noFile.statusCode).toBe(400);
    expect(errorOf(noFile).message).toContain('사진 파일이 없습니다');
  });

  it('multipart 가 아니면 415', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/edi/uploads', payload: { a: 1 }, headers: await t.authHeaders('ckp_demo') });
    expect(res.statusCode).toBe(415);
  });

  it('지원하지 않는 형식: 텍스트·GIF → 415, HEIC → 415 전용 안내', async () => {
    const text = await uploadRaw(t, 'ckp_demo', { data: Buffer.from('이것은 사진이 아닙니다. just some text content'), name: 'a.jpg' });
    expect(text.statusCode).toBe(415);
    expect(errorOf(text).code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(errorOf(text).message).toContain('JPG, PNG, WEBP');

    const gif = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#ff0000' } }).gif().toBuffer();
    const gifRes = await uploadRaw(t, 'ckp_demo', { data: gif, name: 'a.gif', type: 'image/gif' });
    expect(gifRes.statusCode).toBe(415);
    expect(errorOf(gifRes).code).toBe('UNSUPPORTED_FILE_TYPE');

    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('mif1heic', 'ascii'),
      Buffer.alloc(64, 0),
    ]);
    const heicRes = await uploadRaw(t, 'ckp_demo', { data: heic, name: 'IMG_0001.HEIC', type: 'image/heic' });
    expect(heicRes.statusCode).toBe(415);
    expect(errorOf(heicRes)).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE', message: HEIC_MESSAGE });
  });

  it('용량 초과 → 413 FILE_TOO_LARGE (저장·원장 기록 없음)', async () => {
    const before = await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_upload');
    const big = Buffer.concat([await jpeg(), Buffer.alloc(MAX_BYTES, 7)]);
    const res = await uploadRaw(t, 'ckp_demo', { data: big });
    expect(res.statusCode).toBe(413);
    expect(errorOf(res).code).toBe('FILE_TOO_LARGE');
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_upload')).toBe(before);
  });

  it('해상도가 너무 작으면 422 IMAGE_TOO_SMALL, 깨진 JPEG 은 422 IMAGE_DECODE_FAILED', async () => {
    const small = await uploadRaw(t, 'ckp_demo', { data: await jpeg(300, 200) });
    expect(small.statusCode).toBe(422);
    expect(errorOf(small).code).toBe('IMAGE_TOO_SMALL');
    expect(errorOf(small).message).toContain('400px');

    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 0x41)]);
    const bad = await uploadRaw(t, 'ckp_demo', { data: broken });
    expect(bad.statusCode).toBe(422);
    expect(errorOf(bad).code).toBe('IMAGE_DECODE_FAILED');
  });

  it('EXIF 방향(6)이 있는 JPEG 은 똑바로 회전·메타 제거되어 저장된다', async () => {
    const rotated = await jpeg(800, 600, { orientation: 6 });
    expect((await readImageMeta(rotated)).orientation).toBe(6);
    const up = await uploadOk(t, 'ckp_demo', { data: rotated });
    expect({ width: up.width, height: up.height }).toEqual({ width: 600, height: 800 });
    const { rows } = await t.db.query<{ object_key: string }>('SELECT object_key FROM public.ckp_app_edi_upload WHERE upload_id = $1', [up.uploadId]);
    const stored = await t.storage.getBuffer(rows[0]!.object_key);
    expect(stored).not.toBeNull();
    const meta = await readImageMeta(stored!);
    expect(meta.format).toBe('jpeg');
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
    expect({ w: meta.width, h: meta.height }).toEqual({ w: 600, h: 800 });
  });

  it('PNG 도 받아서 JPEG 으로 저장한다', async () => {
    const png = await sharp({ create: { width: 900, height: 500, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer();
    const up = await uploadOk(t, 'ckp_demo', { data: png, name: 'a.png', type: 'image/png' });
    const { rows } = await t.db.query<{ object_key: string; content_type: string }>(
      'SELECT object_key, content_type FROM public.ckp_app_edi_upload WHERE upload_id = $1',
      [up.uploadId],
    );
    expect(rows[0]?.content_type).toBe('image/jpeg');
    expect((await readImageMeta((await t.storage.getBuffer(rows[0]!.object_key))!)).format).toBe('jpeg');
  });

  it('인증 없으면 401', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/edi/uploads', payload: 'x', headers: { 'content-type': 'multipart/form-data; boundary=x' } });
    expect(res.statusCode).toBe(401);
  });

  it('정리 스크립트가 DELETED 로 바꾼 업로드는 같은 clientPhotoId 로 다시 올리면 새로 저장된다', async () => {
    const cid = randomUUID();
    const first = await uploadOk(t, 'ckp_demo', { clientPhotoId: cid });
    await t.db.query("UPDATE public.ckp_app_edi_upload SET status = 'DELETED' WHERE upload_id = $1", [first.uploadId]);
    const again = await uploadRaw(t, 'ckp_demo', { clientPhotoId: cid });
    expect(again.statusCode).toBe(201);
    const body = again.json<EdiUploadResponse>();
    expect(body.reused).toBe(false);
    expect(body.upload.uploadId).not.toBe(first.uploadId);
    const { rows } = await t.db.query<{ status: string; upload_id: string }>(
      'SELECT status, upload_id::text AS upload_id FROM public.ckp_app_edi_upload WHERE client_photo_id = $1',
      [cid],
    );
    expect(rows).toEqual([{ status: 'PENDING', upload_id: body.upload.uploadId }]);
  });
});

describe('미사용 업로드 정리 (cleanup-uploads)', () => {
  it('24시간 넘은 PENDING 만 대상, dry-run 은 변경 없음, --apply 는 객체 삭제 + DELETED', async () => {
    const old = await uploadOk(t, 'ckp_demo');
    const fresh = await uploadOk(t, 'ckp_demo');
    const oldUsed = await uploadOk(t, 'ckp_demo');
    await t.db.query(`UPDATE public.ckp_app_edi_upload SET created_at = $2 WHERE upload_id = ANY($1::uuid[])`, [
      [old.uploadId, oldUsed.uploadId],
      new Date(new Date(NOW).getTime() - 48 * 3600 * 1000),
    ]);
    await t.db.query(`UPDATE public.ckp_app_edi_upload SET status = 'USED' WHERE upload_id = $1`, [oldUsed.uploadId]);
    const keyOf = async (id: string) =>
      (await t.db.query<{ object_key: string; thumb_key: string }>('SELECT object_key, thumb_key FROM public.ckp_app_edi_upload WHERE upload_id = $1', [id])).rows[0]!;
    const oldKeys = await keyOf(old.uploadId);

    const dry = await cleanupPendingUploads(t.db, t.storage, { now: t.clock.now(), olderThanHours: 24, apply: false });
    expect(dry.candidates.map((c) => c.uploadId)).toEqual([old.uploadId]);
    expect(dry.deleted).toBe(0);
    expect(await t.storage.getBuffer(oldKeys.object_key)).not.toBeNull();

    const applied = await cleanupPendingUploads(t.db, t.storage, { now: t.clock.now(), olderThanHours: 24, apply: true });
    expect(applied.deleted).toBe(1);
    expect(await t.storage.getBuffer(oldKeys.object_key)).toBeNull();
    expect(await t.storage.getBuffer(oldKeys.thumb_key)).toBeNull();
    const statuses = await t.db.query<{ upload_id: string; status: string }>(
      'SELECT upload_id::text AS upload_id, status FROM public.ckp_app_edi_upload WHERE upload_id = ANY($1::uuid[])',
      [[old.uploadId, fresh.uploadId, oldUsed.uploadId]],
    );
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.upload_id, r.status]));
    expect(byId).toEqual({ [old.uploadId]: 'DELETED', [fresh.uploadId]: 'PENDING', [oldUsed.uploadId]: 'USED' });

    // 삭제된 업로드의 썸네일 URL 은 더 이상 열리지 않는다
    expect((await getFile(t, old.thumbUrl)).statusCode).toBe(404);
  });

  it('저장소 삭제가 실패해도 나머지 대상은 계속 처리하고 실패 건수를 알려준다', async () => {
    const a = await uploadOk(t, 'ckp_demo');
    const b = await uploadOk(t, 'ckp_demo');
    await t.db.query(`UPDATE public.ckp_app_edi_upload SET created_at = $2 WHERE upload_id = ANY($1::uuid[])`, [
      [a.uploadId, b.uploadId],
      new Date(new Date(NOW).getTime() - 30 * 3600 * 1000),
    ]);
    let calls = 0;
    const flaky: Storage = {
      driver: t.storage.driver,
      put: (k, buf, type) => t.storage.put(k, buf, type),
      getBuffer: (k) => t.storage.getBuffer(k),
      publicUrl: (k) => t.storage.publicUrl(k),
      keyFromUrl: (u) => t.storage.keyFromUrl(u),
      delete: async (k) => {
        calls++;
        if (calls === 1) throw new Error('일시적인 저장소 오류');
        await t.storage.delete(k);
      },
    };
    const skipped: string[] = [];
    const r = await cleanupPendingUploads(t.db, flaky, {
      now: t.clock.now(),
      olderThanHours: 24,
      apply: true,
      onSkip: (c, reason) => skipped.push(`${c.uploadId}:${reason}`),
    });
    expect(r).toMatchObject({ deleted: 1, failed: 1, skipped: 0 });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('저장소 객체 삭제 실패');
    expect(await count(t, "SELECT count(*) AS n FROM public.ckp_app_edi_upload WHERE upload_id = ANY($1::uuid[]) AND status = 'DELETED'", [[a.uploadId, b.uploadId]])).toBe(2);
  });
});

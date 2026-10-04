/**
 * EDI 제출 (DESIGN §2.5, §3.3, §3.4, §5.7, §5.8)
 * 시계: 2026-09-30 15:30 UTC = 2026-10-01 00:30 KST → 대상 월 당월 2026-09 / 전월 2026-08 / 전전월 2026-07, reg_ymd 2026-10-01
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdiStatusResponse, EdiSubmissionCreateResponse } from '../src/contract.js';
import { createTestApp, type TestContext } from './helpers.js';
import { clientIdx, count, errorOf, photosOf, submitOk, submitRaw, uploadMany, uploadOk, uploadRaw } from './edi-fixtures.js';

const NOW = '2026-09-30T15:30:00Z';
const CREATE_AT = '2026-10-01 00:30:00';
const REG_YMD = '2026-10-01';

let t: TestContext;
let seoul: number; // 승인된 거래처
let unsetClient: number; // approval = null
let pendingClient: number; // approval = false
let otherUsersClient: number; // ckp_md5 소유

beforeAll(async () => {
  t = await createTestApp({ now: NOW });
  seoul = await clientIdx(t, 'ckp_demo', '서울튼튼내과의원');
  unsetClient = await clientIdx(t, 'ckp_demo', '유성온천내과');
  pendingClient = await clientIdx(t, 'ckp_demo', '참편한통증의학과');
  otherUsersClient = await clientIdx(t, 'ckp_md5', '청주바른내과');
});

afterAll(async () => {
  await t?.close();
});

interface EdiRowFull {
  idx: number;
  deal_type: string | null;
  hospital_name: string | null;
  pharmacist: string | null;
  user_id: string | null;
  edi_image: Buffer | null;
  reg_ymd: string | null;
  is_ocr: boolean | null;
  month: string | null;
  move_month: boolean | null;
  aws_url: string | null;
  ocr: string | null;
  create_at: string | null;
  print: boolean | null;
  is_copy: boolean | null;
  region: string | null;
}

async function ediRows(idxs: number[]): Promise<EdiRowFull[]> {
  const { rows } = await t.db.query<EdiRowFull>(
    `SELECT idx, deal_type, hospital_name, pharmacist, user_id, edi_image, to_char(reg_ymd, 'YYYY-MM-DD') AS reg_ymd, is_ocr, month,
            move_month, aws_url, ocr, create_at, print, is_copy, region
       FROM public.edi WHERE idx = ANY($1::int[]) ORDER BY idx`,
    [idxs],
  );
  return rows;
}

const ediCount = () => count(t, 'SELECT count(*) AS n FROM public.edi');

async function uploadStatuses(ids: string[]): Promise<string[]> {
  const { rows } = await t.db.query<{ upload_id: string; status: string }>(
    'SELECT upload_id::text AS upload_id, status FROM public.ckp_app_edi_upload WHERE upload_id = ANY($1::uuid[])',
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.upload_id, r.status]));
  return ids.map((id) => byId.get(id) ?? 'NONE');
}

function expectLegacyValues(rows: EdiRowFull[], uploadIds: string[], month: string, hospital = '서울튼튼내과의원') {
  expect(rows).toHaveLength(uploadIds.length);
  rows.forEach((r, i) => {
    expect(r).toEqual({
      idx: r.idx,
      deal_type: '기존',
      hospital_name: hospital,
      pharmacist: '',
      user_id: 'ckp_demo',
      edi_image: null,
      reg_ymd: REG_YMD,
      is_ocr: false,
      month,
      move_month: false,
      aws_url: `local:uploads/users/ckp/edi/202610/${uploadIds[i]}.jpg`,
      ocr: null,
      create_at: CREATE_AT,
      print: false,
      is_copy: false,
      region: null,
    });
    expect(r.aws_url!.length).toBeLessThanOrEqual(200);
  });
}

describe('POST /v1/edi/submissions — 성공', () => {
  it('사진 1장: 201, edi 행 1개가 §2.5 값 그대로, 제출 건·순번·업로드 USED 기록', async () => {
    await t.db.query('DELETE FROM public.manager');
    const [u1] = await uploadMany(t, 'ckp_demo', 1);
    const before = await ediCount();
    const key = randomUUID();
    const res = await submitRaw(
      t,
      'ckp_demo',
      // 본문의 사용자 값은 무시되어야 한다 (토큰의 usr_id 만 사용)
      { clientIdx: seoul, targetYm: '2026-09', memo: '  첫 등록 메모  ', photos: [{ uploadId: u1!, seq: 1 }], userId: 'ckp_md5', user_id: 'ckp_md5' },
      key,
    );
    expect(res.statusCode, res.body).toBe(201);
    expect((await t.db.query('SELECT user_id FROM public.manager')).rows).toEqual([{ user_id: 'ckp_demo' }]);
    const body = res.json<EdiSubmissionCreateResponse>();
    expect(body.replayed).toBe(false);
    const s = body.submission;
    expect(s).toMatchObject({
      kind: 'app',
      clientIdx: seoul,
      clientName: '서울튼튼내과의원',
      targetYm: '2026-09',
      monthLabel: '당월',
      memo: '첫 등록 메모',
      photoCount: 1,
      createdAt: CREATE_AT,
      regYmd: REG_YMD,
      statusCounts: { needs_review: 1, reviewed: 0, delete_requested: 0, missing: 0 },
    });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.coverThumbUrl).toMatch(/^http:\/\/localhost(:80)?\/v1\/files\//);
    expect(s.photos).toHaveLength(1);
    expect(s.photos[0]).toMatchObject({ seq: 1, reviewStatus: 'needs_review', printed: false, analyzed: false, pharmaCompanies: [] });
    expect(s.photos[0]!.thumbUrl).toBeTruthy();
    expect(s.photos[0]!.imageUrl).toBeTruthy();

    expect(await ediCount()).toBe(before + 1);
    expectLegacyValues(await ediRows([s.photos[0]!.ediIdx!]), [u1!], '당월');

    const sub = await t.db.query<Record<string, unknown>>(
      `SELECT usr_id, idempotency_key::text AS idempotency_key, client_idx, client_name, target_ym, month_label, memo, photo_count,
              create_at_kst, to_char(reg_ymd, 'YYYY-MM-DD') AS reg_ymd
         FROM public.ckp_app_edi_submission WHERE submission_id = $1`,
      [s.id],
    );
    expect(sub.rows).toEqual([
      {
        usr_id: 'ckp_demo',
        idempotency_key: key,
        client_idx: seoul,
        client_name: '서울튼튼내과의원',
        target_ym: '2026-09',
        month_label: '당월',
        memo: '첫 등록 메모',
        photo_count: 1,
        create_at_kst: CREATE_AT,
        reg_ymd: REG_YMD,
      },
    ]);
    const photos = await t.db.query<{ seq: number; edi_idx: number; upload_id: string }>(
      'SELECT seq, edi_idx, upload_id::text AS upload_id FROM public.ckp_app_edi_submission_photo WHERE submission_id = $1 ORDER BY seq',
      [s.id],
    );
    expect(photos.rows).toEqual([{ seq: 1, edi_idx: s.photos[0]!.ediIdx, upload_id: u1 }]);
    expect(await uploadStatuses([u1!])).toEqual(['USED']);
  });

  it('사진 30장: edi 행 30개, idx 오름차순 = seq 순서, 모든 행 create_at 동일, 전전월 라벨', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 30);
    const before = await ediCount();
    const memo = '가'.repeat(500);
    const s = await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-07', memo, photos: photosOf(ids) });
    expect(s.photoCount).toBe(30);
    expect(s.memo).toBe(memo);
    expect(s.monthLabel).toBe('전전월');
    expect(s.photos.map((p) => p.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const idxs = s.photos.map((p) => p.ediIdx!);
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
    expect(new Set(idxs).size).toBe(30);
    expect(await ediCount()).toBe(before + 30);

    const rows = await ediRows(idxs);
    expectLegacyValues(rows, ids, '전전월');
    expect(new Set(rows.map((r) => r.create_at))).toEqual(new Set([CREATE_AT]));
    expect((await uploadStatuses(ids)).every((st) => st === 'USED')).toBe(true);
  });

  it('승인 여부가 미지정(null)인 거래처는 선택할 수 있다', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 1);
    const s = await submitOk(t, 'ckp_demo', { clientIdx: unsetClient, targetYm: '2026-08', photos: photosOf(ids) });
    expect(s).toMatchObject({ clientName: '유성온천내과', monthLabel: '전월', memo: null });
    const [row] = await ediRows([s.photos[0]!.ediIdx!]);
    expect(row).toMatchObject({ hospital_name: '유성온천내과', month: '전월' });
  });

  it('사진 순서 변경: [c, a, b] 순서로 제출하면 seq1=c, seq2=a, seq3=b 이고 idx 도 그 순서', async () => {
    const [a, b, c] = await uploadMany(t, 'ckp_demo', 3);
    // 배열 순서와 무관하게 seq 기준으로 저장되어야 한다
    const s = await submitOk(t, 'ckp_demo', {
      clientIdx: seoul,
      targetYm: '2026-09',
      photos: [
        { uploadId: a!, seq: 2 },
        { uploadId: b!, seq: 3 },
        { uploadId: c!, seq: 1 },
      ],
    });
    const rows = await ediRows(s.photos.map((p) => p.ediIdx!));
    expect(rows.map((r) => r.aws_url)).toEqual([c, a, b].map((id) => `local:uploads/users/ckp/edi/202610/${id}.jpg`));
    const photos = await t.db.query<{ seq: number; upload_id: string }>(
      'SELECT seq, upload_id::text AS upload_id FROM public.ckp_app_edi_submission_photo WHERE submission_id = $1 ORDER BY seq',
      [s.id],
    );
    expect(photos.rows).toEqual([
      { seq: 1, upload_id: c },
      { seq: 2, upload_id: a },
      { seq: 3, upload_id: b },
    ]);
  });
});

describe('POST /v1/edi/submissions — 입력 검증', () => {
  const body = (photos: unknown, extra: Record<string, unknown> = {}) => ({ clientIdx: seoul, targetYm: '2026-09', photos, ...extra });

  it('사진 31장 → 400 PHOTO_COUNT_OUT_OF_RANGE, 0장 → 400', async () => {
    const before = await ediCount();
    const many = Array.from({ length: 31 }, (_, i) => ({ uploadId: randomUUID(), seq: i + 1 }));
    const r31 = await submitRaw(t, 'ckp_demo', body(many));
    expect(r31.statusCode).toBe(400);
    expect(errorOf(r31)).toMatchObject({ code: 'PHOTO_COUNT_OUT_OF_RANGE', details: { min: 1, max: 30, count: 31 } });
    expect(errorOf(r31).message).toContain('30장');

    const r0 = await submitRaw(t, 'ckp_demo', body([]));
    expect(r0.statusCode).toBe(400);
    expect(errorOf(r0).code).toBe('PHOTO_COUNT_OUT_OF_RANGE');
    expect(await ediCount()).toBe(before);
  });

  it('seq 불연속·중복·0 시작·정수 아님 → 400', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    for (const photos of [
      [{ uploadId: a, seq: 1 }, { uploadId: b, seq: 3 }],
      [{ uploadId: a, seq: 1 }, { uploadId: b, seq: 1 }],
      [{ uploadId: a, seq: 0 }, { uploadId: b, seq: 1 }],
      [{ uploadId: a, seq: 2 }],
      [{ uploadId: a, seq: 1.5 }],
      [{ uploadId: a, seq: '1' }],
    ]) {
      const res = await submitRaw(t, 'ckp_demo', body(photos));
      expect(res.statusCode, JSON.stringify(photos)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('한 요청에 같은 uploadId 가 두 번 → 400', async () => {
    const [u] = await uploadMany(t, 'ckp_demo', 1);
    const res = await submitRaw(t, 'ckp_demo', body([{ uploadId: u, seq: 1 }, { uploadId: u!.toUpperCase(), seq: 2 }]));
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).message).toContain('같은 사진이 두 번');
    expect(await uploadStatuses([u!])).toEqual(['PENDING']);
  });

  it('Idempotency-Key 누락·형식 오류 → 400', async () => {
    const [u] = await uploadMany(t, 'ckp_demo', 1);
    const noKey = await submitRaw(t, 'ckp_demo', body(photosOf([u!])), null);
    expect(noKey.statusCode).toBe(400);
    expect(errorOf(noKey).message).toContain('Idempotency-Key');
    const badKey = await submitRaw(t, 'ckp_demo', body(photosOf([u!])), 'not-a-uuid');
    expect(badKey.statusCode).toBe(400);
  });

  it('메모 500자 초과, 거래처 누락, 형식이 틀린 uploadId → 400 + 필드 오류', async () => {
    const [u] = await uploadMany(t, 'ckp_demo', 1);
    const memo = await submitRaw(t, 'ckp_demo', body(photosOf([u!]), { memo: '나'.repeat(501) }));
    expect(memo.statusCode).toBe(400);
    expect(errorOf(memo).fields?.memo).toContain('500자');

    const noClient = await submitRaw(t, 'ckp_demo', { targetYm: '2026-09', photos: photosOf([u!]) });
    expect(noClient.statusCode).toBe(400);
    expect(errorOf(noClient).fields?.clientIdx).toBe('거래처를 선택해 주세요.');

    const badUpload = await submitRaw(t, 'ckp_demo', body([{ uploadId: 'abc', seq: 1 }]));
    expect(badUpload.statusCode).toBe(400);
  });

  it('대상 연월이 선택 가능한 3개월(2026-09/08/07)이 아니면 400', async () => {
    const [u] = await uploadMany(t, 'ckp_demo', 1);
    for (const ym of ['2026-10', '2026-06', '2026-13', '202609']) {
      const res = await submitRaw(t, 'ckp_demo', { clientIdx: seoul, targetYm: ym, photos: photosOf([u!]) });
      expect(res.statusCode, ym).toBe(400);
      expect(errorOf(res).fields?.targetYm).toBe('대상 연월을 다시 선택해 주세요.');
    }
    expect(await uploadStatuses([u!])).toEqual(['PENDING']);
  });

  it('인증 없으면 401', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/edi/submissions', payload: {}, headers: { 'idempotency-key': randomUUID() } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/edi/submissions — 중복 방지 (Idempotency-Key)', () => {
  it('같은 키·같은 내용 재요청 → 200 replayed, 응답 본문 동일, edi 행 수 불변', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 3);
    const key = randomUUID();
    const req = { clientIdx: seoul, targetYm: '2026-09', memo: '재시도', photos: photosOf(ids) };
    const first = await submitRaw(t, 'ckp_demo', req, key);
    expect(first.statusCode).toBe(201);
    const afterFirst = await ediCount();

    const again = await submitRaw(t, 'ckp_demo', req, key);
    expect(again.statusCode).toBe(200);
    const replay = again.json<EdiSubmissionCreateResponse>();
    expect(replay.replayed).toBe(true);
    expect(replay.submission).toEqual(first.json<EdiSubmissionCreateResponse>().submission);
    expect(await ediCount()).toBe(afterFirst);

    // 키 대소문자 차이, 메모 앞뒤 공백 차이는 같은 요청
    const upper = await submitRaw(t, 'ckp_demo', { ...req, memo: ' 재시도 ' }, key.toUpperCase());
    expect(upper.statusCode).toBe(200);
    expect(upper.json<EdiSubmissionCreateResponse>().submission.id).toBe(replay.submission.id);

    // 차단 중이거나 월이 바뀐 뒤에도 이미 처리된 요청은 같은 결과를 돌려준다
    await t.db.query('UPDATE public.is_edi SET edi = true');
    t.clock.advance(40 * 24 * 3600 * 1000);
    try {
      const late = await submitRaw(t, 'ckp_demo', req, key);
      expect(late.statusCode).toBe(200);
      expect(late.json<EdiSubmissionCreateResponse>().submission.id).toBe(replay.submission.id);
    } finally {
      t.clock.set(NOW);
      await t.db.query('UPDATE public.is_edi SET edi = false');
    }
    expect(await ediCount()).toBe(afterFirst);
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_submission WHERE idempotency_key = $1', [key])).toBe(1);
  });

  it('같은 키·다른 내용 → 409 IDEMPOTENCY_CONFLICT (메모, 사진 순서, 대상 월 모두)', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 2);
    const key = randomUUID();
    const req = { clientIdx: seoul, targetYm: '2026-09', memo: '원본', photos: photosOf(ids) };
    await submitOk(t, 'ckp_demo', req, key);
    const before = await ediCount();
    for (const changed of [
      { ...req, memo: '변경' },
      { ...req, photos: photosOf([...ids].reverse()) },
      { ...req, targetYm: '2026-08' },
    ]) {
      const res = await submitRaw(t, 'ckp_demo', changed, key);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await ediCount()).toBe(before);
  });

  it('같은 요청 두 개를 동시에 보내도 edi 행은 한 벌만 생긴다 (201 + 200 replayed)', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 4);
    const key = randomUUID();
    const req = { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(ids) };
    const before = await ediCount();
    const [a, b] = await Promise.all([submitRaw(t, 'ckp_demo', req, key), submitRaw(t, 'ckp_demo', req, key)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    const [sa, sb] = [a, b].map((r) => r.json<EdiSubmissionCreateResponse>());
    expect(sa!.submission.id).toBe(sb!.submission.id);
    expect([sa!.replayed, sb!.replayed].sort()).toEqual([false, true]);
    expect(await ediCount()).toBe(before + 4);
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_submission WHERE idempotency_key = $1', [key])).toBe(1);
  });

  it('다른 키로 같은 사진을 동시에 제출하면 한 건만 성공하고 나머지는 409 UPLOAD_ALREADY_USED', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 2);
    const req = { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(ids) };
    const before = await ediCount();
    const results = await Promise.all([submitRaw(t, 'ckp_demo', req), submitRaw(t, 'ckp_demo', req)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(errorOf(results.find((r) => r.statusCode === 409)!).code).toBe('UPLOAD_ALREADY_USED');
    expect(await ediCount()).toBe(before + 2);
  });

  it('키는 사용자별: 다른 사용자가 같은 키를 써도 별개의 제출', async () => {
    const key = randomUUID();
    const mine = await uploadMany(t, 'ckp_demo', 1);
    const theirs = await uploadMany(t, 'ckp_md5', 1);
    const s1 = await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(mine) }, key);
    const s2 = await submitOk(t, 'ckp_md5', { clientIdx: otherUsersClient, targetYm: '2026-09', photos: photosOf(theirs) }, key);
    expect(s2.id).not.toBe(s1.id);
    const [row] = await ediRows([s2.photos[0]!.ediIdx!]);
    expect(row).toMatchObject({ user_id: 'ckp_md5', hospital_name: '청주바른내과' });
  });

  it('실패한 제출은 키를 저장하지 않고 전부 되돌린다 → 원인 해결 후 같은 키로 다시 성공', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 3);
    const key = randomUUID();
    const req = { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(ids) };
    const before = await ediCount();
    // 세 번째 사진의 저장 URL 을 edi.aws_url 규칙(쿼리스트링 금지)에 어긋나게 만든다 → 크게 실패해야 한다
    const good = (await t.db.query<{ public_url: string }>('SELECT public_url FROM public.ckp_app_edi_upload WHERE upload_id = $1', [ids[2]])).rows[0]!.public_url;
    await t.db.query('UPDATE public.ckp_app_edi_upload SET public_url = $2 WHERE upload_id = $1', [ids[2], `${good}?X-Amz-Signature=abc`]);
    const bad = await submitRaw(t, 'ckp_demo', req, key);
    expect(bad.statusCode).toBe(500);
    expect(errorOf(bad).code).toBe('SERVER_ERROR');
    expect(await ediCount()).toBe(before); // 앞의 두 행도 롤백
    expect(await uploadStatuses(ids)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(await count(t, 'SELECT count(*) AS n FROM public.ckp_app_edi_submission WHERE idempotency_key = $1', [key])).toBe(0);

    await t.db.query('UPDATE public.ckp_app_edi_upload SET public_url = $2 WHERE upload_id = $1', [ids[2], good]);
    const ok = await submitRaw(t, 'ckp_demo', req, key);
    expect(ok.statusCode).toBe(201);
    expect(await ediCount()).toBe(before + 3);
  });
});

describe('POST /v1/edi/submissions — 소유·상태 확인', () => {
  it('다른 사용자의 uploadId → 422 UPLOAD_NOT_FOUND + details.missing (내 사진은 그대로 PENDING)', async () => {
    const [mine] = await uploadMany(t, 'ckp_demo', 1);
    const [theirs] = await uploadMany(t, 'ckp_md5', 1);
    const unknown = randomUUID();
    const before = await ediCount();
    const res = await submitRaw(t, 'ckp_demo', {
      clientIdx: seoul,
      targetYm: '2026-09',
      photos: [
        { uploadId: mine!, seq: 1 },
        { uploadId: theirs!, seq: 2 },
        { uploadId: unknown, seq: 3 },
      ],
    });
    expect(res.statusCode).toBe(422);
    const err = errorOf(res);
    expect(err.code).toBe('UPLOAD_NOT_FOUND');
    expect(err.message).toContain('사진을 다시 올려');
    expect((err.details?.missing as string[]).sort()).toEqual([theirs!, unknown].sort());
    expect(await ediCount()).toBe(before);
    expect(await uploadStatuses([mine!, theirs!])).toEqual(['PENDING', 'PENDING']);
  });

  it('정리되어 DELETED 가 된 업로드 → 422 UPLOAD_NOT_FOUND', async () => {
    const [u] = await uploadMany(t, 'ckp_demo', 1);
    await t.db.query("UPDATE public.ckp_app_edi_upload SET status = 'DELETED' WHERE upload_id = $1", [u]);
    const res = await submitRaw(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf([u!]) });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res).details?.missing).toEqual([u]);
  });

  it('이미 제출에 쓰인 사진을 새 제출에 넣으면 409 UPLOAD_ALREADY_USED', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 2);
    await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf([ids[0]!]) });
    const before = await ediCount();
    const res = await submitRaw(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf([ids[1]!, ids[0]!]) });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: 'UPLOAD_ALREADY_USED', details: { used: [ids[0]] } });
    expect(await ediCount()).toBe(before);
    expect(await uploadStatuses([ids[1]!])).toEqual(['PENDING']);
  });

  it('승인 대기(approval=false) 거래처 → 409 CLIENT_NOT_SELECTABLE', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 1);
    const before = await ediCount();
    const res = await submitRaw(t, 'ckp_demo', { clientIdx: pendingClient, targetYm: '2026-09', photos: photosOf(ids) });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('CLIENT_NOT_SELECTABLE');
    expect(errorOf(res).message).toContain('승인 대기');
    expect(await ediCount()).toBe(before);
    expect(await uploadStatuses(ids)).toEqual(['PENDING']);
  });

  it('다른 사용자의 거래처·없는 거래처 → 404', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 1);
    for (const idx of [otherUsersClient, 99_999_999]) {
      const res = await submitRaw(t, 'ckp_demo', { clientIdx: idx, targetYm: '2026-09', photos: photosOf(ids) });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).message).toBe('거래처를 찾을 수 없습니다. 거래처를 다시 선택해 주세요.');
    }
    expect(await uploadStatuses(ids)).toEqual(['PENDING']);
  });

  it('EDI 차단(is_edi.edi=true) → 업로드·제출 모두 403 EDI_DISABLED, 행 생성 없음', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 1);
    const before = await ediCount();
    await t.db.query('UPDATE public.is_edi SET edi = true');
    try {
      const up = await uploadRaw(t, 'ckp_demo');
      expect(up.statusCode).toBe(403);
      expect(errorOf(up).code).toBe('EDI_DISABLED');
      const res = await submitRaw(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(ids) });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toMatchObject({ code: 'EDI_DISABLED', message: '현재 EDI 등록이 중지되어 있습니다. 관리자에게 문의해 주세요.' });
    } finally {
      await t.db.query('UPDATE public.is_edi SET edi = false');
    }
    expect(await ediCount()).toBe(before);
    expect(await uploadStatuses(ids)).toEqual(['PENDING']);
    // 차단이 풀리면 같은 사진으로 등록된다
    await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-09', photos: photosOf(ids) });
  });
});

describe('설정·스키마 차이', () => {
  let t2: TestContext;
  beforeAll(async () => {
    t2 = await createTestApp({ now: NOW, env: { CLIENT_APPROVAL_REQUIRED_FOR_EDI: 'false', EDI_DEAL_TYPE: '앱등록' } });
  });
  afterAll(async () => {
    await t2?.close();
  });

  it('CLIENT_APPROVAL_REQUIRED_FOR_EDI=false 면 승인 대기 거래처도 등록된다 (EDI_DEAL_TYPE 반영)', async () => {
    const pending = await clientIdx(t2, 'ckp_demo', '참편한통증의학과');
    const u = await uploadOk(t2, 'ckp_demo');
    const s = await submitOk(t2, 'ckp_demo', { clientIdx: pending, targetYm: '2026-09', photos: photosOf([u.uploadId]) });
    const { rows } = await t2.db.query<{ hospital_name: string; deal_type: string }>('SELECT hospital_name, deal_type FROM public.edi WHERE idx = $1', [
      s.photos[0]!.ediIdx,
    ]);
    expect(rows[0]).toEqual({ hospital_name: '참편한통증의학과', deal_type: '앱등록' });
  });

  it('edi.is_copy 컬럼이 없는 DB 에서는 is_copy 를 넣지 않고 등록된다', async () => {
    await t2.db.query('ALTER TABLE public.edi DROP COLUMN is_copy');
    t2.capabilities.ediIsCopy = false; // 서버 시작 시 스키마 확인 결과와 같은 상태로 만든다
    const seoul2 = await clientIdx(t2, 'ckp_demo', '서울튼튼내과의원');
    const u = await uploadOk(t2, 'ckp_demo');
    const s = await submitOk(t2, 'ckp_demo', { clientIdx: seoul2, targetYm: '2026-09', photos: photosOf([u.uploadId]) });
    expect(s.photos).toHaveLength(1);
    const list = await t2.app.inject({ method: 'GET', url: '/v1/edi/submissions?ym=2026-10', headers: await t2.authHeaders('ckp_demo') });
    expect(list.statusCode).toBe(200);
  });
});

describe('앱 전용 테이블(마이그레이션) 없음 → 503 SCHEMA_NOT_READY', () => {
  let t3: TestContext;
  beforeAll(async () => {
    t3 = await createTestApp({ now: NOW, applyMigration: false });
  });
  afterAll(async () => {
    await t3?.close();
  });

  it('업로드·제출·내역·상세는 503 + 한국어 안내, 상태는 enabled=false', async () => {
    const h = await t3.authHeaders('ckp_demo');
    const status = await t3.app.inject({ method: 'GET', url: '/v1/edi/status', headers: h });
    expect(status.statusCode).toBe(200);
    expect(status.json<EdiStatusResponse>()).toMatchObject({ enabled: false });
    expect(status.json<EdiStatusResponse>().message).toContain('준비가 완료되지 않아');

    const up = await uploadRaw(t3, 'ckp_demo');
    const sub = await submitRaw(t3, 'ckp_demo', { clientIdx: 1, targetYm: '2026-09', photos: photosOf([randomUUID()]) });
    const list = await t3.app.inject({ method: 'GET', url: '/v1/edi/submissions', headers: h });
    const detail = await t3.app.inject({ method: 'GET', url: `/v1/edi/submissions/${randomUUID()}`, headers: h });
    for (const res of [up, sub, list, detail]) {
      expect(res.statusCode).toBe(503);
      const err = errorOf(res);
      expect(err.code).toBe('SCHEMA_NOT_READY');
      expect(err.message).toContain('EDI 등록에 필요한 서버 데이터베이스 준비가 완료되지 않아');
      expect(res.body).not.toMatch(/relation|stack|ckp_app_edi_upload/);
    }
    // 조회 전용 기능·대상 월은 계속 동작
    const months = await t3.app.inject({ method: 'GET', url: '/v1/edi/month-options', headers: h });
    expect(months.statusCode).toBe(200);
  });
});

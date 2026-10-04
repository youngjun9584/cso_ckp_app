/**
 * EDI 등록 내역·상세 (DESIGN §2.5 표시 규칙, §5.7 내역 규칙)
 * 시계: 2026-09-15 03:00 UTC = 2026-09-15 12:00 KST
 * 시드(이전 방식 등록분, ckp_demo): A 09-15 09:12 3장 / D 09-14 월·시각 없음 1장 / B 09-13 14:05 2장(+관리자 복사본 1장) / C 08-11 data URL 1장
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdiSubmissionDetail, EdiSubmissionDetailResponse, EdiSubmissionListResponse, EdiSubmissionSummary } from '../src/contract.js';
import { createTestApp, type TestContext } from './helpers.js';
import { clientIdx, errorOf, photosOf, submitOk, uploadMany } from './edi-fixtures.js';

const NOW = '2026-09-15T03:00:00Z';

let t: TestContext;
let seoul: number;
let hanbit: number;
let s1: EdiSubmissionDetail; // 12:00:00, 4장, 순서 [c, a, b, d]
let s2: EdiSubmissionDetail; // 12:01:00, 1장
let s1Order: string[];

async function list(usrId: string, query = ''): Promise<EdiSubmissionListResponse> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/edi/submissions${query}`, headers: await t.authHeaders(usrId) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<EdiSubmissionListResponse>();
}

async function detailRaw(usrId: string, id: string) {
  return t.app.inject({ method: 'GET', url: `/v1/edi/submissions/${encodeURIComponent(id)}`, headers: await t.authHeaders(usrId) });
}

async function detail(usrId: string, id: string): Promise<EdiSubmissionDetail> {
  const res = await detailRaw(usrId, id);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<EdiSubmissionDetailResponse>().submission;
}

/** 서명 URL 은 만료 시각이 들어 있어 시계가 바뀌면 달라진다 → 토큰 내용(종류·id·크기·사용자)만 비교 */
function tokenOf(url: string | null): string | null {
  if (!url) return null;
  const token = new URL(url).pathname.split('/').pop()!;
  const { k, id, v, u } = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  return JSON.stringify([k, id, v, u]);
}

function comparable<T extends EdiSubmissionSummary & { photos?: EdiSubmissionDetail['photos'] }>(d: T): T {
  return {
    ...d,
    coverThumbUrl: tokenOf(d.coverThumbUrl),
    ...(d.photos ? { photos: d.photos.map((p) => ({ ...p, thumbUrl: tokenOf(p.thumbUrl), imageUrl: tokenOf(p.imageUrl) })) } : {}),
  };
}

function legacyByClient(items: EdiSubmissionSummary[], name: string): EdiSubmissionSummary {
  const found = items.find((i) => i.kind === 'legacy' && i.clientName === name);
  if (!found) throw new Error(`legacy 묶음 없음: ${name}`);
  return found;
}

beforeAll(async () => {
  t = await createTestApp({ now: NOW });
  seoul = await clientIdx(t, 'ckp_demo', '서울튼튼내과의원');
  hanbit = await clientIdx(t, 'ckp_demo', '한빛소아청소년과의원');

  const [a, b, c, d] = await uploadMany(t, 'ckp_demo', 4);
  s1Order = [c!, a!, b!, d!];
  s1 = await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-08', memo: '9월 첫 제출', photos: photosOf(s1Order) });
  t.clock.advance(60_000);
  const [e] = await uploadMany(t, 'ckp_demo', 1);
  s2 = await submitOk(t, 'ckp_demo', { clientIdx: hanbit, targetYm: '2026-07', photos: photosOf([e!]) });
});

afterAll(async () => {
  await t?.close();
});

describe('GET /v1/edi/submissions (등록월 내역)', () => {
  it('기본 월은 현재 KST 월, 앱 제출 건 + 이전 방식 묶음이 최신순, 관리자 복사본 제외', async () => {
    const r = await list('ckp_demo');
    expect(r).toMatchObject({ page: 1, pageSize: 30, total: 5, hasMore: false });
    expect(r.items.map((i) => [i.kind, i.clientName, i.createdAt])).toEqual([
      ['app', '한빛소아청소년과의원', '2026-09-15 12:01:00'],
      ['app', '서울튼튼내과의원', '2026-09-15 12:00:00'],
      ['legacy', '서울튼튼내과의원', '2026-09-15 09:12:00'],
      ['legacy', '미소가정의학과의원', null],
      ['legacy', '한빛소아청소년과의원', '2026-09-13 14:05:00'],
    ]);
    expect(await list('ckp_demo', '?ym=2026-09')).toEqual(r);
  });

  it('앱 제출 건 요약: 사진 수·상태 집계·대상 월·메모·표지 썸네일', async () => {
    const item = (await list('ckp_demo')).items.find((i) => i.id === s1.id)!;
    expect(comparable(item)).toEqual({
      id: s1.id,
      kind: 'app',
      clientIdx: seoul,
      clientName: '서울튼튼내과의원',
      targetYm: '2026-08',
      monthLabel: '당월',
      memo: '9월 첫 제출',
      photoCount: 4,
      createdAt: '2026-09-15 12:00:00',
      regYmd: '2026-09-15',
      coverThumbUrl: tokenOf(s1.photos[0]!.thumbUrl),
      statusCounts: { needs_review: 4, reviewed: 0, delete_requested: 0, missing: 0 },
    });
  });

  it('이전 방식 묶음: 관리자 판정 규칙으로 상태 집계, 거래처 idx·대상 월 역산', async () => {
    const items = (await list('ckp_demo')).items;
    const a = legacyByClient(items, '서울튼튼내과의원');
    expect(a).toMatchObject({
      kind: 'legacy',
      clientIdx: seoul,
      targetYm: '2026-08',
      monthLabel: '당월',
      memo: null,
      photoCount: 3,
      regYmd: '2026-09-15',
      statusCounts: { needs_review: 2, reviewed: 1, delete_requested: 0, missing: 0 },
    });
    expect(a.id).toMatch(/^legacy-[0-9a-f]{24}$/);
    expect(a.coverThumbUrl).toBeTruthy();

    const b = legacyByClient(items, '한빛소아청소년과의원');
    expect(b).toMatchObject({ photoCount: 2, monthLabel: '전월', targetYm: '2026-07', statusCounts: { needs_review: 1, delete_requested: 1 } });

    const d = legacyByClient(items, '미소가정의학과의원');
    expect(d).toMatchObject({ photoCount: 1, monthLabel: null, targetYm: null, createdAt: null, regYmd: '2026-09-14' });
  });

  it('등록월 기준: 8월에는 35일 전 묶음만, 다른 사용자에게는 내 내역이 보이지 않는다', async () => {
    const aug = await list('ckp_demo', '?ym=2026-08');
    expect(aug.items.map((i) => [i.kind, i.clientName, i.regYmd])).toEqual([['legacy', '대전연세정형외과', '2026-08-11']]);
    expect(aug.items[0]!.coverThumbUrl).toBeTruthy(); // edi_image(data URL) 에만 이미지가 있어도 표지 표시

    const other = await list('ckp_md5');
    expect(other.items.map((i) => i.clientName)).toEqual(['청주바른내과']);
    expect(other.items.some((i) => i.id === s1.id)).toBe(false);

    expect((await list('ckp_demo', '?ym=2026-10')).items).toEqual([]);
  });

  it('페이지 나누기', async () => {
    const p1 = await list('ckp_demo', '?pageSize=2');
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 5, hasMore: true });
    expect(p1.items.map((i) => i.id)).toEqual([s2.id, s1.id]);
    const p3 = await list('ckp_demo', '?pageSize=2&page=3');
    expect(p3).toMatchObject({ page: 3, total: 5, hasMore: false });
    expect(p3.items).toHaveLength(1);
    expect(p3.items[0]!.clientName).toBe('한빛소아청소년과의원');
  });

  it('잘못된 ym 은 400, 인증 없으면 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/edi/submissions?ym=2026-9', headers: await t.authHeaders('ckp_demo') });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fields?.ym).toContain('연월 형식');
    // 0년은 PostgreSQL date 범위 밖 → DB 오류(500) 대신 400
    const year0 = await t.app.inject({ method: 'GET', url: '/v1/edi/submissions?ym=0000-01', headers: await t.authHeaders('ckp_demo') });
    expect(year0.statusCode).toBe(400);
    expect(errorOf(year0).code).toBe('VALIDATION_FAILED');
    expect(errorOf(year0).fields?.ym).toContain('연월 형식');
    expect((await t.app.inject({ method: 'GET', url: '/v1/edi/submissions' })).statusCode).toBe(401);
  });

  it('거래처 담당자가 바뀌어도 앱 제출 건은 제출한 사용자의 내역에 남는다', async () => {
    await t.db.query("UPDATE public.mannager_by_hospital SET user_id = 'ckp_md5' WHERE idx = $1", [hanbit]);
    try {
      const items = (await list('ckp_demo')).items;
      expect(items.find((i) => i.id === s2.id)).toMatchObject({ clientName: '한빛소아청소년과의원', clientIdx: hanbit });
    } finally {
      await t.db.query("UPDATE public.mannager_by_hospital SET user_id = 'ckp_demo' WHERE idx = $1", [hanbit]);
    }
  });
});

describe('GET /v1/edi/submissions/:id (상세)', () => {
  it('앱 제출 건: 사진은 seq 순서, 제출한 순서 [c, a, b, d] 그대로', async () => {
    const d = await detail('ckp_demo', s1.id);
    expect(comparable(d)).toEqual(comparable(s1));
    expect(tokenOf(d.photos[0]!.thumbUrl)).toBe(JSON.stringify(['e', d.photos[0]!.ediIdx, 'thumb', 'ckp_demo']));
    expect(d.photos.map((p) => p.seq)).toEqual([1, 2, 3, 4]);
    const { rows } = await t.db.query<{ idx: number; aws_url: string }>('SELECT idx, aws_url FROM public.edi WHERE idx = ANY($1::int[]) ORDER BY idx', [
      d.photos.map((p) => p.ediIdx),
    ]);
    expect(rows.map((r) => r.idx)).toEqual(d.photos.map((p) => p.ediIdx));
    expect(rows.map((r) => r.aws_url)).toEqual(s1Order.map((id) => `local:uploads/users/ckp/edi/202609/${id}.jpg`));
    // 대소문자가 다른 uuid 도 같은 건
    expect((await detail('ckp_demo', s1.id.toUpperCase())).id).toBe(s1.id);
  });

  it('관리자 검토 반영: 제약사 1개(A제약) → 검토완료, 숫자만·여러 개 → 검토필요, 삭제요청, 출력·AI분석 여부', async () => {
    const [p1, p2, p3, p4] = s1.photos.map((p) => p.ediIdx!);
    await t.db.query("UPDATE public.edi SET pharmacist = 'A제약', print = true, is_ocr = true WHERE idx = $1", [p1]);
    await t.db.query("UPDATE public.edi SET pharmacist = '641012340' WHERE idx = $1", [p2]);
    await t.db.query("UPDATE public.edi SET pharmacist = 'A제약, B제약', is_ocr = true WHERE idx = $1", [p3]);
    await t.db.query("UPDATE public.edi SET deal_type = '삭제요청', pharmacist = 'C제약' WHERE idx = $1", [p4]);
    try {
      const d = await detail('ckp_demo', s1.id);
      expect(d.photos.map((p) => ({ seq: p.seq, s: p.reviewStatus, printed: p.printed, analyzed: p.analyzed, companies: p.pharmaCompanies }))).toEqual([
        { seq: 1, s: 'reviewed', printed: true, analyzed: true, companies: ['A제약'] },
        { seq: 2, s: 'needs_review', printed: false, analyzed: false, companies: ['641012340'] },
        { seq: 3, s: 'needs_review', printed: false, analyzed: true, companies: ['A제약', 'B제약'] },
        { seq: 4, s: 'delete_requested', printed: false, analyzed: false, companies: ['C제약'] },
      ]);
      expect(d.statusCounts).toEqual({ needs_review: 2, reviewed: 1, delete_requested: 1, missing: 0 });
      const item = (await list('ckp_demo')).items.find((i) => i.id === s1.id)!;
      expect(item.statusCounts).toEqual(d.statusCounts);
    } finally {
      await t.db.query("UPDATE public.edi SET pharmacist = '', print = false, is_ocr = false, deal_type = '기존' WHERE idx = ANY($1::int[])", [[p1, p2, p3, p4]]);
    }
  });

  it('관리자가 edi 행을 삭제하면 해당 seq 는 missing (오류 없음), 나머지 순서 유지', async () => {
    const ids = await uploadMany(t, 'ckp_demo', 3);
    const s = await submitOk(t, 'ckp_demo', { clientIdx: seoul, targetYm: '2026-08', photos: photosOf(ids) });
    const deletedIdx = s.photos[1]!.ediIdx!;
    await t.db.query('DELETE FROM public.edi WHERE idx = $1', [deletedIdx]);

    const d = await detail('ckp_demo', s.id);
    expect(d.photoCount).toBe(3);
    expect(d.photos.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(d.photos[1]).toEqual({
      seq: 2,
      ediIdx: deletedIdx,
      thumbUrl: null,
      imageUrl: null,
      reviewStatus: 'missing',
      printed: false,
      analyzed: false,
      pharmaCompanies: [],
    });
    expect(d.photos[0]!.reviewStatus).toBe('needs_review');
    expect(d.photos[2]!.thumbUrl).toBeTruthy();
    expect(d.statusCounts).toEqual({ needs_review: 2, reviewed: 0, delete_requested: 0, missing: 1 });
    // 첫 사진까지 지워지면 표지는 다음으로 남은 사진
    await t.db.query('DELETE FROM public.edi WHERE idx = $1', [s.photos[0]!.ediIdx]);
    const item = (await list('ckp_demo')).items.find((i) => i.id === s.id)!;
    expect(item.statusCounts.missing).toBe(2);
    expect(item.coverThumbUrl).toBe(d.photos[2]!.thumbUrl);
    // 앱 제출 행은 이전 방식 묶음으로 따로 나타나지 않는다
    expect((await list('ckp_demo')).total).toBe(6);
  });

  it('이전 방식 묶음 상세: idx 오름차순, 판정 규칙, 복사본 제외, 다시 조회해도 같은 id', async () => {
    const a = legacyByClient((await list('ckp_demo')).items, '서울튼튼내과의원');
    const d = await detail('ckp_demo', a.id);
    expect(d).toMatchObject({ id: a.id, kind: 'legacy', photoCount: 3, clientIdx: seoul });
    expect(d.photos.map((p) => [p.seq, p.reviewStatus, p.printed, p.analyzed, p.pharmaCompanies])).toEqual([
      [1, 'needs_review', false, false, []],
      [2, 'reviewed', true, true, ['한결제약']],
      [3, 'needs_review', false, true, ['한결제약', '서울신약']],
    ]);
    const idxs = d.photos.map((p) => p.ediIdx!);
    expect([...idxs].sort((x, y) => x - y)).toEqual(idxs);
    expect(d.photos.every((p) => p.thumbUrl && p.imageUrl)).toBe(true);

    const b = await detail('ckp_demo', legacyByClient((await list('ckp_demo')).items, '한빛소아청소년과의원').id);
    expect(b.photos.map((p) => p.reviewStatus)).toEqual(['delete_requested', 'needs_review']);

    const dGroup = await detail('ckp_demo', legacyByClient((await list('ckp_demo')).items, '미소가정의학과의원').id);
    expect(dGroup).toMatchObject({ monthLabel: null, createdAt: null, photoCount: 1 });
  });

  it('이전 방식 묶음에서 관리자가 한 장을 지우면 남은 사진만, 모두 지우면 404', async () => {
    const b = legacyByClient((await list('ckp_demo')).items, '한빛소아청소년과의원');
    const before = await detail('ckp_demo', b.id);
    await t.db.query('DELETE FROM public.edi WHERE idx = $1', [before.photos[0]!.ediIdx]);
    const after = await detail('ckp_demo', b.id);
    expect(after.photoCount).toBe(1);
    expect(after.photos.map((p) => p.ediIdx)).toEqual([before.photos[1]!.ediIdx]);
    await t.db.query('DELETE FROM public.edi WHERE idx = $1', [before.photos[1]!.ediIdx]);
    const gone = await detailRaw('ckp_demo', b.id);
    expect(gone.statusCode).toBe(404);
    expect(errorOf(gone).message).toBe('EDI 등록 내역을 찾을 수 없습니다.');
  });

  it('다른 사용자의 제출 건·묶음, 없는 id, 형식이 틀린 id → 404', async () => {
    const theirs = (await list('ckp_md5')).items[0]!;
    expect(theirs.kind).toBe('legacy');
    for (const [usr, id] of [
      ['ckp_md5', s1.id],
      ['ckp_demo', theirs.id],
      ['ckp_demo', randomUUID()],
      ['ckp_demo', `legacy-${'0'.repeat(24)}`],
      ['ckp_demo', 'legacy-xyz'],
      ['ckp_demo', '12345'],
    ] as const) {
      const res = await detailRaw(usr, id);
      expect(res.statusCode, `${usr} ${id}`).toBe(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
    }
    expect((await detailRaw('ckp_md5', theirs.id)).statusCode).toBe(200);
  });
});

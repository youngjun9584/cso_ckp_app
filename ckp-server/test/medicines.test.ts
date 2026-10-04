/**
 * /v1/medicines — 검색·페이지·정렬·수수료 표시·반환 금지 컬럼 (DESIGN §2.3, §5.5)
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ApiErrorBody, MedicineDetailResponse, MedicineListResponse, MedicineSearchField, MedicineSummary } from '../src/contract.js';
import { feeColumnFromFreesIdx, httpsUrlOrNull, parsePrice } from '../src/domain/medicines/medicines.js';
import { createTestApp, testConfig, type TestContext } from './helpers.js';

let t: TestContext;
let auth: { authorization: string };

const SUMMARY_KEYS = ['code', 'company', 'fee', 'imageUrl', 'inHouse', 'ingredient', 'name', 'packing', 'price', 'priceText'].sort();
const DETAIL_KEYS = [
  ...SUMMARY_KEYS,
  'additives', 'contrastMedicine', 'medicineClass', 'note', 'regYmd', 'settlement', 'type1', 'type2', 'welfareCode',
].sort();

/** 테스트 전용 추가 행 (LIKE 이스케이프·가격·이미지·정렬 확인용) */
const EXTRA_ROWS = [
  { code: 'T-PCT-001', name: '퍼센트100%정 5밀리그램', company: '테스트_제약', pay: '1,234원', image: 'https://img.example.com/약 사진.png', ingredient: '성분\\역슬래시 5mg', maker: 'o', tax: '12' },
  { code: 'T-UND-002', name: '[NP] ★밑줄약 10밀리그램', company: '테스트제약', pay: ' 2,500 ', image: 'javascript:alert(1)', ingredient: null, maker: 'X', tax: null },
  { code: 'T-ENG-003', name: 'Abc Tablet 20mg', company: 'Global Pharma', pay: '0', image: '/relative.png', ingredient: 'abc 20mg', maker: null, tax: ' ' },
];

interface RawMedicine {
  medicine_code: string;
  name: string | null;
  company: string | null;
  ingredient: string | null;
  pay: string;
  tax: string | null;
  tax_2: string | null;
}

let all: RawMedicine[] = [];

/** SQL 의 이름 정렬(표식 제거 + COLLATE "C" 바이트 순, 동률 보험코드)을 JS 로 재현 */
function sortKey(name: string | null): string | null {
  if (name === null) return null;
  return name.replace(/^ +| +$/g, '').replace(/^(\[[^\][]*\]|◎|★|\s)+/, '');
}
function expectedOrder(rows: RawMedicine[]): string[] {
  return [...rows]
    .sort((a, b) => {
      const ka = sortKey(a.name);
      const kb = sortKey(b.name);
      if (ka === null || kb === null) {
        if (ka !== kb) return ka === null ? 1 : -1;
      } else {
        const c = Buffer.compare(Buffer.from(ka, 'utf8'), Buffer.from(kb, 'utf8'));
        if (c !== 0) return c;
      }
      return Buffer.compare(Buffer.from(a.medicine_code), Buffer.from(b.medicine_code));
    })
    .map((r) => r.medicine_code);
}

const includesCI = (v: string | null, q: string) => (v ?? '').toLowerCase().includes(q.toLowerCase());
function expectedMatches(field: MedicineSearchField, q: string): RawMedicine[] {
  return all.filter((r) => {
    switch (field) {
      case 'company':
        return includesCI(r.company, q);
      case 'code':
        return includesCI(r.medicine_code, q);
      case 'all':
        return includesCI(r.name, q) || includesCI(r.company, q) || includesCI(r.medicine_code, q) || includesCI(r.ingredient, q);
      default:
        return includesCI(r.name, q);
    }
  });
}

async function getList(query: Record<string, string | number>, app: FastifyInstance = t.app, headers = auth) {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return app.inject({ method: 'GET', url: `/v1/medicines${qs ? `?${qs}` : ''}`, headers });
}

async function fetchAll(query: Record<string, string>, app?: FastifyInstance, headers?: { authorization: string }): Promise<MedicineSummary[]> {
  const items: MedicineSummary[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await getList({ ...query, page, pageSize: 100 }, app, headers);
    expect(res.statusCode).toBe(200);
    const body = res.json<MedicineListResponse>();
    items.push(...body.items);
    if (!body.hasMore) break;
  }
  return items;
}

beforeAll(async () => {
  t = await createTestApp();
  auth = await t.authHeaders('ckp_demo');
  for (const r of EXTRA_ROWS) {
    await t.db.query(
      `INSERT INTO public.medicine (medicine_code, name, company, pay, image_url, ingredient, is_maker, tax, ee2, is_live, decrease_tax, reg_ymd, medicine_is)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '비공개 관리자 메모', 'SECRET_LIVE', '9.9', '2026-03-04', 'N')`,
      [r.code, r.name, r.company, r.pay, r.image, r.ingredient, r.maker, r.tax],
    );
  }
  all = (
    await t.db.query<RawMedicine>('SELECT medicine_code, name, company, ingredient, pay, tax, tax_2 FROM public.medicine')
  ).rows;
});

afterAll(async () => {
  await t?.close();
});

describe('GET /v1/medicines', () => {
  it('인증이 없으면 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/medicines' });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.code).toBe('UNAUTHORIZED');
    const detail = await t.app.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001' });
    expect(detail.statusCode).toBe(401);
  });

  it('기본 목록: 30건, total, hasMore, 계약 필드만 반환', async () => {
    const res = await getList({});
    expect(res.statusCode).toBe(200);
    const body = res.json<MedicineListResponse>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(30);
    expect(body.total).toBe(all.length);
    expect(body.items).toHaveLength(30);
    expect(body.hasMore).toBe(true);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('페이지를 끝까지 넘기면 이름 정렬(표식 무시·C 정렬) 순서와 같고 hasMore 가 정확하다', async () => {
    const pageSize = 50;
    const seen: string[] = [];
    const pages = Math.ceil(all.length / pageSize);
    for (let page = 1; page <= pages; page++) {
      const body = (await getList({ page, pageSize })).json<MedicineListResponse>();
      expect(body.total).toBe(all.length);
      expect(body.hasMore).toBe(page < pages);
      expect(body.items.length).toBe(page < pages ? pageSize : all.length - pageSize * (pages - 1));
      seen.push(...body.items.map((i) => i.code));
    }
    expect(seen).toEqual(expectedOrder(all));
    const beyond = (await getList({ page: pages + 1, pageSize })).json<MedicineListResponse>();
    expect(beyond.items).toEqual([]);
    expect(beyond.hasMore).toBe(false);
    expect(beyond.total).toBe(all.length);
  });

  it('앞쪽 표식([NP], ★ 등)은 정렬에서 무시된다', async () => {
    const items = await fetchAll({});
    const idx = items.findIndex((i) => i.code === 'T-UND-002');
    expect(items[idx]?.name).toBe('[NP] ★밑줄약 10밀리그램');
    // '밑줄약…' 기준으로 앞뒤 이웃과 순서가 맞아야 한다
    const prev = items[idx - 1];
    if (prev) expect(Buffer.compare(Buffer.from(sortKey(prev.name) as string), Buffer.from('밑줄약 10밀리그램'))).toBeLessThanOrEqual(0);
    // 영문 이름은 한글보다 앞(바이트 순)
    expect(items.findIndex((i) => i.code === 'T-ENG-003')).toBeLessThan(items.findIndex((i) => i.company === '한결제약'));
  });

  it('pageSize 는 최대 100, 잘못된 page/field 는 400 (한국어 메시지)', async () => {
    expect((await getList({ pageSize: 100 })).statusCode).toBe(200);
    const tooBig = await getList({ pageSize: 101 });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json<ApiErrorBody>().error.fields?.pageSize).toBe('100 이하여야 합니다.');
    expect((await getList({ page: 0 })).statusCode).toBe(400);
    expect((await getList({ pageSize: 'abc' })).statusCode).toBe(400);
    const badField = await getList({ q: '아토르', field: 'price' });
    expect(badField.statusCode).toBe(400);
    expect(badField.json<ApiErrorBody>().error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { field: '검색 기준이 올바르지 않습니다.' } });
    const longQ = await getList({ q: '가'.repeat(101) });
    expect(longQ.statusCode).toBe(400);
    expect(longQ.json<ApiErrorBody>().error.fields?.q).toBe('검색어는 100자 이하로 입력해 주세요.');
  });

  it.each<[MedicineSearchField | undefined, string]>([
    [undefined, '아토르'],
    ['name', '로수'],
    ['name', 'abc'],
    ['company', '한결'],
    ['company', 'GLOBAL'],
    ['code', '644'],
    ['code', 't-pct'],
    ['all', '로수바스타틴'],
    ['all', '한결제약'],
  ])('검색 field=%s q=%s → 해당 필드에서만 부분 일치(대소문자 무시)', async (field, q) => {
    const query: Record<string, string> = { q };
    if (field) query.field = field;
    const items = await fetchAll(query);
    const expected = expectedMatches(field ?? 'name', q);
    expect(expected.length).toBeGreaterThan(0);
    expect(items.map((i) => i.code)).toEqual(expectedOrder(expected));
    const first = (await getList({ ...query, pageSize: 5 })).json<MedicineListResponse>();
    expect(first.total).toBe(expected.length);
    expect(first.hasMore).toBe(expected.length > 5);
  });

  it('검색어 앞뒤 공백은 무시하고, 빈 검색어는 전체 목록', async () => {
    const trimmed = (await getList({ q: '  한결  ', field: 'company' })).json<MedicineListResponse>();
    expect(trimmed.total).toBe(expectedMatches('company', '한결').length);
    const empty = (await getList({ q: '   ', field: '' })).json<MedicineListResponse>();
    expect(empty.total).toBe(all.length);
  });

  it('LIKE 와일드카드(%, _, \\)는 글자 그대로 검색된다', async () => {
    const pct = (await getList({ q: '%' })).json<MedicineListResponse>();
    expect(pct.items.map((i) => i.code)).toEqual(['T-PCT-001']);
    const under = (await getList({ q: '_', field: 'company' })).json<MedicineListResponse>();
    expect(under.items.map((i) => i.code)).toEqual(['T-PCT-001']);
    const backslash = (await getList({ q: '\\', field: 'all' })).json<MedicineListResponse>();
    expect(backslash.items.map((i) => i.code)).toEqual(['T-PCT-001']);
    const none = (await getList({ q: '%%없는약%%' })).json<MedicineListResponse>();
    expect(none).toMatchObject({ items: [], total: 0, hasMore: false });
  });

  it('약가 파싱·https 이미지·자사생산 표시', async () => {
    const items = await fetchAll({ q: 'T-', field: 'code' });
    const byCode = new Map(items.map((i) => [i.code, i]));
    expect(byCode.get('T-PCT-001')).toMatchObject({ priceText: '1,234원', price: 1234, inHouse: true, imageUrl: 'https://img.example.com/%EC%95%BD%20%EC%82%AC%EC%A7%84.png' });
    expect(byCode.get('T-UND-002')).toMatchObject({ priceText: '2,500', price: 2500, inHouse: false, imageUrl: null, ingredient: null });
    expect(byCode.get('T-ENG-003')).toMatchObject({ priceText: '0', price: 0, inHouse: false, imageUrl: null });

    const seeded = await fetchAll({});
    const undecided = seeded.find((i) => i.priceText === '미정');
    expect(undecided?.price).toBeNull();
    const withComma = seeded.find((i) => i.priceText?.includes(','));
    expect(withComma?.price).toBe(Number(withComma?.priceText?.replace(/,/g, '')));
    // 개발 시드의 image_url 은 http:// 이므로 모두 숨겨진다
    const httpRows = await t.db.query<{ medicine_code: string }>(`SELECT medicine_code FROM public.medicine WHERE image_url LIKE 'http://%'`);
    expect(httpRows.rows.length).toBeGreaterThan(0);
    for (const r of httpRows.rows) expect(seeded.find((i) => i.code === r.medicine_code)?.imageUrl).toBeNull();
  });

  it('반환 금지 컬럼(ee2, is_live, decrease_tax)은 목록·상세 어디에도 없다', async () => {
    const res = await getList({ q: 'T-', field: 'code' });
    expect(res.body).not.toContain('비공개 관리자 메모');
    expect(res.body).not.toContain('SECRET_LIVE');
    expect(res.body).not.toContain('9.9');
    const all100 = await getList({ pageSize: 100 });
    expect(all100.body).not.toContain('관리자 메모');
    expect(all100.body).not.toContain('NONE_TARGET');
    const detail = await t.app.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001', headers: auth });
    expect(detail.body).not.toContain('비공개 관리자 메모');
    expect(detail.body).not.toContain('SECRET_LIVE');
    expect(detail.body).not.toMatch(/ee2|isLive|is_live|decrease/i);
  });
});

describe('수수료 표시 (frees.list = true)', () => {
  it('기본: frees 의 tax 행(기본 수수료) → tax 컬럼 값, 값이 없으면 null', async () => {
    const items = await fetchAll({});
    const raw = new Map(all.map((r) => [r.medicine_code, r]));
    let shown = 0;
    let hidden = 0;
    for (const item of items) {
      const tax = raw.get(item.code)?.tax?.trim();
      if (tax) {
        expect(item.fee).toEqual({ label: '기본 수수료', value: tax });
        shown++;
      } else {
        expect(item.fee).toBeNull();
        hidden++;
      }
    }
    expect(shown).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0); // 시드 null + 테스트 행 ' '(공백)
  });

  it("관리자 camelCase 키('tax2')도 tax_2 컬럼으로 매핑한다", async () => {
    try {
      await t.db.query(`UPDATE public.frees SET list = false`);
      await t.db.query(`UPDATE public.frees SET idx = 'tax2', list = true WHERE idx = 'tax_2'`);
      const items = await fetchAll({});
      const raw = new Map(all.map((r) => [r.medicine_code, r]));
      const withTax2 = items.filter((i) => raw.get(i.code)?.tax_2);
      expect(withTax2.length).toBeGreaterThan(0);
      for (const item of items) {
        const v = raw.get(item.code)?.tax_2?.trim();
        expect(item.fee).toEqual(v ? { label: '수수료2', value: v } : null);
      }
    } finally {
      await t.db.query(`UPDATE public.frees SET idx = 'tax_2', list = false WHERE idx = 'tax2'`);
      await t.db.query(`UPDATE public.frees SET list = true WHERE idx = 'tax'`);
    }
  });

  it('list=true 행이 없거나 frees 조회가 실패하면 fee = null (오류 없이)', async () => {
    try {
      await t.db.query(`UPDATE public.frees SET list = false`);
      const none = (await getList({ pageSize: 100 })).json<MedicineListResponse>();
      expect(none.items.every((i) => i.fee === null)).toBe(true);
      await t.db.query(`UPDATE public.frees SET list = true WHERE idx = 'tax'`);
      await t.db.query(`ALTER TABLE public.frees RENAME TO frees_hidden`);
      const res = await getList({ pageSize: 100 });
      expect(res.statusCode).toBe(200);
      expect(res.json<MedicineListResponse>().items.every((i) => i.fee === null)).toBe(true);
      const detail = await t.app.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001', headers: auth });
      expect(detail.json<MedicineDetailResponse>().medicine.fee).toBeNull();
    } finally {
      await t.db.query(`ALTER TABLE IF EXISTS public.frees_hidden RENAME TO frees`);
      await t.db.query(`UPDATE public.frees SET list = (idx = 'tax')`);
    }
    const back = await t.app.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001', headers: auth });
    expect(back.json<MedicineDetailResponse>().medicine.fee).toEqual({ label: '기본 수수료', value: '12' });
  });

  it('MEDICINE_FEE_VISIBLE=false 이면 항상 fee = null', async () => {
    const app2 = await buildApp({
      config: testConfig({ MEDICINE_FEE_VISIBLE: 'false' }, t.storageDir),
      db: t.db,
      storage: t.storage,
      capabilities: t.capabilities,
      clock: t.clock,
      dataSource: 'development',
      logger: false,
    });
    try {
      await app2.ready();
      const headers = { authorization: `Bearer ${(await app2.deps.tokens.issueAccessToken('ckp_demo')).token}` };
      const items = await fetchAll({}, app2, headers);
      expect(items).toHaveLength(all.length);
      expect(items.every((i) => i.fee === null)).toBe(true);
      const detail = await app2.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001', headers });
      expect(detail.json<MedicineDetailResponse>().medicine.fee).toBeNull();
    } finally {
      await app2.close();
    }
  });
});

describe('GET /v1/medicines/:code', () => {
  it('상세: 계약 필드만, DB 값과 일치, 날짜는 YYYY-MM-DD', async () => {
    const { rows } = await t.db.query<Record<string, string | null>>(
      `SELECT medicine_code, name, company, type1, type2, medicine_class, welfare_code, contrast_medicine, medicine_add, ee, medicine_is,
              medicine_packing, ingredient, pay, to_char(reg_ymd, 'YYYY-MM-DD') AS reg
         FROM public.medicine WHERE contrast_medicine IS NOT NULL ORDER BY medicine_code LIMIT 1`,
    );
    const row = rows[0] as Record<string, string | null>;
    expect(row).toBeDefined();
    const res = await t.app.inject({ method: 'GET', url: `/v1/medicines/${encodeURIComponent(row.medicine_code as string)}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const { medicine } = res.json<MedicineDetailResponse>();
    expect(Object.keys(medicine).sort()).toEqual(DETAIL_KEYS);
    expect(medicine).toMatchObject({
      code: row.medicine_code,
      name: row.name,
      company: row.company,
      packing: row.medicine_packing,
      ingredient: row.ingredient,
      priceText: row.pay,
      type1: row.type1,
      type2: row.type2,
      medicineClass: row.medicine_class,
      welfareCode: row.welfare_code,
      contrastMedicine: row.contrast_medicine,
      additives: row.medicine_add,
      note: row.ee,
      settlement: row.medicine_is,
      regYmd: row.reg,
    });
    expect(medicine.regYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('테스트 행 상세 (정산여부 N, 이미지·약가)', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/medicines/T-PCT-001', headers: auth });
    const { medicine } = res.json<MedicineDetailResponse>();
    expect(medicine).toMatchObject({ code: 'T-PCT-001', settlement: 'N', regYmd: '2026-03-04', price: 1234, fee: { label: '기본 수수료', value: '12' } });
    expect(medicine.note).toBeNull();
    expect(medicine.type1).toBeNull();
  });

  it('없는 코드는 404 (한국어 메시지)', async () => {
    for (const code of ['NO-SUCH-CODE', '%25', ' ', 'x'.repeat(100)]) {
      const res = await t.app.inject({ method: 'GET', url: `/v1/medicines/${encodeURIComponent(code)}`, headers: auth });
      expect(res.statusCode).toBe(404);
      expect(res.json<ApiErrorBody>().error).toEqual({ code: 'NOT_FOUND', message: '의약품을 찾을 수 없습니다.' });
    }
  });
});

describe('의약품 도우미 함수', () => {
  it('feeColumnFromFreesIdx: tax/tax2/tax_2/TAX_4 → 실제 컬럼, 모르는 값·없는 컬럼은 null', () => {
    const cols = ['tax', 'tax_2', 'tax_3', 'tax_4'];
    expect(feeColumnFromFreesIdx('tax', cols)).toBe('tax');
    expect(feeColumnFromFreesIdx('tax1', cols)).toBe('tax');
    expect(feeColumnFromFreesIdx('tax2', cols)).toBe('tax_2');
    expect(feeColumnFromFreesIdx(' tax_3 ', cols)).toBe('tax_3');
    expect(feeColumnFromFreesIdx('TAX_4', cols)).toBe('tax_4');
    expect(feeColumnFromFreesIdx('tax5', cols)).toBeNull();
    expect(feeColumnFromFreesIdx('pay', cols)).toBeNull();
    expect(feeColumnFromFreesIdx('tax; DROP TABLE medicine', cols)).toBeNull();
    expect(feeColumnFromFreesIdx('tax_2', ['tax'])).toBeNull();
    expect(feeColumnFromFreesIdx(null, cols)).toBeNull();
  });

  it('parsePrice', () => {
    expect(parsePrice('1,234')).toBe(1234);
    expect(parsePrice('12,345원')).toBe(12345);
    expect(parsePrice('310.5')).toBe(310.5);
    expect(parsePrice('0')).toBe(0);
    expect(parsePrice('미정')).toBeNull();
    expect(parsePrice('-')).toBeNull();
    expect(parsePrice('1.2.3')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });

  it('httpsUrlOrNull', () => {
    expect(httpsUrlOrNull('https://a.example.com/x.png')).toBe('https://a.example.com/x.png');
    expect(httpsUrlOrNull(' https://a.example.com/x.png ')).toBe('https://a.example.com/x.png');
    expect(httpsUrlOrNull('http://a.example.com/x.png')).toBeNull();
    expect(httpsUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(httpsUrlOrNull('data:image/png;base64,AAAA')).toBeNull();
    expect(httpsUrlOrNull('//a.example.com/x.png')).toBeNull();
    expect(httpsUrlOrNull('')).toBeNull();
    expect(httpsUrlOrNull(null)).toBeNull();
  });
});

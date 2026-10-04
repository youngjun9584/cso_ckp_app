/**
 * /v1/clients — 소유 범위·검색·승인 표시·등록 검증·중복·스키마 선택 컬럼 (DESIGN §2.2, §5.5)
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type {
  ApiErrorBody,
  ClientDetail,
  ClientDetailResponse,
  ClientDuplicateCheckResponse,
  ClientListResponse,
  ClientSummary,
} from '../src/contract.js';
import { checkSchema } from '../src/db/schema-check.js';
import { withBizNoCheckDigit } from '../src/lib/bizno.js';
import { createTestApp, testConfig, type TestContext } from './helpers.js';

let t: TestContext;
let demo: { authorization: string };
let md5: { authorization: string };

const SUMMARY_KEYS = ['address', 'approval', 'bizNo', 'clientType', 'idx', 'name', 'phone', 'representative', 'selectableForEdi'];
const DETAIL_KEYS = [...SUMMARY_KEYS, 'careCode', 'dispensary', 'memo', 'ownerUsrId', 'zipCode'].sort();

interface RawClient {
  idx: number;
  user_id: string;
  hospital: string | null;
  doctor_name: string | null;
  address: string | null;
  phone: string | null;
  cpy_number: string | null;
}

async function rawClients(usrId: string): Promise<RawClient[]> {
  return (
    await t.db.query<RawClient>(
      'SELECT idx, user_id, hospital, doctor_name, address, phone, cpy_number FROM public.mannager_by_hospital WHERE user_id = $1',
      [usrId],
    )
  ).rows;
}

/** hospital COLLATE "C" (바이트 순, null 은 뒤), 동률 idx */
function expectedOrder(rows: RawClient[]): number[] {
  return [...rows]
    .sort((a, b) => {
      if (a.hospital !== b.hospital) {
        if (a.hospital === null) return 1;
        if (b.hospital === null) return -1;
        const c = Buffer.compare(Buffer.from(a.hospital), Buffer.from(b.hospital));
        if (c !== 0) return c;
      }
      return a.idx - b.idx;
    })
    .map((r) => r.idx);
}

function expectedSearch(rows: RawClient[], q: string): RawClient[] {
  const lc = q.toLowerCase();
  const has = (v: string | null) => (v ?? '').toLowerCase().includes(lc);
  const digits = q.replace(/\D/g, '');
  const digitMode = digits !== '' && /^[\d\s-]+$/.test(q);
  const hasDigits = (v: string | null) => digitMode && (v ?? '').replace(/\D/g, '').includes(digits);
  return rows.filter(
    (r) => has(r.hospital) || has(r.doctor_name) || has(r.address) || has(r.phone) || has(r.cpy_number) || hasDigits(r.phone) || hasDigits(r.cpy_number),
  );
}

async function listAll(headers: { authorization: string }, q?: string, app: FastifyInstance = t.app): Promise<ClientSummary[]> {
  const qs = new URLSearchParams({ pageSize: '100', ...(q !== undefined ? { q } : {}) }).toString();
  const res = await app.inject({ method: 'GET', url: `/v1/clients?${qs}`, headers });
  expect(res.statusCode).toBe(200);
  const body = res.json<ClientListResponse>();
  expect(body.hasMore).toBe(false);
  return body.items;
}

async function idxOf(usrId: string, name: string): Promise<number> {
  const { rows } = await t.db.query<{ idx: number }>('SELECT idx FROM public.mannager_by_hospital WHERE user_id = $1 AND hospital = $2', [usrId, name]);
  const idx = rows[0]?.idx;
  if (idx === undefined) throw new Error(`거래처 없음: ${name}`);
  return idx;
}

async function post(body: unknown, headers = demo, app: FastifyInstance = t.app) {
  return app.inject({ method: 'POST', url: '/v1/clients', headers, payload: body as Record<string, unknown> });
}

async function checkDup(query: Record<string, string>, headers = demo) {
  const qs = new URLSearchParams(query).toString();
  return t.app.inject({ method: 'GET', url: `/v1/clients/check-duplicate${qs ? `?${qs}` : ''}`, headers });
}

async function countClients(usrId: string): Promise<number> {
  return (await t.db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.mannager_by_hospital WHERE user_id = $1', [usrId])).rows[0]?.n ?? 0;
}

async function extraApp(env: Record<string, string>, capabilities = t.capabilities): Promise<{ app: FastifyInstance; headers: (u: string) => Promise<{ authorization: string }> }> {
  const app = await buildApp({
    config: testConfig(env, t.storageDir),
    db: t.db,
    storage: t.storage,
    capabilities,
    clock: t.clock,
    dataSource: 'development',
    logger: false,
  });
  await app.ready();
  return {
    app,
    headers: async (u) => ({ authorization: `Bearer ${(await app.deps.tokens.issueAccessToken(u)).token}` }),
  };
}

const bizDemo = withBizNoCheckDigit('314812345'); // 서울튼튼내과의원 (ckp_demo·ckp_md5 모두 보유)
const bizMd5Only = withBizNoCheckDigit('301445566'); // 청주바른내과 (ckp_md5 만)
const bizFresh = withBizNoCheckDigit('777666555');

beforeAll(async () => {
  t = await createTestApp();
  demo = await t.authHeaders('ckp_demo');
  md5 = await t.authHeaders('ckp_md5');
});

afterAll(async () => {
  await t?.close();
});

describe('인증', () => {
  it('토큰 없음·승인 대기 사용자는 401', async () => {
    const wait = await t.authHeaders('ckp_wait');
    for (const [method, url] of [
      ['GET', '/v1/clients'],
      ['GET', '/v1/clients/1'],
      ['GET', '/v1/clients/check-duplicate?name=a'],
      ['POST', '/v1/clients'],
    ] as const) {
      const none = await t.app.inject({ method, url, ...(method === 'POST' ? { payload: { name: 'x' } } : {}) });
      expect(none.statusCode).toBe(401);
      const waiting = await t.app.inject({ method, url, headers: wait, ...(method === 'POST' ? { payload: { name: 'x' } } : {}) });
      expect(waiting.statusCode).toBe(401);
    }
    expect(await countClients('ckp_wait')).toBe(1);
  });
});

describe('GET /v1/clients', () => {
  it('내 거래처만, 이름 C 정렬(영문 먼저), 계약 필드만', async () => {
    const own = await rawClients('ckp_demo');
    const items = await listAll(demo);
    expect(items.map((i) => i.idx)).toEqual(expectedOrder(own));
    expect(items).toHaveLength(16);
    expect(items[0]?.name).toBe('Good Morning 의원');
    for (const item of items) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);

    const other = await listAll(md5);
    expect(other).toHaveLength(3);
    const ownIdx = new Set(own.map((r) => r.idx));
    expect(other.some((i) => ownIdx.has(i.idx))).toBe(false);
  });

  it('페이지네이션', async () => {
    const seen: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await t.app.inject({ method: 'GET', url: `/v1/clients?page=${page}&pageSize=5`, headers: demo });
      const body = res.json<ClientListResponse>();
      expect(body).toMatchObject({ page, pageSize: 5, total: 16, hasMore: page < 4 });
      expect(body.items).toHaveLength(page < 4 ? 5 : 1);
      seen.push(...body.items.map((i) => i.idx));
    }
    expect(seen).toEqual(expectedOrder(await rawClients('ckp_demo')));
    expect((await t.app.inject({ method: 'GET', url: '/v1/clients?pageSize=101', headers: demo })).statusCode).toBe(400);
  });

  it('승인 상태·EDI 선택 가능 여부·사업자번호 표시·구분', async () => {
    const byName = new Map((await listAll(demo)).map((i) => [i.name, i]));
    expect(byName.get('서울튼튼내과의원')).toMatchObject({ approval: 'approved', selectableForEdi: true, clientType: '의원', bizNo: `${bizDemo.slice(0, 3)}-${bizDemo.slice(3, 5)}-${bizDemo.slice(5)}` });
    expect(byName.get('유성온천내과')).toMatchObject({ approval: 'unset', selectableForEdi: true });
    expect(byName.get('참편한통증의학과')).toMatchObject({ approval: 'pending', selectableForEdi: false });
    expect(byName.get('밝은눈안과의원')).toMatchObject({ bizNo: '314-82-23344', phone: '0425554444' });
    expect(byName.get('늘푸른내과의원')).toMatchObject({ bizNo: '사업자번호 미확인', clientType: null, representative: null });
    expect(byName.get('미소가정의학과의원')?.bizNo).toBeNull();
    expect(byName.get('우리들이비인후과의원')).toMatchObject({ address: null, phone: null, bizNo: null });
  });

  it.each([
    '둔산',
    '김건강',
    'good morning',
    '042-555-4444',
    '31482233',
    '314-82-23',
    '0425',
    '의원',
  ])('검색 q=%s → 이름·대표자·주소·전화·사업자번호 (숫자는 하이픈 무시)', async (q) => {
    const expected = expectedSearch(await rawClients('ckp_demo'), q);
    expect(expected.length).toBeGreaterThan(0);
    const items = await listAll(demo, q);
    expect(items.map((i) => i.idx)).toEqual(expectedOrder(expected));
  });

  it('검색: 전화 하이픈 무시, 다른 사용자 거래처는 나오지 않음, 와일드카드는 글자 그대로', async () => {
    expect((await listAll(demo, '042-555-4444')).map((i) => i.name)).toContain('밝은눈안과의원');
    expect((await listAll(demo, '314-82-23344')).map((i) => i.name)).toEqual(['밝은눈안과의원']);
    expect(await listAll(demo, '청주바른')).toEqual([]);
    expect((await listAll(md5, '청주바른')).map((i) => i.name)).toEqual(['청주바른내과']);
    expect(await listAll(demo, '%')).toEqual([]);
    expect(await listAll(demo, '_')).toEqual([]);
    expect(await listAll(demo, '\\')).toEqual([]);
  });
});

describe('GET /v1/clients/:idx', () => {
  it('내 거래처 상세: 모든 필드', async () => {
    const idx = await idxOf('ckp_demo', '서울튼튼내과의원');
    const res = await t.app.inject({ method: 'GET', url: `/v1/clients/${idx}`, headers: demo });
    expect(res.statusCode).toBe(200);
    const { client } = res.json<ClientDetailResponse>();
    expect(Object.keys(client).sort()).toEqual(DETAIL_KEYS);
    expect(client).toMatchObject({
      idx,
      name: '서울튼튼내과의원',
      representative: '김건강',
      address: '대전광역시 서구 둔산로 100, 3층',
      zipCode: '35233',
      careCode: '34100123',
      dispensary: '둔산온누리약국',
      phone: '042-123-4567',
      memo: '화·목 오전 방문',
      approval: 'approved',
      ownerUsrId: 'ckp_demo',
    });
  });

  it('다른 사용자 거래처는 404 (존재 여부를 드러내지 않음), 잘못된 idx 도 404', async () => {
    const othersIdx = await idxOf('ckp_md5', '서울튼튼내과의원');
    const res = await t.app.inject({ method: 'GET', url: `/v1/clients/${othersIdx}`, headers: demo });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().error).toEqual({ code: 'NOT_FOUND', message: '거래처를 찾을 수 없습니다.' });
    expect((await listAll(demo)).some((i) => i.idx === othersIdx)).toBe(false);
    // 소유자 본인은 조회 가능
    expect((await t.app.inject({ method: 'GET', url: `/v1/clients/${othersIdx}`, headers: md5 })).statusCode).toBe(200);

    for (const bad of ['999999', 'abc', '0', '-3', '1e3', '99999999999']) {
      const r = await t.app.inject({ method: 'GET', url: `/v1/clients/${bad}`, headers: demo });
      expect(r.statusCode).toBe(404);
      expect(r.json<ApiErrorBody>().error.message).toBe('거래처를 찾을 수 없습니다.');
    }
  });
});

describe('GET /v1/clients/check-duplicate', () => {
  it('이름: 공백·대소문자 정규화 비교, 내 거래처만, excludeIdx 제외', async () => {
    const dup = (await checkDup({ name: '  good   MORNING 의원 ' })).json<ClientDuplicateCheckResponse>();
    expect(dup.name).toEqual({ checked: true, duplicate: true, message: '이미 같은 이름으로 등록된 거래처가 있습니다.' });
    expect(dup.bizNo).toEqual({ checked: false, valid: true, duplicate: false, message: null });

    const others = (await checkDup({ name: '청주바른내과' })).json<ClientDuplicateCheckResponse>();
    expect(others.name).toEqual({ checked: true, duplicate: false, message: null });

    const gm = await idxOf('ckp_demo', 'Good Morning 의원');
    const excluded = (await checkDup({ name: 'Good Morning 의원', excludeIdx: String(gm) })).json<ClientDuplicateCheckResponse>();
    expect(excluded.name.duplicate).toBe(false);

    const empty = (await checkDup({ name: '   ' })).json<ClientDuplicateCheckResponse>();
    expect(empty.name).toEqual({ checked: false, duplicate: false, message: null });

    const long = (await checkDup({ name: '가'.repeat(101) })).json<ClientDuplicateCheckResponse>();
    expect(long.name).toEqual({ checked: true, duplicate: false, message: '거래처명은 100자 이하로 입력해 주세요.' });
  });

  it('사업자번호: 형식·검증번호·중복(숫자만 비교, 내 거래처만)', async () => {
    const bad = (await checkDup({ bizNo: '123-45-67890' })).json<ClientDuplicateCheckResponse>();
    expect(bad.bizNo).toEqual({ checked: true, valid: false, duplicate: false, message: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.' });
    const short = (await checkDup({ bizNo: '12345' })).json<ClientDuplicateCheckResponse>();
    expect(short.bizNo).toMatchObject({ valid: false, message: '사업자등록번호 10자리를 정확히 입력해 주세요.' });
    const chars = (await checkDup({ bizNo: '12a-45' })).json<ClientDuplicateCheckResponse>();
    expect(chars.bizNo).toMatchObject({ valid: false, message: '사업자등록번호는 숫자와 하이픈(-)만 입력할 수 있습니다.' });

    const dup = (await checkDup({ bizNo: bizDemo })).json<ClientDuplicateCheckResponse>();
    expect(dup.bizNo).toEqual({ checked: true, valid: true, duplicate: true, message: '이미 같은 사업자등록번호로 등록된 거래처가 있습니다.' });
    // 저장값이 하이픈 없는 '3148223344' 여도 하이픈 입력과 같은 번호로 본다
    const noHyphen = (await checkDup({ bizNo: '314-82-23344' })).json<ClientDuplicateCheckResponse>();
    expect(noHyphen.bizNo.duplicate).toBe(true);

    const othersOnly = (await checkDup({ bizNo: bizMd5Only })).json<ClientDuplicateCheckResponse>();
    expect(othersOnly.bizNo).toEqual({ checked: true, valid: true, duplicate: false, message: null });
    const fresh = (await checkDup({ bizNo: bizFresh, name: '새 거래처명' })).json<ClientDuplicateCheckResponse>();
    expect(fresh).toEqual({
      name: { checked: true, duplicate: false, message: null },
      bizNo: { checked: true, valid: true, duplicate: false, message: null },
    });
  });

  it('잘못된 excludeIdx 는 400, 빈 요청은 모두 checked=false', async () => {
    const bad = await checkDup({ name: 'a', excludeIdx: 'abc' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<ApiErrorBody>().error.fields?.excludeIdx).toBe('제외할 거래처 번호가 올바르지 않습니다.');
    const none = (await checkDup({ excludeIdx: '' })).json<ClientDuplicateCheckResponse>();
    expect(none.name.checked).toBe(false);
    expect(none.bizNo.checked).toBe(false);
  });
});

describe('POST /v1/clients — 입력 검증', () => {
  it.each<[string, Record<string, unknown>, Record<string, string>]>([
    ['이름 없음', {}, { name: '거래처명을 입력해 주세요.' }],
    ['이름 공백', { name: '   ' }, { name: '거래처명을 입력해 주세요.' }],
    ['이름 숫자 타입', { name: 123 }, { name: '거래처명을 입력해 주세요.' }],
    ['이름 101자', { name: '가'.repeat(101) }, { name: '거래처명은 100자 이하로 입력해 주세요.' }],
    ['사업자번호 자릿수', { name: 'A', bizNo: '123-45-678' }, { bizNo: '사업자등록번호 10자리를 정확히 입력해 주세요.' }],
    ['사업자번호 검증번호', { name: 'A', bizNo: '123-45-67890' }, { bizNo: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.' }],
    ['사업자번호 문자', { name: 'A', bizNo: '12345abcde' }, { bizNo: '사업자등록번호는 숫자와 하이픈(-)만 입력할 수 있습니다.' }],
    ['연락처 문자', { name: 'A', phone: '042-123-abcd' }, { phone: '연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.' }],
    ['연락처 길이', { name: 'A', phone: '0'.repeat(21) }, { phone: '연락처는 20자 이하로 입력해 주세요.' }],
    ['우편번호', { name: 'A', zipCode: '1234' }, { zipCode: '우편번호는 숫자 5자리로 입력해 주세요.' }],
    ['주소만 101자', { name: 'A', address: '가'.repeat(101) }, { address: '주소와 상세주소를 합쳐 100자 이하로 입력해 주세요.' }],
    ['메모 201자', { name: 'A', memo: 'm'.repeat(201) }, { memo: '메모는 200자 이하로 입력해 주세요.' }],
    ['대표자 101자', { name: 'A', representative: 'r'.repeat(101) }, { representative: '대표자명은 100자 이하로 입력해 주세요.' }],
    ['요양기관번호 51자', { name: 'A', careCode: '1'.repeat(51) }, { careCode: '요양기관번호는 50자 이하로 입력해 주세요.' }],
    ['문전약국 101자', { name: 'A', dispensary: 'd'.repeat(101) }, { dispensary: '문전약국은 100자 이하로 입력해 주세요.' }],
    ['구분 51자', { name: 'A', clientType: 't'.repeat(51) }, { clientType: '거래처 구분은 50자 이하로 입력해 주세요.' }],
    ['구분 숫자 타입', { name: 'A', clientType: 5 }, { clientType: '입력 형식이 올바르지 않습니다.' }],
  ])('%s → 400 + 필드 메시지', async (_label, body, fields) => {
    const before = await countClients('ckp_demo');
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    const err = res.json<ApiErrorBody>().error;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toEqual(fields);
    expect(err.message).toBe(Object.values(fields)[0]);
    expect(await countClients('ckp_demo')).toBe(before);
  });

  it('주소+상세주소 합계 초과는 두 입력란 모두에 표시, 여러 오류는 한 번에', async () => {
    const res = await post({ name: '', bizNo: '1', phone: 'x', address: '가'.repeat(60), addressDetail: '나'.repeat(40) });
    expect(res.statusCode).toBe(400);
    const err = res.json<ApiErrorBody>().error;
    expect(err.message).toBe('입력한 내용을 확인해 주세요.');
    expect(err.fields).toEqual({
      name: '거래처명을 입력해 주세요.',
      bizNo: '사업자등록번호 10자리를 정확히 입력해 주세요.',
      phone: '연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.',
      address: '주소와 상세주소를 합쳐 100자 이하로 입력해 주세요.',
      addressDetail: '주소와 상세주소를 합쳐 100자 이하로 입력해 주세요.',
    });
    // 합쳐서 정확히 100자(공백 포함)는 통과
    const ok = await post({ name: '주소 경계 거래처', address: '가'.repeat(60), addressDetail: '나'.repeat(39) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<ClientDetailResponse>().client.address).toHaveLength(100);
  });

  it('본문이 객체가 아니면 400', async () => {
    const arr = await t.app.inject({ method: 'POST', url: '/v1/clients', headers: { ...demo, 'content-type': 'application/json' }, payload: '[1,2]' });
    expect(arr.statusCode).toBe(400);
    const str = await t.app.inject({ method: 'POST', url: '/v1/clients', headers: { ...demo, 'content-type': 'application/json' }, payload: '"abc"' });
    expect(str.statusCode).toBe(400);
    expect(str.json<ApiErrorBody>().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/clients — 등록', () => {
  let created: ClientDetail;

  it('201: approval=false(승인 대기), 소유자는 토큰 사용자, 값 정규화·주소 결합', async () => {
    const res = await post({
      name: '  새봄   연합의원 ',
      clientType: '의원',
      bizNo: bizFresh,
      representative: ' 홍길동 ',
      phone: '042-000-1111',
      address: '대전광역시 서구 둔산로 1',
      addressDetail: ' 2층 ',
      zipCode: '35233',
      careCode: '34109999',
      dispensary: '새봄약국',
      memo: '앱에서 등록',
      // 무시되어야 하는 값
      ownerUsrId: 'ckp_md5',
      userId: 'ckp_md5',
      approval: true,
    });
    expect(res.statusCode).toBe(201);
    created = res.json<ClientDetailResponse>().client;
    expect(Object.keys(created).sort()).toEqual(DETAIL_KEYS);
    expect(created).toMatchObject({
      name: '새봄 연합의원',
      clientType: '의원',
      bizNo: `${bizFresh.slice(0, 3)}-${bizFresh.slice(3, 5)}-${bizFresh.slice(5)}`,
      representative: '홍길동',
      phone: '042-000-1111',
      address: '대전광역시 서구 둔산로 1 2층',
      zipCode: '35233',
      careCode: '34109999',
      dispensary: '새봄약국',
      memo: '앱에서 등록',
      approval: 'pending',
      selectableForEdi: false,
      ownerUsrId: 'ckp_demo',
    });

    const { rows } = await t.db.query<Record<string, unknown>>('SELECT * FROM public.mannager_by_hospital WHERE idx = $1', [created.idx]);
    expect(rows[0]).toMatchObject({
      user_id: 'ckp_demo',
      hospital: '새봄 연합의원',
      approval: false,
      hospital_type: '의원',
      cpy_number: created.bizNo,
      address: '대전광역시 서구 둔산로 1 2층',
      ee: '앱에서 등록',
    });

    const detail = await t.app.inject({ method: 'GET', url: `/v1/clients/${created.idx}`, headers: demo });
    expect(detail.json<ClientDetailResponse>().client).toEqual(created);
    expect((await listAll(demo)).map((i) => i.idx)).toContain(created.idx);
    expect((await t.app.inject({ method: 'GET', url: `/v1/clients/${created.idx}`, headers: md5 })).statusCode).toBe(404);
  });

  it('선택 입력은 비우면 null, 상세주소만 있어도 저장', async () => {
    const res = await post({ name: '최소 입력 거래처', bizNo: '', phone: null, addressDetail: '상세만', memo: '   ' });
    expect(res.statusCode).toBe(201);
    expect(res.json<ClientDetailResponse>().client).toMatchObject({
      bizNo: null, phone: null, address: '상세만', memo: null, clientType: null, representative: null, zipCode: null,
    });
    const oldZip = await post({ name: '구 우편번호 거래처', zipCode: '123-456' });
    expect(oldZip.statusCode).toBe(201);
  });

  it('같은 사용자 이름 중복(정규화) → 409 DUPLICATE_CLIENT_NAME + fields.name', async () => {
    const before = await countClients('ckp_demo');
    const res = await post({ name: 'GOOD  morning 의원' });
    expect(res.statusCode).toBe(409);
    const err = res.json<ApiErrorBody>().error;
    expect(err).toMatchObject({
      code: 'DUPLICATE_CLIENT_NAME',
      message: '이미 같은 이름으로 등록된 거래처가 있습니다.',
      fields: { name: '이미 같은 이름으로 등록된 거래처가 있습니다.' },
    });
    expect(err.details?.existingIdx).toBe(await idxOf('ckp_demo', 'Good Morning 의원'));
    expect((await post({ name: ' 새봄 연합의원' })).statusCode).toBe(409);
    expect(await countClients('ckp_demo')).toBe(before);
  });

  it('같은 사용자 사업자번호 중복(숫자만 비교) → 409 DUPLICATE_BIZ_NO + fields.bizNo', async () => {
    const res = await post({ name: '다른 이름 거래처', bizNo: bizDemo }); // 저장값은 하이픈 형식, 입력은 숫자만
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiErrorBody>().error).toMatchObject({
      code: 'DUPLICATE_BIZ_NO',
      message: '이미 같은 사업자등록번호로 등록된 거래처가 있습니다.',
      fields: { bizNo: '이미 같은 사업자등록번호로 등록된 거래처가 있습니다.' },
    });
    const both = await post({ name: '서울튼튼내과의원', bizNo: '314-82-23344' });
    expect(both.statusCode).toBe(409);
    expect(both.json<ApiErrorBody>().error).toMatchObject({
      code: 'DUPLICATE_CLIENT_NAME',
      fields: { name: '이미 같은 이름으로 등록된 거래처가 있습니다.', bizNo: '이미 같은 사업자등록번호로 등록된 거래처가 있습니다.' },
    });
  });

  it('다른 사용자의 같은 이름·사업자번호는 중복이 아니다', async () => {
    const res = await post({ name: '대덕종합병원', bizNo: withBizNoCheckDigit('314820001') }, md5);
    expect(res.statusCode).toBe(201);
    expect(res.json<ClientDetailResponse>().client.ownerUsrId).toBe('ckp_md5');
    const res2 = await post({ name: '청주바른내과 분점', bizNo: bizMd5Only });
    expect(res2.statusCode).toBe(201);
  });

  it('동시에 같은 이름을 등록하면 하나만 성공한다', async () => {
    const results = await Promise.all([post({ name: '동시 등록 의원' }), post({ name: '동시 등록 의원' }), post({ name: '동시 등록  의원' })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    const { rows } = await t.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.mannager_by_hospital WHERE user_id = 'ckp_demo' AND hospital = '동시 등록 의원'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('설정·스키마에 따른 동작', () => {
  it('CLIENT_APPROVAL_REQUIRED_FOR_EDI=false 이면 승인 대기 거래처도 선택 가능', async () => {
    const { app, headers } = await extraApp({ CLIENT_APPROVAL_REQUIRED_FOR_EDI: 'false' });
    try {
      const items = await listAll(await headers('ckp_demo'), undefined, app);
      const pending = items.filter((i) => i.approval === 'pending');
      expect(pending.length).toBeGreaterThan(0);
      expect(items.every((i) => i.selectableForEdi)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('hospital_type 컬럼이 없으면 SQL 에서 쓰지 않고 clientType 은 null', async () => {
    await t.db.query('ALTER TABLE public.mannager_by_hospital RENAME COLUMN hospital_type TO hospital_type_hidden');
    try {
      const caps = await checkSchema(t.db);
      expect(caps.clientHospitalType).toBe(false);
      const { app, headers } = await extraApp({}, caps);
      try {
        const h = await headers('ckp_demo');
        const items = await listAll(h, undefined, app);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.clientType === null)).toBe(true);
        const res = await post({ name: '구분 컬럼 없는 거래처', clientType: '의원' }, h, app);
        expect(res.statusCode).toBe(201);
        const { client } = res.json<ClientDetailResponse>();
        expect(client.clientType).toBeNull();
        const detail = await app.inject({ method: 'GET', url: `/v1/clients/${client.idx}`, headers: h });
        expect(detail.statusCode).toBe(200);
        const { rows } = await t.db.query<{ hospital_type_hidden: string | null }>(
          'SELECT hospital_type_hidden FROM public.mannager_by_hospital WHERE idx = $1',
          [client.idx],
        );
        expect(rows[0]?.hospital_type_hidden).toBeNull();
        const dup = await app.inject({ method: 'GET', url: `/v1/clients/check-duplicate?name=${encodeURIComponent('구분 컬럼 없는 거래처')}`, headers: h });
        expect(dup.json<ClientDuplicateCheckResponse>().name.duplicate).toBe(true);
      } finally {
        await app.close();
      }
    } finally {
      await t.db.query('ALTER TABLE public.mannager_by_hospital RENAME COLUMN hospital_type_hidden TO hospital_type');
    }
  });

  it('DB 컬럼이 계약보다 짧으면 짧은 쪽 길이로 검증한다', async () => {
    const caps = structuredClone(t.capabilities);
    const col = caps.columns.mannager_by_hospital?.address;
    expect(col).toBeDefined();
    if (col) col.maxLength = 20;
    const { app, headers } = await extraApp({}, caps);
    try {
      const res = await post({ name: '짧은 주소 컬럼', address: '가'.repeat(15), addressDetail: '나'.repeat(10) }, await headers('ckp_demo'), app);
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiErrorBody>().error.fields?.address).toBe('주소와 상세주소를 합쳐 20자 이하로 입력해 주세요.');
    } finally {
      await app.close();
    }
  });
});

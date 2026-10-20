/**
 * 회원가입 (GET /v1/auth/check-id, POST /v1/auth/register) — 인메모리 PGlite 만 사용.
 * 모든 inject 는 기본 127.0.0.1 에서 오므로, 가입 IP 한도(5회/10분)와 섞이지 않게 요청마다 다른 remoteAddress 를 쓴다
 * (속도 제한 테스트만 같은 주소를 반복 사용).
 */
import bcryptjs from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, getConfigWarnings, loadConfig } from '../src/config.js';
import type { ApiErrorBody, AuthTokensResponse, CheckUserIdResponse, MetaResponse, RegisterResponse } from '../src/contract.js';
import type { Db } from '../src/db/pool.js';
import { formatPhone, insertPendingUser, validateRegistration } from '../src/domain/users/registration.js';
import { AppError } from '../src/lib/errors.js';
import { todayKst } from '../src/lib/kst.js';
import { createTestApp, type TestContext } from './helpers.js';

const REGISTERED = '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.';
const TAKEN = '이미 사용 중인 아이디입니다.';
const AVAILABLE = '사용할 수 있는 아이디입니다.';
const DISABLED = '현재 앱에서 회원가입을 받지 않습니다. 관리자에게 계정 발급을 요청해 주세요.';

/** UTC 16:30 = KST 다음 날 01:30 — join_ymd 가 UTC 가 아닌 KST 날짜인지 드러나게 한다 */
function kstNextDayInstant(): Date {
  const d = new Date();
  d.setUTCHours(16, 30, 0, 0);
  return d;
}

let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `10.20.${Math.floor(ipSeq / 200)}.${(ipSeq % 200) + 1}`;
}

type Body = Record<string, unknown>;

function validBody(overrides: Body = {}): Body {
  return { usrId: 'newbie01', password: 'abcd1234', name: '홍길동', phone: '01012345678', agreePrivacy: true, ...overrides };
}

function register(ctx: TestContext, payload: unknown, ip: string = nextIp()) {
  return ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: payload as object, remoteAddress: ip });
}

function checkId(ctx: TestContext, usrId: string | undefined, ip: string = nextIp()) {
  return ctx.app.inject({ method: 'GET', url: '/v1/auth/check-id', query: usrId === undefined ? {} : { usrId }, remoteAddress: ip });
}

function login(ctx: TestContext, usrId: string, password: string) {
  return ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { usrId, password, platform: 'native' } });
}

interface UserRow {
  usr_id: string;
  usr_pwd: string;
  usr_nam: string | null;
  phone: string | null;
  email: string | null;
  cpy_nam: string | null;
  apr_yn: string | null;
  join_ymd: string | null;
  role_id: string | null;
  others: Record<string, unknown>;
}

async function userRow(ctx: TestContext, usrId: string): Promise<UserRow | undefined> {
  const { rows } = await ctx.db.query<Omit<UserRow, 'others'> & Record<string, unknown>>(
    `SELECT usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn, join_ymd, role_id,
            tel, address, cpy_number, cpy_address, bankbook_name, bankbook_number, bankbook_security_number,
            last_ymd, gbn, sessionkey, user_ip, use_ymd, cpy_image, bankbook_image, classification, client, coalition_company
       FROM public.sys_app_usr_mng WHERE usr_id = $1`,
    [usrId],
  );
  const r = rows[0];
  if (!r) return undefined;
  const { usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn, join_ymd, role_id, ...others } = r;
  return { usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn, join_ymd, role_id, others };
}

async function countUsers(ctx: TestContext, lowerId?: string): Promise<number> {
  const { rows } = lowerId
    ? await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sys_app_usr_mng WHERE lower(usr_id) = $1', [lowerId])
    : await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sys_app_usr_mng');
  return rows[0]?.n ?? 0;
}

let t: TestContext;

beforeAll(async () => {
  t = await createTestApp({ now: kstNextDayInstant() });
});

afterAll(async () => {
  await t?.close();
});

describe('POST /v1/auth/register', () => {
  it('승인 대기(N)·R0004·KST 오늘로 등록하고 bcrypt(cost 10)로만 저장한다', async () => {
    const res = await register(
      t,
      validBody({ usrId: 'newbie01', email: '  Hong@Example.COM ', companyName: '  길동상사 ', phone: '010-1234-5678' }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json<RegisterResponse>()).toEqual({ usrId: 'newbie01', status: 'pending', message: REGISTERED });
    expect(res.body).not.toMatch(/\$2[aby]\$|abcd1234|usr_pwd|R0004/);
    expect(res.headers['cache-control']).toBe('no-store');

    const expectedYmd = todayKst(t.clock.now());
    expect(expectedYmd).not.toBe(t.clock.now().toISOString().slice(0, 10)); // UTC 날짜와 다른 시각에서 확인
    const row = await userRow(t, 'newbie01');
    expect(row).toMatchObject({
      usr_id: 'newbie01',
      usr_nam: '홍길동',
      phone: '010-1234-5678',
      email: 'hong@example.com',
      cpy_nam: '길동상사',
      apr_yn: 'N',
      role_id: 'R0004',
      join_ymd: expectedYmd,
    });
    expect(row?.usr_pwd).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
    expect(await bcryptjs.compare('abcd1234', row?.usr_pwd as string)).toBe(true);
    // 명시한 컬럼 외에는 아무것도 쓰지 않는다 (계좌·사진·신분 정보 등)
    for (const [col, value] of Object.entries(row?.others ?? {})) expect({ col, value }).toEqual({ col, value: null });
  });

  it('가입 직후 로그인은 403 승인 대기, 관리자가 apr_yn=Y 로 승인하면 로그인된다', async () => {
    expect((await register(t, validBody({ usrId: 'waituser1', password: 'wait1234' }))).statusCode).toBe(201);

    const pending = await login(t, 'waituser1', 'wait1234');
    expect(pending.statusCode).toBe(403);
    expect(pending.json<ApiErrorBody>().error).toMatchObject({
      code: 'ACCOUNT_NOT_APPROVED',
      message: '관리자 승인 대기중입니다.',
      details: { status: 'N' },
    });
    expect((await login(t, 'waituser1', 'wrong1234')).statusCode).toBe(401);

    await t.db.query(`UPDATE public.sys_app_usr_mng SET apr_yn = 'Y' WHERE usr_id = 'waituser1'`);
    const ok = await login(t, 'waituser1', 'wait1234');
    expect(ok.statusCode).toBe(200);
    expect(ok.json<AuthTokensResponse>().user).toEqual({
      usrId: 'waituser1',
      name: '홍길동',
      companyName: null,
      phone: '010-1234-5678',
      email: null,
      roleId: 'R0004',
    });
  });

  it('같은 아이디는 정확히 같거나 대소문자·앞뒤 공백만 달라도 409 DUPLICATE_USER_ID', async () => {
    expect((await register(t, validBody({ usrId: 'DupUser' }))).statusCode).toBe(201);
    for (const usrId of ['DupUser', 'dupuser', 'DUPUSER', '  dupUser  ']) {
      const res = await register(t, validBody({ usrId }));
      expect(res.statusCode).toBe(409);
      expect(res.json<ApiErrorBody>().error).toEqual({ code: 'DUPLICATE_USER_ID', message: TAKEN, fields: { usrId: TAKEN } });
    }
    expect(await countUsers(t, 'dupuser')).toBe(1);

    // 샘플 계정과 대소문자만 다른 아이디
    const demo = await register(t, validBody({ usrId: 'CKP_Demo' }));
    expect(demo.statusCode).toBe(409);
    expect(await countUsers(t, 'ckp_demo')).toBe(1);
  });

  it('기존 행의 아이디 앞뒤에 공백이 있어도 중복으로 본다', async () => {
    await t.db.query(`INSERT INTO public.sys_app_usr_mng (usr_id, usr_pwd, apr_yn) VALUES ('spaced ', 'x', 'Y')`);
    expect((await register(t, validBody({ usrId: 'Spaced' }))).statusCode).toBe(409);
    expect((await checkId(t, 'spaced')).json<CheckUserIdResponse>().available).toBe(false);
  });

  const ID_LENGTH = '아이디는 2~20자로 입력해 주세요.';
  const ID_CHARS = '아이디는 한글, 영문, 숫자, 공백, 밑줄(_), 하이픈(-), 마침표(.)만 사용할 수 있습니다.';
  const PW_LENGTH = '비밀번호는 4~64자로 입력해 주세요.';
  const PW_SPACE = '비밀번호 앞뒤에는 공백을 넣을 수 없습니다.';
  const PHONE_DIGITS = '휴대폰 번호는 숫자 10~11자리로 입력해 주세요.';
  const PHONE_CHARS = '휴대폰 번호는 숫자와 하이픈(-)만 입력해 주세요.';
  const EMAIL_FORMAT = '이메일 형식이 올바르지 않습니다.';
  const AGREE = '개인정보 수집·이용에 동의해 주세요.';

  it.each<[string, Body, string, string]>([
    ['아이디 누락', { usrId: undefined }, 'usrId', '아이디를 입력해 주세요.'],
    ['아이디 공백만', { usrId: '   ' }, 'usrId', '아이디를 입력해 주세요.'],
    ['아이디 1자', { usrId: 'a' }, 'usrId', ID_LENGTH],
    ['아이디 21자', { usrId: 'a'.repeat(21) }, 'usrId', ID_LENGTH],
    ['아이디 탭 문자', { usrId: 'ab\tcd' }, 'usrId', ID_CHARS],
    ['아이디 특수문자', { usrId: 'ab!cd' }, 'usrId', ID_CHARS],
    ['아이디 이메일 형태', { usrId: 'a@b.com' }, 'usrId', ID_CHARS],
    ['아이디 한글 자모', { usrId: 'ㄱㄴㄷ' }, 'usrId', ID_CHARS],
    ['아이디 숫자 타입', { usrId: 12345 }, 'usrId', '아이디 형식이 올바르지 않습니다.'],
    ['비밀번호 누락', { password: undefined }, 'password', '비밀번호를 입력해 주세요.'],
    ['비밀번호 3자', { password: 'ab1' }, 'password', PW_LENGTH],
    ['비밀번호 65자', { password: `${'a1'.repeat(32)}a` }, 'password', PW_LENGTH],
    ['비밀번호 앞 공백', { password: ' abcd1234' }, 'password', PW_SPACE],
    ['비밀번호 뒤 공백', { password: 'abcd1234 ' }, 'password', PW_SPACE],
    ['이름 누락', { name: undefined }, 'name', '이름을 입력해 주세요.'],
    ['이름 공백만', { name: '   ' }, 'name', '이름을 입력해 주세요.'],
    ['이름 21자', { name: '가'.repeat(21) }, 'name', '이름은 20자 이하로 입력해 주세요.'],
    ['휴대폰 누락', { phone: undefined }, 'phone', '휴대폰 번호를 입력해 주세요.'],
    ['휴대폰 9자리', { phone: '010-123-456' }, 'phone', PHONE_DIGITS],
    ['휴대폰 12자리', { phone: '010123456789' }, 'phone', PHONE_DIGITS],
    ['휴대폰 공백 포함', { phone: '010 1234 5678' }, 'phone', PHONE_CHARS],
    ['휴대폰 국가번호', { phone: '+821012345678' }, 'phone', PHONE_CHARS],
    ['휴대폰 숫자 타입', { phone: 1012345678 }, 'phone', PHONE_CHARS],
    ['이메일 형식', { email: 'not-an-email' }, 'email', EMAIL_FORMAT],
    ['이메일 도메인에 점 없음', { email: 'a@b' }, 'email', EMAIL_FORMAT],
    ['이메일 201자', { email: `${'a'.repeat(195)}@a.com` }, 'email', '이메일은 200자 이하로 입력해 주세요.'],
    ['회사명 51자', { companyName: '가'.repeat(51) }, 'companyName', '회사명은 50자 이하로 입력해 주세요.'],
    ['개인정보 동의 false', { agreePrivacy: false }, 'agreePrivacy', AGREE],
    ['개인정보 동의 누락', { agreePrivacy: undefined }, 'agreePrivacy', AGREE],
    ['개인정보 동의 문자열 "true"', { agreePrivacy: 'true' }, 'agreePrivacy', AGREE],
  ])('%s → 400 fields.%s', async (_label, overrides, field, message) => {
    const before = await countUsers(t);
    const res = await register(t, validBody({ usrId: 'valid_case', ...overrides }));
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().error).toEqual({ code: 'VALIDATION_FAILED', message, fields: { [field]: message } });
    expect(await countUsers(t)).toBe(before);
  });

  it('여러 항목이 틀리면 필드별 문구와 공통 문구', async () => {
    const res = await register(t, {});
    expect(res.statusCode).toBe(400);
    const { error } = res.json<ApiErrorBody>();
    expect(error.message).toBe('입력한 내용을 확인해 주세요.');
    expect(Object.keys(error.fields ?? {}).sort()).toEqual(['agreePrivacy', 'name', 'password', 'phone', 'usrId']);
  });

  it('본문이 객체가 아니거나 JSON 이 깨지면 400', async () => {
    const arr = await register(t, [validBody()]);
    expect(arr.statusCode).toBe(400);
    expect(arr.json<ApiErrorBody>().error.code).toBe('VALIDATION_FAILED');
    const broken = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"usrId":',
      remoteAddress: nextIp(),
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json<ApiErrorBody>().error.message).toBe('요청 형식이 올바르지 않습니다.');
  });

  it('선택 항목은 비우면 NULL, 휴대폰은 하이픈 형식으로 저장한다', async () => {
    const cases: Array<[Body, Partial<UserRow>]> = [
      [{ usrId: 'opt_null', email: null, companyName: null, phone: '0101234567' }, { email: null, cpy_nam: null, phone: '010-123-4567' }],
      [{ usrId: 'opt_empty', email: '   ', companyName: '', phone: '02-1234-5678' }, { email: null, cpy_nam: null, phone: '02-1234-5678' }],
      [{ usrId: 'opt_missing', phone: '0311234567' }, { email: null, cpy_nam: null, phone: '031-123-4567' }],
      [{ usrId: '홍길동_01.a-b', phone: '010-9999-0000' }, { usr_id: '홍길동_01.a-b', phone: '010-9999-0000' }],
    ];
    for (const [body, expected] of cases) {
      const res = await register(t, validBody(body));
      expect(res.statusCode, JSON.stringify(body)).toBe(201);
      expect(await userRow(t, res.json<RegisterResponse>().usrId)).toMatchObject(expected);
    }
  });

  it('본문의 다른 항목(aprYn·roleId 등)은 무시한다 — 항상 N / R0004', async () => {
    const res = await register(
      t,
      validBody({
        usrId: 'sneaky01',
        aprYn: 'Y',
        apr_yn: 'Y',
        roleId: 'R0001',
        role_id: 'R0001',
        joinYmd: '2000-01-01',
        join_ymd: '2000-01-01',
        usrPwd: 'plain',
        usr_pwd: 'plain',
        bankbookNumber: '123-456',
        bankbook_number: '123-456',
      }),
    );
    expect(res.statusCode).toBe(201);
    const row = await userRow(t, 'sneaky01');
    expect(row).toMatchObject({ apr_yn: 'N', role_id: 'R0004', join_ymd: todayKst(t.clock.now()) });
    expect(row?.usr_pwd).toMatch(/^\$2[aby]\$10\$/);
    expect(row?.others.bankbook_number).toBeNull();
    expect((await login(t, 'sneaky01', 'abcd1234')).statusCode).toBe(403);
  });
});

describe('GET /v1/auth/check-id', () => {
  it('사용 가능한 아이디 (앞뒤 공백 제거한 값을 돌려준다)', async () => {
    const res = await checkId(t, '  fresh_id  ');
    expect(res.statusCode).toBe(200);
    expect(res.json<CheckUserIdResponse>()).toEqual({ usrId: 'fresh_id', available: true, message: AVAILABLE });
  });

  it('이미 있는 아이디는 대소문자와 관계없이 사용 불가', async () => {
    for (const usrId of ['ckp_demo', 'CKP_DEMO']) {
      const res = await checkId(t, usrId);
      expect(res.statusCode).toBe(200);
      expect(res.json<CheckUserIdResponse>()).toEqual({ usrId, available: false, message: TAKEN });
    }
  });

  it.each<[string, string | undefined, string]>([
    ['누락', undefined, '아이디를 입력해 주세요.'],
    ['1자', 'a', '아이디는 2~20자로 입력해 주세요.'],
    ['특수문자', 'ab#cd', '아이디는 한글, 영문, 숫자, 공백, 밑줄(_), 하이픈(-), 마침표(.)만 사용할 수 있습니다.'],
  ])('형식 오류(%s) → 400 fields.usrId', async (_label, usrId, message) => {
    const res = await checkId(t, usrId);
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().error).toEqual({ code: 'VALIDATION_FAILED', message, fields: { usrId: message } });
  });

  it('GET /v1/meta 의 features.selfRegistration 은 기본 true', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.json<MetaResponse>().features.selfRegistration).toBe(true);
  });
});

describe('속도 제한', () => {
  it('가입: 같은 IP 에서 10분에 5회를 넘으면 6번째는 429 (다른 IP 는 가능)', async () => {
    const ip = '10.99.0.1';
    for (let i = 1; i <= 5; i++) expect((await register(t, validBody({ usrId: `rl_user${i}` }), ip)).statusCode).toBe(201);
    const blocked = await register(t, validBody({ usrId: 'rl_user6' }), ip);
    expect(blocked.statusCode).toBe(429);
    const { error } = blocked.json<ApiErrorBody>();
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toMatch(/^회원가입 요청이 너무 많습니다\. \d+분 후 다시 시도해 주세요\.$/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(await userRow(t, 'rl_user6')).toBeUndefined();

    expect((await register(t, validBody({ usrId: 'rl_user6' }), '10.99.0.2')).statusCode).toBe(201);
  });

  it('가입: 실패한 요청(400·409)도 IP 한도에 포함된다', async () => {
    const ip = '10.99.0.3';
    for (let i = 0; i < 3; i++) expect((await register(t, validBody({ password: 'abc' }), ip)).statusCode).toBe(400);
    for (let i = 0; i < 2; i++) expect((await register(t, validBody({ usrId: 'ckp_demo' }), ip)).statusCode).toBe(409);
    expect((await register(t, validBody({ usrId: 'rl_after_fail' }), ip)).statusCode).toBe(429);
  });

  it('아이디 확인: 같은 IP 에서 1분에 30회를 넘으면 429', async () => {
    const ip = '10.99.0.4';
    for (let i = 0; i < 30; i++) expect((await checkId(t, `probe${i}`, ip)).statusCode).toBe(200);
    const blocked = await checkId(t, 'probe_last', ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().error.code).toBe('RATE_LIMITED');
  });
});

describe('동시 가입', () => {
  it('같은 아이디 두 건을 동시에 보내면 정확히 하나만 201, 나머지는 409', async () => {
    const results = await Promise.all([register(t, validBody({ usrId: 'race_same' })), register(t, validBody({ usrId: 'race_same' }))]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const conflict = results.find((r) => r.statusCode === 409);
    expect(conflict?.json<ApiErrorBody>().error.fields).toEqual({ usrId: TAKEN });
    expect(await countUsers(t, 'race_same')).toBe(1);
  });

  it('대소문자만 다른 아이디를 동시에 보내도 하나만 등록된다', async () => {
    const results = await Promise.all([register(t, validBody({ usrId: 'RaceCase' })), register(t, validBody({ usrId: 'racecase' }))]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await countUsers(t, 'racecase')).toBe(1);
  });
});

describe('설정 — SELF_REGISTRATION_ENABLED=false', () => {
  let off: TestContext;
  beforeAll(async () => {
    off = await createTestApp({ env: { SELF_REGISTRATION_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await off?.close();
  });

  it('가입·아이디 확인 모두 403 REGISTRATION_DISABLED, meta 는 false', async () => {
    const before = await countUsers(off);
    for (const res of [
      await register(off, validBody({ usrId: 'off_user' })),
      await register(off, { nonsense: true }), // 본문 검증보다 먼저 거부
      await checkId(off, 'off_user'),
      await checkId(off, undefined),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json<ApiErrorBody>().error).toEqual({ code: 'REGISTRATION_DISABLED', message: DISABLED });
    }
    expect(await countUsers(off)).toBe(before);
    const meta = await off.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(meta.json<MetaResponse>().features.selfRegistration).toBe(false);
  });
});

describe('설정 — REGISTER_ROLE_ID 빈 값 · REGISTER_MAX_PER_HOUR', () => {
  let alt: TestContext;
  beforeAll(async () => {
    alt = await createTestApp({ env: { REGISTER_ROLE_ID: '', REGISTER_MAX_PER_HOUR: '2' }, seed: false });
  });
  afterAll(async () => {
    await alt?.close();
  });

  it('REGISTER_ROLE_ID 가 빈 값이면 role_id 는 NULL', async () => {
    expect((await register(alt, validBody({ usrId: 'norole01' }))).statusCode).toBe(201);
    expect(await userRow(alt, 'norole01')).toMatchObject({ role_id: null, apr_yn: 'N' });
  });

  it('서버 전체 가입 완료 수가 시간당 한도를 넘으면 429, 1시간 뒤 다시 가능', async () => {
    expect((await register(alt, validBody({ usrId: 'norole02' }))).statusCode).toBe(201); // 1건은 위 테스트
    const blocked = await register(alt, validBody({ usrId: 'norole03' }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().error.message).toBe('지금은 회원가입 신청이 많아 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    expect(await userRow(alt, 'norole03')).toBeUndefined();
    alt.clock.advance(60 * 60 * 1000 + 1000);
    expect((await register(alt, validBody({ usrId: 'norole03' }))).statusCode).toBe(201);
  });
});

describe('단위 — 설정·검증·저장', () => {
  it('loadConfig: 회원가입 기본값과 REGISTER_ROLE_ID 규칙', () => {
    const base = { NODE_ENV: 'development', DEV_DB: 'pglite' };
    expect(loadConfig(base).registration).toEqual({ enabled: true, roleId: 'R0004', ipMaxPer10Min: 5, maxPerHour: 100 });
    expect(loadConfig({ ...base, SELF_REGISTRATION_ENABLED: 'false' }).registration.enabled).toBe(false);
    expect(loadConfig({ ...base, REGISTER_ROLE_ID: ' R0002 ' }).registration.roleId).toBe('R0002');
    const empty = loadConfig({ ...base, REGISTER_ROLE_ID: '' });
    expect(empty.registration.roleId).toBeNull();
    expect(getConfigWarnings(empty).join('\n')).toMatch(/REGISTER_ROLE_ID/);
    expect(() => loadConfig({ ...base, REGISTER_ROLE_ID: 'R00001' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, REGISTER_ROLE_ID: 'R 01' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, REGISTER_IP_MAX_PER_10MIN: '0' })).toThrow(ConfigError);
    expect(loadConfig({ ...base, REGISTER_IP_MAX_PER_10MIN: '20', REGISTER_MAX_PER_HOUR: '500' }).registration).toMatchObject({
      ipMaxPer10Min: 20,
      maxPerHour: 500,
    });
  });

  it('formatPhone', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(formatPhone('0111234567')).toBe('011-123-4567');
    expect(formatPhone('0212345678')).toBe('02-1234-5678');
    expect(formatPhone('0311234567')).toBe('031-123-4567');
    expect(formatPhone('03112345678')).toBe('031-1234-5678');
  });

  it('validateRegistration: NFD 한글도 NFC 로 저장하고 모르는 항목은 버린다', () => {
    const nfd = '홍길동'.normalize('NFD');
    const v = validateRegistration({ ...validBody({ usrId: `${nfd}01`, name: nfd }), aprYn: 'Y', roleId: 'R0001' });
    expect(v).toEqual({ usrId: '홍길동01', password: 'abcd1234', name: '홍길동', phone: '010-1234-5678', email: null, companyName: null });
  });

  it('insertPendingUser: PK 충돌(23505)은 409 DUPLICATE_USER_ID, 그 밖의 DB 오류는 그대로', async () => {
    const input = validateRegistration(validBody());
    const values = { passwordHash: '$2b$10$x', roleId: 'R0004', joinYmd: '2026-01-01' };
    const failingDb = (err: unknown) => ({ tx: async () => Promise.reject(err) }) as unknown as Db;

    const pkErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', severity: 'ERROR' });
    const dup = await insertPendingUser(failingDb(pkErr), input, values).catch((e: unknown) => e);
    expect(dup).toBeInstanceOf(AppError);
    expect((dup as AppError).code).toBe('DUPLICATE_USER_ID');
    expect((dup as AppError).statusCode).toBe(409);
    expect((dup as AppError).fields).toEqual({ usrId: TAKEN });

    const other = Object.assign(new Error('relation does not exist'), { code: '42P01', severity: 'ERROR' });
    await expect(insertPendingUser(failingDb(other), input, values)).rejects.toBe(other);
  });
});

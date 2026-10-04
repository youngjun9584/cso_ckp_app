import bcryptjs from 'bcryptjs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ApiErrorBody, AuthTokensResponse, MeResponse, MetaResponse } from '../src/contract.js';
import { describeCapabilities } from '../src/db/schema-check.js';
import { BCRYPT_MAX_CONCURRENCY, BCRYPT_MAX_QUEUE, hashPassword, md5Hex } from '../src/lib/password.js';
import { hashRefreshToken, REFRESH_REUSE_GRACE_MS } from '../src/services/refresh-tokens.js';
import { createTestApp, type TestContext } from './helpers.js';

let t: TestContext;

async function addUser(usrId: string, pwd: string, aprYn: string | null, name = '테스트') {
  await t.db.query(
    `INSERT INTO public.sys_app_usr_mng (usr_id, usr_pwd, usr_nam, cpy_nam, phone, email, role_id, apr_yn, bankbook_number)
     VALUES ($1, $2, $3, '테스트회사', '010-0000-0000', NULL, 'R0004', $4, '999-999-999')`,
    [usrId, pwd, name, aprYn],
  );
}

function login(usrId: string, password: string, platform: 'native' | 'web' = 'native') {
  return t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { usrId, password, platform } });
}

beforeAll(async () => {
  t = await createTestApp();
  const bcrypt = await hashPassword('demo1234');
  await addUser('ckp_kor', md5Hex('한글비번12', 'cp949'), 'Y', '한글사용자'); // 관리자(Windows JVM, CP949) 방식
  await addUser('ckp_utf', md5Hex('비밀번호1', 'utf8'), 'Y');
  await addUser('ckp_upper', md5Hex('demo1234').toUpperCase(), 'Y');
  await addUser('ckp_plain', 'demo1234', 'Y'); // 평문 — 형식 불명이므로 거부
  await addUser('ckp_del', bcrypt, 'D');
  await addUser('ckp_hold', bcrypt, 'R');
  await addUser('ckp_block', bcrypt, 'S');
  await addUser('ckp_etc', bcrypt, 'X');
  await addUser('ckp_null', bcrypt, null);
  await addUser('ckp_later', bcrypt, 'Y');
  await addUser('ckp_lock', bcrypt, 'Y');
  await addUser('ckp_rl', md5Hex('demo1234'), 'Y');
  // refresh 토큰·로그인 제한 테스트용 (IP+아이디당 10회/분 한도를 서로 나눠 쓰지 않도록 테스트마다 다른 계정)
  for (const id of ['ckp_rt_hash', 'ckp_rt_rot', 'ckp_rt_grace', 'ckp_rt_web', 'ckp_rt_out', 'ckp_rt_restart', 'ckp_rt_legacy', 'ckp_rt_gone', 'ckp_src', 'ckp_acct']) {
    await addUser(id, md5Hex('demo1234'), 'Y');
  }
});

afterAll(async () => {
  await t?.close();
});

describe('POST /v1/auth/login', () => {
  it('bcrypt 비밀번호로 로그인한다 (native: 본문에 refreshToken)', async () => {
    const res = await login('ckp_demo', 'demo1234');
    expect(res.statusCode).toBe(200);
    const body = res.json<AuthTokensResponse>();
    expect(body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body.refreshToken).toBeTruthy();
    expect(new Date(body.accessTokenExpiresAt).getTime()).toBeGreaterThan(t.clock.now().getTime());
    expect(body.user).toEqual({
      usrId: 'ckp_demo',
      name: '김영업',
      companyName: 'CKP파트너스',
      phone: '010-1234-5678',
      email: 'demo@example.com',
      roleId: 'R0004',
    });
    // 민감 컬럼은 절대 응답에 없어야 한다
    expect(res.body).not.toMatch(/bankbook|000-0000-0000-01|usr_pwd|\$2[aby]\$|314-81-00001/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('아이디 앞뒤 공백은 무시한다', async () => {
    expect((await login('  ckp_demo  ', 'demo1234')).statusCode).toBe(200);
  });

  it('MD5(UTF-8) 비밀번호로 로그인한다 — 앞뒤 공백 제거(trim) 후 비교', async () => {
    expect((await login('ckp_md5', 'demo1234')).statusCode).toBe(200);
    expect((await login('ckp_md5', '  demo1234 ')).statusCode).toBe(200);
    expect((await login('ckp_utf', '비밀번호1')).statusCode).toBe(200);
    expect((await login('ckp_upper', 'demo1234')).statusCode).toBe(200);
  });

  it('CP949 로 해시된 한글 비밀번호도 로그인된다', async () => {
    const res = await login('ckp_kor', '한글비번12');
    expect(res.statusCode).toBe(200);
    expect(res.json<AuthTokensResponse>().user.name).toBe('한글사용자');
  });

  it('bcrypt 는 공백을 제거하지 않는다 (Next.js 와 동일)', async () => {
    expect((await login('ckp_later', ' demo1234')).statusCode).toBe(401);
  });

  it('잘못된 비밀번호·없는 아이디·형식 불명 해시는 같은 401 메시지', async () => {
    for (const [id, pw] of [
      ['ckp_demo', 'wrong-pass'],
      ['no_such_user', 'demo1234'],
      ['ckp_plain', 'demo1234'],
      ['ckp_kor', '한글비번13'],
    ] as const) {
      const res = await login(id, pw);
      expect(res.statusCode).toBe(401);
      const body = res.json<ApiErrorBody>();
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
      expect(body.error.message).toBe('아이디 또는 비밀번호가 올바르지 않습니다.');
    }
  });

  it.each([
    ['ckp_wait', 'N', '관리자 승인 대기중입니다.'],
    ['ckp_del', 'D', '삭제 요청된 상태입니다.'],
    ['ckp_hold', 'R', '승인 보류된 상태입니다.'],
    ['ckp_block', 'S', '접속차단 상태입니다.'],
    ['ckp_etc', 'X', '관리자에게 승인 상태를 확인하십시오.'],
    ['ckp_null', null, '관리자에게 승인 상태를 확인하십시오.'],
  ])('apr_yn=%s(%s) 이면 403 과 관리자 문구', async (usrId, status, message) => {
    const res = await login(usrId, 'demo1234');
    expect(res.statusCode).toBe(403);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('ACCOUNT_NOT_APPROVED');
    expect(body.error.message).toBe(message);
    expect(body.error.details?.status).toBe(status);
  });

  it('승인 대기 계정도 비밀번호가 틀리면 401 (계정 상태 노출 금지)', async () => {
    const res = await login('ckp_wait', 'wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('입력 누락은 400 + 필드별 한국어 메시지', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { password: '' } });
    expect(res.statusCode).toBe(400);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toEqual({ usrId: '아이디를 입력해 주세요.', password: '비밀번호를 입력해 주세요.' });
  });

  it('JSON 이 깨진 요청은 400 한국어 메시지', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"usrId":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().error).toMatchObject({ code: 'VALIDATION_FAILED', message: '요청 형식이 올바르지 않습니다.' });
  });

  it('web 로그인은 refresh 토큰을 httpOnly 쿠키(ckp_rt)로 준다', async () => {
    const res = await login('ckp_demo', 'demo1234', 'web');
    expect(res.statusCode).toBe(200);
    expect(res.json<AuthTokensResponse>().refreshToken).toBeUndefined();
    const cookie = res.cookies.find((c) => c.name === 'ckp_rt');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/v1/auth');
    expect(cookie?.secure).toBeFalsy(); // 테스트 설정 COOKIE_SECURE=false
    expect(cookie?.maxAge).toBe(14 * 24 * 60 * 60);
  });

  it('실패 5회(10분) 이후에는 맞는 비밀번호도 429, 10분 지나면 다시 가능', async () => {
    for (let i = 0; i < 5; i++) expect((await login('ckp_lock', 'bad')).statusCode).toBe(401);
    const blocked = await login('ckp_lock', 'demo1234');
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json<ApiErrorBody>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toMatch(/^로그인 시도가 너무 많습니다\. \d+분 후 다시 시도해 주세요\.$/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    t.clock.advance(10 * 60 * 1000 + 1000);
    expect((await login('ckp_lock', 'demo1234')).statusCode).toBe(200);
  });

  it('같은 IP·아이디로 1분에 10회를 넘기면 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login('ckp_rl', 'demo1234')).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('POST /v1/auth/refresh · GET /v1/auth/me · POST /v1/auth/logout', () => {
  it('native refresh 로 새 토큰을 받는다', async () => {
    const first = await t.loginAs('ckp_demo');
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native', refreshToken: first.refreshToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json<AuthTokensResponse>();
    expect(body.refreshToken).toBeTruthy();
    const me = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json<MeResponse>().user.usrId).toBe('ckp_demo');
  });

  it('web refresh 는 쿠키로 동작하고 새 쿠키를 준다', async () => {
    const first = await t.loginAs('ckp_demo', undefined, 'web');
    expect(first.refreshCookie).toBeTruthy();
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { platform: 'web' },
      cookies: { ckp_rt: first.refreshCookie as string },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<AuthTokensResponse>().refreshToken).toBeUndefined();
    expect(res.cookies.find((c) => c.name === 'ckp_rt')?.value).toBeTruthy();
  });

  it('refresh 토큰이 없거나 access 토큰을 넣으면 401', async () => {
    const first = await t.loginAs('ckp_demo');
    const missing = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native' } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json<ApiErrorBody>().error.code).toBe('UNAUTHORIZED');
    const wrongTyp = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native', refreshToken: first.accessToken } });
    expect(wrongTyp.statusCode).toBe(401);
  });

  it('refresh 토큰을 access 토큰처럼 쓰면 401', async () => {
    const first = await t.loginAs('ckp_demo');
    const res = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${first.refreshToken}` } });
    expect(res.statusCode).toBe(401);
  });

  it('토큰 없이 /me → 401 한국어 메시지, 위조 토큰 → 401', async () => {
    const none = await t.app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(none.statusCode).toBe(401);
    expect(none.json<ApiErrorBody>().error).toMatchObject({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
    const bad = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json<ApiErrorBody>().error.details?.reason).toBe('TOKEN_INVALID');
  });

  it('access 토큰은 30분 후 만료된다', async () => {
    const first = await t.loginAs('ckp_demo');
    t.clock.advance(31 * 60 * 1000);
    const res = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: first.headers });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error).toMatchObject({ message: '로그인이 만료되었습니다. 다시 로그인해 주세요.', details: { reason: 'TOKEN_EXPIRED' } });
    // refresh 토큰은 아직 유효
    const refreshed = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native', refreshToken: first.refreshToken } });
    expect(refreshed.statusCode).toBe(200);
  });

  it('로그인 후 관리자가 차단하면 상태 캐시(60초) 이후 401, refresh 도 거부', async () => {
    const s = await t.loginAs('ckp_later');
    expect((await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: s.headers })).statusCode).toBe(200);

    await t.db.query(`UPDATE public.sys_app_usr_mng SET apr_yn = 'S' WHERE usr_id = 'ckp_later'`);
    // 캐시 유효 기간 안에서는 아직 허용
    expect((await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: s.headers })).statusCode).toBe(200);

    t.clock.advance(61_000);
    const blocked = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: s.headers });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json<ApiErrorBody>().error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '접속차단 상태입니다.',
      details: { reason: 'ACCOUNT_NOT_APPROVED', status: 'S' },
    });

    const refresh = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native', refreshToken: s.refreshToken } });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json<ApiErrorBody>().error.message).toBe('접속차단 상태입니다.');

    // 차단 해제 → invalidate 로 즉시 반영
    await t.db.query(`UPDATE public.sys_app_usr_mng SET apr_yn = 'Y' WHERE usr_id = 'ckp_later'`);
    t.app.userStatusCache.invalidate('ckp_later');
    expect((await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: s.headers })).statusCode).toBe(200);
  });

  it('로그아웃하면 204, 쿠키 삭제, 그 refresh 토큰은 더 이상 쓸 수 없다', async () => {
    const s = await t.loginAs('ckp_demo', undefined, 'web');
    const out = await t.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { platform: 'web' }, cookies: { ckp_rt: s.refreshCookie as string } });
    expect(out.statusCode).toBe(204);
    const cleared = out.cookies.find((c) => c.name === 'ckp_rt');
    expect(cleared?.value).toBe('');
    const again = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'web' }, cookies: { ckp_rt: s.refreshCookie as string } });
    expect(again.statusCode).toBe(401);
  });
});

describe('공통 동작', () => {
  it('GET /v1/meta 는 인증 없이 기능·제한값을 준다', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.statusCode).toBe(200);
    const meta = res.json<MetaResponse>();
    expect(meta).toMatchObject({
      apiVersion: '1.0.0',
      dataSource: 'development',
      storage: 'local',
      features: { clientApprovalRequiredForEdi: true, clientTypeField: true, medicineFeeVisible: true, selfRegistration: true },
      limits: {
        ediMinPhotos: 1,
        ediMaxPhotos: 30,
        photoMaxBytes: 15 * 1024 * 1024,
        photoMinLongSide: 400,
        acceptedUploadTypes: ['image/jpeg', 'image/png', 'image/webp'],
        memoMaxLength: 500,
      },
    });
    expect(meta.serverTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('없는 경로는 404 NOT_FOUND 한국어 본문', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>()).toEqual({ error: { code: 'NOT_FOUND', message: '요청한 주소를 찾을 수 없습니다.' } });
  });

  it('CORS: 허용 목록의 출처만 credentials 와 함께 허용', async () => {
    const ok = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/login',
      headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/login',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('보안 헤더(helmet)와 교차 출처 이미지 허용(CORP)', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

// ───────────────────── refresh 토큰: 출처·재발급·폐기 ─────────────────────

function refreshNative(app: TestContext['app'], refreshToken: string | undefined) {
  return app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'native', refreshToken } });
}

function logoutNative(app: TestContext['app'], refreshToken: string | undefined) {
  return app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { platform: 'native', refreshToken } });
}

describe('POST /v1/auth/refresh — 토큰 출처는 platform 으로만', () => {
  it('web 쿠키로 platform=native 를 요청해도 본문에 refresh 토큰을 돌려주지 않는다 (JS 로 httpOnly 토큰 탈취 방지)', async () => {
    const s = await t.loginAs('ckp_src', undefined, 'web');
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { platform: 'native' },
      cookies: { ckp_rt: s.refreshCookie as string },
      headers: { origin: 'http://localhost:8081' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.details?.reason).toBe('REFRESH_MISSING');
    expect((res.json() as Partial<AuthTokensResponse>).refreshToken).toBeUndefined();

    // web 은 본문 토큰을 받지 않는다
    const n = await t.loginAs('ckp_src');
    const webWithBody = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'web', refreshToken: n.refreshToken } });
    expect(webWithBody.statusCode).toBe(401);

    // 원래 쿠키는 web 으로는 그대로 유효 (위 요청들이 소비하지 않았다)
    const ok = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'web' }, cookies: { ckp_rt: s.refreshCookie as string } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<AuthTokensResponse>().refreshToken).toBeUndefined();
  });
});

describe('refresh 토큰 기록(ckp_app_refresh_token, migrations/002): 재발급·재사용 감지·로그아웃', () => {
  it('capabilities 가 테이블을 인식하고, DB 에는 토큰 원문이 아니라 sha256 만 저장한다', async () => {
    expect(t.capabilities.refreshTokenTable).toBe(true);
    expect(describeCapabilities(t.capabilities).join('\n')).toMatch(/refresh 토큰 기록 테이블.*있음/);
    const s = await t.loginAs('ckp_rt_hash');
    const jti = (await t.app.deps.tokens.verifyRefreshToken(s.refreshToken as string)).jti;
    const { rows } = await t.db.query<{ usr_id: string; token_hash: string; revoked_at: Date | null; replaced_by: string | null }>(
      'SELECT usr_id, token_hash, revoked_at, replaced_by FROM public.ckp_app_refresh_token WHERE token_id = $1',
      [jti],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ usr_id: 'ckp_rt_hash', token_hash: hashRefreshToken(s.refreshToken as string), revoked_at: null, replaced_by: null });
    const raw = await t.db.query('SELECT 1 FROM public.ckp_app_refresh_token WHERE token_hash = $1', [s.refreshToken]);
    expect(raw.rowCount).toBe(0);
  });

  it('재발급하면 이전 토큰은 폐기되고, 60초 뒤 다시 쓰면(유출 의심) 같은 로그인의 토큰이 모두 폐기된다', async () => {
    const s = await t.loginAs('ckp_rt_rot');
    const r1 = await refreshNative(t.app, s.refreshToken);
    expect(r1.statusCode).toBe(200);
    const second = r1.json<AuthTokensResponse>().refreshToken as string;
    expect(second).not.toBe(s.refreshToken);

    t.clock.advance(REFRESH_REUSE_GRACE_MS + 1000);
    const reuse = await refreshNative(t.app, s.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json<ApiErrorBody>().error).toMatchObject({ code: 'UNAUTHORIZED', details: { reason: 'TOKEN_REVOKED' } });
    // 정상 사용자가 가진 최신 토큰도 폐기됨 → 다시 로그인해야 한다
    expect((await refreshNative(t.app, second)).statusCode).toBe(401);
    const { rows } = await t.db.query<{ n: number }>(
      "SELECT count(*) AS n FROM public.ckp_app_refresh_token WHERE usr_id = 'ckp_rt_rot' AND revoked_at IS NULL",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('60초 안에 같은 토큰이 다시 오면(동시 요청·응답 유실 후 재시도) 같은 로그인으로 하나 더 발급한다', async () => {
    const s = await t.loginAs('ckp_rt_grace');
    const a = await refreshNative(t.app, s.refreshToken);
    const b = await refreshNative(t.app, s.refreshToken);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const ta = a.json<AuthTokensResponse>().refreshToken as string;
    const tb = b.json<AuthTokensResponse>().refreshToken as string;
    expect(ta).not.toBe(tb);
    expect((await refreshNative(t.app, ta)).statusCode).toBe(200);
    expect((await refreshNative(t.app, tb)).statusCode).toBe(200);
  });

  it('web: 탭 두 개가 같은 쿠키로 동시에 재발급해도 둘 다 성공한다', async () => {
    const s = await t.loginAs('ckp_rt_web', undefined, 'web');
    const send = () =>
      t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'web' }, cookies: { ckp_rt: s.refreshCookie as string } });
    const [x, y] = await Promise.all([send(), send()]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    for (const r of [x, y]) {
      const cookie = r.cookies.find((c) => c.name === 'ckp_rt')?.value as string;
      expect(cookie).toBeTruthy();
      const next = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { platform: 'web' }, cookies: { ckp_rt: cookie } });
      expect(next.statusCode).toBe(200);
    }
  });

  it('native 로그아웃(본문 refreshToken)은 같은 로그인에서 발급된 토큰을 모두 폐기한다', async () => {
    const s = await t.loginAs('ckp_rt_out');
    const r = await refreshNative(t.app, s.refreshToken);
    const second = r.json<AuthTokensResponse>().refreshToken as string;
    expect((await logoutNative(t.app, second)).statusCode).toBe(204);
    expect((await refreshNative(t.app, second)).statusCode).toBe(401);
    // 방금 재발급으로 폐기된 이전 토큰도 (60초 안이지만) 후속 토큰이 로그아웃됐으므로 거부
    expect((await refreshNative(t.app, s.refreshToken)).statusCode).toBe(401);
    // 다른 로그인(기기)은 영향 없음
    const other = await t.loginAs('ckp_rt_out');
    expect((await refreshNative(t.app, other.refreshToken)).statusCode).toBe(200);
  });

  it('폐기 기록은 서버를 다시 시작해도(새 인스턴스) 유지된다', async () => {
    const s = await t.loginAs('ckp_rt_restart');
    expect((await logoutNative(t.app, s.refreshToken)).statusCode).toBe(204);
    const app2 = await buildApp({
      config: t.config,
      db: t.db,
      storage: t.storage,
      capabilities: t.capabilities,
      clock: t.clock,
      dataSource: 'development',
      logger: false,
    });
    await app2.ready();
    try {
      expect((await refreshNative(app2, s.refreshToken)).statusCode).toBe(401);
      const fresh = await t.loginAs('ckp_rt_restart');
      expect((await refreshNative(app2, fresh.refreshToken)).statusCode).toBe(200);
    } finally {
      await app2.close();
    }
  });

  it('테이블 적용 전(무상태)에 발급된 토큰은 한 번 새 로그인 묶음으로 옮기고, 이후 재사용은 거부한다', async () => {
    const legacy = await t.app.deps.tokens.issueRefreshToken('ckp_rt_legacy'); // st 클레임 없음, 기록 없음
    const r = await refreshNative(t.app, legacy.token);
    expect(r.statusCode).toBe(200);
    const next = r.json<AuthTokensResponse>().refreshToken as string;
    const nextClaims = await t.app.deps.tokens.verifyRefreshToken(next);
    expect(nextClaims.stored).toBe(true);
    const { rows } = await t.db.query<{ revoked_at: Date | null; replaced_by: string }>(
      'SELECT revoked_at, replaced_by::text AS replaced_by FROM public.ckp_app_refresh_token WHERE token_id = $1',
      [legacy.jti],
    );
    expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(rows[0]?.replaced_by).toBe(nextClaims.jti);

    t.clock.advance(REFRESH_REUSE_GRACE_MS + 1000);
    expect((await refreshNative(t.app, legacy.token)).statusCode).toBe(401);
    expect((await refreshNative(t.app, next)).statusCode).toBe(401); // 재사용 감지 → 묶음 전체 폐기
  });

  it('DB 방식으로 발급됐는데 기록이 없는 토큰은 거부한다', async () => {
    const s = await t.loginAs('ckp_rt_gone');
    await t.db.query("DELETE FROM public.ckp_app_refresh_token WHERE usr_id = 'ckp_rt_gone'");
    const res = await refreshNative(t.app, s.refreshToken);
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.details?.reason).toBe('TOKEN_INVALID');
  });
});

describe('refresh 토큰 무상태 방식 (migrations/002 미적용)', () => {
  let m: TestContext;
  beforeAll(async () => {
    m = await createTestApp({ refreshTokenTable: false });
  });
  afterAll(async () => {
    await m?.close();
  });

  it('테이블이 없으면 기존처럼 동작: 재발급해도 이전 토큰 유효, 로그아웃한 토큰만 메모리에서 거부', async () => {
    expect(m.capabilities.refreshTokenTable).toBe(false);
    expect(m.capabilities.ediAppTables).toBe(true); // EDI 기능과 무관
    expect(describeCapabilities(m.capabilities).join('\n')).toMatch(/refresh 토큰 기록 테이블.*없음 → 무상태/);
    const { rows } = await m.db.query<{ t: string | null }>("SELECT to_regclass('public.ckp_app_refresh_token')::text AS t");
    expect(rows[0]?.t).toBeNull();

    const s = await m.loginAs('ckp_md5');
    expect((await m.app.deps.tokens.verifyRefreshToken(s.refreshToken as string)).stored).toBe(false);
    const r1 = await refreshNative(m.app, s.refreshToken);
    expect(r1.statusCode).toBe(200);
    expect((await refreshNative(m.app, s.refreshToken)).statusCode).toBe(200);
    expect((await logoutNative(m.app, s.refreshToken)).statusCode).toBe(204);
    expect((await refreshNative(m.app, s.refreshToken)).statusCode).toBe(401);
    expect((await refreshNative(m.app, r1.json<AuthTokensResponse>().refreshToken)).statusCode).toBe(200);
  });
});

// ───────────────────── 로그인 제한: 프록시·IPv6·아이디·IP·bcrypt ─────────────────────

function loginFrom(app: TestContext['app'], usrId: string, password: string, extra: { remoteAddress?: string; xff?: string } = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { usrId, password, platform: 'native' },
    ...(extra.remoteAddress ? { remoteAddress: extra.remoteAddress } : {}),
    ...(extra.xff ? { headers: { 'x-forwarded-for': extra.xff } } : {}),
  });
}

describe('TRUST_PROXY=1 (앞단 프록시 1대)', () => {
  let p: TestContext;
  beforeAll(async () => {
    p = await createTestApp({ env: { TRUST_PROXY: '1' } });
  });
  afterAll(async () => {
    await p?.close();
  });

  it('클라이언트가 X-Forwarded-For 앞부분을 바꿔 보내도 프록시가 붙인 주소로 세어 6번째 실패는 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await loginFrom(p.app, 'ckp_md5', 'wrong', { xff: `10.9.${i}.${i + 1}, 203.0.113.9` })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    // 다른 실제 클라이언트(프록시가 붙인 마지막 값이 다름)는 영향 없음
    expect((await loginFrom(p.app, 'ckp_md5', 'demo1234', { xff: '10.9.9.9, 198.51.100.7' })).statusCode).toBe(200);
  });
});

describe('로그인 실패 제한 — IPv6 대역 · 아이디 기준', () => {
  it('IPv6 는 /64 대역으로 묶어 센다 (대역 안에서 주소를 바꿔도 6번째 실패는 429)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await loginFrom(t.app, 'no_such_v6', 'wrong', { remoteAddress: `2001:db8:abcd:12::${(i + 1).toString(16)}` })).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await loginFrom(t.app, 'no_such_v6', 'wrong', { remoteAddress: '2001:db8:abcd:13::1' })).statusCode).toBe(401);
  });

  it('IP 를 바꿔 가며 20번 틀리면 그 아이디는 10분간 429 (맞는 비밀번호도), 10분 뒤 다시 가능', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await loginFrom(t.app, 'ckp_acct', 'wrong', { remoteAddress: `192.0.2.${i + 1}` })).statusCode).toBe(401);
    }
    const blocked = await loginFrom(t.app, 'ckp_acct', 'demo1234', { remoteAddress: '198.51.100.99' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().error.message).toMatch(/^로그인 시도가 너무 많습니다\. \d+분 후 다시 시도해 주세요\.$/);
    // 다른 아이디는 영향 없음
    expect((await loginFrom(t.app, 'ckp_md5', 'demo1234', { remoteAddress: '198.51.100.99' })).statusCode).toBe(200);
    t.clock.advance(10 * 60 * 1000 + 1000);
    expect((await loginFrom(t.app, 'ckp_acct', 'demo1234', { remoteAddress: '198.51.100.99' })).statusCode).toBe(200);
  });
});

describe('로그인 IP 한도 (LOGIN_IP_MAX_PER_MIN) · bcrypt 대기열', () => {
  let c: TestContext;
  beforeAll(async () => {
    c = await createTestApp({ env: { LOGIN_IP_MAX_PER_MIN: '30' } });
  });
  afterAll(async () => {
    await c?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('같은 IP 에서 아이디를 바꿔 가며 보내면 31번째는 bcrypt 없이 429, 다른 IP 는 그대로', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await loginFrom(c.app, `rnd${i}`, 'x')).statusCode);
    expect(codes.every((code) => code === 401)).toBe(true);
    const compare = vi.spyOn(bcryptjs, 'compare');
    const blocked = await loginFrom(c.app, 'rnd30', 'x');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(compare).not.toHaveBeenCalled();
    expect((await loginFrom(c.app, 'ckp_demo', 'demo1234', { remoteAddress: '198.51.100.20' })).statusCode).toBe(200);
  });

  it(`bcrypt 검증 대기열(동시 ${BCRYPT_MAX_CONCURRENCY} + 대기 ${BCRYPT_MAX_QUEUE})이 가득 차면 넘치는 로그인은 바로 429`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(bcryptjs, 'compare').mockImplementation((async () => {
      await gate;
      return false;
    }) as never);
    const extra = 4;
    let settled = 0;
    const pending = Array.from({ length: BCRYPT_MAX_CONCURRENCY + BCRYPT_MAX_QUEUE + extra }, (_, i) =>
      loginFrom(c.app, `busy${i}`, 'x', { remoteAddress: `100.64.${Math.floor(i / 200)}.${(i % 200) + 1}` }).then((r) => {
        settled += 1;
        return r;
      }),
    );
    await vi.waitFor(() => expect(settled).toBe(extra), { timeout: 15_000, interval: 20 });
    release();
    const results = await Promise.all(pending);
    const busy = results.filter((r) => r.statusCode === 429);
    expect(busy).toHaveLength(extra);
    expect(busy[0]!.json<ApiErrorBody>().error.message).toBe('로그인 요청이 많아 지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    expect(busy[0]!.headers['retry-after']).toBe('5');
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(BCRYPT_MAX_CONCURRENCY + BCRYPT_MAX_QUEUE);
  });
});

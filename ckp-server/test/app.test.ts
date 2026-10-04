/**
 * 앱 공통 배관 확인: multipart 제한, 파일 URL, 사용자 기준 rate limit 키, route deps.
 * (프로브 라우트는 app.ready() 전에 추가해야 하므로 buildApp 을 직접 호출한다)
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ApiErrorBody } from '../src/contract.js';
import { startDevDb, type DevDbHandle } from '../src/db/devdb.js';
import { checkSchema } from '../src/db/schema-check.js';
import { buildFileUrl } from '../src/lib/urls.js';
import { requireUser, userRateLimitKey } from '../src/plugins/auth.js';
import { LocalStorage } from '../src/storage/local.js';
import { testConfig } from './helpers.js';

let dev: DevDbHandle;
let app: FastifyInstance;

function multipart(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const boundary = `----ckp${randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  dev = await startDevDb({ dataDir: null, seed: true });
  app = await buildApp({
    config: testConfig({ PHOTO_MAX_BYTES: String(3 * 1024 * 1024) }),
    db: dev.db,
    storage: new LocalStorage(path.join(os.tmpdir(), 'ckp-test-unused')),
    capabilities: await checkSchema(dev.db),
    logger: false,
  });
  app.post('/v1/__upload', { onRequest: app.authenticate }, async (request) => {
    const user = requireUser(request);
    const file = await request.file();
    if (!file) return { none: true };
    const buf = await file.toBuffer();
    const cid = file.fields.clientPhotoId;
    const clientPhotoId = cid && 'value' in cid ? String(cid.value) : null;
    return { usrId: user.usrId, bytes: buf.length, mimetype: file.mimetype, clientPhotoId };
  });
  app.get('/v1/__url', async (request) => ({
    url: buildFileUrl(request, app.deps.config, app.deps.tokens.signFileToken({ k: 'e', id: 12, v: 'full', u: 'ckp_demo' })),
    key: await userRateLimitKey(app)(request),
    depsKeys: Object.keys(app.deps).sort(),
  }));
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await dev?.stop();
});

describe('multipart 업로드 제한', () => {
  it('JSON 1MB 제한과 무관하게 PHOTO_MAX_BYTES 까지 받는다', async () => {
    const { token } = await app.deps.tokens.issueAccessToken('ckp_demo');
    const id = randomUUID();
    const mp = multipart({ clientPhotoId: id }, { name: 'a.jpg', type: 'image/jpeg', data: Buffer.alloc(2 * 1024 * 1024, 1) });
    const res = await app.inject({ method: 'POST', url: '/v1/__upload', payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ usrId: 'ckp_demo', bytes: 2 * 1024 * 1024, mimetype: 'image/jpeg', clientPhotoId: id });
  });

  it('PHOTO_MAX_BYTES 초과는 413 FILE_TOO_LARGE 한국어 안내', async () => {
    const { token } = await app.deps.tokens.issueAccessToken('ckp_demo');
    const mp = multipart({ clientPhotoId: randomUUID() }, { name: 'big.jpg', type: 'image/jpeg', data: Buffer.alloc(3 * 1024 * 1024 + 10, 1) });
    const res = await app.inject({ method: 'POST', url: '/v1/__upload', payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(413);
    expect(res.json<ApiErrorBody>().error).toMatchObject({
      code: 'FILE_TOO_LARGE',
      message: '사진 용량이 너무 큽니다. 1장당 최대 3MB까지 올릴 수 있습니다.',
    });
  });

  it('multipart 가 아니면 415 한국어 안내', async () => {
    const { token } = await app.deps.tokens.issueAccessToken('ckp_demo');
    const res = await app.inject({ method: 'POST', url: '/v1/__upload', payload: { a: 1 }, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(415);
    expect(res.json<ApiErrorBody>().error.message).toBe('사진은 multipart/form-data 형식으로 보내야 합니다.');
  });

  it('인증은 본문 수신 전에 거부된다', async () => {
    const mp = multipart({}, { name: 'a.jpg', type: 'image/jpeg', data: Buffer.alloc(10) });
    const res = await app.inject({ method: 'POST', url: '/v1/__upload', payload: mp.payload, headers: mp.headers });
    expect(res.statusCode).toBe(401);
  });
});

describe('파일 URL · rate limit 키 · deps', () => {
  it('서명 URL 은 요청 Host 기준 절대 주소, 키는 토큰 사용자/IP', async () => {
    const anon = await app.inject({ method: 'GET', url: '/v1/__url', headers: { host: 'api.test:4000' } });
    const body = anon.json<{ url: string; key: string; depsKeys: string[] }>();
    expect(body.url).toMatch(/^http:\/\/api\.test:4000\/v1\/files\/[\w-]+\.[\w-]+$/);
    expect(body.key).toBe('ip:127.0.0.1');
    expect(body.depsKeys).toEqual(['capabilities', 'clock', 'config', 'dataSource', 'db', 'storage', 'tokens']);
    const token = body.url.split('/v1/files/')[1] as string;
    expect(app.deps.tokens.verifyFileToken(token)).toMatchObject({ k: 'e', id: 12, v: 'full', u: 'ckp_demo' });

    const { token: access } = await app.deps.tokens.issueAccessToken('ckp_md5');
    const authed = await app.inject({ method: 'GET', url: '/v1/__url', headers: { authorization: `Bearer ${access}` } });
    expect(authed.json<{ key: string }>().key).toBe('u:ckp_md5');
    const forged = await app.inject({ method: 'GET', url: '/v1/__url', headers: { authorization: 'Bearer x.y.z' } });
    expect(forged.json<{ key: string }>().key).toBe('ip:127.0.0.1');
  });

  it('등록된 라우트 접두어 (스텁 포함)', () => {
    const routes = app.printRoutes({ commonPrefix: false });
    for (const p of ['/v1/meta', '/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout', '/v1/auth/me', '/healthz']) {
      expect(routes).toContain(p);
    }
  });
});

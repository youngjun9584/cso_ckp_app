/**
 * 테스트 도우미 — 항상 인메모리 PGlite 개발 DB + 임시 폴더 로컬 저장소를 쓴다(실제 DB/S3 접속 없음).
 *
 *   let t: TestContext;
 *   beforeAll(async () => { t = await createTestApp(); });
 *   afterAll(async () => { await t.close(); });
 *
 *   const res = await t.app.inject({ method: 'GET', url: '/v1/medicines', headers: await t.authHeaders('ckp_demo') });
 *   const login = await t.loginAs('ckp_demo');            // 실제 /v1/auth/login 호출 (비밀번호 기본 demo1234)
 *   t.clock.advance(61_000);                               // 시계 이동 (토큰 만료·상태 캐시 확인)
 *   await t.db.query('UPDATE ...');                        // DB 직접 조작 (같은 pg.Pool 경로)
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AuthTokensResponse, ClientPlatform } from '../src/contract.js';
import { DEMO_PASSWORD } from '../src/db/dev-seed.js';
import { startDevDb, type DevDbHandle } from '../src/db/devdb.js';
import type { Db } from '../src/db/pool.js';
import { checkSchema, type Capabilities } from '../src/db/schema-check.js';
import { createTestClock, type TestClock } from '../src/lib/clock.js';
import { LocalStorage } from '../src/storage/local.js';

export { DEMO_PASSWORD };

export interface CreateTestAppOptions {
  /** 시계 시작 시각 (기본: 현재 시각 — DB now() 와 맞추기 위해) */
  now?: Date | string | number;
  /** 환경변수 형태의 설정 덮어쓰기 (예: { CLIENT_APPROVAL_REQUIRED_FOR_EDI: 'false' }) */
  env?: Record<string, string>;
  /** 샘플 데이터 (기본 true) */
  seed?: boolean;
  /** migrations/001 적용 (기본 true). false → SCHEMA_NOT_READY 확인용 */
  applyMigration?: boolean;
  /** migrations/002(refresh 토큰 기록) 적용 (기본: applyMigration 과 같음). false → 무상태(메모리) 방식 확인용 */
  refreshTokenTable?: boolean;
  /** 사용자 상태 캐시 TTL (기본 60초 — clock.advance 또는 app.userStatusCache.invalidate 로 우회) */
  authCacheTtlMs?: number;
}

export interface LoginResult extends AuthTokensResponse {
  headers: { authorization: string };
  /** web 로그인 시 Set-Cookie 로 받은 refresh 토큰 */
  refreshCookie?: string;
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  storage: LocalStorage;
  storageDir: string;
  config: AppConfig;
  clock: TestClock;
  capabilities: Capabilities;
  dev: DevDbHandle;
  /** /v1/auth/login 호출. 실패하면 오류를 던진다 */
  loginAs(usrId: string, password?: string, platform?: ClientPlatform): Promise<LoginResult>;
  /** 로그인 없이 access 토큰을 직접 발급해 Authorization 헤더를 만든다 */
  authHeaders(usrId: string): Promise<{ authorization: string }>;
  close(): Promise<void>;
}

/**
 * 테스트용 설정 (로컬 저장소·개발 DB·개발용 비밀키).
 * 모든 inject 요청은 같은 IP(127.0.0.1)에서 오므로 로그인 IP 한도(LOGIN_IP_MAX_PER_MIN)는 기본으로 크게 둔다
 * — 한도 자체를 확인하는 테스트는 env 로 직접 지정한다.
 */
export function testConfig(env: Record<string, string> = {}, storageDir = path.join(os.tmpdir(), 'ckp-test-unused')): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DEV_DB: 'pglite',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: storageDir,
    CORS_ORIGINS: 'http://localhost:8081',
    LOG_LEVEL: 'silent',
    LOGIN_IP_MAX_PER_MIN: '10000',
    ...env,
  });
}

export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestContext> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'ckp-test-'));
  const config = testConfig(opts.env, storageDir);
  const clock = createTestClock(opts.now ?? Date.now());
  const storage = new LocalStorage(storageDir);

  let dev: DevDbHandle | undefined;
  try {
    dev = await startDevDb({
      dataDir: null,
      seed: opts.seed ?? true,
      applyMigration: opts.applyMigration ?? true,
      ...(opts.refreshTokenTable !== undefined ? { applyRefreshTokenMigration: opts.refreshTokenTable } : {}),
      now: clock.now(),
      storage,
    });
    const capabilities = await checkSchema(dev.db);
    const app = await buildApp({
      config,
      db: dev.db,
      storage,
      capabilities,
      clock,
      dataSource: 'development',
      logger: false,
      ...(opts.authCacheTtlMs !== undefined ? { authCacheTtlMs: opts.authCacheTtlMs } : {}),
    });
    await app.ready();
    const handle = dev;

    return {
      app,
      db: dev.db,
      storage,
      storageDir,
      config,
      clock,
      capabilities,
      dev,
      async loginAs(usrId, password = DEMO_PASSWORD, platform = 'native') {
        const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { usrId, password, platform } });
        if (res.statusCode !== 200) throw new Error(`로그인 실패 (${usrId}): ${res.statusCode} ${res.body}`);
        const body = res.json<AuthTokensResponse>();
        const cookie = res.cookies.find((c) => c.name === 'ckp_rt');
        return {
          ...body,
          headers: { authorization: `Bearer ${body.accessToken}` },
          ...(cookie ? { refreshCookie: cookie.value } : {}),
        };
      },
      async authHeaders(usrId) {
        const { token } = await app.deps.tokens.issueAccessToken(usrId);
        return { authorization: `Bearer ${token}` };
      },
      async close() {
        await app.close().catch(() => undefined);
        await handle.stop();
        await rm(storageDir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  } catch (err) {
    await dev?.stop();
    await rm(storageDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

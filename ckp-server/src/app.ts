/**
 * buildApp(deps) — Fastify 인스턴스를 만든다 (index.ts 에서 listen, 테스트에서 app.inject()).
 *
 * ── 라우트 의존성 (RouteDeps) ─────────────────────────────────────────────
 * 모든 라우트 플러그인은 두 번째 인자 opts.deps 로 같은 객체를 받는다(app.deps 로도 접근 가능).
 *
 *   export default async function routes(app: FastifyInstance, opts: RouteOptions) {
 *     const { db, storage, config, capabilities, clock, tokens } = opts.deps;
 *     app.get('/', { onRequest: app.authenticate }, async (request) => {
 *       const user = requireUser(request);            // plugins/auth.ts
 *       const { rows } = await db.query<Row>('SELECT ... WHERE user_id = $1', [user.usrId]);
 *       ...
 *     });
 *   }
 *
 *   db           Db (db/pool.ts): query<T>(sql, params) → { rows, rowCount }, tx(async (q) => ...) — tx 안에서는 q 만 사용
 *   storage      Storage (storage/index.ts): put/getBuffer/getStream/delete/publicUrl/keyFromUrl
 *   config       AppConfig (config.ts): features, photo 제한, edi.dealType, storage.keyPrefix, legacyImageUrlPrefixes ...
 *   capabilities Capabilities (db/schema-check.ts): ediAppTables, ediIsCopy, clientHospitalType, freesTable, medicineTaxColumns ...
 *   clock        Clock (lib/clock.ts): clock.now() — 현재 시각은 반드시 여기서 얻는다(KST 계산은 lib/kst.ts)
 *   tokens       TokenService (lib/tokens.ts): signFileToken/verifyFileToken (+ access/refresh)
 *   dataSource   'production' | 'development' (/v1/meta)
 *
 * 라우트 접두어: meta → /v1/meta, auth → /v1/auth, medicines → /v1/medicines, notices → /v1/notices,
 *               clients → /v1/clients, edi → /v1/edi, files → /v1/files
 * 오류는 AppError 를 throw 하면 전역 처리기가 ApiErrorBody 로 응답한다(lib/errors.ts).
 * 입력 검증은 parseInput(zodSchema, request.body|query|params) (lib/validation.ts).
 * JSON 응답에는 기본 `Cache-Control: no-store` 가 붙는다(라우트가 직접 지정하면 그 값 유지).
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config.js';
import type { Capabilities } from './db/schema-check.js';
import type { Db } from './db/pool.js';
import { systemClock, type Clock } from './lib/clock.js';
import { AppError, registerErrorHandling } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { createTokenService, type TokenService } from './lib/tokens.js';
import { setupAuth } from './plugins/auth.js';
import type { Storage } from './storage/index.js';
import authRoutes from './routes/auth.js';
import clientsRoutes from './routes/clients.js';
import ediRoutes from './routes/edi.js';
import filesRoutes from './routes/files.js';
import medicinesRoutes from './routes/medicines.js';
import metaRoutes from './routes/meta.js';
import noticesRoutes from './routes/notices.js';

export type DataSource = 'production' | 'development';

export interface RouteDeps {
  config: AppConfig;
  db: Db;
  storage: Storage;
  capabilities: Capabilities;
  clock: Clock;
  tokens: TokenService;
  dataSource: DataSource;
}

/** 라우트 플러그인 옵션 (Fastify 가 넘기는 prefix 등 + deps) */
export interface RouteOptions {
  deps: RouteDeps;
  prefix?: string;
}

export type RoutePlugin = (app: FastifyInstance, opts: RouteOptions) => Promise<void>;

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  storage: Storage;
  capabilities: Capabilities;
  clock?: Clock;
  /** 기본: config.devDb.enabled 이면 'development' */
  dataSource?: DataSource;
  /** 기본: loggerOptions(config) */
  logger?: FastifyServerOptions['logger'];
  /** 사용자 상태 캐시 TTL (기본 60초) */
  authCacheTtlMs?: number;
  /** 테스트에서 토큰 서비스 교체 */
  tokens?: TokenService;
}

export const JSON_BODY_LIMIT = 1024 * 1024;

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const clock = opts.clock ?? systemClock;
  const tokens =
    opts.tokens ??
    createTokenService({
      jwtSecret: config.auth.jwtSecret,
      fileTokenSecret: config.auth.fileTokenSecret,
      accessTtlMin: config.auth.accessTtlMin,
      refreshTtlDays: config.auth.refreshTtlDays,
      clock,
    });
  const deps: RouteDeps = {
    config,
    db: opts.db,
    storage: opts.storage,
    capabilities: opts.capabilities,
    clock,
    tokens,
    dataSource: opts.dataSource ?? (config.devDb.enabled ? 'development' : 'production'),
  };

  // 숫자(n 번째 프록시까지 신뢰)는 Fastify 타입에 없어 함수로 바꿔 넘긴다
  const hops = config.trustProxy;
  const trustProxy = typeof hops === 'number' ? (_addr: string, hop: number) => hop < hops : hops;

  const app = Fastify({
    logger: opts.logger ?? loggerOptions(config),
    trustProxy,
    bodyLimit: JSON_BODY_LIMIT,
    requestIdHeader: false,
    return503OnClosing: true,
  });

  registerErrorHandling(app, { photoMaxBytes: config.photo.maxBytes });

  await app.register(fastifyHelmet, {
    // 웹 앱(다른 출처)이 /v1/files 이미지를 <img> 로 불러올 수 있어야 한다
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  const allowed = new Set(config.cors.origins);
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Origin 이 없는 요청(네이티브 앱, 서버 간 호출)은 CORS 대상이 아니다
      if (!origin) return cb(null, true);
      cb(null, allowed.has(origin.replace(/\/+$/, '')));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: 60_000,
    errorResponseBuilder: (_request, ctx) =>
      new AppError('RATE_LIMITED', undefined, {
        status: 429,
        details: { retryAfterSeconds: Math.max(1, Math.ceil(ctx.ttl / 1000)) },
      }),
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.photo.maxBytes,
      files: 1,
      fields: 10,
      fieldSize: 16 * 1024,
      parts: 12,
      headerPairs: 200,
    },
  });

  app.decorate('deps', deps);
  setupAuth(app, deps, opts.authCacheTtlMs !== undefined ? { cacheTtlMs: opts.authCacheTtlMs } : {});

  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));

  const routeOpts = (prefix: string): RouteOptions => ({ prefix, deps });
  await app.register(metaRoutes, routeOpts('/v1/meta'));
  await app.register(authRoutes, routeOpts('/v1/auth'));
  await app.register(medicinesRoutes, routeOpts('/v1/medicines'));
  await app.register(noticesRoutes, routeOpts('/v1/notices'));
  await app.register(clientsRoutes, routeOpts('/v1/clients'));
  await app.register(ediRoutes, routeOpts('/v1/edi'));
  await app.register(filesRoutes, routeOpts('/v1/files'));

  return app;
}

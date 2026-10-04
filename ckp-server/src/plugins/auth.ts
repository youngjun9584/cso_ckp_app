/**
 * Bearer 인증.
 *
 *   app.get('/x', { onRequest: app.authenticate }, async (request) => {
 *     const user = requireUser(request);    // AuthUser (usrId, name, companyName, phone, email, roleId)
 *   });
 *
 * - access 토큰(typ=access) 검증 → 사용자 상태(apr_yn)를 60초 캐시로 재확인 → 승인(Y)이 아니면 401 UNAUTHORIZED.
 * - app.userStatusCache.invalidate(usrId) 로 즉시 반영할 수 있다(테스트는 clock 을 61초 넘기거나 invalidate 사용).
 * - 업로드처럼 사용자 기준 rate limit 이 필요한 라우트는 userRateLimitKey(app) 를 keyGenerator 로 쓴다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../contract.js';
import type { RouteDeps } from '../app.js';
import type { Clock } from '../lib/clock.js';
import type { Queryable } from '../db/pool.js';
import { clientIpKey } from '../lib/client-ip.js';
import { AppError } from '../lib/errors.js';
import { TokenError } from '../lib/tokens.js';
import { approvalMessage, findUserStatus, isApproved, type AppUserRow } from '../services/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest/preHandler 훅: Bearer access 토큰 검증 후 request.user 설정 */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    userStatusCache: UserStatusCache;
    /** 라우트 공통 의존성 (buildApp 에서 설정) */
    deps: RouteDeps;
  }
  interface FastifyRequest {
    /** authenticate 통과 후 설정. 그 전에는 null */
    user: AuthUser | null;
  }
}

export const DEFAULT_USER_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  row: AppUserRow | null; // null = 계정 없음
  at: number;
}

/** 사용자 상태 캐시 (usrId → 최근 조회 결과) */
export class UserStatusCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly q: Queryable,
    private readonly clock: Clock,
    readonly ttlMs: number = DEFAULT_USER_CACHE_TTL_MS,
    private readonly maxEntries = 5_000,
  ) {}

  /** 캐시가 유효하면 캐시값, 아니면 DB 에서 다시 읽는다 */
  async get(usrId: string): Promise<AppUserRow | null> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(usrId);
    if (hit && this.ttlMs > 0 && now - hit.at < this.ttlMs) return hit.row;
    const row = await findUserStatus(this.q, usrId);
    this.set(usrId, row);
    return row;
  }

  set(usrId: string, row: AppUserRow | null): void {
    this.entries.delete(usrId);
    this.entries.set(usrId, { row, at: this.clock.now().getTime() });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  invalidate(usrId: string): void {
    this.entries.delete(usrId);
  }

  clear(): void {
    this.entries.clear();
  }
}

export function unauthorized(message: string, reason: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError('UNAUTHORIZED', message, { details: { reason, ...extra } });
}

export const AUTH_MESSAGES = {
  missing: '로그인이 필요합니다.',
  invalid: '로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.',
  expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  userNotFound: '계정을 찾을 수 없습니다. 다시 로그인해 주세요.',
} as const;

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? (m[1] as string) : null;
}

/** 승인 상태가 아닌 사용자 → 401 (메시지는 관리자 화면과 같은 문구) */
export function notApprovedError(aprYn: string | null): AppError {
  return unauthorized(approvalMessage(aprYn), 'ACCOUNT_NOT_APPROVED', { status: aprYn });
}

export interface SetupAuthOptions {
  cacheTtlMs?: number;
}

/** buildApp 에서 1회 호출 (루트 인스턴스에 데코레이터 등록 → 모든 라우트 플러그인에서 사용 가능) */
export function setupAuth(app: FastifyInstance, deps: RouteDeps, opts: SetupAuthOptions = {}): void {
  const cache = new UserStatusCache(deps.db, deps.clock, opts.cacheTtlMs ?? DEFAULT_USER_CACHE_TTL_MS);
  app.decorate('userStatusCache', cache);
  app.decorateRequest('user', null);
  app.decorate('authenticate', async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    const token = bearerToken(request);
    if (!token) throw unauthorized(AUTH_MESSAGES.missing, 'TOKEN_MISSING');
    let usrId: string;
    try {
      usrId = (await deps.tokens.verifyAccessToken(token)).usrId;
    } catch (err) {
      if (err instanceof TokenError && err.reason === 'expired') throw unauthorized(AUTH_MESSAGES.expired, 'TOKEN_EXPIRED');
      throw unauthorized(AUTH_MESSAGES.invalid, 'TOKEN_INVALID');
    }
    const row = await cache.get(usrId);
    if (!row) throw unauthorized(AUTH_MESSAGES.userNotFound, 'USER_NOT_FOUND');
    if (!isApproved(row.aprYn)) throw notApprovedError(row.aprYn);
    request.user = row.user;
  });
}

/** authenticate 이후 라우트에서 사용자 얻기 (없으면 401) */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized(AUTH_MESSAGES.missing, 'TOKEN_MISSING');
  return request.user;
}

/**
 * rate limit 키: 유효한 access 토큰이면 'u:<usrId>', 아니면 'ip:<ip>' (IPv6 는 /64 대역 — lib/client-ip.ts).
 * (서명을 검증하므로 다른 사용자의 키를 사칭해 한도를 소진시킬 수 없다)
 */
export function userRateLimitKey(app: FastifyInstance) {
  return async (request: FastifyRequest): Promise<string> => {
    const token = bearerToken(request);
    if (token) {
      try {
        return `u:${(await app.deps.tokens.verifyAccessToken(token)).usrId}`;
      } catch {
        // 아래 IP 기준
      }
    }
    return `ip:${clientIpKey(request.ip)}`;
  };
}

/**
 * 인증 라우트 (/v1/auth) — DESIGN §2.1, §3.1, §5.4
 *   POST /login    AuthTokensResponse (web: refresh 는 httpOnly 쿠키 ckp_rt)
 *   POST /refresh  AuthTokensResponse (refresh 토큰 재발급 포함, DB 에서 사용자 상태 재확인)
 *                  토큰 출처는 platform 으로만 정한다: web = 쿠키, native = 본문
 *   POST /logout   204 (쿠키 삭제, refresh 토큰 폐기 — ckp_app_refresh_token 이 있으면 DB·family 전체, 없으면 메모리)
 *   GET  /me       MeResponse
 *   GET  /check-id?usrId=  CheckUserIdResponse (인증 불필요) — 형식 오류 400 VALIDATION_FAILED(fields.usrId)
 *   POST /register         201 RegisterResponse (인증 불필요, 승인 대기 apr_yn='N' 등록, 토큰 발급 안 함 — domain/users/registration.ts)
 *                          400 VALIDATION_FAILED · 409 DUPLICATE_USER_ID · 403 REGISTRATION_DISABLED · 429 RATE_LIMITED
 *
 * 회원가입 보호 (메모리, 단일 프로세스 기준)
 *   - SELF_REGISTRATION_ENABLED=false 면 check-id·register 모두 본문을 읽기 전에 403
 *   - check-id: IP당 30회/분, register: IP당 REGISTER_IP_MAX_PER_10MIN(기본 5)회/10분(결과와 무관) — 본문 읽기 전에 거부
 *   - register 전체: 가입 완료 REGISTER_MAX_PER_HOUR(기본 100)건/시간 — 넘으면 429
 *   - 중복 확인 후에만 bcrypt 해시(동시 실행 제한 공유). 비밀번호·요청 본문은 로그에 남기지 않는다.
 *
 * 로그인 보호 (모두 메모리, 단일 프로세스 기준)
 *   - IP당 LOGIN_IP_MAX_PER_MIN(기본 30)회/분 — 아이디와 무관, 본문 읽기·bcrypt 전에 거부
 *   - IP+아이디당 10회/분 (DESIGN §5.3)
 *   - 실패: 아이디+IP 5회/10분, 아이디만 20회/10분(IP 를 바꿔 가며 시도해도 누적) → 429
 *   - bcrypt 동시 실행 제한(lib/password.ts) — 대기열이 가득 차면 429
 *   IP 는 TRUST_PROXY 로 계산한 신뢰 가능한 클라이언트 주소, IPv6 는 /64 대역(lib/client-ip.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteOptions } from '../app.js';
import type { AuthTokensResponse, AuthUser, CheckUserIdResponse, ClientPlatform, MeResponse, RegisterResponse } from '../contract.js';
import {
  CheckUserIdQuery,
  duplicateUserIdError,
  insertPendingUser,
  isUserIdTaken,
  REGISTER_MESSAGES,
  validateRegistration,
} from '../domain/users/registration.js';
import { LoginFailureLimiter } from '../lib/attempts.js';
import { clientIpKey } from '../lib/client-ip.js';
import { AppError } from '../lib/errors.js';
import { todayKst } from '../lib/kst.js';
import { dummyVerify, hashPassword, PasswordBusyError, verifyPassword } from '../lib/password.js';
import { TokenError } from '../lib/tokens.js';
import { parseInput } from '../lib/validation.js';
import { AUTH_MESSAGES, notApprovedError, requireUser, unauthorized } from '../plugins/auth.js';
import { createRefreshTokenStore, type IssuedRefresh } from '../services/refresh-tokens.js';
import { matchManagers } from '../services/managers.js';
import { approvalMessage, findUserForLogin, findUserStatus, isApproved } from '../services/users.js';

export const REFRESH_COOKIE = 'ckp_rt';
export const REFRESH_COOKIE_PATH = '/v1/auth';

/** 실패 제한: 아이디+IP / 아이디만 */
export const LOGIN_FAILURE_MAX_PER_IP = 5;
export const LOGIN_FAILURE_MAX_PER_ACCOUNT = 20;
const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BUSY_RETRY_SEC = 5;
const LOGIN_BUSY_MESSAGE = '로그인 요청이 많아 지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.';

/** 회원가입 제한 */
export const CHECK_ID_IP_MAX_PER_MIN = 30;
const REGISTER_IP_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_GLOBAL_KEY = 'all';
const REGISTER_BUSY_MESSAGE = '회원가입 요청이 많아 지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.';

const platformSchema = z.enum(['native', 'web'], { error: '플랫폼 값이 올바르지 않습니다.' }).default('native');

const LoginSchema = z.object({
  usrId: z.string({ error: '아이디를 입력해 주세요.' }).trim().min(1, '아이디를 입력해 주세요.').max(100, '아이디 또는 비밀번호가 올바르지 않습니다.'),
  password: z.string({ error: '비밀번호를 입력해 주세요.' }).min(1, '비밀번호를 입력해 주세요.').max(200, '아이디 또는 비밀번호가 올바르지 않습니다.'),
  platform: platformSchema,
});

const RefreshSchema = z.object({
  refreshToken: z.string().max(4096).optional(),
  platform: platformSchema,
});

function rateLimited(retryAfterSec: number, message?: string): AppError {
  const retry = Math.max(1, Math.ceil(retryAfterSec));
  return new AppError('RATE_LIMITED', message, {
    status: 429,
    details: { retryAfterSeconds: retry },
    headers: { 'retry-after': String(retry) },
  });
}

export default async function authRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { config, db, tokens, clock, capabilities } = opts.deps;
  const failures = new LoginFailureLimiter(clock, LOGIN_FAILURE_MAX_PER_IP, LOGIN_FAILURE_WINDOW_MS);
  const accountFailures = new LoginFailureLimiter(clock, LOGIN_FAILURE_MAX_PER_ACCOUNT, LOGIN_FAILURE_WINDOW_MS, 50_000);
  const refreshStore = createRefreshTokenStore({ db, tokens, clock, persistent: capabilities.refreshTokenTable });

  // IP 전체 한도는 route config.rateLimit(IP+아이디)과 별도로 createRateLimit 으로 센다
  // (app.rateLimit() 훅을 하나 더 달면 요청당 1회만 도는 플래그 때문에 둘 중 하나가 세지 않는다)
  const loginIpLimit = app.createRateLimit({
    max: config.auth.loginIpMaxPerMin,
    timeWindow: 60_000,
    keyGenerator: (request: FastifyRequest) => `login-ip:${clientIpKey(request.ip)}`,
  });

  // 회원가입: IP당 한도(요청 수, 결과 무관) + 서버 전체 가입 완료 수(시계 기준, 테스트에서 이동 가능)
  const registration = config.registration;
  const checkIdIpLimit = app.createRateLimit({
    max: CHECK_ID_IP_MAX_PER_MIN,
    timeWindow: 60_000,
    keyGenerator: (request: FastifyRequest) => `check-id-ip:${clientIpKey(request.ip)}`,
  });
  const registerIpLimit = app.createRateLimit({
    max: registration.ipMaxPer10Min,
    timeWindow: REGISTER_IP_WINDOW_MS,
    keyGenerator: (request: FastifyRequest) => `register-ip:${clientIpKey(request.ip)}`,
  });
  const registerGlobal = new LoginFailureLimiter(clock, registration.maxPerHour, REGISTER_GLOBAL_WINDOW_MS, 1);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
    secure: config.auth.cookieSecure,
  };

  function clearRefreshCookie(reply: FastifyReply) {
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);
  }

  async function issueTokens(reply: FastifyReply, user: AuthUser, platform: ClientPlatform, refresh: IssuedRefresh): Promise<AuthTokensResponse> {
    const access = await tokens.issueAccessToken(user.usrId);
    const body: AuthTokensResponse = {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      user,
    };
    if (platform === 'web') {
      reply.setCookie(REFRESH_COOKIE, refresh.token, { ...cookieOptions, maxAge: tokens.refreshTtlSec });
    } else {
      body.refreshToken = refresh.token;
    }
    return body;
  }

  /** 로그아웃 전용: 앱의 웹 로그아웃은 본문 없이(=native 로 해석) 쿠키만 보내므로 쿠키도 받아 폐기한다 */
  function logoutTokenFrom(request: FastifyRequest, platform: ClientPlatform, bodyToken: string | undefined): string | null {
    const cookieToken = request.cookies?.[REFRESH_COOKIE];
    const token = platform === 'web' ? (cookieToken ?? bodyToken) : (bodyToken ?? cookieToken);
    return token ? token : null;
  }

  /** bcrypt 대기열이 가득 차면 429 (실패 횟수에는 넣지 않는다) */
  async function passwordStep<T>(fn: () => Promise<T>, busyMessage: string = LOGIN_BUSY_MESSAGE): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PasswordBusyError) {
        throw rateLimited(LOGIN_BUSY_RETRY_SEC, busyMessage);
      }
      throw err;
    }
  }

  // ── 로그인 ──
  app.post(
    '/login',
    {
      // 본문을 읽기 전에 IP 전체 한도부터 확인한다(아이디를 바꿔 가며 보내는 요청의 bcrypt 비용 차단)
      onRequest: async (request) => {
        const r = await loginIpLimit(request);
        if (!r.isAllowed && r.isExceeded) {
          throw rateLimited(r.ttlInSeconds, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
        }
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60_000,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => {
            const raw = (request.body as { usrId?: unknown } | undefined)?.usrId;
            const id = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 100) : '';
            return `login:${clientIpKey(request.ip)}:${id}`;
          },
        },
      },
    },
    async (request, reply): Promise<AuthTokensResponse> => {
      const body = parseInput(LoginSchema, request.body ?? {});
      const usrId = body.usrId;
      const accountKey = usrId.toLowerCase();
      const failureKey = `${accountKey}|${clientIpKey(request.ip)}`;

      const retryAfter = Math.max(failures.retryAfterSec(failureKey), accountFailures.retryAfterSec(accountKey));
      if (retryAfter > 0) {
        const minutes = Math.max(1, Math.ceil(retryAfter / 60));
        throw rateLimited(retryAfter, `로그인 시도가 너무 많습니다. ${minutes}분 후 다시 시도해 주세요.`);
      }
      const recordFailure = () => {
        failures.recordFailure(failureKey);
        accountFailures.recordFailure(accountKey);
      };

      const found = await findUserForLogin(db, usrId);
      if (!found) {
        await passwordStep(() => dummyVerify());
        recordFailure();
        throw new AppError('INVALID_CREDENTIALS');
      }
      const check = await passwordStep(() => verifyPassword(body.password, found.passwordHash));
      if (!check.ok) {
        recordFailure();
        throw new AppError('INVALID_CREDENTIALS');
      }
      failures.reset(failureKey);
      accountFailures.reset(accountKey);

      if (!isApproved(found.aprYn)) {
        throw new AppError('ACCOUNT_NOT_APPROVED', approvalMessage(found.aprYn), { details: { status: found.aprYn } });
      }

      if (config.auth.passwordRehashOnLogin && check.scheme === 'md5') {
        try {
          const hashed = await hashPassword(body.password);
          await db.query('UPDATE public.sys_app_usr_mng SET usr_pwd = $1 WHERE usr_id = $2', [hashed, found.user.usrId]);
        } catch (err) {
          request.log.warn({ err }, '비밀번호 재해시 실패 (로그인은 계속 진행)');
        }
      }

      await matchManagers(db, found.user.usrId);
      app.userStatusCache.set(found.user.usrId, { user: found.user, aprYn: found.aprYn });
      const refresh = await refreshStore.issueForLogin(found.user.usrId);
      return issueTokens(reply, found.user, body.platform, refresh);
    },
  );

  // ── 토큰 재발급 ──
  app.post('/refresh', async (request, reply): Promise<AuthTokensResponse> => {
    const body = parseInput(RefreshSchema, request.body ?? {});
    // web 은 httpOnly 쿠키만, native 는 본문만 본다. native 로 쿠키를 받아 본문에 돌려주면 웹 페이지의 JS 가
    // refresh 토큰을 읽을 수 있게 되므로(DESIGN §3.1 위반) 서로 섞지 않는다.
    const token = body.platform === 'web' ? (request.cookies?.[REFRESH_COOKIE] || null) : (body.refreshToken || null);
    const fail = (err: AppError): never => {
      if (body.platform === 'web') clearRefreshCookie(reply);
      throw err;
    };
    if (!token) return fail(unauthorized(AUTH_MESSAGES.missing, 'REFRESH_MISSING'));

    let claims;
    try {
      claims = await tokens.verifyRefreshToken(token);
    } catch (err) {
      const expired = err instanceof TokenError && err.reason === 'expired';
      return fail(unauthorized(expired ? AUTH_MESSAGES.expired : AUTH_MESSAGES.invalid, expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'));
    }

    // refresh 는 캐시를 쓰지 않고 항상 DB 에서 상태를 다시 확인한다
    const row = await findUserStatus(db, claims.usrId);
    app.userStatusCache.set(claims.usrId, row);
    if (!row) return fail(unauthorized(AUTH_MESSAGES.userNotFound, 'USER_NOT_FOUND'));
    if (!isApproved(row.aprYn)) return fail(notApprovedError(row.aprYn));

    const rotated = await refreshStore.rotate(token, claims);
    if (!rotated.ok) {
      if (rotated.reason === 'reused') {
        request.log.warn({ usrId: claims.usrId }, 'refresh 토큰 재사용 감지 — 같은 로그인에서 발급된 토큰을 모두 폐기했습니다');
      }
      if (rotated.reason === 'unknown') return fail(unauthorized(AUTH_MESSAGES.invalid, 'TOKEN_INVALID'));
      return fail(unauthorized(AUTH_MESSAGES.expired, 'TOKEN_REVOKED'));
    }
    await matchManagers(db, row.user.usrId);
    return issueTokens(reply, row.user, body.platform, rotated.next);
  });

  // ── 로그아웃 ──
  app.post('/logout', async (request, reply) => {
    const raw = (request.body ?? {}) as { refreshToken?: unknown; platform?: unknown };
    const platform: ClientPlatform = raw.platform === 'web' ? 'web' : 'native';
    const bodyToken = typeof raw.refreshToken === 'string' ? raw.refreshToken : undefined;
    const token = logoutTokenFrom(request, platform, bodyToken);
    if (token) {
      let claims;
      try {
        claims = await tokens.verifyRefreshToken(token);
      } catch {
        claims = null; // 이미 만료·위조된 토큰은 무시
      }
      if (claims) {
        try {
          await refreshStore.revoke(token, claims);
        } catch (err) {
          request.log.warn({ err }, 'refresh 토큰 폐기 실패 (로그아웃은 계속 진행)');
        }
      }
    }
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  // ── 내 정보 ──
  app.get('/me', { onRequest: app.authenticate }, async (request): Promise<MeResponse> => ({ user: requireUser(request) }));

  // ── 회원가입 ──
  function ensureRegistrationEnabled(): void {
    if (!registration.enabled) throw new AppError('REGISTRATION_DISABLED');
  }

  // 아이디 중복 확인 (대소문자·앞뒤 공백 무시)
  app.get(
    '/check-id',
    {
      onRequest: async (request) => {
        ensureRegistrationEnabled();
        const r = await checkIdIpLimit(request);
        if (!r.isAllowed && r.isExceeded) {
          throw rateLimited(r.ttlInSeconds, '아이디 확인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
        }
      },
    },
    async (request): Promise<CheckUserIdResponse> => {
      const { usrId } = parseInput(CheckUserIdQuery, request.query ?? {});
      const taken = await isUserIdTaken(db, usrId);
      return { usrId, available: !taken, message: taken ? REGISTER_MESSAGES.idTaken : REGISTER_MESSAGES.idAvailable };
    },
  );

  // 가입 신청 (승인 대기)
  app.post(
    '/register',
    {
      // 꺼져 있거나 IP 한도를 넘으면 본문을 읽기 전에 거부한다
      onRequest: async (request) => {
        ensureRegistrationEnabled();
        const r = await registerIpLimit(request);
        if (!r.isAllowed && r.isExceeded) {
          const minutes = Math.max(1, Math.ceil(r.ttlInSeconds / 60));
          throw rateLimited(r.ttlInSeconds, `회원가입 요청이 너무 많습니다. ${minutes}분 후 다시 시도해 주세요.`);
        }
      },
    },
    async (request, reply): Promise<RegisterResponse> => {
      const input = validateRegistration(request.body ?? {});

      const globalRetry = registerGlobal.retryAfterSec(REGISTER_GLOBAL_KEY);
      if (globalRetry > 0) {
        throw rateLimited(globalRetry, '지금은 회원가입 신청이 많아 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }

      // bcrypt 비용을 쓰기 전에 먼저 확인 (최종 확인은 insertPendingUser 의 잠금 안에서 다시 한다)
      if (await isUserIdTaken(db, input.usrId)) throw duplicateUserIdError();

      const passwordHash = await passwordStep(() => hashPassword(input.password), REGISTER_BUSY_MESSAGE);
      await insertPendingUser(db, input, {
        passwordHash,
        roleId: registration.roleId,
        joinYmd: todayKst(clock.now()),
      });
      registerGlobal.recordFailure(REGISTER_GLOBAL_KEY); // 가입 완료 1건 기록 (이름은 실패 카운터지만 시간창 계수기로 사용)
      app.userStatusCache.invalidate(input.usrId);
      request.log.info({ usrId: input.usrId, roleId: registration.roleId }, '앱 회원가입 신청 등록 (승인 대기)');

      reply.status(201);
      return { usrId: input.usrId, status: 'pending', message: REGISTER_MESSAGES.registered };
    },
  );
}

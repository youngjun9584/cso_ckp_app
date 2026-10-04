/**
 * 토큰
 *  - access / refresh: JWT HS256(jose), typ 클레임으로 구분. 만료 판단은 주입된 clock 기준.
 *    refresh 는 ckp_app_refresh_token 테이블(migrations/002)이 있으면 DB 에 기록되고(st=1 클레임), 없으면 무상태.
 *  - 파일(이미지) 토큰: HMAC-SHA256 서명 + 만료(기본 1시간). 형식 `<base64url(payload)>.<base64url(sig)>`
 *    payload = { k:'u'|'e', id, v:'thumb'|'full', u:usrId, exp(유닉스 초) }
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Clock } from './clock.js';

const ISSUER = 'ckp-server';
const AUDIENCE = 'ckp-app';

export type TokenType = 'access' | 'refresh';

export interface AccessClaims {
  usrId: string;
  typ: 'access';
  exp: number;
}

export interface RefreshClaims {
  usrId: string;
  typ: 'refresh';
  jti: string;
  exp: number;
  /** DB(ckp_app_refresh_token)에 기록하며 발급한 토큰인지 (st=1 클레임) */
  stored: boolean;
}

export interface IssueRefreshOptions {
  /** DB 에 기록하는 방식으로 발급 (st=1 클레임) */
  stored?: boolean;
}

export type FileTokenKind = 'u' | 'e'; // u: 업로드 원장(ckp_app_edi_upload), e: edi 행
export type FileTokenVariant = 'thumb' | 'full';

export interface FileTokenPayload {
  k: FileTokenKind;
  /** 'u' → upload_id(uuid), 'e' → edi.idx(숫자 문자열 또는 숫자) */
  id: string | number;
  v: FileTokenVariant;
  u: string; // usrId
  exp: number; // 유닉스 초
}

export class TokenError extends Error {
  readonly reason: 'expired' | 'invalid';
  constructor(reason: 'expired' | 'invalid', message?: string) {
    super(message ?? reason);
    this.name = 'TokenError';
    this.reason = reason;
  }
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export interface TokenService {
  issueAccessToken(usrId: string): Promise<IssuedToken>;
  issueRefreshToken(usrId: string, opts?: IssueRefreshOptions): Promise<IssuedToken & { jti: string }>;
  /** 실패 시 TokenError */
  verifyAccessToken(token: string): Promise<AccessClaims>;
  /** 실패 시 TokenError */
  verifyRefreshToken(token: string): Promise<RefreshClaims>;
  /** 파일 토큰 서명. ttlSec 기본 3600 */
  signFileToken(payload: Omit<FileTokenPayload, 'exp'>, ttlSec?: number): string;
  /** 유효하면 payload, 위조·만료·형식 오류면 null */
  verifyFileToken(token: string): FileTokenPayload | null;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;
}

export interface TokenServiceOptions {
  jwtSecret: string;
  fileTokenSecret: string;
  accessTtlMin: number;
  refreshTtlDays: number;
  clock: Clock;
}

export const FILE_TOKEN_DEFAULT_TTL_SEC = 3600;

export function createTokenService(opts: TokenServiceOptions): TokenService {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const accessTtlSec = opts.accessTtlMin * 60;
  const refreshTtlSec = opts.refreshTtlDays * 24 * 60 * 60;
  const nowSec = () => Math.floor(opts.clock.now().getTime() / 1000);

  async function sign(usrId: string, typ: TokenType, ttlSec: number, jti?: string, extra: Record<string, unknown> = {}): Promise<IssuedToken> {
    const iat = nowSec();
    const exp = iat + ttlSec;
    const jwt = new SignJWT({ ...extra, typ })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(usrId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp);
    if (jti) jwt.setJti(jti);
    return { token: await jwt.sign(key), expiresAt: new Date(exp * 1000) };
  }

  async function verify(token: string, typ: TokenType) {
    if (!token || token.length > 4096) throw new TokenError('invalid');
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: opts.clock.now(),
        clockTolerance: 5,
      });
      if (payload.typ !== typ || typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number') {
        throw new TokenError('invalid');
      }
      return payload as typeof payload & { sub: string; exp: number };
    } catch (err) {
      if (err instanceof TokenError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw new TokenError('expired');
      throw new TokenError('invalid');
    }
  }

  function hmac(data: string): Buffer {
    return createHmac('sha256', opts.fileTokenSecret).update(data).digest();
  }

  return {
    accessTtlSec,
    refreshTtlSec,
    issueAccessToken: (usrId) => sign(usrId, 'access', accessTtlSec),
    async issueRefreshToken(usrId, issueOpts = {}) {
      const jti = randomUUID();
      const issued = await sign(usrId, 'refresh', refreshTtlSec, jti, issueOpts.stored ? { st: 1 } : {});
      return { ...issued, jti };
    },
    async verifyAccessToken(token) {
      const p = await verify(token, 'access');
      return { usrId: p.sub, typ: 'access', exp: p.exp };
    },
    async verifyRefreshToken(token) {
      const p = await verify(token, 'refresh');
      if (typeof p.jti !== 'string') throw new TokenError('invalid');
      return { usrId: p.sub, typ: 'refresh', jti: p.jti, exp: p.exp, stored: p.st === 1 };
    },
    signFileToken(payload, ttlSec = FILE_TOKEN_DEFAULT_TTL_SEC) {
      const full: FileTokenPayload = { k: payload.k, id: payload.id, v: payload.v, u: payload.u, exp: nowSec() + ttlSec };
      const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
      return `${body}.${hmac(body).toString('base64url')}`;
    },
    verifyFileToken(token) {
      if (typeof token !== 'string' || token.length > 1024) return null;
      const dot = token.indexOf('.');
      if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
      const body = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
      const expected = hmac(body);
      const given = Buffer.from(sig, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (!isFilePayload(parsed)) return null;
      if (parsed.exp < nowSec()) return null;
      return parsed;
    },
  };
}

function isFilePayload(v: unknown): v is FileTokenPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.k === 'u' || o.k === 'e') &&
    (typeof o.id === 'string' || typeof o.id === 'number') &&
    (o.v === 'thumb' || o.v === 'full') &&
    typeof o.u === 'string' &&
    typeof o.exp === 'number'
  );
}

/**
 * 파일 토큰으로 이미지 URL 을 만든다. baseUrl 이 없으면 상대 경로('/v1/files/<token>')를 반환한다.
 * 라우트에서는 buildFileUrl(request, token) (app.ts) 사용을 권장.
 */
export function fileUrlFromToken(token: string, baseUrl?: string | null): string {
  const path = `/v1/files/${token}`;
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
}

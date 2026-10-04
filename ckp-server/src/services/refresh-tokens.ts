/**
 * refresh 토큰 발급·재발급·폐기 (DESIGN §3.1 — JWT refresh 14일)
 *
 * DbRefreshTokenStore — ckp_app_refresh_token 테이블(migrations/002, 선택)이 있을 때
 *   - 로그인: 새 family(로그인 1회) 로 발급하고 기록한다. 토큰 원문 대신 sha256 만 저장.
 *   - 재발급(rotation): 제시된 토큰을 폐기(revoked_at, replaced_by)하고 같은 family 로 새 토큰 발급 (한 트랜잭션).
 *       · 재발급으로 폐기된 지 REFRESH_REUSE_GRACE_MS(60초) 안이고 그 후속 토큰이 아직 살아 있으면
 *         (웹 탭 여러 개의 동시 재발급, 응답 유실 직후 재시도) 같은 family 로 하나 더 발급한다.
 *       · 그 밖에 폐기된 토큰이 다시 오면 유출로 보고 family 전체를 폐기한다(재사용 감지) → 401.
 *       · 테이블 적용 전(무상태)에 발급된 토큰(st 클레임 없음·기록 없음)은 한 번만 새 family 로 옮기고 원래 토큰은 폐기 기록.
 *   - 로그아웃: 제시된 토큰의 family 전체 폐기. 재시작해도 유지된다.
 *   - 만료 후 1일 지난 기록은 로그인 때 가끔(6시간마다) 지운다.
 *
 * MemoryRefreshTokenStore — 테이블이 없을 때(기존 무상태 방식 그대로)
 *   - 재발급해도 이전 토큰은 만료까지 유효. 로그아웃한 토큰(jti)만 메모리에 기억(서버 재시작 시 초기화).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../db/pool.js';
import { RevokedTokenStore } from '../lib/attempts.js';
import type { Clock } from '../lib/clock.js';
import type { RefreshClaims, TokenService } from '../lib/tokens.js';

export const REFRESH_REUSE_GRACE_MS = 60_000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRUNE_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface IssuedRefresh {
  token: string;
  jti: string;
  expiresAt: Date;
}

export type RefreshRotateResult =
  | { ok: true; next: IssuedRefresh }
  /** revoked: 로그아웃 등으로 폐기됨 / reused: 폐기된 토큰 재사용 → family 폐기 / unknown: 기록 없음 */
  | { ok: false; reason: 'revoked' | 'reused' | 'unknown' };

export interface RefreshTokenStore {
  /** true: DB 기록(재시작 후에도 폐기 유지) / false: 무상태 + 메모리 */
  readonly persistent: boolean;
  /** 로그인 성공 → 새 family 로 발급 */
  issueForLogin(usrId: string): Promise<IssuedRefresh>;
  /** 재발급: 제시된 토큰(서명·만료 검증 완료)을 소비하고 다음 토큰을 발급 */
  rotate(token: string, claims: RefreshClaims): Promise<RefreshRotateResult>;
  /** 로그아웃: DB 방식은 family 전체, 메모리 방식은 그 토큰만 폐기 */
  revoke(token: string, claims: RefreshClaims): Promise<void>;
}

/** 저장용 해시 (토큰 원문은 DB 에 남기지 않는다) */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface RefreshTokenStoreDeps {
  db: Db;
  tokens: TokenService;
  clock: Clock;
  /** capabilities.refreshTokenTable */
  persistent: boolean;
}

export function createRefreshTokenStore(deps: RefreshTokenStoreDeps): RefreshTokenStore {
  return deps.persistent ? new DbRefreshTokenStore(deps.db, deps.tokens, deps.clock) : new MemoryRefreshTokenStore(deps.tokens, deps.clock);
}

// ───────────────────────── 메모리(무상태) ─────────────────────────

export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly persistent = false;
  private readonly revoked: RevokedTokenStore;

  constructor(
    private readonly tokens: TokenService,
    clock: Clock,
  ) {
    this.revoked = new RevokedTokenStore(clock);
  }

  issueForLogin(usrId: string): Promise<IssuedRefresh> {
    return this.tokens.issueRefreshToken(usrId);
  }

  async rotate(_token: string, claims: RefreshClaims): Promise<RefreshRotateResult> {
    if (this.revoked.isRevoked(claims.jti)) return { ok: false, reason: 'revoked' };
    return { ok: true, next: await this.tokens.issueRefreshToken(claims.usrId) };
  }

  async revoke(_token: string, claims: RefreshClaims): Promise<void> {
    this.revoked.revoke(claims.jti, claims.exp);
  }
}

// ───────────────────────── DB (migrations/002) ─────────────────────────

interface TokenRow {
  token_id: string;
  usr_id: string;
  family_id: string;
  revoked_at: Date | null;
  replaced_by: string | null;
}

const TABLE = 'public.ckp_app_refresh_token';

export class DbRefreshTokenStore implements RefreshTokenStore {
  readonly persistent = true;
  private lastPruneAt = 0;

  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  private async issue(q: Queryable, usrId: string, familyId: string): Promise<IssuedRefresh> {
    const issued = await this.tokens.issueRefreshToken(usrId, { stored: true });
    await q.query(
      `INSERT INTO ${TABLE} (token_id, usr_id, family_id, token_hash, issued_at, expires_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)`,
      [issued.jti, usrId, familyId, hashRefreshToken(issued.token), this.clock.now(), issued.expiresAt],
    );
    return issued;
  }

  private async revokeFamily(q: Queryable, familyId: string, now: Date): Promise<void> {
    await q.query(`UPDATE ${TABLE} SET revoked_at = $2 WHERE family_id = $1::uuid AND revoked_at IS NULL`, [familyId, now]);
  }

  /** 기록 없는 무상태 시절 토큰을 폐기 상태로 남긴다(이후 재사용하면 family 폐기) */
  private async recordLegacyRevoked(q: Queryable, token: string, claims: RefreshClaims, familyId: string, now: Date, replacedBy: string | null) {
    await q.query(
      `INSERT INTO ${TABLE} (token_id, usr_id, family_id, token_hash, issued_at, expires_at, revoked_at, replaced_by)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $5, $7::uuid)
       ON CONFLICT DO NOTHING`,
      [claims.jti, claims.usrId, familyId, hashRefreshToken(token), now, new Date(claims.exp * 1000), replacedBy],
    );
  }

  private async maybePrune(): Promise<void> {
    const now = this.clock.now().getTime();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    try {
      await this.db.query(`DELETE FROM ${TABLE} WHERE expires_at < $1`, [new Date(now - PRUNE_AFTER_EXPIRY_MS)]);
    } catch {
      // 정리는 다음 기회에 (로그인에는 영향 없음)
    }
  }

  async issueForLogin(usrId: string): Promise<IssuedRefresh> {
    await this.maybePrune();
    return this.issue(this.db, usrId, randomUUID());
  }

  async rotate(token: string, claims: RefreshClaims): Promise<RefreshRotateResult> {
    const hash = hashRefreshToken(token);
    const now = this.clock.now();
    return this.db.tx(async (q): Promise<RefreshRotateResult> => {
      const { rows } = await q.query<TokenRow>(
        `SELECT token_id::text AS token_id, usr_id, family_id::text AS family_id, revoked_at, replaced_by::text AS replaced_by
           FROM ${TABLE} WHERE token_hash = $1 FOR UPDATE`,
        [hash],
      );
      const row = rows[0];
      if (!row) {
        if (claims.stored) return { ok: false, reason: 'unknown' };
        // 테이블 적용 전에 발급된 토큰: 새 family 로 한 번만 옮긴다
        const familyId = randomUUID();
        const next = await this.issue(q, claims.usrId, familyId);
        await this.recordLegacyRevoked(q, token, claims, familyId, now, next.jti);
        return { ok: true, next };
      }
      if (row.token_id !== claims.jti.toLowerCase() || row.usr_id !== claims.usrId) return { ok: false, reason: 'unknown' };

      if (row.revoked_at) {
        if (await this.withinReuseGrace(q, row, now)) return { ok: true, next: await this.issue(q, row.usr_id, row.family_id) };
        await this.revokeFamily(q, row.family_id, now);
        return { ok: false, reason: 'reused' };
      }

      const next = await this.issue(q, row.usr_id, row.family_id);
      await q.query(`UPDATE ${TABLE} SET revoked_at = $2, replaced_by = $3::uuid WHERE token_id = $1::uuid`, [row.token_id, now, next.jti]);
      return { ok: true, next };
    });
  }

  /** 방금(60초 안) 재발급으로 폐기됐고, 그 후속 토큰이 아직 폐기되지 않았는가 (로그아웃·재사용 감지 뒤에는 false) */
  private async withinReuseGrace(q: Queryable, row: TokenRow, now: Date): Promise<boolean> {
    if (!row.revoked_at || !row.replaced_by) return false;
    if (now.getTime() - row.revoked_at.getTime() >= REFRESH_REUSE_GRACE_MS) return false;
    const { rows } = await q.query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM ${TABLE} WHERE token_id = $1::uuid`, [row.replaced_by]);
    return rows.length > 0 && rows[0]?.revoked_at === null;
  }

  async revoke(token: string, claims: RefreshClaims): Promise<void> {
    const now = this.clock.now();
    const { rows } = await this.db.query<{ family_id: string }>(`SELECT family_id::text AS family_id FROM ${TABLE} WHERE token_hash = $1`, [
      hashRefreshToken(token),
    ]);
    const familyId = rows[0]?.family_id;
    if (familyId) {
      await this.revokeFamily(this.db, familyId, now);
      return;
    }
    if (!claims.stored) await this.recordLegacyRevoked(this.db, token, claims, randomUUID(), now, null);
  }
}

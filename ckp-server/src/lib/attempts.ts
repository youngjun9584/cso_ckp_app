/**
 * 메모리 기반 카운터 (단일 프로세스 기준 — 여러 대로 확장 시 공유 저장소 필요)
 *  - LoginFailureLimiter: 최근 windowMs 안의 실패가 max 이상이면 차단
 *  - RevokedTokenStore: 로그아웃한 refresh 토큰(jti)을 만료 시각까지 기억 (ckp_app_refresh_token 테이블이 없을 때만 사용)
 *  - ConcurrencyLimiter: 동시 실행 수 제한(bcrypt 등 CPU 작업)
 */
import type { Clock } from './clock.js';

export class LoginFailureLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly max = 5,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly maxKeys = 10_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  /** 차단 중이면 남은 초, 아니면 0 */
  retryAfterSec(key: string): number {
    const now = this.clock.now().getTime();
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    const oldestRelevant = list[list.length - this.max] as number;
    return Math.max(1, Math.ceil((oldestRelevant + this.windowMs - now) / 1000));
  }

  recordFailure(key: string): void {
    const now = this.clock.now().getTime();
    const list = this.recent(key, now);
    list.push(now);
    this.failures.delete(key);
    this.failures.set(key, list);
    if (this.failures.size > this.maxKeys) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export class RevokedTokenStore {
  private readonly revoked = new Map<string, number>(); // jti → 만료(ms)

  constructor(
    private readonly clock: Clock,
    private readonly maxKeys = 50_000,
  ) {}

  revoke(jti: string, expSec: number): void {
    this.prune();
    this.revoked.set(jti, expSec * 1000);
    if (this.revoked.size > this.maxKeys) {
      const oldest = this.revoked.keys().next().value;
      if (oldest !== undefined) this.revoked.delete(oldest);
    }
  }

  isRevoked(jti: string): boolean {
    const exp = this.revoked.get(jti);
    return exp !== undefined && exp > this.clock.now().getTime();
  }

  private prune(): void {
    const now = this.clock.now().getTime();
    for (const [k, exp] of this.revoked) if (exp <= now) this.revoked.delete(k);
  }
}

/**
 * 동시 실행 제한 (세마포어 + 길이 제한 대기열).
 *   const slot = limiter.tryAcquire();       // 대기열까지 가득 차면 null
 *   if (!slot) throw ...;
 *   await slot.ready;                        // 차례가 올 때까지 대기
 *   try { ... } finally { slot.done(); }     // 반드시 1회 호출
 */
export interface ConcurrencySlot {
  ready: Promise<void>;
  done(): void;
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    readonly maxConcurrent: number,
    readonly maxQueue: number,
  ) {}

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  tryAcquire(): ConcurrencySlot | null {
    let ready: Promise<void>;
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      ready = Promise.resolve();
    } else if (this.waiters.length < this.maxQueue) {
      ready = new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      return null;
    }
    let released = false;
    return {
      ready,
      done: () => {
        if (released) return;
        released = true;
        const next = this.waiters.shift();
        if (next) next(); // 자리를 다음 대기자에게 그대로 넘긴다(active 유지)
        else this.active -= 1;
      },
    };
  }
}

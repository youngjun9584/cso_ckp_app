/**
 * pg.Pool 래퍼.
 *
 *   const { rows } = await db.query<{ name: string }>('SELECT name FROM medicine WHERE medicine_code = $1', [code]);
 *   const result = await db.tx(async (q) => {           // 트랜잭션: 안에서는 반드시 q 만 사용한다
 *     await q.query('INSERT ...', [...]);
 *     return (await q.query('SELECT ...')).rows;
 *   });
 *
 * 타입 변환(모든 연결 공통):
 *   date(1082)·timestamp(1114) → 원문 문자열 그대로 ('YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss') — JS Date 변환으로 날짜가 밀리는 문제 방지
 *   int8(20, count(*) 등) → number
 *   timestamptz(1184) → Date (절대 시각). 응답에는 SQL 에서 to_char(... AT TIME ZONE 'Asia/Seoul') 로 만든 문자열을 쓴다.
 */
import pg from 'pg';
import type { DatabaseSslMode } from '../config.js';

export interface QueryResultLite<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResultLite<T>>;
}

export interface Db extends Queryable {
  /** fn 안의 모든 쿼리는 인자로 받은 q 로 실행해야 한다(같은 연결·같은 트랜잭션). 예외 시 ROLLBACK. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** 내부 pg.Pool (스크립트·진단용) */
  readonly pool: pg.Pool;
}

const PG_TYPES = {
  INT8: 20,
  DATE: 1082,
  TIMESTAMP: 1114,
} as const;

/** 이 풀 전용 타입 파서 (전역 pg.types 는 건드리지 않는다) */
const customTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format === undefined || format === 'text') {
      if (oid === PG_TYPES.DATE || oid === PG_TYPES.TIMESTAMP) return (v: string) => v;
      if (oid === PG_TYPES.INT8) return (v: string) => Number(v);
    }
    return pg.types.getTypeParser(oid, format ?? 'text');
  },
} as unknown as pg.CustomTypesConfig; // pg 의 타입 정의가 오버로드 형태라 단일 함수 구현을 캐스팅한다

export interface CreateDbOptions {
  connectionString: string;
  ssl?: DatabaseSslMode;
  max?: number;
  /** 연결 대기 제한(ms). 풀이 가득 차 있으면 이 시간 후 오류 */
  connectionTimeoutMillis?: number;
  /** 유휴 연결 종료(ms). 0 이면 닫지 않음 */
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  applicationName?: string;
  onError?: (err: Error) => void;
}

/** DATABASE_URL 의 sslmode 등 SSL 파라미터를 제거한다(DATABASE_SSL 설정이 우선하도록). */
export function stripSslParams(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    for (const k of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return connectionString;
  }
}

function sslOption(mode: DatabaseSslMode | undefined): pg.PoolConfig['ssl'] {
  if (mode === 'require') return { rejectUnauthorized: false }; // libpq 'require' 와 동일: 암호화만, 인증서 검증 안 함
  if (mode === 'verify-full') return { rejectUnauthorized: true }; // CA 는 NODE_EXTRA_CA_CERTS 로 추가
  return false;
}

class TxClosedError extends Error {
  constructor() {
    super('트랜잭션이 이미 끝난 뒤 쿼리를 실행하려 했습니다.');
    this.name = 'TxClosedError';
  }
}

export function wrapPool(pool: pg.Pool): Db {
  return {
    pool,
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let open = true;
      const q: Queryable = {
        async query<R>(sql: string, params: readonly unknown[] = []) {
          if (!open) throw new TxClosedError();
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
      };
      let releaseErr: Error | undefined;
      try {
        await client.query('BEGIN');
        const result = await fn(q);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          releaseErr = rollbackErr as Error; // 연결이 망가졌으면 풀에서 폐기
        }
        throw err;
      } finally {
        open = false;
        client.release(releaseErr);
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export function createDb(opts: CreateDbOptions): Db {
  const pool = new pg.Pool({
    connectionString: stripSslParams(opts.connectionString),
    ssl: sslOption(opts.ssl),
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
    application_name: opts.applicationName ?? 'ckp-server',
    types: customTypes,
    ...(opts.statementTimeoutMillis ? { statement_timeout: opts.statementTimeoutMillis } : {}),
  });
  pool.on('error', (err) => {
    // 유휴 연결 오류(네트워크 끊김 등) — 프로세스가 죽지 않도록 기록만 한다
    opts.onError?.(err);
  });
  return wrapPool(pool);
}

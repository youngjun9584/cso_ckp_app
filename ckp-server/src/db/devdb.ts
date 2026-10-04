/**
 * 개발/테스트용 내장 DB: PGlite(WASM PostgreSQL)를 127.0.0.1 의 빈 포트에서 PostgreSQL 프로토콜로 열고,
 * 운영과 **같은 pg.Pool 코드 경로**로 접속한다(Pool max 1).
 *
 *   const dev = await startDevDb({ dataDir: '.data/pglite' });   // 영구 저장 (npm run dev)
 *   const dev = await startDevDb({ dataDir: null });             // 인메모리 (테스트)
 *   dev.db.query(...); await dev.stop();
 *
 * 적용 순서: dev-schema.sql(IF NOT EXISTS) → migrations/001_ckp_app_edi.sql → migrations/002_ckp_app_refresh_token.sql → 샘플 데이터(최초 1회)
 * 세션 TimeZone 은 UTC 로 고정한다(운영 RDS 기본값과 같게 — KST 변환을 빼먹은 SQL 을 개발 중에 드러내기 위해).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Storage } from '../storage/index.js';
import { seedDevData, type SeedSummary } from './dev-seed.js';
import { createDb, type Db } from './pool.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** 프로젝트 루트 (src/db 또는 dist/db 기준 두 단계 위) */
export const PROJECT_ROOT = path.resolve(moduleDir, '..', '..');
export const MIGRATION_001 = path.join(PROJECT_ROOT, 'migrations', '001_ckp_app_edi.sql');
export const MIGRATION_002 = path.join(PROJECT_ROOT, 'migrations', '002_ckp_app_refresh_token.sql');

function devSchemaPath(): string {
  const candidates = [path.join(moduleDir, 'dev-schema.sql'), path.join(PROJECT_ROOT, 'src', 'db', 'dev-schema.sql')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`개발용 스키마 파일(dev-schema.sql)을 찾을 수 없습니다: ${candidates.join(', ')}`);
  return found;
}

export interface StartDevDbOptions {
  /** 영구 저장 폴더. null 이면 메모리(테스트) */
  dataDir: string | null;
  /** 001 마이그레이션 적용 여부 (기본 true). false 는 SCHEMA_NOT_READY 테스트용 */
  applyMigration?: boolean;
  /** 002(refresh 토큰 기록, 선택) 적용 여부 (기본: applyMigration 과 같음). false 는 무상태 동작 테스트용 */
  applyRefreshTokenMigration?: boolean;
  /** 샘플 데이터 넣기 (기본 true, 사용자 테이블이 비어 있을 때만) */
  seed?: boolean;
  /** 샘플 데이터 기준 시각 */
  now?: Date;
  /** 샘플 EDI 이미지를 기록할 저장소 (로컬일 때만 기록) */
  storage?: Storage | null;
}

export interface DevDbHandle {
  db: Db;
  /** 로그용 접속 주소 (비밀번호 없음, 로컬 전용) */
  connectionString: string;
  dataDir: string | null;
  seed: SeedSummary | null;
  /** 원시 PGlite (테스트에서 직접 SQL 실행이 필요할 때만) */
  pglite: PGlite;
  stop(): Promise<void>;
}

export async function startDevDb(opts: StartDevDbOptions): Promise<DevDbHandle> {
  let dataDir: string | null = null;
  if (opts.dataDir) {
    dataDir = path.resolve(opts.dataDir);
    await mkdir(dataDir, { recursive: true });
  }
  const pglite = dataDir ? await PGlite.create({ dataDir }) : await PGlite.create();

  try {
    await pglite.exec(`SET TimeZone TO 'UTC'`);
    await pglite.exec(`ALTER DATABASE postgres SET TimeZone TO 'UTC'`);
    await pglite.exec(await readFile(devSchemaPath(), 'utf8'));
    if (opts.applyMigration !== false) await pglite.exec(await readFile(MIGRATION_001, 'utf8'));
    if (opts.applyRefreshTokenMigration ?? (opts.applyMigration !== false)) await pglite.exec(await readFile(MIGRATION_002, 'utf8'));
  } catch (err) {
    await pglite.close().catch(() => undefined);
    throw err;
  }

  const server = new PGLiteSocketServer({ db: pglite, host: '127.0.0.1', port: 0, maxConnections: 4 });
  await server.start();
  const [host, portText] = server.getServerConn().split(':');
  const connectionString = `postgres://postgres@${host}:${portText}/postgres`;
  const db = createDb({
    connectionString,
    ssl: 'disable',
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 15_000,
    applicationName: 'ckp-server-dev',
  });

  let seed: SeedSummary | null = null;
  try {
    if (opts.seed !== false) {
      seed = await seedDevData(db, { now: opts.now ?? new Date(), storage: opts.storage ?? null });
    }
  } catch (err) {
    await db.close().catch(() => undefined);
    await server.stop().catch(() => undefined);
    await pglite.close().catch(() => undefined);
    throw err;
  }

  let stopped = false;
  return {
    db,
    connectionString,
    dataDir,
    seed,
    pglite,
    async stop() {
      if (stopped) return;
      stopped = true;
      await db.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      await pglite.close().catch(() => undefined);
    },
  };
}

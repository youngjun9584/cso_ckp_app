/**
 * 서버 진입점: 설정 → DB(운영 pg 또는 개발용 PGlite) → 스키마 확인 → buildApp → listen → 종료 처리
 */
import { buildApp } from './app.js';
import { ConfigError, describeConfig, getConfigWarnings, loadConfig, serverStartProblems, type AppConfig } from './config.js';
import { createDb, type Db } from './db/pool.js';
import { checkSchema, describeCapabilities } from './db/schema-check.js';
import { createStorage } from './storage/index.js';

async function openDatabase(config: AppConfig, storage: ReturnType<typeof createStorage>) {
  if (config.database.url) {
    const db: Db = createDb({
      connectionString: config.database.url,
      ssl: config.database.ssl,
      statementTimeoutMillis: 30_000,
      onError: (err) => console.error(`[DB] 유휴 연결 오류: ${err.message}`),
    });
    return { db, stop: () => db.close(), devNotice: null as string | null };
  }
  // 개발용 내장 DB — devDependency 이므로 필요할 때만 불러온다
  const { startDevDb } = await import('./db/devdb.js');
  const { demoAccountsNotice } = await import('./db/dev-seed.js');
  const dev = await startDevDb({ dataDir: config.devDb.dir, storage });
  const seeded = dev.seed?.seeded
    ? `샘플 데이터를 새로 넣었습니다 (의약품 ${dev.seed.medicines}, 공지 ${dev.seed.notices}, 거래처 ${dev.seed.clients}, EDI ${dev.seed.ediRows}).`
    : '기존 개발 DB 데이터를 사용합니다 (초기화: npm run dev:reset).';
  const notice = [`개발용 내장 DB(PGlite) 실행 중: ${dev.dataDir ?? '메모리'} — ${seeded}`, demoAccountsNotice()].join('\n');
  return { db: dev.db, stop: () => dev.stop(), devNotice: notice };
}

async function main() {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  // 실제 DB + 개발용 비밀키 조합 등 — 서버 기동에만 적용(db:check·db:migrate 스크립트는 그대로 동작)
  const startProblems = serverStartProblems(config);
  if (startProblems.length > 0) {
    console.error(`서버 설정 오류:\n - ${startProblems.join('\n - ')}`);
    process.exit(1);
  }

  const storage = createStorage(config);
  const database = await openDatabase(config, storage);

  let capabilities;
  try {
    capabilities = await checkSchema(database.db);
  } catch (err) {
    console.error(`[DB] 스키마 확인에 실패했습니다. DB 접속 정보를 확인해 주세요: ${(err as Error).message}`);
    await database.stop().catch(() => undefined);
    process.exit(1);
  }

  const app = await buildApp({ config, db: database.db, storage, capabilities });

  for (const w of getConfigWarnings(config)) app.log.warn(w);
  app.log.info({ config: describeConfig(config) }, '서버 설정');
  app.log.info(`DB 스키마 확인 결과:\n  ${describeCapabilities(capabilities).join('\n  ')}`);
  if (!capabilities.ok) app.log.error('필수 테이블/컬럼이 없어 일부 기능이 동작하지 않습니다. npm run db:check 로 확인해 주세요.');
  if (!capabilities.refreshTokenTable) {
    app.log.warn(
      'refresh 토큰 기록 테이블(ckp_app_refresh_token)이 없어 무상태 방식으로 동작합니다. 재발급해도 이전 토큰이 만료 전까지 유효하고, 로그아웃 폐기 정보는 메모리에만 있어 서버를 다시 시작하면 사라집니다. (적용: npm run db:migrate -- --yes, migrations/002)',
    );
  }
  if (database.devNotice && !config.isProduction) app.log.info(database.devNotice);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} 수신 — 서버를 종료합니다.`);
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    try {
      await app.close();
      await database.stop();
    } catch (err) {
      app.log.error({ err }, '종료 중 오류');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`CKP API 서버 시작: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/v1/meta`);
  } catch (err) {
    app.log.error({ err }, '서버를 시작할 수 없습니다 (포트 사용 중인지 확인해 주세요).');
    await database.stop().catch(() => undefined);
    process.exit(1);
  }
}

void main();

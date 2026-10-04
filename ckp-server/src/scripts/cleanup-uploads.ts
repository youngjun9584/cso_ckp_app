/**
 * npm run cleanup:uploads [-- --apply] [-- --hours=24]
 *   제출에 쓰이지 않은 채 오래된(기본 24시간) PENDING 업로드의 저장소 객체를 지우고 status 를 DELETED 로 바꾼다.
 *   --apply 가 없으면 대상 목록만 출력한다(dry-run).
 */
import { ConfigError, loadConfig, type AppConfig } from '../config.js';
import { createDb, type Db } from '../db/pool.js';
import { checkSchema } from '../db/schema-check.js';
import { cleanupPendingUploads } from '../domain/edi/cleanup.js';
import { createStorage } from '../storage/index.js';

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const hoursArg = process.argv.find((a) => a.startsWith('--hours='));
  const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;
  if (!Number.isFinite(hours) || hours < 1) {
    console.error('[업로드 정리] --hours 는 1 이상의 숫자여야 합니다.');
    return 1;
  }

  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  const storage = createStorage(config);

  let db: Db;
  let stop: () => Promise<void>;
  if (config.database.url) {
    db = createDb({ connectionString: config.database.url, ssl: config.database.ssl, max: 2 });
    stop = () => db.close();
  } else {
    const { startDevDb } = await import('../db/devdb.js');
    const dev = await startDevDb({ dataDir: config.devDb.dir, seed: false });
    db = dev.db;
    stop = () => dev.stop();
  }

  try {
    const caps = await checkSchema(db);
    if (!caps.ediAppTables) {
      console.error('[업로드 정리] 앱 전용 테이블(ckp_app_edi_upload)이 없습니다. 먼저 npm run db:migrate 를 실행하세요.');
      return 1;
    }
    const result = await cleanupPendingUploads(db, storage, {
      now: new Date(),
      olderThanHours: Math.floor(hours),
      apply,
      onSkip: (c, reason) => console.warn(`  - 건너뜀 ${c.uploadId}: ${reason}`),
    });
    console.log(
      `[업로드 정리] ${Math.floor(hours)}시간 넘은 미사용 업로드: ${result.candidates.length}건${apply ? '' : ' (dry-run: --apply 로 실제 삭제)'}`,
    );
    if (!apply) {
      for (const c of result.candidates) console.log(`  - ${c.uploadId} (${c.createdKst}) ${c.objectKey}`);
    } else {
      console.log(`[업로드 정리] 삭제 완료: ${result.deleted}건, 건너뜀: ${result.skipped}건, 객체 삭제 실패: ${result.failed}건`);
    }
    return result.failed > 0 ? 1 : 0;
  } finally {
    await stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[업로드 정리] 실패: ${(err as Error).message}`);
    process.exit(1);
  },
);

/** Read-only by default. --apply inserts missing manager rows for approved users. */
import { loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { checkSchema } from '../db/schema-check.js';
import { managerMatchingSummary, matchManagers } from '../services/managers.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('사용법: npm run db:match-managers -- [--apply]');
  const config = loadConfig();
  if (!config.database.url) throw new Error('DATABASE_URL을 설정하세요. 실행 중인 내장 개발 DB는 별도로 열지 않습니다.');
  const db = createDb({ connectionString: config.database.url, ssl: config.database.ssl, max: 1 });
  try {
    const caps = await checkSchema(db);
    if (!caps.modules.auth || !caps.modules.clients || !caps.modules.ediLegacy) {
      throw new Error(`매칭에 필요한 스키마 누락: ${caps.missingRequired.join(', ')}`);
    }
    console.log('매칭 기준: sys_app_usr_mng.usr_id = manager.user_id = 거래처/EDI.user_id');
    console.log('적용 전:', await managerMatchingSummary(db));
    if (args.includes('--apply')) {
      const inserted = await db.tx((q) => matchManagers(q, null));
      console.log(`승인 사용자 manager ${inserted}건 추가`);
      console.log('적용 후:', await managerMatchingSummary(db));
    } else {
      console.log('읽기 전용 점검입니다. 누락 담당자 추가: npm run db:match-managers -- --apply');
    }
    console.log('orphan 항목은 로그인 ID가 없는 데이터입니다. 소유자 ID를 확인해야 합니다.');
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(`[담당자 매칭] 실패: ${(err as Error).message}`);
  process.exitCode = 1;
});

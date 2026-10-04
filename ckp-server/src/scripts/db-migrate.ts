/**
 * npm run db:migrate [-- --yes] [-- --only=001|002] — 앱 전용 테이블 마이그레이션(추가 전용) 적용.
 *   001_ckp_app_edi.sql            EDI 제출 묶음·사진 순번·업로드 원장 (필수 — 없으면 EDI 제출/내역 503)
 *   002_ckp_app_refresh_token.sql  refresh 토큰 기록 (선택 — 없으면 무상태 방식으로 동작)
 *   --yes 가 없으면 무엇을 할지만 출력하고 종료한다(아무것도 바꾸지 않음). 두 파일 모두 IF NOT EXISTS 라 다시 실행해도 안전하다.
 *   --only=001 처럼 하나만 적용할 수 있다.
 *   대상은 DATABASE_URL (개발용 내장 DB 는 서버 시작 시 자동 적용되므로 대상이 아니다).
 *   적용 전 운영 DB 백업 및 DBA 검토 필수. 롤백: migrations/00N_*.rollback.sql
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { checkSchema, describeCapabilities, type Capabilities } from '../db/schema-check.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Migration {
  id: '001' | '002';
  file: string;
  summary: string;
  /** 적용 후 확인 */
  applied(c: Capabilities): boolean;
  status(c: Capabilities): string;
}

const MIGRATIONS: Migration[] = [
  {
    id: '001',
    file: path.join(root, 'migrations', '001_ckp_app_edi.sql'),
    summary: '새 테이블(없을 때만 생성): ckp_app_edi_upload, ckp_app_edi_submission, ckp_app_edi_submission_photo (+ 인덱스) — EDI 제출에 필수',
    applied: (c) => c.ediAppTables,
    status: (c) => (c.ediAppTables ? '이미 있음' : `없음 [${c.missingAppTables.join(', ')}]`),
  },
  {
    id: '002',
    file: path.join(root, 'migrations', '002_ckp_app_refresh_token.sql'),
    summary: '새 테이블(없을 때만 생성): ckp_app_refresh_token (+ 인덱스) — 선택: refresh 토큰 재발급 시 폐기·재사용 감지·로그아웃 폐기 유지',
    applied: (c) => c.refreshTokenTable,
    status: (c) => (c.refreshTokenTable ? '이미 있음' : '없음 (무상태 방식으로 동작 중)'),
  },
];

function selectedMigrations(argv: string[]): Migration[] | string {
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).trim();
  if (!only) return MIGRATIONS;
  const found = MIGRATIONS.filter((m) => m.id === only);
  return found.length > 0 ? found : `--only 값이 올바르지 않습니다: ${only} (사용 가능: ${MIGRATIONS.map((m) => m.id).join(', ')})`;
}

async function main(): Promise<number> {
  const yes = process.argv.includes('--yes');
  const selected = selectedMigrations(process.argv);
  if (typeof selected === 'string') {
    console.error(`[마이그레이션] ${selected}`);
    return 1;
  }
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  if (!config.database.url) {
    console.error('[마이그레이션] DATABASE_URL 이 설정되지 않았습니다. (개발용 내장 DB 에는 서버 시작 시 자동 적용됩니다.)');
    return 1;
  }

  const sqls = await Promise.all(selected.map((m) => readFile(m.file, 'utf8')));
  const u = new URL(config.database.url);
  const target = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  const db = createDb({ connectionString: config.database.url, ssl: config.database.ssl, max: 1 });
  try {
    const before = await checkSchema(db);
    console.log(`[마이그레이션] 대상 DB: ${target}`);
    for (const m of selected) {
      console.log(`[마이그레이션] ${m.id}: ${path.relative(root, m.file)}`);
      console.log(`  - ${m.summary}`);
      console.log(`  - 현재 상태: ${m.status(before)}`);
    }
    console.log('  - 기존 테이블(edi, mannager_by_hospital, sys_app_usr_mng 등)은 변경하지 않습니다.');

    if (!yes) {
      console.log('[마이그레이션] 실제로 적용하려면 백업 후 다음을 실행하세요: npm run db:migrate -- --yes (하나만: -- --yes --only=001)');
      return 0;
    }

    for (const [i, m] of selected.entries()) {
      await db.query(sqls[i] as string);
      console.log(`[마이그레이션] ${m.id} 적용 완료`);
    }
    const after = await checkSchema(db);
    for (const line of describeCapabilities(after)) console.log(`  - ${line}`);
    const failed = selected.filter((m) => !m.applied(after));
    if (failed.length > 0) {
      console.error(`[마이그레이션] 적용 후에도 테이블이 확인되지 않습니다(${failed.map((m) => m.id).join(', ')}). DB 권한을 확인해 주세요.`);
      return 1;
    }
    console.log('[마이그레이션] 완료. 서버를 다시 시작하면 반영됩니다.');
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[마이그레이션] 실패: ${(err as Error).message}`);
    process.exit(1);
  },
);

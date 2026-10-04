/**
 * npm run db:check — DB 스키마 읽기 전용 점검 보고서.
 *   DATABASE_URL 이 있으면 그 DB 를, 없고 DEV_DB=pglite 이면 개발용 내장 DB 를 확인한다.
 *   필수 테이블/컬럼이 없으면 종료 코드 1.
 * (information_schema 조회와 사용자 비밀번호 해시 형식 집계만 한다. 데이터를 바꾸지 않는다.)
 */
import { ConfigError, loadConfig } from '../config.js';
import { createDb, type Db } from '../db/pool.js';
import { checkSchema, describeCapabilities } from '../db/schema-check.js';
import { managerMatchingSummary } from '../services/managers.js';

async function main(): Promise<number> {
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

  let db: Db;
  let stop: () => Promise<void>;
  let target: string;
  if (config.database.url) {
    db = createDb({ connectionString: config.database.url, ssl: config.database.ssl, max: 1 });
    stop = () => db.close();
    const u = new URL(config.database.url);
    target = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } else {
    const { startDevDb } = await import('../db/devdb.js');
    const dev = await startDevDb({ dataDir: config.devDb.dir, seed: false });
    db = dev.db;
    stop = () => dev.stop();
    target = `개발용 내장 DB(PGlite) ${dev.dataDir}`;
  }

  try {
    console.log(`[DB 점검] 대상: ${target}`);
    const caps = await checkSchema(db);
    for (const line of describeCapabilities(caps)) console.log(`  - ${line}`);

    if (caps.modules.auth) {
      const { rows } = await db.query<{ kind: string; n: number }>(
        // bcrypt 는 cost 별로 센다(더미 비교 cost 10 과 다르면 응답 시간으로 계정이 구분될 수 있음)
        `SELECT CASE WHEN usr_pwd ~ '^\\$2[aby]\\$[0-9]{2}\\$' THEN 'bcrypt(cost ' || substring(usr_pwd from 5 for 2) || ')'
                     WHEN usr_pwd ~ '^\\$2[aby]\\$' THEN 'bcrypt'
                     WHEN usr_pwd ~ '^[0-9a-fA-F]{32}$' THEN 'md5'
                     ELSE 'other' END AS kind, count(*)::int AS n
           FROM public.sys_app_usr_mng GROUP BY 1 ORDER BY 1`,
      );
      const summary = rows.map((r) => `${r.kind} ${r.n}명`).join(', ') || '사용자 없음';
      console.log(`  - 비밀번호 해시 형식 분포: ${summary} (other 는 로그인 불가)`);
      const { rows: apr } = await db.query<{ apr_yn: string | null; n: number }>(
        'SELECT apr_yn, count(*)::int AS n FROM public.sys_app_usr_mng GROUP BY apr_yn ORDER BY apr_yn',
      );
      console.log(`  - 승인 상태(apr_yn) 분포: ${apr.map((r) => `${r.apr_yn ?? '(없음)'} ${r.n}명`).join(', ') || '사용자 없음'}`);
    }
    if (caps.modules.auth && caps.modules.clients && caps.modules.ediLegacy) {
      console.log('  - 로그인 ID/담당자/거래처/EDI 매칭:', await managerMatchingSummary(db));
    }
    if (caps.modules.ediLegacy) {
      const { rows } = await db.query<{ n: number; blocked: boolean | null }>(
        'SELECT count(*)::int AS n, bool_or(edi) AS blocked FROM public.is_edi',
      );
      const r = rows[0];
      console.log(`  - EDI 차단 스위치(is_edi): 행 ${r?.n ?? 0}개, 차단=${r?.blocked === true ? '예' : '아니오'}`);
    }

    if (!caps.ok) {
      console.error('[DB 점검] 필수 테이블/컬럼이 없습니다. 서버의 일부 기능이 동작하지 않습니다.');
      return 1;
    }
    console.log(caps.ediAppTables ? '[DB 점검] 이상 없음.' : '[DB 점검] 필수 항목은 있음. 앱 전용 테이블이 없어 EDI 제출/내역은 사용할 수 없습니다 (npm run db:migrate).');
    return 0;
  } finally {
    await stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[DB 점검] 실패: ${(err as Error).message}`);
    process.exit(1);
  },
);

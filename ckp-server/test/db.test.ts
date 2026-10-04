import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ApiErrorBody } from '../src/contract.js';
import { startDevDb, type DevDbHandle } from '../src/db/devdb.js';
import { checkSchema, describeCapabilities } from '../src/db/schema-check.js';
import { LocalStorage } from '../src/storage/local.js';
import { createTestApp, testConfig, type TestContext } from './helpers.js';

describe('개발 DB (PGlite) · 스키마 확인 · 샘플 데이터', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp({ now: '2026-09-25T01:00:00Z' });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('capabilities: 필수·선택 컬럼과 앱 전용 테이블을 모두 인식한다', () => {
    const c = t.capabilities;
    expect(c.ok).toBe(true);
    expect(c.missingRequired).toEqual([]);
    expect(c.ediAppTables).toBe(true);
    expect(c.ediIsCopy).toBe(true);
    expect(c.clientHospitalType).toBe(true);
    expect(c.freesTable).toBe(true);
    expect(c.medicineTaxColumns).toEqual(['tax', 'tax_2', 'tax_3', 'tax_4']);
    expect(c.isEdiCoalitionCompany).toBe(true);
    expect(c.modules).toEqual({ auth: true, medicines: true, notices: true, clients: true, ediLegacy: true });
    expect(c.columns.edi?.aws_url?.maxLength).toBe(200);
    expect(describeCapabilities(c).join('\n')).toContain('필수 테이블/컬럼: 모두 있음');
  });

  it('샘플 데이터 규모', async () => {
    const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(sql, params)).rows[0]?.n;
    expect(await count('SELECT count(*) AS n FROM public.sys_app_usr_mng')).toBe(3);
    expect(await count('SELECT count(*) AS n FROM public.medicine')).toBeGreaterThanOrEqual(120);
    expect(await count('SELECT count(DISTINCT company) AS n FROM public.medicine')).toBe(12);
    expect(await count("SELECT count(*) AS n FROM public.medicine WHERE pay = '미정'")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.medicine WHERE pay LIKE '%,%'")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.medicine WHERE name ~ '^([[]|★|◎)'")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.medicine WHERE medicine_code !~ '^[0-9]{9}$'")).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.notice')).toBeGreaterThanOrEqual(25);
    expect(await count("SELECT count(*) AS n FROM public.notice WHERE important = 'true'")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM public.notice WHERE contents LIKE '%<script>%'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM public.notice WHERE contents LIKE '%data:image/png;base64,%'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM public.mannager_by_hospital WHERE user_id = 'ckp_demo'")).toBeGreaterThanOrEqual(15);
    expect(await count("SELECT count(*) AS n FROM public.mannager_by_hospital WHERE user_id = 'ckp_demo' AND approval IS NULL")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.mannager_by_hospital WHERE user_id = 'ckp_demo' AND approval = false")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM public.frees WHERE list = true")).toBe(1);
    expect(await count('SELECT count(*) AS n FROM public.is_edi WHERE edi = false')).toBe(1);
    expect(await count("SELECT count(*) AS n FROM public.edi WHERE user_id = 'ckp_demo'")).toBeGreaterThanOrEqual(6);
  });

  it('이전 방식 EDI 샘플: 같은 create_at 묶음, 로컬 이미지·data URL', async () => {
    const { rows } = await t.db.query<{ hospital_name: string; create_at: string | null; n: number }>(
      `SELECT hospital_name, create_at, count(*)::int AS n FROM public.edi
        WHERE user_id = 'ckp_demo' AND COALESCE(is_copy, false) = false
        GROUP BY hospital_name, month, create_at, reg_ymd ORDER BY min(idx)`,
    );
    expect(rows.map((r) => r.n)).toEqual([3, 2, 1, 1]);
    expect(rows[0]?.create_at).toBe('2026-09-25 09:12:00');

    const { rows: imgs } = await t.db.query<{ aws_url: string | null; edi_image: Buffer | null }>(
      "SELECT aws_url, edi_image FROM public.edi WHERE user_id = 'ckp_demo' ORDER BY idx",
    );
    const firstKey = t.storage.keyFromUrl(imgs[0]?.aws_url);
    expect(firstKey).toBe('seed/edi/legacy-a-1.jpg');
    const bytes = await t.storage.getBuffer(firstKey as string);
    expect(bytes?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    const withData = imgs.find((r) => r.edi_image);
    expect(withData?.edi_image?.toString('ascii', 0, 23)).toBe('data:image/jpeg;base64,');
  });

  it('pg 타입 변환: date → 문자열, count → number, 세션 TZ=UTC', async () => {
    const { rows } = await t.db.query<{ d: string; n: number; tz: string; kst: string }>(
      `SELECT '2026-01-01'::date AS d, count(*) AS n, current_setting('TimeZone') AS tz,
              to_char(timestamptz '2025-12-31 15:30:00+00' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS kst
         FROM public.sys_app_usr_mng`,
    );
    expect(rows[0]).toEqual({ d: '2026-01-01', n: 3, tz: 'UTC', kst: '2026-01-01 00:30:00' });
  });

  it('tx: 성공 시 COMMIT, 예외 시 ROLLBACK, 끝난 뒤 q 사용 금지', async () => {
    await t.db.tx(async (q) => {
      await q.query(`INSERT INTO public.is_edi (edi, coalition_company) VALUES (false, 'tx-ok')`);
    });
    await expect(
      t.db.tx(async (q) => {
        await q.query(`INSERT INTO public.is_edi (edi, coalition_company) VALUES (false, 'tx-fail')`);
        throw new Error('의도한 실패');
      }),
    ).rejects.toThrow('의도한 실패');
    const { rows } = await t.db.query<{ c: string }>(`SELECT coalition_company AS c FROM public.is_edi WHERE coalition_company LIKE 'tx-%'`);
    expect(rows.map((r) => r.c)).toEqual(['tx-ok']);

    let leaked: { query: (sql: string) => Promise<unknown> } | null = null;
    await t.db.tx(async (q) => {
      leaked = q;
    });
    await expect(leaked!.query('SELECT 1')).rejects.toThrow('트랜잭션이 이미 끝난 뒤');
    await t.db.query(`DELETE FROM public.is_edi WHERE coalition_company LIKE 'tx-%'`);
  });
});

describe('마이그레이션 미적용 DB', () => {
  let dev: DevDbHandle;
  beforeAll(async () => {
    dev = await startDevDb({ dataDir: null, applyMigration: false, seed: false });
  });
  afterAll(async () => {
    await dev?.stop();
  });

  it('ediAppTables=false 이고 없는 테이블을 알려준다', async () => {
    const c = await checkSchema(dev.db);
    expect(c.ok).toBe(true);
    expect(c.ediAppTables).toBe(false);
    expect(c.missingAppTables).toEqual(['ckp_app_edi_upload', 'ckp_app_edi_submission', 'ckp_app_edi_submission_photo']);
    expect(describeCapabilities(c).join('\n')).toContain('npm run db:migrate');
  });

  it('선택 컬럼이 없으면 기능이 꺼진다', async () => {
    await dev.db.query('ALTER TABLE public.edi DROP COLUMN is_copy');
    await dev.db.query('ALTER TABLE public.mannager_by_hospital DROP COLUMN hospital_type');
    await dev.db.query('DROP TABLE public.frees');
    const c = await checkSchema(dev.db);
    expect(c.ediIsCopy).toBe(false);
    expect(c.clientHospitalType).toBe(false);
    expect(c.freesTable).toBe(false);
    expect(c.ok).toBe(true);
  });

  it('필수 컬럼이 없으면 ok=false', async () => {
    await dev.db.query('ALTER TABLE public.notice DROP COLUMN important');
    const c = await checkSchema(dev.db);
    expect(c.ok).toBe(false);
    expect(c.missingRequired).toEqual(['notice.important']);
    expect(c.modules.notices).toBe(false);
    expect(c.modules.medicines).toBe(true);
  });

  it('없는 테이블을 조회하는 라우트는 503 SCHEMA_NOT_READY (내부 메시지 비노출)', async () => {
    const app = await buildApp({
      config: testConfig(),
      db: dev.db,
      storage: new LocalStorage(path.join(os.tmpdir(), 'ckp-test-unused')),
      capabilities: await checkSchema(dev.db),
      logger: false,
    });
    app.get('/v1/__probe', async () => {
      await dev.db.query('SELECT 1 FROM public.ckp_app_edi_upload');
      return {};
    });
    const res = await app.inject({ method: 'GET', url: '/v1/__probe' });
    expect(res.statusCode).toBe(503);
    expect(res.json<ApiErrorBody>().error.code).toBe('SCHEMA_NOT_READY');
    expect(res.body).not.toMatch(/relation|ckp_app_edi_upload|stack/);
    await app.close();
  });
});

describe('migrations/002 (refresh 토큰 기록, 선택)', () => {
  let dev: DevDbHandle;
  beforeAll(async () => {
    dev = await startDevDb({ dataDir: null, applyMigration: false, seed: false });
  });
  afterAll(async () => {
    await dev?.stop();
  });

  it('001 과 따로 적용·재적용·롤백할 수 있고, 없어도 EDI 기능(ediAppTables)과 무관하다', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const sql = (name: string) => readFile(path.join(root, 'migrations', name), 'utf8');
    let c = await checkSchema(dev.db);
    expect([c.ediAppTables, c.refreshTokenTable]).toEqual([false, false]);

    await dev.pglite.exec(await sql('001_ckp_app_edi.sql'));
    c = await checkSchema(dev.db);
    expect([c.ediAppTables, c.refreshTokenTable]).toEqual([true, false]);
    expect(c.missingAppTables).toEqual([]);

    await dev.pglite.exec(await sql('002_ckp_app_refresh_token.sql'));
    await dev.pglite.exec(await sql('002_ckp_app_refresh_token.sql')); // IF NOT EXISTS — 다시 실행해도 안전
    c = await checkSchema(dev.db);
    expect([c.ediAppTables, c.refreshTokenTable]).toEqual([true, true]);
    expect(Object.keys(c.columns.ckp_app_refresh_token ?? {})).toEqual([
      'token_id', 'usr_id', 'family_id', 'token_hash', 'issued_at', 'expires_at', 'revoked_at', 'replaced_by',
    ]);

    await dev.pglite.exec(await sql('002_ckp_app_refresh_token.rollback.sql'));
    c = await checkSchema(dev.db);
    expect([c.ediAppTables, c.refreshTokenTable]).toEqual([true, false]);
  });
});

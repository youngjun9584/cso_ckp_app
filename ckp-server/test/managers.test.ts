import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkSchema } from '../src/db/schema-check.js';
import { matchManagers, managerMatchingSummary } from '../src/services/managers.js';
import { createTestApp, type TestContext } from './helpers.js';

describe('로그인 ID → manager → 거래처 매칭', () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t?.close(); });
  beforeEach(async () => { await t.db.query('DELETE FROM public.manager'); });

  it('승인 로그인 시 ID를 매칭하고 기존 거래처 조회는 본인 범위만 유지한다', async () => {
    const login = await t.loginAs('ckp_demo');
    const { rows } = await t.db.query('SELECT user_id, name, company FROM public.manager');
    expect(rows).toEqual([{ user_id: 'ckp_demo', name: '김영업', company: 'CKP파트너스' }]);
    const clients = await t.app.inject({ method: 'GET', url: '/v1/clients', headers: login.headers });
    expect(clients.statusCode).toBe(200);
    expect(clients.json().items.length).toBeGreaterThan(0);
    const other = await t.db.query<{ idx: number }>("SELECT idx FROM public.mannager_by_hospital WHERE user_id = 'ckp_md5' LIMIT 1");
    expect(other.rows[0]).toBeDefined();
    const hidden = await t.app.inject({ method: 'GET', url: `/v1/clients/${other.rows[0]!.idx}`, headers: login.headers });
    expect(hidden.statusCode).toBe(404);
  });

  it('잘못된 비밀번호와 미승인 사용자는 담당자를 만들지 않는다', async () => {
    for (const [usrId, password, status] of [['ckp_demo', 'wrong', 401], ['ckp_wait', 'demo1234', 403]] as const) {
      const res = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { usrId, password } });
      expect(res.statusCode).toBe(status);
    }
    expect((await t.db.query('SELECT user_id FROM public.manager')).rows).toEqual([]);
  });

  it('반복·동시 매칭은 중복을 만들지 않고 관리자가 지정한 값을 보존한다', async () => {
    await t.db.query("INSERT INTO public.manager (user_id, name, manager, company) VALUES ('ckp_demo', '기존 표시명', '본사담당자', '지정회사')");
    await Promise.all([matchManagers(t.db, 'ckp_demo'), matchManagers(t.db, 'ckp_md5'), matchManagers(t.db, 'ckp_md5')]);
    expect((await t.db.query("SELECT name, manager, company FROM public.manager WHERE user_id = 'ckp_demo'")).rows)
      .toEqual([{ name: '기존 표시명', manager: '본사담당자', company: '지정회사' }]);
    expect((await t.db.query('SELECT count(*)::int AS n FROM public.manager')).rows[0]?.n).toBe(2);
  });

  it('기존 세션의 거래처 등록도 토큰 ID로 매칭하며 등록 실패 시 매칭을 롤백한다', async () => {
    const headers = await t.authHeaders('ckp_demo');
    const payload = { name: '매칭테스트의원', ownerUsrId: 'ckp_md5', userId: 'ckp_md5' };
    const created = await t.app.inject({ method: 'POST', url: '/v1/clients', headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json().client.ownerUsrId).toBe('ckp_demo');
    expect((await t.db.query('SELECT user_id FROM public.manager')).rows).toEqual([{ user_id: 'ckp_demo' }]);
    await t.db.query('DELETE FROM public.manager');
    const duplicate = await t.app.inject({ method: 'POST', url: '/v1/clients', headers, payload });
    expect(duplicate.statusCode).toBe(409);
    expect((await t.db.query('SELECT user_id FROM public.manager')).rows).toEqual([]);
  });

  it('기존 세션의 토큰 재발급도 누락 담당자를 매칭한다', async () => {
    const login = await t.loginAs('ckp_demo');
    await t.db.query('DELETE FROM public.manager');
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: login.refreshToken } });
    expect(res.statusCode).toBe(200);
    expect((await t.db.query('SELECT user_id FROM public.manager')).rows).toEqual([{ user_id: 'ckp_demo' }]);
  });

  it('일괄 매칭은 승인 사용자만 추가하고 고아 데이터는 다른 사용자에게 재배정하지 않는다', async () => {
    await t.db.query("INSERT INTO public.mannager_by_hospital (hospital, user_id) VALUES ('확인필요거래처', 'unknown-owner')");
    try {
      const before = await managerMatchingSummary(t.db);
      expect(before).toMatchObject({ approvedUsers: 2, matchedUsers: 0, missingManagers: 2, orphanClients: 1 });
      expect(await matchManagers(t.db, null)).toBe(2);
      expect(await matchManagers(t.db, null)).toBe(0);
      expect(await managerMatchingSummary(t.db)).toMatchObject({ matchedUsers: 2, missingManagers: 0, orphanClients: 1 });
      expect((await t.db.query("SELECT user_id FROM public.manager WHERE user_id IN ('ckp_wait', 'unknown-owner')")).rows).toEqual([]);
    } finally {
      await t.db.query("DELETE FROM public.mannager_by_hospital WHERE user_id = 'unknown-owner'");
    }
  });

  it('manager 스키마가 없으면 로그인·거래처 기능 준비 실패를 보고한다', async () => {
    await t.db.query('ALTER TABLE public.manager RENAME TO manager_hidden');
    try {
      const caps = await checkSchema(t.db);
      expect(caps.modules.auth).toBe(false);
      expect(caps.modules.clients).toBe(false);
      expect(caps.missingRequired).toContain('manager');
    } finally {
      await t.db.query('ALTER TABLE public.manager_hidden RENAME TO manager');
    }
  });
});

import type { Queryable } from '../db/pool.js';

/** Canonical ownership key: sys_app_usr_mng.usr_id = manager.user_id.
 * Only approved accounts are added. Existing administrator assignments are preserved.
 * Passing null is reserved for the maintenance command to match all approved accounts.
 */
export async function matchManagers(q: Queryable, usrId: string | null): Promise<number> {
  const result = await q.query(
    `INSERT INTO public.manager (user_id, name, company)
     SELECT u.usr_id, NULLIF(btrim(u.usr_nam), ''), NULLIF(btrim(u.cpy_nam), '')
       FROM public.sys_app_usr_mng u
      WHERE upper(btrim(u.apr_yn)) = 'Y'
        AND ($1::text IS NULL OR u.usr_id = $1)
        AND NOT EXISTS (SELECT 1 FROM public.manager m WHERE m.user_id = u.usr_id)
      ORDER BY u.usr_id
     ON CONFLICT (user_id) DO NOTHING`,
    [usrId],
  );
  return result.rowCount;
}

/** Counts only: never read passwords, bank details, or guess ownership from names. */
export async function managerMatchingSummary(q: Queryable) {
  const { rows } = await q.query<{
    approvedUsers: number; matchedUsers: number; missingManagers: number;
    orphanManagers: number; orphanClients: number; orphanEdi: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM public.sys_app_usr_mng WHERE upper(btrim(apr_yn)) = 'Y') AS "approvedUsers",
       (SELECT count(*)::int FROM public.sys_app_usr_mng u WHERE upper(btrim(u.apr_yn)) = 'Y'
         AND EXISTS (SELECT 1 FROM public.manager m WHERE m.user_id = u.usr_id)) AS "matchedUsers",
       (SELECT count(*)::int FROM public.sys_app_usr_mng u WHERE upper(btrim(u.apr_yn)) = 'Y'
         AND NOT EXISTS (SELECT 1 FROM public.manager m WHERE m.user_id = u.usr_id)) AS "missingManagers",
       (SELECT count(*)::int FROM public.manager m WHERE NOT EXISTS
         (SELECT 1 FROM public.sys_app_usr_mng u WHERE u.usr_id = m.user_id)) AS "orphanManagers",
       (SELECT count(*)::int FROM public.mannager_by_hospital h WHERE NOT EXISTS
         (SELECT 1 FROM public.sys_app_usr_mng u WHERE u.usr_id = h.user_id)) AS "orphanClients",
       (SELECT count(*)::int FROM public.edi e WHERE NOT EXISTS
         (SELECT 1 FROM public.sys_app_usr_mng u WHERE u.usr_id = e.user_id)) AS "orphanEdi"`,
  );
  return rows[0]!;
}

/**
 * EDI 등록 차단 스위치 (public.is_edi). DESIGN §2.5
 *   SELECT COALESCE(bool_or(edi), false) FROM public.is_edi → true 면 차단.
 *   관리자 토글은 WHERE 없이 모든 행을 같은 값으로 바꾸므로 bool_or 가 결정적이다.
 *   조회 오류(테이블 없음 등)도 차단으로 본다(fail-closed).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { EdiStatusResponse } from '../../contract.js';
import type { Capabilities } from '../../db/schema-check.js';
import type { Queryable } from '../../db/pool.js';
import { AppError, DEFAULT_MESSAGE } from '../../lib/errors.js';
import { SCHEMA_NOT_READY_MESSAGE, ediSchemaReady } from './common.js';

export const EDI_DISABLED_MESSAGE = DEFAULT_MESSAGE.EDI_DISABLED;
export const EDI_STATUS_UNKNOWN_MESSAGE = '지금은 EDI 등록 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';

/** 차단 여부. 조회 실패 시 예외를 그대로 던진다(호출 측에서 fail-closed 처리) */
export async function readEdiBlocked(q: Queryable): Promise<boolean> {
  const { rows } = await q.query<{ blocked: boolean | null }>('SELECT COALESCE(bool_or(edi), false) AS blocked FROM public.is_edi');
  return rows[0]?.blocked !== false;
}

/** 등록 불가면 403 EDI_DISABLED. 조회 오류도 차단(fail-closed) */
export async function assertEdiEnabled(q: Queryable, log?: FastifyBaseLogger): Promise<void> {
  let blocked: boolean;
  try {
    blocked = await readEdiBlocked(q);
  } catch (err) {
    log?.error({ err }, 'is_edi 조회 실패 — EDI 등록을 차단합니다(fail-closed)');
    throw new AppError('EDI_DISABLED', EDI_STATUS_UNKNOWN_MESSAGE, { details: { reason: 'STATUS_UNAVAILABLE' } });
  }
  if (blocked) throw new AppError('EDI_DISABLED', EDI_DISABLED_MESSAGE, { details: { reason: 'BLOCKED_BY_ADMIN' } });
}

/** GET /v1/edi/status 응답 (오류 시 enabled=false) */
export async function ediStatus(q: Queryable, caps: Capabilities, log?: FastifyBaseLogger): Promise<EdiStatusResponse> {
  if (!ediSchemaReady(caps)) return { enabled: false, message: SCHEMA_NOT_READY_MESSAGE };
  try {
    const blocked = await readEdiBlocked(q);
    return blocked ? { enabled: false, message: EDI_DISABLED_MESSAGE } : { enabled: true, message: null };
  } catch (err) {
    log?.error({ err }, 'is_edi 조회 실패 — EDI 상태를 차단으로 응답합니다(fail-closed)');
    return { enabled: false, message: EDI_STATUS_UNKNOWN_MESSAGE };
  }
}

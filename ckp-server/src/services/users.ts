/**
 * 앱 사용자(sys_app_usr_mng) 조회. SELECT * 금지 — 필요한 컬럼만 읽는다(bankbook_*, 이미지, cpy_number 절대 조회 안 함).
 */
import type { AuthUser } from '../contract.js';
import type { Queryable } from '../db/pool.js';

export interface AppUserRow {
  user: AuthUser;
  /** apr_yn (trim, 대문자). null 가능 */
  aprYn: string | null;
}

export interface AppUserWithPassword extends AppUserRow {
  passwordHash: string | null;
}

interface Row {
  usr_id: string;
  usr_nam: string | null;
  cpy_nam: string | null;
  phone: string | null;
  email: string | null;
  role_id: string | null;
  apr_yn: string | null;
  usr_pwd?: string | null;
}

const BASE_COLUMNS = 'usr_id, usr_nam, cpy_nam, phone, email, role_id, apr_yn';

function toUser(r: Row): AppUserRow {
  const clean = (v: string | null) => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    user: {
      usrId: r.usr_id.trim(),
      name: clean(r.usr_nam),
      companyName: clean(r.cpy_nam),
      phone: clean(r.phone),
      email: clean(r.email),
      roleId: clean(r.role_id),
    },
    aprYn: r.apr_yn ? r.apr_yn.trim().toUpperCase() || null : null,
  };
}

/** 로그인 검증용 (비밀번호 해시 포함). usrId 는 trim 후 정확히 일치 */
export async function findUserForLogin(q: Queryable, usrId: string): Promise<AppUserWithPassword | null> {
  const { rows } = await q.query<Row>(`SELECT ${BASE_COLUMNS}, usr_pwd FROM public.sys_app_usr_mng WHERE usr_id = $1`, [usrId]);
  const r = rows[0];
  if (!r) return null;
  return { ...toUser(r), passwordHash: r.usr_pwd ?? null };
}

/** 인증 상태 확인용 (비밀번호 제외) */
export async function findUserStatus(q: Queryable, usrId: string): Promise<AppUserRow | null> {
  const { rows } = await q.query<Row>(`SELECT ${BASE_COLUMNS} FROM public.sys_app_usr_mng WHERE usr_id = $1`, [usrId]);
  const r = rows[0];
  return r ? toUser(r) : null;
}

/** apr_yn 별 로그인 거부 문구 (관리자 화면과 동일 문구) */
export function approvalMessage(aprYn: string | null): string {
  switch (aprYn) {
    case 'N':
      return '관리자 승인 대기중입니다.';
    case 'D':
      return '삭제 요청된 상태입니다.';
    case 'R':
      return '승인 보류된 상태입니다.';
    case 'S':
      return '접속차단 상태입니다.';
    default:
      return '관리자에게 승인 상태를 확인하십시오.';
  }
}

export function isApproved(aprYn: string | null): boolean {
  return aprYn === 'Y';
}

/**
 * 거래처 (DESIGN §2.2) — public.mannager_by_hospital (테이블명 오타가 실제 이름).
 *  - 항상 user_id = 로그인 사용자 로 범위를 제한한다(다른 담당자 거래처는 존재 여부도 드러내지 않음).
 *  - hospital_type 은 capabilities.clientHospitalType 일 때만 SQL 에 등장한다.
 *  - 거래처명 중복: 같은 사용자 안에서 공백 정규화 + 대소문자 무시 비교.
 *  - 사업자번호 중복: 같은 사용자 안에서 숫자만 비교.
 */
import type { ClientApproval, ClientDetail, ClientDuplicateCheckResponse, ClientSummary } from '../../contract.js';
import type { Db, Queryable } from '../../db/pool.js';
import { checkBizNo, formatBizNo } from '../../lib/bizno.js';
import { AppError, DEFAULT_MESSAGE } from '../../lib/errors.js';
import { escapeLike } from '../../lib/validation.js';
import { matchManagers } from '../../services/managers.js';
import { CLIENT_MESSAGES, normalizeClientName, type ClientFieldLimits, type ValidClientCreate } from './validation.js';

export const CLIENT_NOT_FOUND_MESSAGE = '거래처를 찾을 수 없습니다.';
export const DUPLICATE_NAME_MESSAGE = DEFAULT_MESSAGE.DUPLICATE_CLIENT_NAME;
export const DUPLICATE_BIZ_NO_MESSAGE = DEFAULT_MESSAGE.DUPLICATE_BIZ_NO;

export interface ClientRepoOptions {
  /** mannager_by_hospital.hospital_type 컬럼 사용 (capabilities.clientHospitalType) */
  hospitalType: boolean;
  /** CLIENT_APPROVAL_REQUIRED_FOR_EDI */
  approvalRequiredForEdi: boolean;
}

export function approvalOf(v: boolean | null | undefined): ClientApproval {
  if (v === true) return 'approved';
  if (v === false) return 'pending';
  return 'unset';
}

/** 기존 규칙: approval !== false 면 선택 가능(null 포함). 설정으로 승인 요구를 끄면 항상 선택 가능 */
export function isSelectableForEdi(approval: boolean | null | undefined, approvalRequiredForEdi: boolean): boolean {
  return approvalRequiredForEdi ? approval !== false : true;
}

/** SQL 쪽 거래처명 정규화 (JS normalizeClientName + 소문자와 같은 의미) */
function normalizedNameSql(expr: string): string {
  return `lower(btrim(regexp_replace(${expr}, '[[:space:]]+', ' ', 'g')))`;
}

const DIGITS_ONLY = (expr: string) => `regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g')`;

interface SummaryRow {
  idx: number;
  hospital: string | null;
  hospital_type?: string | null;
  doctor_name: string | null;
  cpy_number: string | null;
  address: string | null;
  phone: string | null;
  approval: boolean | null;
}

interface DetailRow extends SummaryRow {
  zip_code: string | null;
  care_code: string | null;
  dispensary: string | null;
  ee: string | null;
  user_id: string;
}

function summaryColumns(opts: ClientRepoOptions): string {
  const cols = [
    'idx',
    'hospital::text AS hospital',
    'doctor_name::text AS doctor_name',
    'cpy_number::text AS cpy_number',
    'address::text AS address',
    'phone::text AS phone',
    'approval',
  ];
  if (opts.hospitalType) cols.push('hospital_type::text AS hospital_type');
  return cols.join(', ');
}

function detailColumns(opts: ClientRepoOptions): string {
  return [
    summaryColumns(opts),
    'zip_code::text AS zip_code',
    'care_code::text AS care_code',
    'dispensary::text AS dispensary',
    'ee::text AS ee',
    'user_id::text AS user_id',
  ].join(', ');
}

function textOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function toSummary(row: SummaryRow, opts: ClientRepoOptions): ClientSummary {
  return {
    idx: row.idx,
    name: textOrNull(row.hospital) ?? '',
    clientType: opts.hospitalType ? textOrNull(row.hospital_type) : null,
    representative: textOrNull(row.doctor_name),
    bizNo: formatBizNo(row.cpy_number),
    address: textOrNull(row.address),
    phone: textOrNull(row.phone),
    approval: approvalOf(row.approval),
    selectableForEdi: isSelectableForEdi(row.approval, opts.approvalRequiredForEdi),
  };
}

function toDetail(row: DetailRow, opts: ClientRepoOptions): ClientDetail {
  return {
    ...toSummary(row, opts),
    zipCode: textOrNull(row.zip_code),
    careCode: textOrNull(row.care_code),
    dispensary: textOrNull(row.dispensary),
    memo: textOrNull(row.ee),
    ownerUsrId: row.user_id,
  };
}

// ───────────────────────── 조회 ─────────────────────────

export interface ClientListOptions {
  q: string | undefined;
  limit: number;
  offset: number;
}

/** 검색: 이름·대표자·주소·전화·사업자번호 (숫자·하이픈만 입력하면 전화·사업자번호는 숫자만 비교) */
function searchCondition(text: string | undefined, params: unknown[]): string {
  if (!text) return '';
  params.push(`%${escapeLike(text)}%`); // LIKE 기본 이스케이프 문자는 역슬래시
  const p = `$${params.length}`;
  const ors = [`hospital ILIKE ${p}`, `doctor_name ILIKE ${p}`, `address ILIKE ${p}`, `phone ILIKE ${p}`, `cpy_number ILIKE ${p}`];
  const digits = text.replace(/\D/g, '');
  if (digits && /^[\d\s-]+$/.test(text)) {
    params.push(`%${digits}%`);
    const d = `$${params.length}`;
    ors.push(`${DIGITS_ONLY('cpy_number')} LIKE ${d}`, `${DIGITS_ONLY('phone')} LIKE ${d}`);
  }
  return ` AND (${ors.join(' OR ')})`;
}

export async function listClients(
  db: Queryable,
  usrId: string,
  list: ClientListOptions,
  opts: ClientRepoOptions,
): Promise<{ items: ClientSummary[]; total: number }> {
  const params: unknown[] = [usrId];
  const where = `WHERE user_id = $1${searchCondition(list.q, params)}`;
  const [count, rows] = await Promise.all([
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.mannager_by_hospital ${where}`, params),
    db.query<SummaryRow>(
      `SELECT ${summaryColumns(opts)} FROM public.mannager_by_hospital ${where}
        ORDER BY hospital COLLATE "C", idx
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, list.limit, list.offset],
    ),
  ]);
  return { items: rows.rows.map((r) => toSummary(r, opts)), total: count.rows[0]?.n ?? 0 };
}

/** 내 거래처 1건 (다른 사용자 소유면 null) */
export async function findClient(db: Queryable, usrId: string, idx: number, opts: ClientRepoOptions): Promise<ClientDetail | null> {
  const { rows } = await db.query<DetailRow>(
    `SELECT ${detailColumns(opts)} FROM public.mannager_by_hospital WHERE idx = $1 AND user_id = $2 LIMIT 1`,
    [idx, usrId],
  );
  const row = rows[0];
  return row ? toDetail(row, opts) : null;
}

/** 같은 사용자의 같은 이름(정규화) 거래처 idx */
export async function findDuplicateName(q: Queryable, usrId: string, name: string, excludeIdx?: number | null): Promise<number | null> {
  const { rows } = await q.query<{ idx: number }>(
    `SELECT idx FROM public.mannager_by_hospital
      WHERE user_id = $1 AND hospital IS NOT NULL
        AND ${normalizedNameSql('hospital')} = ${normalizedNameSql('$2::text')}
        AND ($3::int IS NULL OR idx <> $3::int)
      ORDER BY idx LIMIT 1`,
    [usrId, name, excludeIdx ?? null],
  );
  return rows[0]?.idx ?? null;
}

/** 같은 사용자의 같은 사업자번호(숫자만 비교) 거래처 idx */
export async function findDuplicateBizNo(q: Queryable, usrId: string, digits: string, excludeIdx?: number | null): Promise<number | null> {
  const { rows } = await q.query<{ idx: number }>(
    `SELECT idx FROM public.mannager_by_hospital
      WHERE user_id = $1 AND ${DIGITS_ONLY('cpy_number')} = $2
        AND ($3::int IS NULL OR idx <> $3::int)
      ORDER BY idx LIMIT 1`,
    [usrId, digits, excludeIdx ?? null],
  );
  return rows[0]?.idx ?? null;
}

// ───────────────────────── 중복 확인 (입력 중) ─────────────────────────

export interface DuplicateCheckInput {
  name?: string | undefined;
  bizNo?: string | undefined;
  excludeIdx?: number | undefined;
}

export async function checkClientDuplicate(
  db: Queryable,
  usrId: string,
  input: DuplicateCheckInput,
  limits: ClientFieldLimits,
): Promise<ClientDuplicateCheckResponse> {
  const result: ClientDuplicateCheckResponse = {
    name: { checked: false, duplicate: false, message: null },
    // 비어 있는 사업자번호는 선택 입력이므로 valid=true 로 둔다(checked=false)
    bizNo: { checked: false, valid: true, duplicate: false, message: null },
  };

  const name = normalizeClientName(input.name ?? '');
  if (name) {
    if (name.length > limits.name) {
      result.name = { checked: true, duplicate: false, message: CLIENT_MESSAGES.nameTooLong(limits.name) };
    } else {
      const dup = await findDuplicateName(db, usrId, name, input.excludeIdx);
      result.name = { checked: true, duplicate: dup !== null, message: dup !== null ? DUPLICATE_NAME_MESSAGE : null };
    }
  }

  const bizRaw = input.bizNo?.trim() ?? '';
  if (bizRaw) {
    const check = checkBizNo(bizRaw);
    if (!check.ok) {
      result.bizNo = { checked: true, valid: false, duplicate: false, message: check.message };
    } else {
      const dup = await findDuplicateBizNo(db, usrId, check.digits, input.excludeIdx);
      result.bizNo = { checked: true, valid: true, duplicate: dup !== null, message: dup !== null ? DUPLICATE_BIZ_NO_MESSAGE : null };
    }
  }
  return result;
}

// ───────────────────────── 등록 ─────────────────────────

/**
 * 거래처 등록 (approval = false). 같은 사용자의 동시 등록은 advisory lock 으로 직렬화해 중복 검사가 경쟁에 지지 않게 한다.
 * 이름·사업자번호 중복이면 409 (이름 우선, fields 에는 둘 다 표시).
 */
export async function createClient(db: Db, usrId: string, input: ValidClientCreate, opts: ClientRepoOptions): Promise<ClientDetail> {
  return db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ckp_app:client:${usrId}`]);
    await matchManagers(q, usrId);

    const nameDup = await findDuplicateName(q, usrId, input.name);
    const bizDup = input.bizNo ? await findDuplicateBizNo(q, usrId, input.bizNo.digits) : null;
    if (nameDup !== null || bizDup !== null) {
      const fields: Record<string, string> = {};
      if (nameDup !== null) fields.name = DUPLICATE_NAME_MESSAGE;
      if (bizDup !== null) fields.bizNo = DUPLICATE_BIZ_NO_MESSAGE;
      const code = nameDup !== null ? 'DUPLICATE_CLIENT_NAME' : 'DUPLICATE_BIZ_NO';
      throw new AppError(code, undefined, { fields, details: { existingIdx: nameDup ?? bizDup } });
    }

    const columns = ['hospital', 'user_id', 'doctor_name', 'cpy_number', 'address', 'zip_code', 'care_code', 'dispensary', 'phone', 'ee', 'approval'];
    const values: unknown[] = [
      input.name,
      usrId,
      input.representative,
      input.bizNo?.stored ?? null,
      input.address,
      input.zipCode,
      input.careCode,
      input.dispensary,
      input.phone,
      input.memo,
      false,
    ];
    if (opts.hospitalType) {
      columns.push('hospital_type');
      values.push(input.clientType);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const inserted = await q.query<{ idx: number }>(
      `INSERT INTO public.mannager_by_hospital (${columns.join(', ')}) VALUES (${placeholders}) RETURNING idx`,
      values,
    );
    const idx = inserted.rows[0]?.idx;
    if (idx === undefined) throw new AppError('SERVER_ERROR');

    const { rows } = await q.query<DetailRow>(`SELECT ${detailColumns(opts)} FROM public.mannager_by_hospital WHERE idx = $1`, [idx]);
    const row = rows[0];
    if (!row) throw new AppError('SERVER_ERROR');
    return toDetail(row, opts);
  });
}

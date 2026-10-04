/**
 * 읽기 전용 스키마 확인 (information_schema) → capabilities.
 * 서버 시작 시 1회 실행해 선택 기능을 켜고 끈다. 마이그레이션 적용 후에는 서버를 다시 시작해야 반영된다.
 *
 * 라우트 사용 예
 *   if (!deps.capabilities.ediAppTables) throw new AppError('SCHEMA_NOT_READY');
 *   if (deps.capabilities.ediIsCopy) { ...INSERT 에 is_copy=false 포함... }
 */
import type { Queryable } from './pool.js';

export interface ColumnInfo {
  dataType: string;
  maxLength: number | null;
  nullable: boolean;
}

/** 기능(라우트 묶음)별로 필요한 테이블·컬럼 */
export const REQUIRED_COLUMNS = {
  manager: ['user_id', 'name', 'company'],
  sys_app_usr_mng: ['usr_id', 'usr_pwd', 'usr_nam', 'cpy_nam', 'phone', 'email', 'role_id', 'apr_yn'],
  mannager_by_hospital: ['idx', 'hospital', 'user_id', 'doctor_name', 'cpy_number', 'address', 'zip_code', 'care_code', 'dispensary', 'phone', 'ee', 'approval'],
  medicine: [
    'medicine_code', 'name', 'company', 'medicine_packing', 'ingredient', 'pay', 'type1', 'type2', 'medicine_class', 'welfare_code',
    'contrast_medicine', 'medicine_add', 'ee', 'medicine_is', 'is_maker', 'image_url', 'reg_ymd',
  ],
  notice: ['idx', 'title', 'author', 'contents', 'reg_ymd', 'important'],
  edi: ['idx', 'deal_type', 'hospital_name', 'pharmacist', 'user_id', 'edi_image', 'reg_ymd', 'is_ocr', 'month', 'move_month', 'aws_url', 'ocr', 'create_at', 'print'],
  is_edi: ['edi'],
} as const satisfies Record<string, readonly string[]>;

export const APP_TABLE_COLUMNS = {
  ckp_app_edi_upload: [
    'upload_id', 'usr_id', 'client_photo_id', 'storage_driver', 'object_key', 'thumb_key', 'public_url', 'content_type', 'bytes', 'width',
    'height', 'sha256', 'status', 'created_at', 'used_at',
  ],
  ckp_app_edi_submission: [
    'submission_id', 'usr_id', 'idempotency_key', 'request_hash', 'client_idx', 'client_name', 'target_ym', 'month_label', 'memo',
    'photo_count', 'create_at_kst', 'reg_ymd', 'created_at',
  ],
  ckp_app_edi_submission_photo: ['submission_id', 'seq', 'edi_idx', 'upload_id'],
} as const satisfies Record<string, readonly string[]>;

/** 선택 앱 전용 테이블(migrations/002) — 없으면 refresh 토큰을 무상태로 처리 (EDI 기능과 무관) */
export const OPTIONAL_APP_TABLE_COLUMNS = {
  ckp_app_refresh_token: ['token_id', 'usr_id', 'family_id', 'token_hash', 'issued_at', 'expires_at', 'revoked_at', 'replaced_by'],
} as const satisfies Record<string, readonly string[]>;

const OPTIONAL_TABLES = ['frees'] as const;
const MEDICINE_TAX_COLUMNS = ['tax', 'tax_2', 'tax_3', 'tax_4'] as const;

export type RequiredTable = keyof typeof REQUIRED_COLUMNS;

export interface Capabilities {
  checkedAt: string; // ISO
  /** 필수 테이블·컬럼이 모두 있는지 */
  ok: boolean;
  /** 없는 필수 항목 ('table' 또는 'table.column') */
  missingRequired: string[];
  /** 기능별 사용 가능 여부 (해당 기능의 필수 테이블·컬럼 존재) */
  modules: {
    auth: boolean;
    medicines: boolean;
    notices: boolean;
    clients: boolean;
    /** 기존 edi·is_edi 테이블 */
    ediLegacy: boolean;
  };
  /** 앱 전용 테이블(migrations/001) 3개가 모두 있고 필요한 컬럼이 있는지 → 없으면 EDI 제출/내역 503 SCHEMA_NOT_READY */
  ediAppTables: boolean;
  /** 없는 앱 전용 항목 */
  missingAppTables: string[];
  /** refresh 토큰 기록 테이블(migrations/002, 선택) → 있으면 재발급 시 폐기·재사용 감지·로그아웃 폐기가 재시작 후에도 유지 */
  refreshTokenTable: boolean;
  /** edi.is_copy 컬럼 존재 (있으면 INSERT 시 false 기록) */
  ediIsCopy: boolean;
  /** mannager_by_hospital.hospital_type 존재 (거래처 구분) */
  clientHospitalType: boolean;
  /** frees 테이블(idx, name, list) 존재 */
  freesTable: boolean;
  /** medicine 에 있는 수수료 컬럼 (tax, tax_2, tax_3, tax_4 중) */
  medicineTaxColumns: string[];
  /** is_edi.coalition_company 존재 */
  isEdiCoalitionCompany: boolean;
  /** 확인한 테이블의 컬럼 정보 (길이 제한 확인 등) */
  columns: Record<string, Record<string, ColumnInfo>>;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
}

export async function checkSchema(q: Queryable): Promise<Capabilities> {
  const tables = [...Object.keys(REQUIRED_COLUMNS), ...Object.keys(APP_TABLE_COLUMNS), ...Object.keys(OPTIONAL_APP_TABLE_COLUMNS), ...OPTIONAL_TABLES];
  const { rows } = await q.query<ColumnRow>(
    `SELECT table_name::text AS table_name, column_name::text AS column_name, data_type::text AS data_type,
            character_maximum_length::int AS character_maximum_length, is_nullable::text AS is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [tables],
  );

  const columns: Record<string, Record<string, ColumnInfo>> = {};
  for (const r of rows) {
    (columns[r.table_name] ??= {})[r.column_name] = {
      dataType: r.data_type,
      maxLength: r.character_maximum_length,
      nullable: r.is_nullable === 'YES',
    };
  }
  const has = (table: string, column?: string) => (column ? Boolean(columns[table]?.[column]) : Boolean(columns[table]));

  const missingFor = (spec: Record<string, readonly string[]>, only?: string[]) => {
    const missing: string[] = [];
    for (const [table, cols] of Object.entries(spec)) {
      if (only && !only.includes(table)) continue;
      if (!has(table)) {
        missing.push(table);
        continue;
      }
      for (const c of cols) if (!has(table, c)) missing.push(`${table}.${c}`);
    }
    return missing;
  };

  const missingRequired = missingFor(REQUIRED_COLUMNS);
  const missingAppTables = missingFor(APP_TABLE_COLUMNS);
  const moduleOk = (...t: RequiredTable[]) => missingFor(REQUIRED_COLUMNS, t).length === 0;

  return {
    checkedAt: new Date().toISOString(),
    ok: missingRequired.length === 0,
    missingRequired,
    modules: {
      auth: moduleOk('sys_app_usr_mng', 'manager'),
      medicines: moduleOk('medicine'),
      notices: moduleOk('notice'),
      clients: moduleOk('mannager_by_hospital', 'manager'),
      ediLegacy: moduleOk('edi', 'is_edi', 'mannager_by_hospital'),
    },
    ediAppTables: missingAppTables.length === 0,
    missingAppTables,
    refreshTokenTable: missingFor(OPTIONAL_APP_TABLE_COLUMNS).length === 0,
    ediIsCopy: has('edi', 'is_copy'),
    clientHospitalType: has('mannager_by_hospital', 'hospital_type'),
    freesTable: has('frees', 'idx') && has('frees', 'name') && has('frees', 'list'),
    medicineTaxColumns: MEDICINE_TAX_COLUMNS.filter((c) => has('medicine', c)),
    isEdiCoalitionCompany: has('is_edi', 'coalition_company'),
    columns,
  };
}

/** 사람이 읽는 한국어 요약 (시작 로그·db:check 공통) */
export function describeCapabilities(c: Capabilities): string[] {
  const yn = (v: boolean) => (v ? '예' : '아니오');
  const lines = [
    `필수 테이블/컬럼: ${c.ok ? '모두 있음' : `누락 ${c.missingRequired.length}개 (${c.missingRequired.join(', ')})`}`,
    `기능별 사용 가능 — 로그인: ${yn(c.modules.auth)}, 의약품: ${yn(c.modules.medicines)}, 공지사항: ${yn(c.modules.notices)}, 거래처: ${yn(c.modules.clients)}, EDI(기존 테이블): ${yn(c.modules.ediLegacy)}`,
    `앱 전용 테이블(ckp_app_*, migrations/001): ${c.ediAppTables ? '있음' : `없음 → EDI 제출/내역 기능 사용 불가 (npm run db:migrate 필요) [${c.missingAppTables.join(', ')}]`}`,
    `refresh 토큰 기록 테이블(ckp_app_refresh_token, migrations/002, 선택): ${c.refreshTokenTable ? '있음 → 재발급 시 이전 토큰 폐기·재사용 감지·로그아웃 폐기(재시작 후에도 유지)' : '없음 → 무상태 방식(로그아웃 폐기는 메모리, 서버 재시작 시 초기화)'}`,
    `선택 컬럼 — edi.is_copy: ${yn(c.ediIsCopy)}, mannager_by_hospital.hospital_type: ${yn(c.clientHospitalType)}, is_edi.coalition_company: ${yn(c.isEdiCoalitionCompany)}`,
    `의약품 수수료 — frees 테이블: ${yn(c.freesTable)}, 수수료 컬럼: ${c.medicineTaxColumns.length > 0 ? c.medicineTaxColumns.join(', ') : '없음'}`,
  ];
  const awsUrl = c.columns.edi?.aws_url;
  if (awsUrl?.maxLength) lines.push(`edi.aws_url 최대 길이: ${awsUrl.maxLength}자`);
  return lines;
}

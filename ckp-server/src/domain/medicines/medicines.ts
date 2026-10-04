/**
 * 의약품 조회 (DESIGN §2.3) — public.medicine 은 조회 전용.
 *  - 반환 금지 컬럼: ee2(관리자 메모), is_live, decrease_tax → SELECT 목록에 절대 넣지 않는다.
 *  - 수수료: frees.list = true 인 첫 행(관리자 화면과 같은 ORDER BY idx)의 idx → tax / tax_2 / tax_3 / tax_4 컬럼.
 *    관리자 화면은 camelCase 키(tax2)를 쓰므로 'tax2'·'tax_2' 모두 받아들인다.
 */
import type { MedicineDetail, MedicineSearchField, MedicineSummary } from '../../contract.js';
import type { Queryable } from '../../db/pool.js';
import type { Capabilities } from '../../db/schema-check.js';
import { escapeLike } from '../../lib/validation.js';

export const MEDICINE_SEARCH_FIELDS = ['name', 'company', 'code', 'all'] as const satisfies readonly MedicineSearchField[];

/** 이름 정렬: 앞쪽 표식([X], [NP], ◎, ★, 공백)을 무시하고 바이트 순, 동률은 보험코드 */
export const MEDICINE_ORDER_BY = `regexp_replace(btrim(name), '^([[][^][]*[]]|◎|★|[[:space:]])+', '') COLLATE "C", medicine_code`;

const FEE_KEY_TO_COLUMN: Record<string, string> = {
  tax: 'tax',
  tax1: 'tax',
  tax2: 'tax_2',
  tax3: 'tax_3',
  tax4: 'tax_4',
};

const DEFAULT_FEE_LABEL = '수수료';

export interface FeeColumn {
  /** medicine 테이블의 실제 컬럼명 (화이트리스트 값만) */
  column: string;
  label: string;
}

export function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** frees.idx 값 → medicine 수수료 컬럼명 (없거나 모르는 값이면 null) */
export function feeColumnFromFreesIdx(idx: string | null | undefined, available: readonly string[]): string | null {
  const key = (idx ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
  const column = FEE_KEY_TO_COLUMN[key];
  return column && available.includes(column) ? column : null;
}

/**
 * 표시할 수수료 컬럼을 정한다. 기능 꺼짐·frees 없음·조회 실패·해당 행 없음 → null (수수료 표시 안 함).
 */
export async function resolveFeeColumn(q: Queryable, capabilities: Capabilities, visible: boolean): Promise<FeeColumn | null> {
  if (!visible || !capabilities.freesTable || capabilities.medicineTaxColumns.length === 0) return null;
  try {
    const { rows } = await q.query<{ idx: string | null; name: string | null }>(
      `SELECT idx::text AS idx, name::text AS name FROM public.frees WHERE list = true ORDER BY idx LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    const column = feeColumnFromFreesIdx(row.idx, capabilities.medicineTaxColumns);
    if (!column) return null;
    return { column, label: textOrNull(row.name) ?? DEFAULT_FEE_LABEL };
  } catch {
    return null;
  }
}

/** 약가 문자열 → 숫자 ('1,234' → 1234, '1,234원' → 1234, '미정' → null) */
export function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[,\s]/g, '').replace(/원$/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** https 주소만 통과 (http·javascript·상대경로 등은 null) */
export function httpsUrlOrNull(v: string | null | undefined): string | null {
  const t = textOrNull(v);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

interface SummaryRow {
  medicine_code: string;
  name: string | null;
  company: string | null;
  medicine_packing: string | null;
  ingredient: string | null;
  pay: string | null;
  is_maker: string | null;
  image_url: string | null;
  fee_value?: string | null;
}

interface DetailRow extends SummaryRow {
  type1: string | null;
  type2: string | null;
  medicine_class: string | null;
  welfare_code: string | null;
  contrast_medicine: string | null;
  medicine_add: string | null;
  ee: string | null;
  medicine_is: string | null;
  reg_ymd_text: string | null;
}

const SUMMARY_COLUMNS = [
  'medicine_code::text AS medicine_code',
  'name::text AS name',
  'company::text AS company',
  'medicine_packing::text AS medicine_packing',
  'ingredient::text AS ingredient',
  'pay::text AS pay',
  'is_maker::text AS is_maker',
  'image_url::text AS image_url',
];

const DETAIL_COLUMNS = [
  ...SUMMARY_COLUMNS,
  'type1::text AS type1',
  'type2::text AS type2',
  'medicine_class::text AS medicine_class',
  'welfare_code::text AS welfare_code',
  'contrast_medicine::text AS contrast_medicine',
  'medicine_add::text AS medicine_add',
  'ee::text AS ee',
  'medicine_is::text AS medicine_is',
  `to_char(reg_ymd, 'YYYY-MM-DD') AS reg_ymd_text`,
];

function selectList(columns: string[], fee: FeeColumn | null): string {
  // fee.column 은 FEE_KEY_TO_COLUMN 화이트리스트 값이므로 식별자로 넣어도 안전하다
  return [...columns, ...(fee ? [`${fee.column}::text AS fee_value`] : [])].join(', ');
}

function toSummary(row: SummaryRow, fee: FeeColumn | null): MedicineSummary {
  const priceText = textOrNull(row.pay);
  const feeValue = fee ? textOrNull(row.fee_value) : null;
  return {
    code: row.medicine_code,
    name: textOrNull(row.name) ?? '',
    company: textOrNull(row.company),
    packing: textOrNull(row.medicine_packing),
    ingredient: textOrNull(row.ingredient),
    priceText,
    price: parsePrice(priceText),
    fee: fee && feeValue ? { label: fee.label, value: feeValue } : null,
    inHouse: textOrNull(row.is_maker)?.toUpperCase() === 'O',
    imageUrl: httpsUrlOrNull(row.image_url),
  };
}

function toDetail(row: DetailRow, fee: FeeColumn | null): MedicineDetail {
  return {
    ...toSummary(row, fee),
    type1: textOrNull(row.type1),
    type2: textOrNull(row.type2),
    medicineClass: textOrNull(row.medicine_class),
    welfareCode: textOrNull(row.welfare_code),
    contrastMedicine: textOrNull(row.contrast_medicine),
    additives: textOrNull(row.medicine_add),
    note: textOrNull(row.ee),
    settlement: textOrNull(row.medicine_is),
    regYmd: row.reg_ymd_text ?? null,
  };
}

/** 검색 조건 WHERE 절 (파라미터는 params 에 추가) */
function searchWhere(field: MedicineSearchField, text: string | undefined, params: unknown[]): string {
  if (!text) return '';
  params.push(`%${escapeLike(text)}%`); // LIKE 기본 이스케이프 문자는 역슬래시
  const p = `$${params.length}`;
  switch (field) {
    case 'company':
      return `WHERE company ILIKE ${p}`;
    case 'code':
      return `WHERE medicine_code ILIKE ${p}`;
    case 'all':
      return `WHERE (name ILIKE ${p} OR company ILIKE ${p} OR medicine_code ILIKE ${p} OR ingredient ILIKE ${p})`;
    case 'name':
    default:
      return `WHERE name ILIKE ${p}`;
  }
}

export interface MedicineListOptions {
  q: string | undefined;
  field: MedicineSearchField;
  limit: number;
  offset: number;
  fee: FeeColumn | null;
}

export async function listMedicines(db: Queryable, opts: MedicineListOptions): Promise<{ items: MedicineSummary[]; total: number }> {
  const params: unknown[] = [];
  const where = searchWhere(opts.field, opts.q, params);
  const countSql = `SELECT count(*)::int AS n FROM public.medicine ${where}`;
  const rowsSql =
    `SELECT ${selectList(SUMMARY_COLUMNS, opts.fee)} FROM public.medicine ${where} ` +
    `ORDER BY ${MEDICINE_ORDER_BY} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const [count, rows] = await Promise.all([
    db.query<{ n: number }>(countSql, params),
    db.query<SummaryRow>(rowsSql, [...params, opts.limit, opts.offset]),
  ]);
  return { items: rows.rows.map((r) => toSummary(r, opts.fee)), total: count.rows[0]?.n ?? 0 };
}

export async function findMedicine(db: Queryable, code: string, fee: FeeColumn | null): Promise<MedicineDetail | null> {
  const { rows } = await db.query<DetailRow>(
    `SELECT ${selectList(DETAIL_COLUMNS, fee)} FROM public.medicine WHERE medicine_code = $1 LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row ? toDetail(row, fee) : null;
}

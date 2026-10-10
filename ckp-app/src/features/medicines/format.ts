import type { MedicineSearchField, MedicineSummary } from '@/lib/api';
import { formatPrice, hasValue } from '@/lib/format';

export const SEARCH_FIELD_OPTIONS: readonly { value: MedicineSearchField; label: string }[] = [
  { value: 'name', label: '의약품명' },
  { value: 'company', label: '제약사' },
  { value: 'code', label: '보험코드' },
  { value: 'all', label: '전체' },
];

export const SEARCH_PLACEHOLDER: Record<MedicineSearchField, string> = {
  name: '의약품명으로 검색',
  company: '제약사로 검색',
  code: '보험코드로 검색',
  all: '의약품명·제약사·보험코드·성분으로 검색',
};

export function fieldLabel(field: MedicineSearchField): string {
  return SEARCH_FIELD_OPTIONS.find((o) => o.value === field)?.label ?? '';
}

/** 수수료 표시 라벨 — 서버가 주는 frees 이름(예: 'Total') 대신 항상 '수수료' 로 보여 준다 */
export const FEE_LABEL = '수수료';

/** 약가 표시 ('12,345원' / '미정' / '') */
export function medicinePrice(item: Pick<MedicineSummary, 'price' | 'priceText'>): string {
  return formatPrice(item.price, item.priceText);
}

/** 정산여부 원문(Y/N/기타) → 표시 문구 */
export function settlementLabel(value: string | null | undefined): string {
  const v = value?.trim();
  if (!v) return '';
  if (v.toUpperCase() === 'Y') return '정산 대상';
  if (v.toUpperCase() === 'N') return '정산 제외';
  return v;
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' (형식이 다르면 원문) */
export function formatDotDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : ymd;
}

/** 목록 카드·표의 스크린리더 문구 */
export function medicineA11yLabel(item: MedicineSummary, showFee: boolean): string {
  const price = medicinePrice(item);
  return [
    item.name,
    item.inHouse ? '자사생산' : null,
    item.company,
    item.packing,
    `보험코드 ${item.code}`,
    price ? `약가 ${price}` : null,
    showFee && item.fee ? `${FEE_LABEL} ${item.fee.value}` : null,
  ]
    .filter((v): v is string => hasValue(v))
    .join(', ');
}

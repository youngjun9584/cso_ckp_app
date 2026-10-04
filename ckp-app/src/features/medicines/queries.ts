/** 의약품 조회 쿼리 (GET /v1/medicines, /v1/medicines/:code) */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { ApiError, getApi, type MedicineSearchField, type MedicineSummary } from '@/lib/api';

export const MEDICINE_PAGE_SIZE = 30;

export const medicineKeys = {
  all: ['medicines'] as const,
  list: (q: string, field: MedicineSearchField) => ['medicines', 'list', { q, field }] as const,
  detail: (code: string) => ['medicines', 'detail', code] as const,
};

/** 검색어가 없으면 검색 기준은 의미가 없으므로 같은 캐시를 쓴다 */
export function effectiveField(q: string, field: MedicineSearchField): MedicineSearchField {
  return q ? field : 'name';
}

export function useMedicineList(q: string, field: MedicineSearchField) {
  const f = effectiveField(q, field);
  return useInfiniteQuery({
    queryKey: medicineKeys.list(q, f),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getApi().listMedicines({ q: q || undefined, field: f, page: pageParam, pageSize: MEDICINE_PAGE_SIZE }, { signal }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    // 검색어를 바꾸는 동안 이전 결과를 유지해 화면이 깜빡이지 않게 한다
    placeholderData: keepPreviousData,
  });
}

/** 여러 페이지를 하나의 목록으로 (오프셋 페이지 사이 중복 제거) */
export function flattenMedicines(pages: readonly { items: MedicineSummary[] }[] | undefined): MedicineSummary[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: MedicineSummary[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.code)) continue;
      seen.add(item.code);
      out.push(item);
    }
  }
  return out;
}

export function useMedicineDetail(code: string) {
  return useQuery({
    queryKey: medicineKeys.detail(code),
    queryFn: ({ signal }) => getApi().getMedicine(code, { signal }),
    enabled: code.length > 0,
  });
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'NOT_FOUND');
}

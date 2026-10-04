/** 거래처 조회 훅·쿼리 키 (목록 화면과 ClientPicker 가 같은 캐시를 쓴다) */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { getApi, type ClientListResponse, type ClientSummary } from '@/lib/api';

export const CLIENT_PAGE_SIZE = 30;

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => ['clients', 'list'] as const,
  list: (q: string) => ['clients', 'list', { q }] as const,
  details: () => ['clients', 'detail'] as const,
  detail: (idx: number) => ['clients', 'detail', idx] as const,
};

/** 내 거래처 목록 (무한 스크롤). 검색어가 바뀌는 동안 이전 결과를 유지한다. */
export function useClientList(q: string, options: { enabled?: boolean } = {}) {
  const query = q.trim();
  return useInfiniteQuery({
    queryKey: clientKeys.list(query),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getApi().listClients({ q: query || undefined, page: pageParam, pageSize: CLIENT_PAGE_SIZE }, { signal }),
    getNextPageParam: (last: ClientListResponse) => (last.hasMore ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** 페이지를 이어 붙인다 (페이지 사이 중복 idx 제거) */
export function flattenClients(pages: readonly ClientListResponse[] | undefined): ClientSummary[] {
  if (!pages) return [];
  const seen = new Set<number>();
  const out: ClientSummary[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.idx)) continue;
      seen.add(item.idx);
      out.push(item);
    }
  }
  return out;
}

/** 거래처 상세. idx 가 null 이면 요청하지 않는다. */
export function useClientDetail(idx: number | null) {
  return useQuery({
    queryKey: clientKeys.detail(idx ?? 0),
    queryFn: ({ signal }) => getApi().getClient(idx as number, { signal }),
    enabled: idx !== null,
  });
}

/** 경로 파라미터 → 거래처 번호 (형식이 틀리면 null) */
export function parseClientIdx(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 2_147_483_647 ? n : null;
}

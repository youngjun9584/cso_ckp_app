/** EDI 등록 내역 조회 (React Query) */
import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';

import { getApi, type EdiSubmissionDetail } from '@/lib/api';

export const EDI_HISTORY_PAGE_SIZE = 20;

export const ediHistoryKeys = {
  all: ['edi', 'submissions'] as const,
  list: (ym: string) => ['edi', 'submissions', ym] as const,
  detail: (id: string) => ['edi', 'submission', id] as const,
};

/** 등록월(KST) 기준 제출 건 목록 — 최신순, 무한 스크롤 */
export function useEdiSubmissions(ym: string) {
  return useInfiniteQuery({
    queryKey: ediHistoryKeys.list(ym),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getApi().listEdiSubmissions({ ym, page: pageParam, pageSize: EDI_HISTORY_PAGE_SIZE }, { signal }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

/** 제출 건 상세 — 사진은 서버 seq 순서 그대로 */
export function useEdiSubmission(id: string) {
  return useQuery({
    queryKey: ediHistoryKeys.detail(id),
    queryFn: ({ signal }) => getApi().getEdiSubmission(id, { signal }),
    enabled: id.length > 0,
  });
}

/**
 * 새 제출 후 호출: 내역 목록을 새로 고치고, 방금 받은 상세를 캐시에 넣어 상세 화면이 바로 열리게 한다.
 * (EDI 새 등록 화면에서 사용)
 */
export function invalidateEdiHistory(queryClient: QueryClient, created?: EdiSubmissionDetail): Promise<void> {
  if (created) queryClient.setQueryData(ediHistoryKeys.detail(created.id), { submission: created });
  return queryClient.invalidateQueries({ queryKey: ediHistoryKeys.all });
}

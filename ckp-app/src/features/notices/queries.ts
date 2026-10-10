/** 공지사항 조회 쿼리 (GET /v1/notices, /v1/notices/:idx) */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { getApi, type NoticeSummary } from '@/lib/api';

export const NOTICE_PAGE_SIZE = 30;

export const noticeKeys = {
  all: ['notices'] as const,
  list: (q: string) => ['notices', 'list', { q }] as const,
  detail: (idx: number) => ['notices', 'detail', idx] as const,
};

export function useNoticeList(q: string) {
  const query = useInfiniteQuery({
    queryKey: noticeKeys.list(q),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getApi().listNotices({ q: q || undefined, page: pageParam, pageSize: NOTICE_PAGE_SIZE }, { signal }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  // Tabs remain mounted: opening the notices tab must also pick up newly published posts.
  const { refetch } = query;
  useFocusEffect(useCallback(() => {
    void refetch({ cancelRefetch: false });
  }, [refetch]));
  return query;
}

export function flattenNotices(pages: readonly { items: NoticeSummary[] }[] | undefined): NoticeSummary[] {
  if (!pages) return [];
  const seen = new Set<number>();
  const out: NoticeSummary[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.idx)) continue;
      seen.add(item.idx);
      out.push(item);
    }
  }
  return out;
}

/** idx 가 올바르지 않으면(null) 요청하지 않는다 */
export function useNoticeDetail(idx: number | null) {
  const query = useQuery({
    queryKey: noticeKeys.detail(idx ?? 0),
    queryFn: ({ signal }) => getApi().getNotice(idx ?? 0, { signal }),
    enabled: idx !== null,
  });
  const { refetch } = query;
  useFocusEffect(useCallback(() => {
    if (idx !== null) void refetch({ cancelRefetch: false });
  }, [idx, refetch]));
  return query;
}

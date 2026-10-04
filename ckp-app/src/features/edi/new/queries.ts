/** EDI 새 등록 화면에서 쓰는 서버 조회 (React Query) */
import { useQuery } from '@tanstack/react-query';

import { getApi } from '@/lib/api';

/** 등록 내역(내역 화면 담당) 목록 키 접두어 — 제출 성공 후 무효화한다 */
export const EDI_HISTORY_QUERY_KEY = ['edi', 'submissions'] as const;
export const EDI_STATUS_QUERY_KEY = ['edi', 'status'] as const;
export const EDI_MONTH_OPTIONS_QUERY_KEY = ['edi', 'month-options'] as const;

/** 관리자 EDI 차단 여부 — 화면에 들어올 때마다 새로 확인 */
export function useEdiStatus() {
  return useQuery({
    queryKey: EDI_STATUS_QUERY_KEY,
    queryFn: ({ signal }) => getApi().getEdiStatus({ signal }),
    staleTime: 15_000,
    refetchOnMount: 'always',
  });
}

/** 대상 연월 3개 (서버가 KST 로 계산) */
export function useEdiMonthOptions() {
  return useQuery({
    queryKey: EDI_MONTH_OPTIONS_QUERY_KEY,
    queryFn: ({ signal }) => getApi().getEdiMonthOptions({ signal }),
    staleTime: 10 * 60_000,
  });
}

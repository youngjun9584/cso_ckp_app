/** GET /v1/meta — 서버 정보·기능 플래그·제한값 (인증 불필요) */
import { useQuery } from '@tanstack/react-query';

import { getApi } from '@/lib/api';
import type { EdiLimits, MetaResponse } from '@/lib/api/contract';
import { DEFAULT_EDI_LIMITS, DEFAULT_FEATURES } from '@/lib/api/defaults';
import { config } from '@/lib/config';

export const metaQueryKey = ['meta'] as const;

export function useMeta() {
  return useQuery({
    queryKey: metaQueryKey,
    queryFn: ({ signal }) => getApi().getMeta({ signal }),
    staleTime: 5 * 60_000,
  });
}

/** EDI 제한값 (meta 를 받기 전에는 기본값) */
export function useLimits(): EdiLimits {
  return useMeta().data?.limits ?? DEFAULT_EDI_LIMITS;
}

/** 서버 기능 플래그 (meta 를 받기 전에는 기본값) */
export function useFeatures(): MetaResponse['features'] {
  return useMeta().data?.features ?? DEFAULT_FEATURES;
}

export type DataSourceKind = 'sample' | 'development' | 'production' | 'unknown';

export interface DataSourceInfo {
  kind: DataSourceKind;
  /** '샘플 모드' | '개발 서버' | '운영 서버' | '확인 중' */
  label: string;
}

/** 현재 데이터 출처: 샘플 모드 / 개발 서버(테스트 데이터) / 운영 서버 */
export function useDataSource(): DataSourceInfo {
  const meta = useMeta();
  if (config.apiMode === 'sample') return { kind: 'sample', label: '샘플 모드' };
  if (meta.data?.dataSource === 'development') return { kind: 'development', label: '개발 서버' };
  if (meta.data?.dataSource === 'production') return { kind: 'production', label: '운영 서버' };
  return { kind: 'unknown', label: meta.isError ? '확인할 수 없음' : '확인 중' };
}

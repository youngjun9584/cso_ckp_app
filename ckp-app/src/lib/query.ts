/** React Query 공통 설정 (DESIGN §6.4: staleTime 30초, 재시도 1회 — 4xx 제외) */
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { QueryClient, focusManager } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/errors';

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.isClientError || error.isAborted)) return false;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetry,
    },
    mutations: {
      retry: false,
    },
  },
});

/** 네이티브 앱이 다시 활성화되면 오래된 쿼리를 새로 고친다 (웹은 React Query 기본 동작) */
export function useAppStateFocusManager(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);
}

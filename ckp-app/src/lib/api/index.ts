/**
 * API 진입점. 화면·훅에서는 항상 getApi() 로 CkpApi 를 얻는다.
 *   const api = getApi();
 *   useQuery({ queryKey: ['medicines', q], queryFn: ({ signal }) => api.listMedicines({ q }, { signal }) })
 */
import type { CkpApi } from './client';
import { createHttpApi } from './http';
import { createSampleApi } from './sample';
import { config } from '@/lib/config';
import { sessionEvents } from '@/lib/auth/session-events';
import { tokenStore } from '@/lib/auth/tokens';

let instance: CkpApi | null = null;

export function getApi(): CkpApi {
  if (!instance) {
    const onSessionExpired = () => sessionEvents.emitExpired();
    instance =
      config.apiMode === 'live' && config.apiBaseUrl
        ? createHttpApi({
            baseUrl: config.apiBaseUrl,
            platform: config.platform,
            tokens: tokenStore,
            onSessionExpired,
            timeoutMs: config.requestTimeoutMs,
            uploadTimeoutMs: config.uploadTimeoutMs,
          })
        : createSampleApi({ platform: config.platform, onSessionExpired });
  }
  return instance;
}

export type * from './client';
export * from './contract';
export { ApiError, MSG as API_MESSAGES, getErrorMessage, isApiError } from './errors';
export type { ApiClientErrorCode } from './errors';
export { DEFAULT_EDI_LIMITS, DEFAULT_FEATURES } from './defaults';

/**
 * 실서버 CkpApi 구현 (DESIGN §6.4).
 * - JSON fetch(전역 fetch = expo/fetch), 타임아웃 20초
 * - access 토큰이 없거나 곧 만료되면 먼저 refresh, 401 이면 refresh 1회 후 같은 요청 재시도
 * - refresh 실패 → 토큰 삭제 + onSessionExpired() → 로그인 화면
 * - 오류는 항상 ApiError(code, message, fields, status, isNetwork, isTimeout)
 */
import type { CkpApi, UploadFile, UploadProgressHandler } from './client';
import type {
  AuthTokensResponse,
  CheckUserIdResponse,
  ClientPlatform,
  EdiUploadResponse,
  LoginRequest,
  RefreshRequest,
  RegisterResponse,
} from './contract';
import { ApiError, MSG, parseJsonSafe, toApiError } from './errors';
import { xhrUpload } from './upload';
import type { TokenStore } from '@/lib/auth/tokens';

export { ApiError } from './errors';

export interface HttpApiOptions {
  baseUrl: string;
  platform: ClientPlatform;
  tokens: TokenStore;
  onSessionExpired: () => void;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
}

type QueryValue = string | number | boolean | null | undefined;

interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** 기본 true: Authorization 헤더 + 401 처리 */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** web 에서 refresh 쿠키(ckp_rt)를 주고받아야 하는 요청 */
  withCookies?: boolean;
}

interface RawResponse {
  status: number;
  /** undefined = JSON 해석 실패, null = 빈 본문 */
  body: unknown;
}

const isOk = (status: number) => status >= 200 && status < 300;

function isTokensResponse(value: unknown): value is AuthTokensResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { accessToken?: unknown }).accessToken === 'string' &&
    typeof (value as { user?: unknown }).user === 'object'
  );
}

export function createHttpApi(options: HttpApiOptions): CkpApi {
  const base = options.baseUrl.replace(/\/+$/, '');
  const { tokens, platform } = options;
  const isWeb = platform === 'web';
  const defaultTimeout = options.timeoutMs ?? 20_000;
  let refreshInFlight: Promise<AuthTokensResponse | null> | null = null;

  function buildUrl(path: string, query?: Record<string, QueryValue>): string {
    let url = `${base}${path}`;
    if (query) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
      if (parts.length) url += `?${parts.join('&')}`;
    }
    return url;
  }

  async function send(path: string, cfg: RequestConfig, token: string | null): Promise<RawResponse> {
    if (cfg.signal?.aborted) throw ApiError.aborted();

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, cfg.timeoutMs ?? defaultTimeout);
    const onCallerAbort = () => controller.abort();
    cfg.signal?.addEventListener('abort', onCallerAbort);

    const headers: Record<string, string> = { Accept: 'application/json', ...cfg.headers };
    let body: string | undefined;
    if (cfg.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(cfg.body);
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(buildUrl(path, cfg.query), {
        method: cfg.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
        // native 는 쿠키를 쓰지 않는다. web 은 인증 경로에서만 쿠키 포함.
        credentials: isWeb ? (cfg.withCookies ? 'include' : 'same-origin') : 'omit',
      });
      const text = await res.text();
      return { status: res.status, body: parseJsonSafe(text) };
    } catch {
      if (timedOut) throw ApiError.timeout();
      if (cfg.signal?.aborted) throw ApiError.aborted();
      throw ApiError.network();
    } finally {
      clearTimeout(timer);
      cfg.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  function unwrap<T>(res: RawResponse): T {
    if (!isOk(res.status)) throw toApiError(res.status, res.body);
    if (res.status === 204) return undefined as T;
    if (res.body === undefined) {
      throw new ApiError({ code: 'INVALID_RESPONSE', message: MSG.invalidResponse, status: res.status });
    }
    return res.body as T;
  }

  function sessionExpiredError(): ApiError {
    return new ApiError({ code: 'UNAUTHORIZED', message: MSG.sessionExpired, status: 401 });
  }

  function expireSession(): ApiError {
    void tokens.clear();
    options.onSessionExpired();
    return sessionExpiredError();
  }

  async function storeTokens(res: AuthTokensResponse): Promise<void> {
    tokens.setAccessToken(res.accessToken, res.accessTokenExpiresAt);
    if (res.refreshToken) await tokens.setRefreshToken(res.refreshToken);
  }

  /** refresh 1회 실행. 세션이 없거나 거부되면 null, 네트워크/서버 오류는 throw(토큰 유지) */
  async function doRefresh(): Promise<AuthTokensResponse | null> {
    const refreshToken = isWeb ? undefined : await tokens.getRefreshToken();
    if (!isWeb && !refreshToken) return null;
    const payload: RefreshRequest = { platform, refreshToken: refreshToken ?? undefined };
    const res = await send('/v1/auth/refresh', { method: 'POST', body: payload, withCookies: true }, null);
    if (isOk(res.status) && isTokensResponse(res.body)) {
      await storeTokens(res.body);
      return res.body;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      await tokens.clear();
      return null;
    }
    throw toApiError(res.status, res.body);
  }

  /** 동시에 여러 요청이 401 을 받아도 refresh 는 한 번만 */
  function ensureRefreshed(): Promise<AuthTokensResponse | null> {
    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function ensureAccessToken(): Promise<void> {
    if (tokens.isAccessTokenFresh()) return;
    const refreshed = await ensureRefreshed();
    if (!refreshed) throw expireSession();
  }

  async function request<T>(path: string, cfg: RequestConfig = {}): Promise<T> {
    const auth = cfg.auth ?? true;
    if (!auth) return unwrap<T>(await send(path, cfg, null));

    await ensureAccessToken();
    let res = await send(path, cfg, tokens.getAccessToken());
    if (res.status === 401) {
      const refreshed = await ensureRefreshed();
      if (!refreshed) throw expireSession();
      res = await send(path, cfg, tokens.getAccessToken());
      if (res.status === 401) throw expireSession();
    }
    return unwrap<T>(res);
  }

  async function uploadOnce(
    file: UploadFile,
    clientPhotoId: string,
    onProgress: UploadProgressHandler | undefined,
    signal: AbortSignal | undefined,
  ): Promise<EdiUploadResponse> {
    const token = tokens.getAccessToken();
    const result = await xhrUpload({
      url: buildUrl('/v1/edi/uploads'),
      file,
      fields: { clientPhotoId },
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      onProgress,
      signal,
      timeoutMs: options.uploadTimeoutMs ?? 90_000,
    });
    return result.body as EdiUploadResponse;
  }

  const api: CkpApi = {
    mode: 'live',
    baseUrl: base,

    resolveUrl(url) {
      if (!url) return null;
      if (/^(https?:|data:|blob:|file:)/i.test(url)) return url;
      if (url.startsWith('/')) return `${base}${url}`;
      return url;
    },

    getMeta: (opts) => request('/v1/meta', { auth: false, signal: opts?.signal }),

    async login({ usrId, password }) {
      const payload: LoginRequest = { usrId: usrId.trim(), password, platform };
      const res = await send('/v1/auth/login', { method: 'POST', body: payload, withCookies: true }, null);
      const body = unwrap<AuthTokensResponse>(res);
      if (!isTokensResponse(body)) {
        throw new ApiError({ code: 'INVALID_RESPONSE', message: MSG.invalidResponse, status: res.status });
      }
      await storeTokens(body);
      return body;
    },

    async refresh() {
      const refreshed = await ensureRefreshed();
      if (!refreshed) throw sessionExpiredError();
      return refreshed;
    },

    async restoreSession() {
      const refreshed = await ensureRefreshed();
      return refreshed?.user ?? null;
    },

    async logout() {
      try {
        // native 는 쿠키가 없으므로 refresh 토큰을 본문으로 보내야 서버가 그 로그인을 폐기한다 (web 은 쿠키 ckp_rt)
        const refreshToken = isWeb ? null : await tokens.getRefreshToken().catch(() => null);
        await send(
          '/v1/auth/logout',
          { method: 'POST', body: { platform, refreshToken: refreshToken ?? undefined }, withCookies: true, timeoutMs: 8_000 },
          tokens.getAccessToken(),
        );
      } catch {
        // 서버에 알리지 못해도 로컬 세션은 정리한다
      } finally {
        await tokens.clear();
      }
    },

    me: (opts) => request('/v1/auth/me', { signal: opts?.signal }),

    // 회원가입: Authorization 헤더·쿠키 없이 보내고, 성공해도 토큰을 저장하지 않는다(승인 대기 계정)
    checkUserId: (usrId, opts) =>
      request<CheckUserIdResponse>('/v1/auth/check-id', {
        auth: false,
        query: { usrId: usrId.trim() },
        signal: opts?.signal,
      }),
    register: (body, opts) =>
      request<RegisterResponse>('/v1/auth/register', {
        method: 'POST',
        auth: false,
        body,
        signal: opts?.signal,
      }),

    listMedicines: (params, opts) =>
      request('/v1/medicines', {
        query: { q: params.q, field: params.field, page: params.page, pageSize: params.pageSize },
        signal: opts?.signal,
      }),
    getMedicine: (code, opts) => request(`/v1/medicines/${encodeURIComponent(code)}`, { signal: opts?.signal }),

    listNotices: (params, opts) =>
      request('/v1/notices', {
        query: { q: params.q, page: params.page, pageSize: params.pageSize },
        signal: opts?.signal,
      }),
    getNotice: (idx, opts) => request(`/v1/notices/${encodeURIComponent(String(idx))}`, { signal: opts?.signal }),

    listClients: (params, opts) =>
      request('/v1/clients', {
        query: { q: params.q, page: params.page, pageSize: params.pageSize },
        signal: opts?.signal,
      }),
    getClient: (idx, opts) => request(`/v1/clients/${encodeURIComponent(String(idx))}`, { signal: opts?.signal }),
    checkClientDuplicate: (params, opts) =>
      request('/v1/clients/check-duplicate', {
        query: { name: params.name, bizNo: params.bizNo, excludeIdx: params.excludeIdx },
        signal: opts?.signal,
      }),
    createClient: (body, opts) => request('/v1/clients', { method: 'POST', body, signal: opts?.signal }),

    getEdiStatus: (opts) => request('/v1/edi/status', { signal: opts?.signal }),
    getEdiMonthOptions: (opts) => request('/v1/edi/month-options', { signal: opts?.signal }),

    async uploadEdiPhoto(file, clientPhotoId, onProgress, signal) {
      await ensureAccessToken();
      try {
        return await uploadOnce(file, clientPhotoId, onProgress, signal);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshed = await ensureRefreshed();
        if (!refreshed) throw expireSession();
        return uploadOnce(file, clientPhotoId, onProgress, signal);
      }
    },

    createEdiSubmission: (body, idempotencyKey, opts) =>
      request('/v1/edi/submissions', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
        timeoutMs: 30_000,
        signal: opts?.signal,
      }),
    listEdiSubmissions: (params, opts) =>
      request('/v1/edi/submissions', {
        query: { ym: params.ym, page: params.page, pageSize: params.pageSize },
        signal: opts?.signal,
      }),
    getEdiSubmission: (id, opts) => request(`/v1/edi/submissions/${encodeURIComponent(id)}`, { signal: opts?.signal }),
  };

  return api;
}

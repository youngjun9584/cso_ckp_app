/**
 * 토큰 저장소.
 * - access 토큰: 항상 메모리에만 (앱 재시작 시 refresh 로 다시 받는다)
 * - refresh 토큰: native 는 SecureStore, web 은 저장하지 않음(httpOnly 쿠키 ckp_rt 를 서버가 관리)
 * 모듈 최상위에서는 저장소에 접근하지 않는다(웹 SPA/정적 렌더 안전).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'ckp.refreshToken';

export interface TokenStore {
  getAccessToken(): string | null;
  /** 만료 30초 전부터는 만료된 것으로 본다 */
  isAccessTokenFresh(): boolean;
  setAccessToken(token: string, expiresAtIso: string): void;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
  clear(): Promise<void>;
}

let accessToken: string | null = null;
let accessExpiresAt = 0;

export const tokenStore: TokenStore = {
  getAccessToken() {
    return accessToken;
  },
  isAccessTokenFresh() {
    return !!accessToken && Date.now() < accessExpiresAt - 30_000;
  },
  setAccessToken(token, expiresAtIso) {
    accessToken = token;
    const parsed = Date.parse(expiresAtIso);
    // 만료 시각을 해석하지 못하면 25분 유효로 가정 (서버 기본 30분)
    accessExpiresAt = Number.isFinite(parsed) ? parsed : Date.now() + 25 * 60_000;
  },
  async getRefreshToken() {
    if (Platform.OS === 'web') return null;
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  async setRefreshToken(token) {
    if (Platform.OS === 'web') return;
    try {
      if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
      else await SecureStore.deleteItemAsync(REFRESH_KEY);
    } catch {
      // 저장 실패 시 다음 실행에서 다시 로그인하면 된다
    }
  },
  async clear() {
    accessToken = null;
    accessExpiresAt = 0;
    await this.setRefreshToken(null);
  },
};

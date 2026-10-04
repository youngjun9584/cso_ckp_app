/**
 * 앱 실행 설정.
 * - EXPO_PUBLIC_API_BASE_URL : API 서버 주소 (예: http://192.168.0.10:4000). 비우면 샘플 모드.
 * - EXPO_PUBLIC_API_MODE     : live | sample. sample 이면 주소가 있어도 샘플 모드.
 * EXPO_PUBLIC_* 값은 빌드 시 코드에 치환되므로 반드시 process.env.EXPO_PUBLIC_XXX 형태로 직접 읽는다.
 */
import { Platform } from 'react-native';

import type { ClientPlatform } from '@/lib/api/contract';

export type ApiMode = 'live' | 'sample';

const rawBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const rawMode = (process.env.EXPO_PUBLIC_API_MODE ?? '').trim().toLowerCase();

function resolveMode(): ApiMode {
  if (rawMode === 'sample') return 'sample';
  if (!rawBaseUrl) {
    if (rawMode === 'live') {
      console.warn('[CKP] EXPO_PUBLIC_API_MODE=live 이지만 EXPO_PUBLIC_API_BASE_URL 이 비어 있어 샘플 모드로 실행합니다.');
    }
    return 'sample';
  }
  return 'live';
}

export const config = {
  apiMode: resolveMode(),
  /** live 모드에서만 값이 있다 (끝의 / 제거됨) */
  apiBaseUrl: rawBaseUrl || null,
  platform: (Platform.OS === 'web' ? 'web' : 'native') as ClientPlatform,
  /** 일반 요청 타임아웃 */
  requestTimeoutMs: 20_000,
  /** 사진 업로드 타임아웃 */
  uploadTimeoutMs: 90_000,
} as const;

export const isSampleMode = config.apiMode === 'sample';

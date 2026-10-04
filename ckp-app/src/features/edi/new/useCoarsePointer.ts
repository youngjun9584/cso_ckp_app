/**
 * 손가락 입력(터치) 기기인지. 웹에서 마우스는 짧게 눌러 끌기, 휴대폰 브라우저는 길게 눌러 끌기(스크롤과 구분)에 쓴다.
 * native 는 항상 true. 렌더 중에 window 를 직접 읽지 않고 useSyncExternalStore 로 구독한다.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const QUERY = '(pointer: coarse)';

function media(): MediaQueryList | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mql = media();
  if (!mql) return () => undefined;
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (Platform.OS !== 'web') return true;
  return media()?.matches ?? false;
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => Platform.OS !== 'web');
}

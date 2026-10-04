import { useSyncExternalStore } from 'react';
import { Dimensions, Platform } from 'react-native';

import { layout } from './tokens';

function subscribe(onChange: () => void): () => void {
  const sub = Dimensions.addEventListener('change', onChange);
  return () => sub.remove();
}

function getSnapshot(): boolean {
  return Platform.OS === 'web' && Dimensions.get('window').width >= layout.wideMinWidth;
}

/** 서버/정적 렌더와 하이드레이션 첫 렌더에서는 항상 모바일 레이아웃 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * 넓은 화면(웹 && 창 너비 ≥ 1024) 여부.
 * useSyncExternalStore 로 창 크기 변경을 구독하며, 하이드레이션 중에는 false 를 돌려 불일치를 피한다.
 */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

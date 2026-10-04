import { Platform } from 'react-native';

import { colors } from '@/theme';

/** 각 탭 안 Stack 공통 옵션 — 헤더는 화면이 AppHeader 로 직접 그린다 */
export const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.bg },
  animation: Platform.OS === 'web' ? ('none' as const) : ('default' as const),
};

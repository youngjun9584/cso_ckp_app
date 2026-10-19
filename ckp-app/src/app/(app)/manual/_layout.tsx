import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

/** 메뉴얼 (보조 화면, 탭 아님): 목록 · 화면별 상세 */
export default function ManualLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: '메뉴얼' }} />
      <Stack.Screen name="[page]" options={{ title: '메뉴얼 상세' }} />
    </Stack>
  );
}

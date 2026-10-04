import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function EdiLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'EDI 등록 내역' }} />
      <Stack.Screen name="new" options={{ title: '새 EDI 등록' }} />
      <Stack.Screen name="[id]" options={{ title: 'EDI 등록 상세' }} />
    </Stack>
  );
}

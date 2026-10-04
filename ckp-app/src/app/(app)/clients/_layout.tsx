import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ClientsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: '거래처' }} />
      <Stack.Screen name="new" options={{ title: '거래처 등록' }} />
      <Stack.Screen name="[idx]" options={{ title: '거래처 상세' }} />
    </Stack>
  );
}

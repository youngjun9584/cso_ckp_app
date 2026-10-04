import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function NoticesLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: '공지사항' }} />
      <Stack.Screen name="[idx]" options={{ title: '공지사항' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function HomeLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: '홈' }} />
    </Stack>
  );
}

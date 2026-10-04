import { Stack } from 'expo-router';

import { stackScreenOptions } from '@/components/shell/stack-options';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function MedicinesLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: '의약품' }} />
      <Stack.Screen name="[code]" options={{ title: '의약품 상세' }} />
    </Stack>
  );
}

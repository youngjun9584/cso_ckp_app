import '@/global.css';

import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BootScreen } from '@/components/shell/BootScreen';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient, useAppStateFocusManager } from '@/lib/query';
import { colors } from '@/theme';

// 로그인 복원이 끝날 때까지 네이티브 스플래시를 유지한다 (웹에서는 아무 동작 안 함)
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  useAppStateFocusManager();
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <StatusBar style="dark" />
                <RootNavigator />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const restoring = status === 'restoring';

  useEffect(() => {
    if (!restoring) void SplashScreen.hideAsync().catch(() => undefined);
  }, [restoring]);

  // 복원 전에는 내비게이터를 만들지 않아 웹 새로고침 시에도 현재 주소가 유지된다
  if (restoring) return <BootScreen />;

  const signedIn = status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: Platform.OS === 'web' ? 'none' : 'fade',
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ title: '로그인' }} />
        <Stack.Screen name="signup" options={{ title: '회원가입' }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" options={{ title: '페이지를 찾을 수 없습니다' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

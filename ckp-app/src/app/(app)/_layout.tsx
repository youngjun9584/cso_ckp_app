import { Tabs } from 'expo-router/js-tabs';

import { AppTabBar } from '@/components/shell/AppTabBar';
import { colors, useIsWide } from '@/theme';

export const unstable_settings = {
  // 로그인 직후·'/' 의 첫 화면은 홈(메인 메뉴)
  initialRouteName: 'home',
};

/** 반응형 셸: 모바일 하단 5탭 / 넓은 웹 좌측 사이드바 (DESIGN §6.1) */
export default function AppLayout() {
  const wide = useIsWide();
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} wide={wide} />}
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'none',
      }}
    >
      <Tabs.Screen name="home" options={{ title: '홈' }} />
      <Tabs.Screen name="medicines" options={{ title: '의약품' }} />
      <Tabs.Screen name="notices" options={{ title: '공지사항' }} />
      <Tabs.Screen name="edi" options={{ title: 'EDI 등록' }} />
      <Tabs.Screen name="clients" options={{ title: '거래처' }} />
      <Tabs.Screen name="account" options={{ title: '계정', href: null }} />
    </Tabs>
  );
}

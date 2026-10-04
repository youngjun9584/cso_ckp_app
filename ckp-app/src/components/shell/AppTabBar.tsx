/**
 * (app) 탭 내비게이터의 커스텀 탭 바.
 * - 모바일/좁은 화면: 하단 5탭 (홈 · 의약품 · 공지사항 · EDI 등록 · 거래처, 아이콘 + 라벨, 60 + 안전영역)
 * - 넓은 웹(≥1024): 좌측 네이비 사이드바 240 (전체 로고, 모드 표시, 메뉴, 사용자·계정)
 * 이동 전에 confirmLeave() 로 작성 중 화면의 확인을 받는다.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { StackActions } from 'expo-router/react-navigation';

import { Icon, type IconName } from '@/components/ui/Icon';
import { LogoFull } from '@/components/ui/Brand';
import { ModeBanner } from '@/components/ui/ModeBanner';
import { asInteraction } from '@/components/ui/pressable-state';
import { Text } from '@/components/ui/Text';
import { webOnly } from '@/components/ui/web-props';
import { useAuth } from '@/lib/auth';
import { confirmLeave } from '@/lib/navigation-guard';
import { colors, layout, radius, spacing } from '@/theme';
import { APP_TABS } from './tabs';

export type AppTabBarProps = BottomTabBarProps & { wide: boolean };

/** Android 는 키보드가 올라오면 하단 탭을 숨긴다 (입력란·하단 버튼이 가려지지 않도록) */
function useAndroidKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export function AppTabBar({ state, navigation, insets, wide }: AppTabBarProps) {
  const { user } = useAuth();
  const keyboardVisible = useAndroidKeyboardVisible();
  const focusedName = state.routes[state.index]?.name;

  async function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const isFocused = focusedName === name;
    const nested = route.state;
    const nestedIndex = nested?.index ?? 0;
    // 이미 해당 탭의 첫 화면이면 아무것도 하지 않는다
    if (isFocused && nestedIndex === 0) return;
    if (!(await confirmLeave())) return;

    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;

    if (isFocused && nested?.key) {
      // 같은 탭을 다시 누르면 목록(첫 화면)으로
      navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
    } else {
      navigation.navigate(route.name, route.params);
    }
  }

  if (wide) {
    return (
      <View style={[styles.sidebar, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.sidebarLogo}>
          <LogoFull height={76} />
          <Text variant="caption" tone="inverseMuted" style={{ marginTop: 16, letterSpacing: 2 }}>CKP · 업무 공간</Text>
        </View>
        <ModeBanner variant="sidebar" style={styles.sidebarMode} />
        <View role="tablist" {...webOnly({ 'aria-orientation': 'vertical' })} style={styles.sidebarMenu}>
          {APP_TABS.map((tab) => (
            <SidebarItem
              key={tab.name}
              icon={focusedName === tab.name ? tab.iconActive : tab.icon}
              label={tab.label}
              active={focusedName === tab.name}
              onPress={() => void go(tab.name)}
            />
          ))}
        </View>
        <View style={styles.flex} />
        <View style={styles.userBox}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text variant="bodyStrong" color={colors.white}>
                {(user?.name ?? user?.usrId ?? '?').slice(0, 1)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong" tone="inverse" numberOfLines={1}>
                {user?.name ?? user?.usrId ?? ''}
              </Text>
              <Text variant="caption" tone="inverseMuted" numberOfLines={1}>
                {user?.companyName ?? user?.usrId ?? ''}
              </Text>
            </View>
          </View>
          <SidebarItem
            icon="person-circle-outline"
            label="계정"
            active={focusedName === 'account'}
            onPress={() => void go('account')}
            role="link"
          />
        </View>
      </View>
    );
  }

  if (keyboardVisible) return null;

  return (
    <View
      role="tablist"
      style={[styles.bottomBar, { height: layout.tabBarHeight + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {APP_TABS.map((tab) => {
        const active = focusedName === tab.name;
        return (
          <Pressable
            key={tab.name}
            onPress={() => void go(tab.name)}
            role="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            style={(s) => [styles.bottomItem, asInteraction(s).hovered && styles.bottomItemHover]}
          >
            <View style={[styles.indicator, active && styles.indicatorActive]}>
              <Icon name={active ? tab.iconActive : tab.icon} size={22} color={active ? colors.primary : colors.textMuted} />
            </View>
            <Text variant="caption" weight={active ? 'bold' : 'medium'} color={active ? colors.primary : colors.textSecondary}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SidebarItemProps {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
  role?: 'tab' | 'link';
}

function SidebarItem({ icon, label, active, onPress, role = 'tab' }: SidebarItemProps) {
  return (
    <Pressable
      onPress={onPress}
      role={role}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      aria-selected={role === 'tab' ? active : undefined}
      {...webOnly({ 'aria-current': role === 'link' && active ? 'page' : undefined })}
      style={(s) => {
        const { hovered, pressed } = asInteraction(s);
        return [styles.sidebarItem, active ? styles.sidebarItemActive : hovered || pressed ? styles.sidebarItemHover : null];
      }}
    >
      <View style={[styles.sidebarAccent, active && styles.sidebarAccentActive]} />
      <Icon name={icon} size={22} color={active ? colors.white : colors.textInverseMuted} />
      <Text variant={active ? 'bodyStrong' : 'body'} tone={active ? 'inverse' : 'inverseMuted'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // ── 하단 탭 ──
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bottomItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: layout.tabBarHeight,
  },
  bottomItemHover: {
    backgroundColor: '#F6F8FB',
  },
  indicator: {
    width: 52,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.transparent,
  },
  indicatorActive: {
    backgroundColor: colors.primarySoft,
  },
  // ── 사이드바 ──
  sidebar: {
    width: layout.sidebarWidth,
    backgroundColor: colors.sidebar,
    paddingHorizontal: spacing.lg,
  },
  sidebarLogo: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  sidebarMode: {
    marginBottom: spacing.lg,
  },
  sidebarMenu: {
    gap: spacing.sm,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  sidebarItemActive: {
    backgroundColor: colors.sidebarActive,
  },
  sidebarItemHover: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sidebarAccent: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.transparent,
  },
  sidebarAccentActive: {
    backgroundColor: colors.teal,
  },
  userBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.sidebarBorder,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { manualHref, manualPageForPath } from '@/features/manual/pages';
import { navigateGuarded } from '@/lib/navigation-guard';
import { colors, layout, spacing, useIsWide } from '@/theme';
import { BrandMark } from './Brand';
import { IconButton } from './IconButton';
import { ModeBanner } from './ModeBanner';
import { Text } from './Text';
import { webOnly } from './web-props';

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /**
   * 뒤로 버튼. true 면 이전 화면으로(기록이 없으면 backHref 로), 함수면 그 함수를 실행.
   */
  back?: boolean | (() => void);
  /** 기록이 없을 때(웹에서 주소로 바로 들어온 경우) 돌아갈 곳. 기본 '/home'(첫 화면) */
  backHref?: Href;
  /** 오른쪽 작업 버튼들 (IconButton, Button size="sm" 등) */
  right?: ReactNode;
  /** 모바일 우측 계정 버튼 (기본: 뒤로 버튼이 없을 때) */
  showAccount?: boolean;
  /** 모바일 좌측 CKP 심볼 (기본: 뒤로 버튼이 없을 때). 넓은 화면에서는 사이드바가 로고를 보여주므로 항상 숨김 */
  showLogo?: boolean;
  /** 헤더 아래 샘플/개발 서버 띠 (기본 true, 넓은 화면은 사이드바에 표시) */
  showModeBanner?: boolean;
  /** 오른쪽 메뉴얼(?) 버튼 — 지금 화면의 메뉴얼을 연다 (기본 true, 메뉴얼 화면 자신은 false) */
  showHelp?: boolean;
  /** 넓은 화면에서 제목 줄 최대 너비 — Screen/FormScroll 의 maxWidth 와 같게 주면 본문과 정렬된다 */
  maxWidth?: number;
}

export function goBack(backHref: Href = '/home'): void {
  if (router.canGoBack()) router.back();
  else router.replace(backHref);
}

export function AppHeader({
  title,
  subtitle,
  back,
  backHref,
  right,
  showAccount,
  showLogo,
  showModeBanner = true,
  showHelp = true,
  maxWidth = layout.contentMaxWidth,
}: AppHeaderProps) {
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const hasBack = !!back;
  const logo = !wide && (showLogo ?? !hasBack);
  const account = !wide && (showAccount ?? !hasBack);
  const help = showHelp && !pathname.startsWith('/manual');

  // 메뉴얼은 다른 탭(숨김)에 열리고 작성 중인 EDI 내용은 그대로 남으므로 이탈 확인 없이 이동한다
  const openManual = () => router.navigate(manualHref(manualPageForPath(pathname)));

  const onBack = () => {
    if (typeof back === 'function') back();
    else goBack(backHref);
  };

  return (
    <View style={[styles.container, { paddingTop: wide ? 0 : insets.top }]}>
      <View style={[styles.bar, wide && styles.barWide]}>
        <View style={[styles.row, wide && styles.rowWide, wide && { maxWidth: maxWidth + layout.gutterWide * 2 }]}>
          {hasBack ? (
            <IconButton icon="chevron-back" accessibilityLabel="뒤로" onPress={onBack} style={styles.back} iconSize={24} />
          ) : null}
          {logo ? (
            <View style={styles.logo}>
              <BrandMark size={24} />
              <View style={styles.logoDivider} />
            </View>
          ) : null}
          <View style={styles.titles}>
            <Text variant={wide ? 'title' : 'heading'} numberOfLines={1} role="heading" {...webOnly({ 'aria-level': 1 })}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
          {help ? <IconButton icon="help-circle-outline" accessibilityLabel="메뉴얼" iconSize={26} onPress={openManual} /> : null}
          {account ? (
            <IconButton
              icon="person-circle-outline"
              accessibilityLabel="계정"
              iconSize={26}
              onPress={() => void navigateGuarded('/account')}
            />
          ) : null}
        </View>
      </View>
      {showModeBanner && !wide ? <ModeBanner variant="bar" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    zIndex: 2,
  },
  bar: {
    minHeight: layout.headerHeight,
    justifyContent: 'center',
  },
  barWide: {
    minHeight: 72,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  rowWide: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.gutterWide,
  },
  back: {
    marginLeft: -spacing.sm,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});

import type { ReactNode, Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, spacing, useIsWide } from '@/theme';
import { useWindowTop } from './useWindowTop';

export interface ContentLayout {
  wide: boolean;
  /** 좌우 여백 (모바일 16 / 넓은 화면 24) */
  gutter: number;
  /** 본문 영역 스타일: 좌우 여백 + 넓은 화면 최대 너비 가운데 정렬 */
  contentStyle: ViewStyle;
}

/** FlatList 등 Screen 밖에서 직접 목록을 그릴 때 헤더·본문과 같은 여백을 쓰기 위한 값 */
export function useContentLayout(maxWidth: number | null = layout.contentMaxWidth): ContentLayout {
  const wide = useIsWide();
  const gutter = wide ? layout.gutterWide : layout.gutter;
  return {
    wide,
    gutter,
    contentStyle: {
      paddingHorizontal: gutter,
      width: '100%',
      ...(wide && maxWidth ? { maxWidth: maxWidth + gutter * 2, alignSelf: 'center' as const } : null),
    },
  };
}

export interface ScreenProps {
  children?: ReactNode;
  /** 보통 <AppHeader /> — 안전영역 위쪽은 AppHeader 가 처리한다 */
  header?: ReactNode;
  /** 본문을 ScrollView 로 감싼다 */
  scroll?: boolean;
  /** 본문 좌우·위아래 여백 (기본 true) */
  padded?: boolean;
  /** 넓은 화면 본문 최대 너비 (null 이면 제한 없음) */
  maxWidth?: number | null;
  /** 위쪽 안전영역 (기본: header 가 없을 때만) */
  safeTop?: boolean;
  /** 아래쪽 안전영역 (탭 화면은 탭 바가 처리하므로 기본 false) */
  safeBottom?: boolean;
  /** 네이티브 키보드 회피 (입력 폼은 FormScroll 권장) */
  keyboardAvoiding?: boolean;
  refreshControl?: ScrollViewProps['refreshControl'];
  background?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollRef?: Ref<ScrollView>;
}

/** 모든 화면의 바깥 틀: 배경·안전영역·(선택)스크롤·넓은 화면 최대 너비 */
export function Screen({
  children,
  header,
  scroll = false,
  padded = true,
  maxWidth = layout.contentMaxWidth,
  safeTop,
  safeBottom = false,
  keyboardAvoiding = false,
  refreshControl,
  background = colors.bg,
  style,
  contentContainerStyle,
  scrollRef,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { contentStyle, wide } = useContentLayout(maxWidth);
  const topInset = (safeTop ?? !header) ? insets.top : 0;
  const bottomInset = safeBottom ? insets.bottom : 0;
  const nativeKeyboardAvoiding = keyboardAvoiding && Platform.OS !== 'web';
  // KAV 는 header 아래(루트 기준 frame.y = header 높이)에 있으므로 offset 은 루트 View 의 창 기준 y (보통 0, 모달 안 등에서는 그 거리)
  const windowTop = useWindowTop(nativeKeyboardAvoiding);

  const inner: StyleProp<ViewStyle> = [
    padded ? contentStyle : styles.unpadded,
    padded && styles.paddedVertical,
    !padded && wide && maxWidth ? { maxWidth, alignSelf: 'center' } : null,
    { paddingBottom: (padded ? spacing.xxl : 0) + bottomInset },
    contentContainerStyle,
  ];

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={inner}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, inner]}>{children}</View>
  );

  const content = nativeKeyboardAvoiding ? (
    <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={windowTop.y}>
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <View
      collapsable={nativeKeyboardAvoiding ? false : undefined}
      onLayout={windowTop.onLayout}
      style={[styles.root, { backgroundColor: background, paddingTop: topInset }, style]}
    >
      {header}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  unpadded: {
    width: '100%',
  },
  paddedVertical: {
    paddingTop: spacing.xxl,
  },
});

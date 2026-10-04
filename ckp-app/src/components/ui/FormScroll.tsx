/**
 * 입력 폼용 스크롤 + 하단 고정 버튼 영역.
 * - iOS/Android: KeyboardAvoidingView(padding)로 하단 버튼이 키보드 바로 위에 붙는다.
 *   RN 은 KAV 의 위치를 부모 기준으로, 키보드 위치를 창 기준으로 계산하므로 FormScroll 이 창 맨 위가 아니면
 *   (AppHeader·샘플/개발 서버 띠·EDI 단계 표시 아래) 그만큼 덜 올라가 하단 버튼이 키보드에 가린다.
 *   그래서 KAV 를 감싼 View 의 창 기준 y 를 직접 재서 keyboardVerticalOffset 으로 넘긴다(호출하는 쪽은 신경 쓰지 않아도 된다).
 *   Android 에서 창 크기가 줄어드는 경우(adjustResize 가 실제로 적용될 때)는 겹침이 0 으로 계산되어 이중 적용되지 않는다.
 * - Web: 하단 버튼은 화면 아래에 고정되고 본문만 스크롤된다.
 */
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

import { colors, layout, spacing } from '@/theme';
import { useContentLayout } from './Screen';
import { useWindowTop } from './useWindowTop';

export interface FormScrollProps {
  children?: ReactNode;
  /** 하단 고정 영역 (예: <Button title="저장" size="lg" fullWidth />) */
  footer?: ReactNode;
  /** 넓은 화면 본문 최대 너비 (기본 720) */
  maxWidth?: number | null;
  /** 탭 바가 없는 화면에서 하단 안전영역만큼 띄운다 */
  footerSafeArea?: boolean;
  /**
   * 보통 지정하지 않는다: FormScroll 이 창 맨 위에서 떨어진 거리를 직접 재서 쓴다.
   * 지정하면 측정값 대신 이 값을 KeyboardAvoidingView 의 keyboardVerticalOffset 으로 쓴다.
   */
  keyboardVerticalOffset?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ScrollViewProps['refreshControl'];
  scrollRef?: Ref<ScrollView>;
}

export function FormScroll({
  children,
  footer,
  maxWidth = layout.formMaxWidth,
  footerSafeArea = false,
  keyboardVerticalOffset,
  contentContainerStyle,
  refreshControl,
  scrollRef,
}: FormScrollProps) {
  const insets = useSafeAreaInsets();
  const { contentStyle } = useContentLayout(maxWidth);
  const native = Platform.OS !== 'web';
  // KAV 의 바로 위 부모를 재면 KAV 의 frame.y 는 0 이므로 offset = 이 View 의 창 기준 y
  const windowTop = useWindowTop(native && keyboardVerticalOffset === undefined);

  return (
    <View style={styles.flex} collapsable={false} onLayout={windowTop.onLayout}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={native ? 'padding' : undefined}
        enabled={native}
        keyboardVerticalOffset={keyboardVerticalOffset ?? windowTop.y}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[contentStyle, styles.content, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View style={[styles.footer, { paddingBottom: spacing.md + (footerSafeArea ? insets.bottom : 0) }]}>
            <View style={[contentStyle, styles.footerInner]}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  footer: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  /** 세로 배치 — 버튼 여러 개를 나란히 두려면 footer 안에서 row View 로 감싼다 */
  footerInner: {
    gap: spacing.sm,
  },
});

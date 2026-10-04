/**
 * 단계 본문 틀.
 * - StepScaffold: 입력이 있는 단계(1·3) — FormScroll(키보드 회피 + 하단 고정 버튼)
 * - AnimatedStepScaffold: 사진 그리드 단계(2) — react-native-sortables 의 자동 스크롤을 위해 Animated.ScrollView + useAnimatedRef
 */
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type AnimatedRef } from 'react-native-reanimated';

import { FormScroll, useContentLayout } from '@/components/ui';
import { layout, spacing } from '@/theme';
import { StepFooterBar } from './StepFooter';

export interface StepScaffoldProps {
  children?: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

export function StepScaffold({ children, footer, maxWidth = layout.formMaxWidth }: StepScaffoldProps) {
  return (
    <FormScroll footer={footer} maxWidth={maxWidth}>
      {children}
    </FormScroll>
  );
}

export interface AnimatedStepScaffoldProps extends StepScaffoldProps {
  scrollRef: AnimatedRef<Animated.ScrollView>;
}

export function AnimatedStepScaffold({ children, footer, maxWidth = layout.formMaxWidth, scrollRef }: AnimatedStepScaffoldProps) {
  const { contentStyle } = useContentLayout(maxWidth);
  return (
    <>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[contentStyle, styles.content]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </Animated.ScrollView>
      {footer ? <StepFooterBar maxWidth={maxWidth}>{footer}</StepFooterBar> : null}
    </>
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
});

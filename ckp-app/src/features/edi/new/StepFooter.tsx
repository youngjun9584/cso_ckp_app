/** 단계 하단 고정 영역 — FormScroll 의 footer 와 같은 모양 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useContentLayout } from '@/components/ui';
import { colors, layout, spacing } from '@/theme';

/** 하단 버튼 가로 배치 ([이전] [다음]) */
export function StepFooterRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/** FormScroll 을 쓰지 않는 단계(사진 그리드)용 하단 고정 영역 */
export function StepFooterBar({ children, maxWidth = layout.formMaxWidth }: { children: ReactNode; maxWidth?: number }) {
  const { contentStyle } = useContentLayout(maxWidth);
  return (
    <View style={styles.bar}>
      <View style={[contentStyle, styles.inner]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bar: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  inner: {
    gap: spacing.sm,
  },
});

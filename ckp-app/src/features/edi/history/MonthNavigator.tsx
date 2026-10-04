import { StyleSheet, View } from 'react-native';

import { Button, IconButton, Text } from '@/components/ui';
import { addMonths, formatYm } from '@/lib/kst';
import { colors, radius, shadow, spacing } from '@/theme';

export interface MonthNavigatorProps {
  /** 보고 있는 등록월 'YYYY-MM' */
  ym: string;
  /** 이동할 수 있는 마지막 달(현재 KST 달) */
  maxYm: string;
  onChange: (ym: string) => void;
  wide?: boolean;
}

/** 등록월 이동: ◀ 2026년 9월 ▶ (현재 달 이후로는 이동하지 않음) */
export function MonthNavigator({ ym, maxYm, onChange, wide = false }: MonthNavigatorProps) {
  const canNext = ym < maxYm;
  const prevYm = addMonths(ym, -1);
  const nextYm = addMonths(ym, 1);

  return (
    <View style={[styles.row, wide && styles.rowWide]}>
      <View style={[styles.box, wide ? styles.boxWide : styles.boxFill]}>
        <IconButton
          icon="chevron-back"
          accessibilityLabel={`이전 달 (${formatYm(prevYm)})`}
          onPress={() => onChange(prevYm)}
        />
        <View style={styles.label} accessible accessibilityLabel={`등록월 ${formatYm(ym)}`} accessibilityLiveRegion="polite">
          <Text variant="caption" tone="secondary">
            등록월
          </Text>
          <Text variant="heading">{formatYm(ym)}</Text>
        </View>
        <IconButton
          icon="chevron-forward"
          accessibilityLabel={canNext ? `다음 달 (${formatYm(nextYm)})` : '다음 달'}
          disabled={!canNext}
          onPress={() => canNext && onChange(nextYm)}
        />
      </View>
      {ym !== maxYm ? (
        <Button title="이번 달" variant="ghost" size="sm" icon="today-outline" onPress={() => onChange(maxYm)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowWide: {
    gap: spacing.md,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    ...shadow.card,
  },
  boxFill: {
    flex: 1,
  },
  boxWide: {
    width: 320,
  },
  label: {
    flex: 1,
    alignItems: 'center',
  },
});

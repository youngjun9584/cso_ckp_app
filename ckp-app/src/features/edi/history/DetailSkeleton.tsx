import { StyleSheet, View } from 'react-native';

import { Card, Skeleton } from '@/components/ui';
import { radius, spacing } from '@/theme';

/** 제출 건 상세를 불러오는 동안의 자리표시 (요약 카드 + 사진 격자) */
export function DetailSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <View
      style={[styles.root, wide && styles.rootWide]}
      accessibilityRole="progressbar"
      accessibilityLabel="등록 내역을 불러오는 중입니다…"
      accessibilityState={{ busy: true }}
    >
      <Card style={wide ? styles.side : undefined}>
        <View style={styles.lines}>
          <Skeleton width="30%" height={12} />
          <Skeleton width="65%" height={22} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="40%" height={14} />
        </View>
      </Card>
      <View style={styles.main}>
        <Skeleton width={120} height={18} />
        <View style={styles.grid}>
          {Array.from({ length: wide ? 10 : 6 }, (_, i) => (
            <View key={i} style={[styles.cell, { width: wide ? '20%' : '33.333%' }]}>
              <Skeleton height={wide ? 190 : 136} radius={radius.control} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xl,
  },
  rootWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  side: {
    width: 340,
  },
  lines: {
    gap: spacing.md,
  },
  main: {
    flex: 1,
    gap: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.md / 2,
    rowGap: spacing.md,
  },
  cell: {
    paddingHorizontal: spacing.md / 2,
  },
});

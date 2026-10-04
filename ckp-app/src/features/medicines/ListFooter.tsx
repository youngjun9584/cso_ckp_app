/** 무한 스크롤 목록 아래쪽: 더 불러오는 중 / 다음 페이지 오류 / 목록 끝 (공지사항 목록도 함께 사용) */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { colors, spacing } from '@/theme';

export interface ListFooterProps {
  loadingMore: boolean;
  /** 다음 페이지를 불러오다 실패한 경우 */
  error?: unknown;
  onRetry?: () => void;
  /** 더 불러올 항목이 없음 */
  reachedEnd: boolean;
  /** 목록 끝 문구 (예: '모든 의약품을 불러왔습니다 · 총 92건') */
  endLabel?: string;
}

export function ListFooter({ loadingMore, error, onRetry, reachedEnd, endLabel }: ListFooterProps) {
  if (loadingMore) {
    return (
      <View style={styles.footer} accessibilityRole="progressbar" accessibilityLabel="목록을 더 불러오는 중입니다">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="secondary" tone="secondary">
          더 불러오는 중…
        </Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.footerColumn} accessibilityLiveRegion="polite">
        <Text variant="secondary" tone="danger" align="center">
          목록을 더 불러오지 못했습니다. {getErrorMessage(error)}
        </Text>
        {onRetry ? <Button title="다시 시도" icon="refresh" variant="secondary" size="sm" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (reachedEnd && endLabel) {
    return (
      <View style={styles.footer}>
        <View style={styles.line} />
        <Text variant="caption" tone="muted">
          {endLabel}
        </Text>
        <View style={styles.line} />
      </View>
    );
  }
  return <View style={styles.spacer} />;
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  footerColumn: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  line: {
    flex: 1,
    maxWidth: 64,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  spacer: {
    height: spacing.lg,
  },
});

/** 공지사항 목록 항목 — 중요 공지는 '중요' 배지 + 왼쪽 강조선 */
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text } from '@/components/ui';
import type { NoticeSummary } from '@/lib/api';
import { hasValue } from '@/lib/format';
import { colors, spacing } from '@/theme';
import { formatDotDate } from '@/features/medicines/format';

export interface NoticeCardProps {
  item: NoticeSummary;
  onPress: (idx: number) => void;
}

export function NoticeCard({ item, onPress }: NoticeCardProps) {
  const date = formatDotDate(item.regYmd);
  const meta = [date, item.author?.trim()].filter(hasValue).join(' · ');
  const a11y = [item.important ? '중요 공지' : null, item.title, date ? `작성일 ${date}` : null, item.author ? `작성자 ${item.author}` : null]
    .filter(hasValue)
    .join(', ');

  return (
    <Card onPress={() => onPress(item.idx)} accessibilityLabel={a11y} style={[styles.card, item.important && styles.important]}>
      <View style={styles.texts}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.meta}>
          {item.important ? <Badge label="중요" tone="accent" icon="megaphone-outline" /> : null}
          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.metaText}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // 두꺼운 왼쪽 선만큼 안쪽 여백을 줄여 제목 시작 위치를 다른 카드와 맞춘다
  important: {
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.lg - 3,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs + 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: {
    flexShrink: 1,
  },
});

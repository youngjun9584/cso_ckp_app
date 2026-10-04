import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text, type IconName } from '@/components/ui';
import type { EdiSubmissionSummary } from '@/lib/api';
import { colors, radius, spacing } from '@/theme';
import { EdiThumb } from './EdiThumb';
import { memoPreview, photoCountText, submittedAtText, targetMonthShort } from './format';
import { StatusSummaryBadges } from './StatusBadges';
import { statusCountsSentence } from './status';

export interface SubmissionCardProps {
  item: EdiSubmissionSummary;
  onPress: () => void;
  onThumbError?: () => void;
  /** 격자(여러 열)에서 같은 줄 카드 높이를 맞춘다 */
  fill?: boolean;
}

const THUMB = 72;

function Meta({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={14} color={colors.textMuted} />
      <Text variant="secondary" tone="secondary" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** 등록 내역 목록의 제출 건 카드 */
export function SubmissionCard({ item, onPress, onThumbError, fill = false }: SubmissionCardProps) {
  const legacy = item.kind === 'legacy';
  const month = targetMonthShort(item);
  const time = submittedAtText(item);
  const memo = memoPreview(item.memo);

  const a11y = [
    item.clientName,
    legacy ? '이전 등록' : null,
    month ? `대상월 ${month}` : null,
    photoCountText(item.photoCount),
    time ? `등록 ${time}` : null,
    statusCountsSentence(item.statusCounts) || null,
    memo ? `메모 ${memo}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={`${a11y}. 상세 보기`} style={fill ? styles.fill : undefined}>
      <View style={styles.row}>
        <EdiThumb uri={item.coverThumbUrl} style={styles.thumb} onError={onThumbError} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.title}>
              {item.clientName || '거래처 정보 없음'}
            </Text>
            {legacy ? <Badge label="이전 등록" tone="neutral" /> : null}
          </View>
          <View style={styles.metaRow}>
            {month ? <Meta icon="calendar-outline" text={`대상월 ${month}`} /> : null}
            <Meta icon="images-outline" text={photoCountText(item.photoCount)} />
          </View>
          {time ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {time} 등록
            </Text>
          ) : null}
          <StatusSummaryBadges counts={item.statusCounts} style={styles.badges} />
          {memo ? (
            <View style={styles.memo}>
              <Icon name="chatbox-ellipses-outline" size={14} color={colors.textMuted} />
              <Text variant="secondary" tone="secondary" numberOfLines={1} style={styles.memoText}>
                {memo}
              </Text>
            </View>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.control,
    alignSelf: 'flex-start',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  badges: {
    marginTop: 2,
  },
  memo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  memoText: {
    flex: 1,
  },
});

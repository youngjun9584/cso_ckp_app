import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, InfoRow, Text } from '@/components/ui';
import type { EdiSubmissionDetail } from '@/lib/api';
import { colors, radius, spacing } from '@/theme';
import { photoCountText, submittedAtText, targetMonthLong } from './format';
import { StatusSummaryBadges } from './StatusBadges';
import { countReviewStatuses, statusCountItems } from './status';

export interface SubmissionSummaryCardProps {
  submission: EdiSubmissionDetail;
  labelWidth?: number;
}

/** 제출 건 요약: 거래처 · 대상 연월 · 등록 일시 · 사진 수 · 검토 현황 · 메모 */
export function SubmissionSummaryCard({ submission, labelWidth = 96 }: SubmissionSummaryCardProps) {
  const legacy = submission.kind === 'legacy';
  const counts = statusCountItems(submission.statusCounts).length > 0 ? submission.statusCounts : countReviewStatuses(submission.photos);
  const hasStatus = statusCountItems(counts).length > 0;
  const memo = submission.memo?.trim() ?? '';

  return (
    <Card>
      <Text variant="caption" tone="secondary">
        거래처
      </Text>
      <View style={styles.head}>
        <Text variant="title" style={styles.name} selectable>
          {submission.clientName || '거래처 정보 없음'}
        </Text>
        {legacy ? <Badge label="이전 등록" tone="neutral" size="md" /> : null}
      </View>

      <View style={styles.rows}>
        <InfoRow label="대상 연월" value={targetMonthLong(submission)} labelWidth={labelWidth} />
        <InfoRow label="등록 일시" value={submittedAtText(submission)} labelWidth={labelWidth} />
        <InfoRow
          label="사진"
          value={photoCountText(submission.photoCount || submission.photos.length)}
          labelWidth={labelWidth}
          divider={hasStatus || !!memo}
        />
        {hasStatus ? (
          <InfoRow label="검토 현황" labelWidth={labelWidth} divider={!!memo}>
            <StatusSummaryBadges counts={counts} size="md" />
          </InfoRow>
        ) : null}
        <InfoRow label="메모" value={memo} labelWidth={labelWidth} divider={false} />
      </View>

      {legacy ? (
        <View style={styles.note}>
          <Icon name="information-circle-outline" size={16} color={colors.textSecondary} />
          <Text variant="caption" tone="secondary" style={styles.noteText}>
            앱 도입 전 방식으로 등록된 내역입니다. 메모 등 일부 정보가 없을 수 있습니다.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  name: {
    flexShrink: 1,
  },
  rows: {
    marginTop: spacing.xs,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs + 2,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.bg,
  },
  noteText: {
    flex: 1,
  },
});

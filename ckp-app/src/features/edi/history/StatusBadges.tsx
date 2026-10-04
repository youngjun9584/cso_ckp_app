import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Badge } from '@/components/ui';
import type { EdiPhoto, EdiPhotoReviewStatus } from '@/lib/api';
import { spacing } from '@/theme';
import { PHOTO_FLAG_META, REVIEW_STATUS_META, statusCountItems } from './status';

export interface StatusSummaryBadgesProps {
  counts: Partial<Record<EdiPhotoReviewStatus, number>> | null | undefined;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/** 상태별 사진 수 (0인 상태는 숨김): 검토필요 3 · 검토완료 2 · 삭제요청 1 · 삭제됨 1 */
export function StatusSummaryBadges({ counts, size = 'sm', style }: StatusSummaryBadgesProps) {
  const items = statusCountItems(counts);
  if (items.length === 0) return null;
  return (
    <View style={[styles.wrap, style]}>
      {items.map((item) => (
        <Badge
          key={item.status}
          label={`${item.label} ${item.count}`}
          tone={item.tone}
          icon={size === 'md' ? item.icon : undefined}
          size={size}
          accessibilityLabel={`${item.label} ${item.count}장`}
        />
      ))}
    </View>
  );
}

export interface PhotoStatusChipsProps {
  photo: Pick<EdiPhoto, 'reviewStatus' | 'printed' | 'analyzed'>;
  style?: StyleProp<ViewStyle>;
}

/** 사진 1장의 상태 칩: 검토 상태 + 출력됨 + AI분석 */
export function PhotoStatusChips({ photo, style }: PhotoStatusChipsProps) {
  const review = REVIEW_STATUS_META[photo.reviewStatus] ?? REVIEW_STATUS_META.needs_review;
  const missing = photo.reviewStatus === 'missing';
  return (
    <View style={[styles.wrap, styles.tight, style]}>
      <Badge label={review.label} tone={review.tone} />
      {!missing && photo.printed ? <Badge label={PHOTO_FLAG_META.printed.label} tone={PHOTO_FLAG_META.printed.tone} /> : null}
      {!missing && photo.analyzed ? <Badge label={PHOTO_FLAG_META.analyzed.label} tone={PHOTO_FLAG_META.analyzed.tone} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  tight: {
    gap: spacing.xs,
  },
});

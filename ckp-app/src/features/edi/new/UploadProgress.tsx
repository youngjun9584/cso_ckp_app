/** 전체 업로드 진행률: '7 / 12장 업로드 완료' + 퍼센트 + 막대 (바이트 기준) */
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import type { UploadSummary } from '../draft/progress';
import type { SubmitStage } from '../draft/types';

export interface UploadProgressProps {
  summary: UploadSummary;
  stage: SubmitStage;
}

export function UploadProgress({ summary, stage }: UploadProgressProps) {
  const creating = stage === 'creating';
  const percent = creating ? 100 : summary.percent;
  const title = creating
    ? '등록 정보를 저장하는 중입니다…'
    : stage === 'uploading'
      ? '사진을 올리는 중입니다…'
      : summary.failed > 0
        ? `업로드 실패 ${summary.failed}장`
        : '업로드 상태';
  return (
    <View
      style={styles.box}
      accessibilityRole="progressbar"
      accessibilityLabel={`${summary.total}장 중 ${summary.uploaded}장 업로드 완료, ${percent}퍼센트`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="bodyStrong" tone="primary">
          {percent}%
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }, summary.failed > 0 && stage === 'idle' && styles.fillWarn]} />
      </View>
      <Text variant="secondary" tone="secondary">
        {summary.uploaded} / {summary.total}장 업로드 완료
        {summary.failed > 0 ? ` · 실패 ${summary.failed}장` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  fillWarn: {
    backgroundColor: colors.accent,
  },
});

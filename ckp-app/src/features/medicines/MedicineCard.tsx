/** 모바일/좁은 화면 의약품 카드 */
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import type { MedicineSummary } from '@/lib/api';
import { hasValue } from '@/lib/format';
import { colors, spacing } from '@/theme';
import { FEE_LABEL, medicineA11yLabel, medicinePrice } from './format';
import { MedicineThumb } from './MedicineThumb';

export interface MedicineCardProps {
  item: MedicineSummary;
  showFee: boolean;
  onPress: (code: string) => void;
}

export function MedicineCard({ item, showFee, onPress }: MedicineCardProps) {
  const price = medicinePrice(item);
  const fee = showFee ? item.fee : null;
  const sub = [item.company, item.packing].filter(hasValue).join(' · ');

  return (
    <Card onPress={() => onPress(item.code)} accessibilityLabel={medicineA11yLabel(item, showFee)} style={styles.card}>
      <View style={styles.top}>
        <MedicineThumb imageUrl={item.imageUrl} size={56} />
        <View style={styles.titleArea}>
          <View style={styles.titleRow}>
            <Text variant="bodyStrong" numberOfLines={2} style={styles.name}>
              {item.name}
            </Text>
            {item.inHouse ? <Badge label="자사생산" tone="teal" /> : null}
          </View>
          {sub ? (
            <Text variant="secondary" tone="secondary" numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <Text variant="caption" tone="muted" style={styles.code}>
          보험코드 {item.code}
        </Text>
        {price ? (
          <View style={styles.metric}>
            <Text variant="caption" tone="muted">
              약가
            </Text>
            <Text variant="bodyStrong" color={colors.primaryStrong}>
              {price}
            </Text>
          </View>
        ) : null}
        {fee ? (
          <View style={styles.metric}>
            <Text variant="caption" tone="muted">
              {FEE_LABEL}
            </Text>
            <Text variant="bodyStrong" tone="accent">
              {fee.value}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleArea: {
    flex: 1,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  bottom: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  code: {
    flexGrow: 1,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
});

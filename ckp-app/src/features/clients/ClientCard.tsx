import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import type { ClientSummary } from '@/lib/api';
import { colors, spacing } from '@/theme';
import { approvalBadgeInfo } from './approval';
import { ClientApprovalBadge } from './ClientApprovalBadge';

export interface ClientCardProps {
  client: ClientSummary;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** 거래처 목록 카드: 이름·승인 배지 / 구분·대표자·전화 / 주소 */
export function ClientCard({ client, onPress, style }: ClientCardProps) {
  const meta = [client.clientType, client.representative ? `대표 ${client.representative}` : null, client.phone].filter(
    (v): v is string => !!v?.trim(),
  );
  const approval = approvalBadgeInfo(client.approval);
  const a11y = [
    client.name,
    approval ? `승인 상태 ${approval.label}` : null,
    client.clientType,
    client.representative ? `대표자 ${client.representative}` : null,
    client.phone ? `전화 ${client.phone}` : null,
    client.address ? `주소 ${client.address}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card onPress={onPress} accessibilityLabel={a11y} style={[styles.card, style]}>
      <View style={styles.top}>
        <Text variant="bodyStrong" numberOfLines={2} style={styles.name}>
          {client.name}
        </Text>
        <ClientApprovalBadge approval={client.approval} />
      </View>
      {meta.length ? (
        <Text variant="secondary" tone="secondary" numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      ) : null}
      {client.address ? (
        <View style={styles.addressRow}>
          <Icon name="location-outline" size={14} color={colors.textMuted} />
          <Text variant="secondary" tone="muted" numberOfLines={2} style={styles.flex}>
            {client.address}
          </Text>
        </View>
      ) : null}
      {!meta.length && !client.address ? (
        <Text variant="secondary" tone="muted">
          등록된 상세 정보가 없습니다.
        </Text>
      ) : null}
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
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: 2,
  },
  flex: {
    flex: 1,
  },
});

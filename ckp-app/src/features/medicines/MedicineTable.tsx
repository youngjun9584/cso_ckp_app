/** 넓은 화면(웹 ≥1024) 의약품 표: 고정 머리글 + 행(hover, 클릭 → 상세) */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Badge, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import type { MedicineSummary } from '@/lib/api';
import { colors, spacing } from '@/theme';
import { medicineA11yLabel, medicinePrice } from './format';

interface Column {
  key: 'name' | 'company' | 'packing' | 'code' | 'price' | 'fee';
  label: string;
  style: StyleProp<ViewStyle>;
  align?: 'right';
}

const COLUMNS: Column[] = [
  { key: 'name', label: '제품명', style: { flex: 2.4, minWidth: 0 } },
  { key: 'company', label: '제약사', style: { flex: 1.3, minWidth: 0 } },
  { key: 'packing', label: '포장·규격', style: { flex: 1.3, minWidth: 0 } },
  { key: 'code', label: '보험코드', style: { width: 104 } },
  { key: 'price', label: '약가', style: { width: 96 }, align: 'right' },
  { key: 'fee', label: '수수료', style: { width: 80 }, align: 'right' },
];

function visibleColumns(showFee: boolean): Column[] {
  return showFee ? COLUMNS : COLUMNS.filter((c) => c.key !== 'fee');
}

export function MedicineTableHeader({ showFee }: { showFee: boolean }) {
  return (
    <View style={[styles.row, styles.header]} aria-hidden>
      {visibleColumns(showFee).map((col) => (
        <View key={col.key} style={[styles.cell, col.style]}>
          <Text variant="label" tone="secondary" align={col.align} numberOfLines={1}>
            {col.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Empty() {
  return (
    <Text variant="secondary" tone="muted">
      –
    </Text>
  );
}

export interface MedicineTableRowProps {
  item: MedicineSummary;
  showFee: boolean;
  onPress: (code: string) => void;
}

export function MedicineTableRow({ item, showFee, onPress }: MedicineTableRowProps) {
  const price = medicinePrice(item);

  function renderCell(col: Column) {
    switch (col.key) {
      case 'name':
        return (
          <View style={styles.nameCell}>
            <Text variant="body" weight="semibold" numberOfLines={2} style={styles.flexText}>
              {item.name}
            </Text>
            {item.inHouse ? <Badge label="자사생산" tone="teal" /> : null}
          </View>
        );
      case 'company':
        return item.company ? (
          <Text variant="secondary" numberOfLines={2}>
            {item.company}
          </Text>
        ) : (
          <Empty />
        );
      case 'packing':
        return item.packing ? (
          <Text variant="secondary" tone="secondary" numberOfLines={2}>
            {item.packing}
          </Text>
        ) : (
          <Empty />
        );
      case 'code':
        return (
          <Text variant="secondary" tone="secondary" numberOfLines={1} selectable>
            {item.code}
          </Text>
        );
      case 'price':
        return price ? (
          <Text variant="secondary" weight="semibold" color={colors.primaryStrong} align="right" numberOfLines={1}>
            {price}
          </Text>
        ) : (
          <Empty />
        );
      case 'fee':
        return item.fee ? (
          <Text variant="secondary" weight="semibold" tone="accent" align="right" numberOfLines={1}>
            {item.fee.value}
          </Text>
        ) : (
          <Empty />
        );
    }
  }

  return (
    <Pressable
      onPress={() => onPress(item.code)}
      accessibilityRole="button"
      accessibilityLabel={medicineA11yLabel(item, showFee)}
      accessibilityHint="의약품 상세 정보를 엽니다"
      style={(state) => {
        const { hovered, pressed, focused } = asInteraction(state);
        return [styles.row, styles.bodyRow, (hovered || focused) && styles.hovered, pressed && styles.pressed];
      }}
    >
      {visibleColumns(showFee).map((col) => (
        <View key={col.key} style={[styles.cell, col.style, col.align === 'right' && styles.right]}>
          {renderCell(col)}
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  header: {
    minHeight: 44,
    backgroundColor: '#F7F9FC',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bodyRow: {
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  hovered: {
    backgroundColor: '#F4F8FC',
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
  cell: {
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  right: {
    alignItems: 'flex-end',
  },
  nameCell: {
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  flexText: {
    alignSelf: 'stretch',
  },
});

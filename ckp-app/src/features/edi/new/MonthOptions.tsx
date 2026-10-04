/** 대상 연월 선택 — 서버 month-options 3개를 버튼으로 (표시 문구는 서버 display 그대로) */
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Skeleton, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import type { EdiMonthOption } from '@/lib/api';
import { colors, controlHeight, radius, spacing, useIsWide } from '@/theme';

export interface MonthOptionsProps {
  options: readonly EdiMonthOption[];
  value: string | null;
  onChange: (ym: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function MonthOptions({ options, value, onChange, disabled = false, loading = false }: MonthOptionsProps) {
  const wide = useIsWide();
  if (loading) {
    return (
      <View style={[styles.list, wide && styles.row]}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={controlHeight.buttonLg} radius={radius.control} />
        ))}
      </View>
    );
  }
  return (
    <View style={[styles.list, wide && styles.row]} accessibilityRole="radiogroup" accessibilityLabel="대상 연월">
      {options.map((option) => {
        const selected = option.ym === value;
        return (
          <Pressable
            key={option.ym}
            onPress={() => onChange(option.ym)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={option.display}
            accessibilityState={{ checked: selected, disabled }}
            style={(state) => {
              const { hovered, pressed } = asInteraction(state);
              return [
                styles.option,
                wide && styles.optionWide,
                selected && styles.selected,
                !selected && (hovered || pressed) && styles.hover,
                disabled && styles.disabled,
              ];
            }}
          >
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
            </View>
            <Text variant={selected ? 'bodyStrong' : 'body'} color={selected ? colors.primaryStrong : colors.text} style={styles.label}>
              {option.display}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
  },
  option: {
    minHeight: controlHeight.buttonLg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  optionWide: {
    flex: 1,
  },
  selected: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primarySoft,
  },
  hover: {
    backgroundColor: '#F6F8FB',
  },
  disabled: {
    opacity: 0.55,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    flexShrink: 1,
  },
});

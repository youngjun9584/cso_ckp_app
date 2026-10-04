import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { asInteraction } from './pressable-state';
import { Text } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 그룹 이름 (스크린리더) — 예: '검색 기준' */
  accessibilityLabel?: string;
  /** 가로로 꽉 채우기 (기본 true) */
  fullWidth?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  fullWidth = true,
  disabled = false,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[styles.track, !fullWidth && styles.inline, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || !!option.disabled;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            disabled={optionDisabled}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected, disabled: optionDisabled }}
            style={(state) => {
              const { hovered, pressed } = asInteraction(state);
              return [
                styles.segment,
                fullWidth && styles.segmentFlex,
                selected ? styles.selected : hovered || pressed ? styles.hovered : null,
                optionDisabled && styles.disabled,
              ];
            }}
          >
            <Text
              variant="label"
              color={selected ? colors.primaryStrong : colors.textSecondary}
              weight={selected ? 'bold' : 'medium'}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.divider,
    borderRadius: radius.control,
    padding: 3,
    gap: 3,
  },
  inline: {
    alignSelf: 'flex-start',
  },
  segment: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control - 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentFlex: {
    flex: 1,
  },
  selected: {
    backgroundColor: colors.card,
    boxShadow: '0px 1px 2px rgba(15, 35, 66, 0.12)',
  },
  hovered: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  disabled: {
    opacity: 0.45,
  },
});

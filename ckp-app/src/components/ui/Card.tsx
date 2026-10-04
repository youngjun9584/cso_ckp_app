import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors, radius, shadow, spacing } from '@/theme';
import { asInteraction } from './pressable-state';
import { Text } from './Text';

export interface CardProps extends Omit<ViewProps, 'style'> {
  children?: ReactNode;
  /** 기본 16 안쪽 여백. false 면 여백 없음(목록·이미지 카드) */
  padded?: boolean;
  /** 지정하면 누를 수 있는 카드 (웹 hover 표시) */
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, padded = true, onPress, accessibilityLabel, disabled, style, ...rest }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !!disabled }}
        style={(state) => {
          const { pressed, hovered } = asInteraction(state);
          return [
            styles.card,
            padded && styles.padded,
            hovered && styles.hovered,
            pressed && styles.pressed,
            disabled && styles.disabled,
            style,
          ];
        }}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View {...rest} style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

export interface SectionTitleProps {
  title: string;
  /** 제목 오른쪽 (건수, 버튼 등) */
  right?: ReactNode;
  description?: string;
}

/** 카드/목록 위 섹션 제목 */
export function SectionTitle({ title, right, description }: SectionTitleProps) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionTitleText}>
        <Text variant="heading" role="heading">
          {title}
        </Text>
        {description ? (
          <Text variant="secondary" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  padded: {
    padding: spacing.lg,
  },
  hovered: {
    borderColor: '#C7D2E0',
    ...shadow.raised,
  },
  pressed: {
    backgroundColor: '#F8FAFC',
  },
  disabled: {
    opacity: 0.55,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitleText: {
    flex: 1,
    gap: 2,
  },
});

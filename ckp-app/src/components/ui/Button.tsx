import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, controlHeight, radius, spacing } from '@/theme';
import { Icon, type IconName } from './Icon';
import { asInteraction } from './pressable-state';
import { Text, type TextVariant } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'disabled'> {
  title: string;
  variant?: ButtonVariant;
  /** sm 40 / md 48 / lg 52 */
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** 글자 크기 (기본: sm 은 label 14, md·lg 는 bodyStrong 16). 작은 글자 버튼은 'button'(15) */
  labelVariant?: TextVariant;
  style?: StyleProp<ViewStyle>;
}

interface VariantColors {
  bg: string;
  bgHover: string;
  bgPressed: string;
  text: string;
  border: string;
}

const VARIANTS: Record<ButtonVariant, VariantColors> = {
  primary: { bg: colors.primary, bgHover: colors.primaryStrong, bgPressed: colors.primaryStrong, text: colors.white, border: colors.primary },
  secondary: { bg: colors.card, bgHover: '#F6F8FB', bgPressed: colors.divider, text: colors.text, border: colors.border },
  soft: { bg: colors.primarySoft, bgHover: '#D7EAF7', bgPressed: '#C9E2F3', text: colors.primaryStrong, border: colors.primarySoft },
  ghost: { bg: colors.transparent, bgHover: colors.primarySoft, bgPressed: '#D7EAF7', text: colors.primary, border: colors.transparent },
  danger: { bg: colors.danger, bgHover: '#A92A32', bgPressed: '#A92A32', text: colors.white, border: colors.danger },
};

const HEIGHTS: Record<ButtonSize, number> = {
  sm: controlHeight.buttonSm,
  md: controlHeight.button,
  lg: controlHeight.buttonLg,
};

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  labelVariant,
  style,
  accessibilityLabel,
  hitSlop,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const v = VARIANTS[variant];
  const inactive = disabled || loading;
  const textColor = disabled ? colors.textMuted : v.text;
  const iconSize = size === 'sm' ? 18 : 20;
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const feedbackStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        scale.set(withTiming(reduceMotion ? 1 : 0.96, { duration: 100, reduceMotion: ReduceMotion.System }));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withTiming(1, { duration: 160, reduceMotion: ReduceMotion.System }));
        onPressOut?.(event);
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={hitSlop ?? (size === 'sm' ? 4 : undefined)}
      style={(state) => {
        const { pressed, hovered } = asInteraction(state);
        const bg = disabled
          ? variant === 'ghost'
            ? colors.transparent
            : colors.disabledBg
          : pressed
            ? v.bgPressed
            : hovered
              ? v.bgHover
              : v.bg;
        return [
          styles.base,
          {
            minHeight: HEIGHTS[size],
            paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
            backgroundColor: bg,
            borderColor: disabled && variant !== 'ghost' ? colors.border : v.border,
          },
          fullWidth && styles.fullWidth,
          style,
        ];
      }}
    >
      <Animated.View style={[styles.content, feedbackStyle]}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : icon ? (
          <Icon name={icon} size={iconSize} color={textColor} />
        ) : null}
        <Text variant={labelVariant ?? (size === 'sm' ? 'label' : 'bodyStrong')} color={textColor} numberOfLines={1}>
          {title}
        </Text>
        {iconRight && !loading ? <Icon name={iconRight} size={iconSize} color={textColor} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});

import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { colors, controlHeight, radius } from '@/theme';
import { Icon, type IconName } from './Icon';
import { asInteraction } from './pressable-state';
import { Text } from './Text';

export type IconButtonVariant = 'plain' | 'filled' | 'outline' | 'onDark';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style' | 'disabled'> {
  icon: IconName;
  /** 스크린리더용 이름 (필수) — 예: '검색어 지우기' */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  /** 터치 영역 (기본 44) */
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  /** 우측 상단 작은 숫자/점 배지 */
  badge?: number | boolean;
  style?: StyleProp<ViewStyle>;
}

const PALETTE: Record<IconButtonVariant, { bg: string; hover: string; pressed: string; icon: string; border: string }> = {
  plain: { bg: colors.transparent, hover: colors.divider, pressed: colors.border, icon: colors.text, border: colors.transparent },
  filled: { bg: colors.primary, hover: colors.primaryStrong, pressed: colors.primaryStrong, icon: colors.white, border: colors.primary },
  outline: { bg: colors.card, hover: '#F6F8FB', pressed: colors.divider, icon: colors.text, border: colors.border },
  onDark: { bg: 'rgba(255,255,255,0.10)', hover: 'rgba(255,255,255,0.18)', pressed: 'rgba(255,255,255,0.26)', icon: colors.white, border: colors.transparent },
};

export function IconButton({
  icon,
  accessibilityLabel,
  variant = 'plain',
  size = controlHeight.touch,
  iconSize = 22,
  color,
  disabled = false,
  badge,
  style,
  ...rest
}: IconButtonProps) {
  const p = PALETTE[variant];
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={(state) => {
        const { pressed, hovered } = asInteraction(state);
        return [
          styles.base,
          {
            width: size,
            height: size,
            borderRadius: variant === 'plain' ? size / 2 : radius.control,
            backgroundColor: pressed ? p.pressed : hovered ? p.hover : p.bg,
            borderColor: p.border,
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ];
      }}
    >
      <Icon name={icon} size={iconSize} color={color ?? p.icon} />
      {badge ? (
        <View style={[styles.badge, typeof badge === 'number' && styles.badgeNumber]}>
          {typeof badge === 'number' ? (
            <Text variant="caption" color={colors.white} style={styles.badgeText}>
              {badge > 99 ? '99+' : badge}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeNumber: {
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 3,
  },
});

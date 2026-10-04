import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'teal' | 'success' | 'warning' | 'danger' | 'accent';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.divider, fg: colors.textSecondary },
  primary: { bg: colors.primarySoft, fg: colors.primaryStrong },
  teal: { bg: colors.tealSoft, fg: '#06737B' },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  accent: { bg: colors.accentSoft, fg: colors.accentText },
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  /** sm: 캡션 12 / md: 보조 14 */
  size?: 'sm' | 'md';
  /** 채운 배경 (눈에 띄는 순번 배지 등) */
  solid?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', icon, size = 'sm', solid = false, accessibilityLabel, style }: BadgeProps) {
  const t = TONES[tone];
  const solidBg = tone === 'neutral' ? colors.textSecondary : tone === 'accent' ? colors.accent : t.fg;
  const bg = solid ? solidBg : t.bg;
  const fg = solid ? (tone === 'accent' ? colors.navy : colors.white) : t.fg;
  return (
    <View
      style={[styles.badge, size === 'md' && styles.md, { backgroundColor: bg }, style]}
      accessibilityLabel={accessibilityLabel}
      accessible={!!accessibilityLabel}
    >
      {icon ? <Icon name={icon} size={size === 'md' ? 14 : 12} color={fg} /> : null}
      <Text variant={size === 'md' ? 'label' : 'caption'} color={fg} weight="semibold" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs,
  },
});

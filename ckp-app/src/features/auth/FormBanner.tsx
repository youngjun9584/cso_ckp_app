import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export type FormBannerTone = 'info' | 'warning' | 'danger' | 'success';

const TONES: Record<FormBannerTone, { bg: string; border: string; fg: string; icon: IconName }> = {
  info: { bg: colors.primarySoft, border: '#CFE4F3', fg: colors.primaryStrong, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, border: '#F8E2B0', fg: colors.warning, icon: 'warning-outline' },
  danger: { bg: colors.dangerSoft, border: '#F4CDD0', fg: colors.danger, icon: 'alert-circle' },
  success: { bg: colors.successSoft, border: '#C6E8D8', fg: colors.success, icon: 'checkmark-circle' },
};

export interface FormBannerProps {
  tone?: FormBannerTone;
  title?: string;
  message: string;
  icon?: IconName;
  /** 오류처럼 바로 읽어 줘야 하는 안내 (스크린리더 알림) */
  live?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 폼 위쪽 안내·오류 상자 */
export function FormBanner({ tone = 'info', title, message, icon, live, children, style }: FormBannerProps) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }, style]}
      accessibilityLiveRegion={live ? 'assertive' : undefined}
      role={live ? 'alert' : undefined}
    >
      <Icon name={icon ?? t.icon} size={20} color={t.fg} />
      <View style={styles.texts}>
        {title ? (
          <Text variant="label" color={t.fg}>
            {title}
          </Text>
        ) : null}
        <Text variant="secondary" color={tone === 'info' ? colors.text : t.fg}>
          {message}
        </Text>
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.md,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

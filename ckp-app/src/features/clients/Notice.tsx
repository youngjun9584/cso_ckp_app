import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export type NoticeTone = 'info' | 'accent' | 'danger' | 'success';

const TONES: Record<NoticeTone, { bg: string; border: string; fg: string; icon: IconName }> = {
  info: { bg: colors.primarySoft, border: '#CFE4F3', fg: colors.primaryStrong, icon: 'information-circle' },
  accent: { bg: colors.accentSoft, border: '#F8E2B0', fg: colors.accentText, icon: 'time' },
  danger: { bg: colors.dangerSoft, border: '#F4CDD0', fg: colors.danger, icon: 'alert-circle' },
  success: { bg: colors.successSoft, border: '#C6E8D8', fg: colors.success, icon: 'checkmark-circle' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  message: string;
  icon?: IconName;
  /** 아래쪽 작업 버튼 등 */
  children?: ReactNode;
  /** 오류 안내처럼 즉시 읽어줘야 하는 경우 */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 화면 안 안내 상자 (승인 안내, 저장 오류 등) */
export function Notice({ tone = 'info', title, message, icon, children, live, style }: NoticeProps) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }, style]}
      accessibilityLiveRegion={live ? 'polite' : undefined}
      role={live ? 'alert' : undefined}
    >
      <Icon name={icon ?? t.icon} size={20} color={t.fg} />
      <View style={styles.texts}>
        {title ? (
          <Text variant="bodyStrong" color={t.fg}>
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
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

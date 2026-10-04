/** 화면 안 안내 띠 (경고·오류·정보) — 버튼을 함께 둘 수 있다 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

const TONES: Record<NoticeTone, { bg: string; border: string; fg: string; icon: IconName }> = {
  info: { bg: colors.primarySoft, border: '#C9E2F3', fg: colors.primaryStrong, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, border: '#F6DFA6', fg: colors.warning, icon: 'warning' },
  danger: { bg: colors.dangerSoft, border: '#F4C7CA', fg: colors.danger, icon: 'alert-circle' },
  success: { bg: colors.successSoft, border: '#BFE6D5', fg: colors.success, icon: 'checkmark-circle' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  message?: string | null;
  children?: ReactNode;
  /** 오른쪽/아래 버튼 영역 */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Notice({ tone = 'info', title, message, children, action, style }: NoticeProps) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }, style]}
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name={t.icon} size={20} color={t.fg} />
        </View>
        <View style={styles.body}>
          {title ? (
            <Text variant="bodyStrong" color={t.fg}>
              {title}
            </Text>
          ) : null}
          {message ? (
            <Text variant="secondary" color={tone === 'info' ? colors.text : t.fg}>
              {message}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  icon: {
    paddingTop: 1,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  action: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
});

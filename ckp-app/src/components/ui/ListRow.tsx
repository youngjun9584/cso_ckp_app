import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { hasValue } from '@/lib/format';
import { colors, spacing } from '@/theme';
import { Icon, type IconName } from './Icon';
import { asInteraction } from './pressable-state';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  /** 세 번째 줄 설명 */
  description?: string | null;
  /** 왼쪽 아이콘 */
  icon?: IconName;
  iconColor?: string;
  /** 왼쪽 사용자 요소 (썸네일 등) — icon 보다 우선 */
  left?: ReactNode;
  /** 오른쪽 요소 (배지, 스위치, 값) */
  right?: ReactNode;
  /** 오른쪽 > 표시 (onPress 가 있으면 기본 true) */
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** 아래 구분선 */
  divider?: boolean;
  /** danger: 로그아웃 같은 위험 동작 */
  tone?: 'default' | 'danger';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** 카드 안의 한 줄 항목 (설정·메뉴·간단한 목록) */
export function ListRow({
  title,
  subtitle,
  description,
  icon,
  iconColor,
  left,
  right,
  chevron,
  onPress,
  disabled,
  divider = false,
  tone = 'default',
  accessibilityLabel,
  style,
}: ListRowProps) {
  const titleTone = tone === 'danger' ? 'danger' : 'default';
  const content = (
    <>
      {left ?? (icon ? <Icon name={icon} size={22} color={iconColor ?? (tone === 'danger' ? colors.danger : colors.textSecondary)} /> : null)}
      <View style={styles.texts}>
        <Text variant="bodyStrong" tone={titleTone} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="secondary" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {description ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {right}
      {(chevron ?? !!onPress) ? <Icon name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
        accessibilityState={{ disabled: !!disabled }}
        style={(state) => {
          const { hovered, pressed } = asInteraction(state);
          return [
            styles.row,
            divider && styles.divider,
            (hovered || pressed) && styles.hovered,
            disabled && styles.disabled,
            style,
          ];
        }}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.row, divider && styles.divider, style]}>{content}</View>;
}

export interface InfoRowProps {
  label: string;
  value?: string | number | null;
  /** value 대신 직접 그리는 내용 */
  children?: ReactNode;
  /** 값이 없을 때 행을 숨기지 않고 '-' 표시 */
  showEmpty?: boolean;
  /** 넓은 화면에서 라벨 폭 */
  labelWidth?: number;
  divider?: boolean;
}

/**
 * 상세 화면의 "라벨: 값" 한 줄. 값이 없으면 기본적으로 행 자체를 숨긴다 (DESIGN §6.5 '값 없으면 행 숨김').
 */
export function InfoRow({ label, value, children, showEmpty = false, labelWidth = 112, divider = true }: InfoRowProps) {
  const has = children !== undefined ? true : hasValue(value);
  if (!has && !showEmpty) return null;
  return (
    <View style={[styles.infoRow, divider && styles.divider]} accessible accessibilityLabel={`${label}: ${has && value !== undefined && value !== null ? String(value) : '없음'}`}>
      <Text variant="secondary" tone="secondary" style={{ width: labelWidth }}>
        {label}
      </Text>
      <View style={styles.infoValue}>
        {children ?? (
          <Text variant="body" selectable>
            {has ? String(value) : '-'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  hovered: {
    backgroundColor: '#F6F8FB',
  },
  disabled: {
    opacity: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  infoValue: {
    flex: 1,
  },
});

import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { ApiError, getErrorMessage } from '@/lib/api/errors';
import { colors, radius, spacing } from '@/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface StateFrameProps {
  icon: IconName;
  iconColor?: string;
  iconBg?: string;
  title: string;
  description?: string | null;
  children?: ReactNode;
  /** 목록 안 등 좁은 곳에서 여백을 줄인다 */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

function StateFrame({ icon, iconColor = colors.textMuted, iconBg = colors.divider, title, description, children, compact, style }: StateFrameProps) {
  return (
    <View style={[styles.frame, compact && styles.frameCompact, style]} accessibilityRole="summary">
      <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={28} color={iconColor} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="secondary" tone="secondary" align="center" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string | null;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: IconName;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 데이터가 하나도 없을 때 (예: '등록된 거래처가 없습니다') */
export function EmptyState({ title, description, icon = 'file-tray-outline', actionLabel, onAction, actionIcon, compact, style }: EmptyStateProps) {
  return (
    <StateFrame icon={icon} title={title} description={description} compact={compact} style={style}>
      {actionLabel && onAction ? <Button title={actionLabel} icon={actionIcon} onPress={onAction} /> : null}
    </StateFrame>
  );
}

export interface NoResultsProps {
  /** 검색어 — "'xxx'에 대한 검색 결과가 없습니다." */
  query?: string;
  /** 문구를 직접 지정 */
  title?: string;
  description?: string | null;
  /** '검색어 지우기' 버튼 */
  onClear?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NoResults({ query, title, description = '검색어를 바꾸거나 검색 기준을 바꿔 보세요.', onClear, compact, style }: NoResultsProps) {
  const heading = title ?? (query ? `'${query}'에 대한 검색 결과가 없습니다.` : '검색 결과가 없습니다.');
  return (
    <StateFrame icon="search-outline" title={heading} description={description} compact={compact} style={style}>
      {onClear ? <Button title="검색어 지우기" variant="secondary" size="sm" onPress={onClear} /> : null}
    </StateFrame>
  );
}

export interface ErrorStateProps {
  /** 받은 오류 (ApiError 면 서버 메시지를 보여준다) */
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({ error, title, message, onRetry, retrying, compact, style }: ErrorStateProps) {
  const isNetwork = error instanceof ApiError && error.isNetwork;
  const heading = title ?? (isNetwork ? '서버에 연결할 수 없습니다' : '정보를 불러오지 못했습니다');
  const body = message ?? getErrorMessage(error);
  return (
    <StateFrame
      icon={isNetwork ? 'cloud-offline-outline' : 'alert-circle-outline'}
      iconColor={colors.danger}
      iconBg={colors.dangerSoft}
      title={heading}
      description={body}
      compact={compact}
      style={style}
    >
      {onRetry ? <Button title="다시 시도" icon="refresh" variant="secondary" onPress={onRetry} loading={retrying} /> : null}
    </StateFrame>
  );
}

export interface LoadingStateProps {
  label?: string;
  /** spinner: 가운데 스피너 / skeleton: 목록 자리표시 */
  variant?: 'spinner' | 'skeleton';
  rows?: number;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({ label = '불러오는 중입니다…', variant = 'spinner', rows = 6, compact, style }: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <View style={style} accessibilityLabel={label} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
        <SkeletonRows count={rows} />
      </View>
    );
  }
  return (
    <View
      style={[styles.frame, compact && styles.frameCompact, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text variant="secondary" tone="secondary" align="center">
        {label}
      </Text>
    </View>
  );
}

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** 깜빡이는 회색 자리표시 */
export function Skeleton({ width = '100%', height = 14, radius: r = radius.sm, style }: SkeletonProps) {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.set(withRepeat(withTiming(1, { duration: 750 }), -1, true));
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.border }, animatedStyle, style]} />;
}

export interface SkeletonRowsProps {
  count?: number;
  /** card: 카드 형태 / row: 한 줄 목록 형태 */
  variant?: 'card' | 'row';
}

/** 목록을 불러오는 동안 보여주는 카드 모양 자리표시 */
export function SkeletonRows({ count = 6, variant = 'card' }: SkeletonRowsProps) {
  return (
    <View style={styles.skeletonList} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={variant === 'card' ? styles.skeletonCard : styles.skeletonRow}>
          <Skeleton width={`${55 + ((i * 17) % 30)}%`} height={16} />
          <Skeleton width={`${35 + ((i * 11) % 35)}%`} height={12} />
          {variant === 'card' ? <Skeleton width="25%" height={12} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl * 1.5,
    paddingHorizontal: spacing.xxl,
  },
  frameCompact: {
    paddingVertical: spacing.xxl,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  description: {
    maxWidth: 420,
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  skeletonList: {
    gap: spacing.md,
  },
  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  skeletonRow: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});

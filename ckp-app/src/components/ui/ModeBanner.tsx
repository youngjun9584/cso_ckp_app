/**
 * 데이터 출처 표시.
 * - 샘플 모드: '샘플 모드 · 서버에 저장되지 않습니다' (accent)
 * - 실서버 + meta.dataSource=development: '개발 서버 · 테스트 데이터' (teal)
 * - 운영 서버: 표시하지 않음
 * AppHeader(모바일)와 사이드바(넓은 화면)가 자동으로 넣으므로 화면에서 직접 쓸 일은 드물다.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useDataSource } from '@/lib/meta';
import { colors, radius, spacing } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

const PARTS = {
  sample: { title: '샘플 모드', detail: '서버에 저장되지 않습니다' },
  development: { title: '개발 서버', detail: '테스트 데이터' },
} as const;

export const MODE_BANNER_TEXT = {
  sample: `${PARTS.sample.title} · ${PARTS.sample.detail}`,
  development: `${PARTS.development.title} · ${PARTS.development.detail}`,
} as const;

export interface ModeBannerProps {
  /**
   * bar: 헤더 아래 가로 띠 / sidebar: 어두운 사이드바 안 / inline: 카드 안 작은 상자 /
   * pill: 아이콘 + '샘플 모드'·'개발 서버' 한 단어만 보이는 작은 알약(로그인·회원가입, 스크린리더는 전체 문구)
   */
  variant?: 'bar' | 'sidebar' | 'inline' | 'pill';
  style?: StyleProp<ViewStyle>;
}

export function ModeBanner({ variant = 'bar', style }: ModeBannerProps) {
  const source = useDataSource();
  if (source.kind !== 'sample' && source.kind !== 'development') return null;

  const sample = source.kind === 'sample';
  const text = sample ? MODE_BANNER_TEXT.sample : MODE_BANNER_TEXT.development;
  const icon = sample ? 'flask-outline' : 'server-outline';

  if (variant === 'sidebar') {
    return (
      <View
        style={[styles.sidebar, { backgroundColor: sample ? 'rgba(253,161,0,0.14)' : 'rgba(10,182,194,0.16)' }, style]}
        accessibilityRole="text"
        accessibilityLabel={text}
      >
        <Icon name={icon} size={18} color={sample ? colors.accent : colors.teal} />
        <View style={styles.flex}>
          <Text variant="label" color={sample ? '#FFC65C' : '#6FE3EA'}>
            {sample ? PARTS.sample.title : PARTS.development.title}
          </Text>
          <Text variant="caption" tone="inverseMuted">
            {sample ? PARTS.sample.detail : PARTS.development.detail}
          </Text>
        </View>
      </View>
    );
  }

  const fg = sample ? colors.accentText : '#06616A';
  const bg = sample ? colors.accentSoft : colors.tealSoft;
  if (variant === 'pill') {
    return (
      <View style={[styles.pill, { backgroundColor: bg }, style]} accessible accessibilityRole="text" accessibilityLabel={text}>
        <Icon name={icon} size={14} color={fg} />
        <Text variant="caption" color={fg} weight="semibold">
          {sample ? PARTS.sample.title : PARTS.development.title}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[variant === 'bar' ? styles.bar : styles.inline, { backgroundColor: bg }, style]}
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      <Icon name={icon} size={16} color={fg} />
      <Text variant="caption" color={fg} weight="semibold" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(138,83,0,0.18)',
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xxs + 1,
    borderRadius: radius.pill,
  },
  sidebar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
  },
  flex: {
    flexShrink: 1,
  },
});

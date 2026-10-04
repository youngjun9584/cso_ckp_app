/**
 * CKP 로고.
 * - LogoFull: 흰 글자가 포함된 전체 로고 → 네이비 배경(로그인·사이드바)에만 사용
 * - LogoSymbol / BrandMark: 밝은 배경(모바일 헤더)용 심볼 + 'CKP' 네이비 글자
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { Text } from './Text';

const FULL_RATIO = 376 / 426; // 가로/세로
const SYMBOL_RATIO = 288 / 284;

const logoFull = require('@/assets/images/logo_full.png') as number;
const logoSymbol = require('@/assets/images/logo_symbol.png') as number;

export function LogoFull({ height = 96 }: { height?: number }) {
  return (
    <Image
      source={logoFull}
      style={{ height, width: height * FULL_RATIO }}
      contentFit="contain"
      accessibilityLabel="(주)CKP 로고"
    />
  );
}

export function LogoSymbol({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={logoSymbol}
      style={{ height: size, width: size * SYMBOL_RATIO }}
      contentFit="contain"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/** 심볼 + 'CKP' (밝은 배경) */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <View style={styles.mark} accessible accessibilityLabel="CKP" accessibilityRole="image">
      <LogoSymbol size={size} />
      <Text variant="heading" color={colors.navy} style={styles.markText}>
        CKP
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  markText: {
    letterSpacing: 0.5,
    fontWeight: '800',
  },
});

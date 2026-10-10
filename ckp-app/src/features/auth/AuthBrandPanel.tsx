/**
 * 로그인·회원가입의 브랜드 영역 — 네이비 그라데이션 위에 로고만 둔다(글자는 최소).
 * 흰 글자 전체 로고(LogoFull)는 어두운 배경에서만 쓴다.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { LogoFull, Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

/** 로고 뒤 은은한 빛 + 브랜드 색 원 두 개 */
function Glow() {
  return (
    <>
      <View pointerEvents="none" style={[styles.orb, styles.orbTeal]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbAmber]} />
      <View pointerEvents="none" style={styles.ring} />
    </>
  );
}

export interface AuthBrandPanelProps {
  /** 로고 아래 작은 한 줄 (기본 'CKP 업무 앱') */
  caption?: string;
  logoHeight?: number;
}

/** 넓은 웹 화면 왼쪽 패널 */
export function AuthBrandPanel({ caption = 'CKP 업무 앱', logoHeight = 148 }: AuthBrandPanelProps) {
  return (
    <LinearGradient colors={[colors.navy, '#132D55', '#0B1B36']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.panel}>
      <Glow />
      <View style={styles.logoHalo}>
        <LogoFull height={logoHeight} />
      </View>
      <Text variant="caption" tone="inverseMuted" align="center" style={styles.caption}>
        {caption}
      </Text>
    </LinearGradient>
  );
}

/** 휴대폰 화면 위쪽: 카드가 겹쳐 올라오는 그라데이션 영역 */
export function AuthMobileHero({ topInset, logoHeight = 92 }: { topInset: number; logoHeight?: number }) {
  return (
    <LinearGradient
      colors={[colors.navy, '#132D55', '#0E2245']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { paddingTop: topInset + spacing.xxl }]}
    >
      <Glow />
      <View style={styles.logoHalo}>
        <LogoFull height={logoHeight} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '42%',
    maxWidth: 560,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
    overflow: 'hidden',
  },
  hero: {
    alignItems: 'center',
    paddingBottom: spacing.xxxl * 2,
    overflow: 'hidden',
  },
  logoHalo: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: 999,
  },
  caption: {
    marginTop: spacing.lg,
    letterSpacing: 0.6,
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.12,
  },
  orbTeal: {
    width: 320,
    height: 320,
    backgroundColor: 'rgba(25, 194, 180, 0.35)',
    top: -120,
    right: -100,
  },
  orbAmber: {
    width: 260,
    height: 260,
    backgroundColor: 'rgba(253, 161, 0, 0.22)',
    bottom: -120,
    left: -80,
  },
  ring: {
    position: 'absolute',
    width: 560,
    height: 560,
    borderRadius: 280,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    top: -200,
    left: -180,
  },
});

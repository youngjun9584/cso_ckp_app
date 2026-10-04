import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { LogoFull } from '@/components/ui/Brand';
import { Text } from '@/components/ui/Text';
import { colors, spacing } from '@/theme';

/** 로그인 복원 중 화면 (스플래시와 같은 네이비 배경) */
export function BootScreen() {
  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="앱을 준비하는 중입니다">
      <StatusBar style="light" />
      <LogoFull height={120} />
      <ActivityIndicator color={colors.white} style={styles.spinner} />
      <Text variant="secondary" tone="inverseMuted">
        불러오는 중입니다…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  spinner: {
    marginTop: spacing.xl,
  },
});

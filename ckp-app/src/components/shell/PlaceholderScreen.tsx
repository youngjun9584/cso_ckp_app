import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Href } from 'expo-router';

import { AppHeader, EmptyState, Screen } from '@/components/ui';
import { spacing } from '@/theme';

interface PlaceholderScreenProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  backHref?: Href;
  description?: string;
  /** 화면 이동 확인용 버튼 등 */
  children?: ReactNode;
}

/** 기능 화면이 만들어지기 전 임시 화면 ('준비 중') */
export function PlaceholderScreen({ title, subtitle, back, backHref, description, children }: PlaceholderScreenProps) {
  return (
    <Screen header={<AppHeader title={title} subtitle={subtitle} back={back} backHref={backHref} />} scroll>
      <EmptyState icon="construct-outline" title="준비 중" description={description ?? `${title} 화면을 준비하고 있습니다.`} />
      {children ? <View style={styles.actions}>{children}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    gap: spacing.sm,
  },
});

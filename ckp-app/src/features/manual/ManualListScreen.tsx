/** 메뉴얼 목록 — 화면별 메뉴얼을 탭(묶음)별로 나열한다. */
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppHeader, Card, Icon, ListRow, Screen, SectionTitle, Text } from '@/components/ui';
import { colors, layout, radius, spacing, useIsWide } from '@/theme';
import { MANUAL_GROUPS, MANUAL_PAGES, manualHref } from './pages';

const MAX_WIDTH = layout.formMaxWidth;

export function ManualListScreen() {
  const wide = useIsWide();
  return (
    <Screen
      header={<AppHeader title="메뉴얼" subtitle="화면별 사용 안내" back={!wide} backHref="/home" showHelp={false} maxWidth={MAX_WIDTH} />}
      scroll
      maxWidth={MAX_WIDTH}
    >
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Icon name="book-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong">화면마다 스크린샷과 사용 방법을 정리했습니다</Text>
          <Text variant="secondary" tone="secondary" style={styles.introDescription}>
            각 화면의 오른쪽 위 물음표(?) 버튼을 누르면 지금 보고 있는 화면의 메뉴얼이 바로 열립니다.
          </Text>
        </View>
      </View>

      <View style={styles.groups}>
        {MANUAL_GROUPS.map((group) => {
          const pages = MANUAL_PAGES.filter((page) => page.group === group);
          if (pages.length === 0) return null;
          return (
            <View key={group} style={styles.group}>
              <SectionTitle title={group} />
              <Card padded={false}>
                {pages.map((page, index) => (
                  <ListRow
                    key={page.key}
                    icon={page.icon}
                    iconColor={colors.primary}
                    title={page.title}
                    subtitle={page.summary}
                    divider={index < pages.length - 1}
                    onPress={() => router.navigate(manualHref(page.key))}
                  />
                ))}
              </Card>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    marginBottom: spacing.xl,
  },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introDescription: { marginTop: 4 },
  groups: { gap: spacing.xl },
  group: { gap: spacing.sm },
});

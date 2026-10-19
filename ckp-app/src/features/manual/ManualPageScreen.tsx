/** 메뉴얼 상세 — 스크린샷 위, 설명(번호 목록) 아래. 단계가 여러 개인 화면은 구역을 반복한다. */
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';

import { AppHeader, Button, Card, EmptyState, Icon, ListRow, Screen, Text } from '@/components/ui';
import { navigateGuarded } from '@/lib/navigation-guard';
import { colors, layout, radius, shadow, spacing, useIsWide } from '@/theme';
import { MANUAL_PAGES, SHOT_ASPECT_MOBILE, SHOT_ASPECT_WIDE, findManualPage, manualHref, type ManualShot } from './pages';

const MAX_WIDTH = layout.formMaxWidth;
/** 모바일 스크린샷은 실제 폰 폭 정도로만 보여 준다 */
const PHONE_SHOT_MAX_WIDTH = 360;

export function ManualPageScreen() {
  const { page: key } = useLocalSearchParams<{ page?: string }>();
  const wide = useIsWide();
  const page = findManualPage(key);
  const index = page ? MANUAL_PAGES.indexOf(page) : -1;
  const prev = index > 0 ? MANUAL_PAGES[index - 1] : undefined;
  const next = index >= 0 && index < MANUAL_PAGES.length - 1 ? MANUAL_PAGES[index + 1] : undefined;

  if (!page) {
    return (
      <Screen header={<AppHeader title="메뉴얼" back backHref="/manual" showHelp={false} maxWidth={MAX_WIDTH} />} maxWidth={MAX_WIDTH}>
        <EmptyState icon="book-outline" title="메뉴얼을 찾을 수 없습니다" description="목록에서 다시 선택해 주세요." actionLabel="메뉴얼 목록" onAction={() => router.navigate('/manual')} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title={page.title} subtitle="사용 메뉴얼" back backHref="/manual" showHelp={false} maxWidth={MAX_WIDTH} />}
      scroll
      maxWidth={MAX_WIDTH}
    >
      <View style={styles.summary}>
        <View style={styles.summaryIcon}>
          <Icon name={page.icon} size={22} color={colors.primary} />
        </View>
        <Text variant="body" style={styles.flex}>
          {page.summary}
        </Text>
      </View>

      <View style={styles.sections}>
        {page.sections.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.title ? (
              <Text variant="heading" role="heading">
                {section.title}
              </Text>
            ) : null}
            {section.shot ? <Shot shot={section.shot} wide={wide} /> : null}
            <Card>
              <Text variant="label" tone="secondary" style={styles.cardLabel}>
                사용 방법
              </Text>
              <View style={styles.steps}>
                {section.steps.map((step, n) => (
                  <View key={n} style={styles.step}>
                    <View style={styles.stepNumber}>
                      <Text variant="caption" weight="bold" color={colors.white}>
                        {n + 1}
                      </Text>
                    </View>
                    <Text variant="body" style={styles.flex}>
                      {step}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
            {section.tips?.length ? (
              <View style={styles.tips}>
                <View style={styles.tipsHeader}>
                  <Icon name="bulb-outline" size={18} color={colors.accentText} />
                  <Text variant="label" color={colors.accentText}>
                    알아두기
                  </Text>
                </View>
                {section.tips.map((tip, n) => (
                  <View key={n} style={styles.tip}>
                    <Text variant="secondary" color={colors.accentText}>
                      •
                    </Text>
                    <Text variant="secondary" color={colors.accentText} style={styles.flex}>
                      {tip}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {page.href ? (
        <Button
          title="이 화면 열기"
          icon="open-outline"
          variant="secondary"
          fullWidth
          style={styles.open}
          onPress={() => void navigateGuarded(page.href!)}
        />
      ) : null}

      <Card padded={false} style={styles.nav}>
        {prev ? <ListRow icon="chevron-back" title={`이전: ${prev.title}`} subtitle={prev.group} chevron={false} divider onPress={() => router.navigate(manualHref(prev.key))} /> : null}
        {next ? <ListRow icon="chevron-forward" title={`다음: ${next.title}`} subtitle={next.group} divider onPress={() => router.navigate(manualHref(next.key))} /> : null}
        <ListRow icon="list-outline" title="메뉴얼 목록" onPress={() => router.navigate('/manual')} />
      </Card>
    </Screen>
  );
}

function Shot({ shot, wide }: { shot: ManualShot; wide: boolean }) {
  const useWide = wide && !!shot.wide;
  return (
    <View style={[styles.shotFrame, !useWide && styles.shotFramePhone]}>
      <Image
        source={useWide ? shot.wide : shot.mobile}
        accessibilityLabel={shot.alt}
        alt={shot.alt}
        contentFit="contain"
        style={[styles.shot, { aspectRatio: useWide ? SHOT_ASPECT_WIDE : SHOT_ASPECT_MOBILE }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    marginBottom: spacing.xl,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sections: { gap: spacing.xxl },
  section: { gap: spacing.md },
  shotFrame: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    ...shadow.card,
  },
  shotFramePhone: {
    width: '100%',
    maxWidth: PHONE_SHOT_MAX_WIDTH,
    alignSelf: 'center',
  },
  shot: {
    width: '100%',
    borderRadius: radius.control,
    backgroundColor: colors.bg,
  },
  cardLabel: { marginBottom: spacing.sm },
  steps: { gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tips: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  tipsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2 },
  tip: { flexDirection: 'row', gap: spacing.sm },
  open: { marginTop: spacing.xxl },
  nav: { marginTop: spacing.xl },
});

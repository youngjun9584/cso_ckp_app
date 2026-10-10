import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from 'expo-router';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { openTabRoot, openTabScreen, type TabsNavigation } from '@/components/shell/tab-navigation';
import { APP_TABS, type AppTabName } from '@/components/shell/tabs';
import { AppHeader, Button, Icon, Screen, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { useAuth } from '@/lib/auth';
import { colors, focusRing, radius, useIsWide } from '@/theme';

const SHORTCUTS: { tab: AppTabName; description: string; color: string; background: string }[] = [
  { tab: 'edi', description: '제출·처리 내역', color: '#087D73', background: '#E5F5F1' },
  { tab: 'medicines', description: '제품·수수료 조회', color: colors.primary, background: colors.primarySoft },
  { tab: 'clients', description: '거래처 조회·등록', color: '#7054AC', background: '#F1EDFA' },
  { tab: 'notices', description: '주요 공지 확인', color: '#996118', background: '#FFF4E2' },
];

// A short, one-time entrance; respect the device's reduced-motion preference.
function Reveal({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    progress.set(withDelay(reduced ? 0 : delay, withTiming(1, { duration: 280, reduceMotion: ReduceMotion.System })));
  }, [delay, progress, reduced]);
  const motion = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ translateY: (1 - progress.get()) * 10 }] }));
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}

export function HomeScreen() {
  const { user } = useAuth();
  const wide = useIsWide();
  const navigation = useNavigation();
  const tabs = () => navigation.getParent<TabsNavigation | undefined>();
  const openNewEdi = () => void openTabScreen(tabs(), 'edi', 'new', '/edi/new', { ignore: ['edi-new-draft'] });
  const open = (name: AppTabName) => void openTabRoot(tabs(), APP_TABS.find((tab) => tab.name === name)!);

  return <Screen header={<AppHeader title="홈" subtitle="CKP 업무 공간" />} scroll>
    <View style={styles.greeting}>
      <View style={styles.eyebrow}><Icon name="sunny-outline" size={17} color={colors.primary} /><Text variant="label" tone="secondary">나의 업무 공간</Text></View>
      <Text variant="titleLg" role="heading" style={styles.title}>{user?.name?.trim() ? user.name.trim() + '님, 안녕하세요' : '안녕하세요'}</Text>
      <Text variant="secondary" tone="secondary">오늘 필요한 업무를 빠르게 시작하세요.</Text>
    </View>
    <Reveal style={[styles.ediCard, wide && styles.ediCardWide]}>
      <View style={styles.flex}>
        <View style={styles.ediLabel}><View style={styles.ediIcon}><Icon name="cloud-upload-outline" size={25} color={colors.white} /></View><Text variant="label" tone="inverseMuted">EDI 사진 등록</Text></View>
        <Text variant="title" tone="inverse" role="heading" style={styles.ediTitle}>사진을 선택하고, 간편하게 제출하세요</Text>
        <Text variant="secondary" tone="inverseMuted">거래처 선택부터 제출까지 3단계 · 최대 30장</Text>
      </View>
      <Button title="새 EDI 등록" icon="add" iconRight="arrow-forward" onPress={openNewEdi} style={[styles.ediButton, !wide && styles.ediButtonMobile]} />
    </Reveal>

    <Pressable accessibilityRole="button" accessibilityLabel="의약품 검색 열기" onPress={() => open('medicines')}
      style={(state) => [styles.search, asInteraction(state).focused && focusRing, asInteraction(state).pressed && styles.pressed]}>
      <Icon name="search-outline" size={22} color={colors.primary} />
      <Text tone="secondary" style={styles.flex}>어떤 의약품을 찾으세요?</Text>
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>

    <View style={styles.sectionHeader}><Text variant="heading" role="heading">자주 쓰는 업무</Text><Text variant="caption" tone="secondary">QUICK ACCESS</Text></View>
    <View style={styles.grid}>
      {SHORTCUTS.map((item, index) => {
        const tab = APP_TABS.find((t) => t.name === item.tab)!;
        return <Reveal delay={70 + index * 45} key={item.tab} style={{ width: wide ? '25%' : '50%', padding: 5 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={tab.label + ', ' + item.description} onPress={() => open(item.tab)}
            style={(state) => { const { pressed, hovered, focused } = asInteraction(state); return [styles.tile, (hovered || pressed) && styles.tileHover, focused && focusRing]; }}>
            <View style={styles.tileTop}><View style={[styles.chip, { backgroundColor: item.background }]}><Icon name={tab.icon} size={25} color={item.color} /></View><Icon name="chevron-forward" size={16} color={colors.textMuted} /></View>
            <Text variant="bodyStrong">{tab.label}</Text>
            <Text variant="caption" tone="secondary">{item.description}</Text>
          </Pressable>
        </Reveal>;
      })}
    </View>

    <View style={styles.sectionHeader}><Text variant="heading" role="heading">업무 안내</Text></View>
    <View style={styles.guide}>
      <View style={styles.guideIcon}><Icon name="images-outline" size={22} color={colors.primary} /></View>
      <View style={styles.flex}><Text variant="bodyStrong">제출 전, 사진을 확인해 주세요</Text><Text variant="secondary" tone="secondary" style={styles.guideDescription}>사진을 크게 확인하고 순서를 바꾼 뒤 제출할 수 있습니다.</Text></View>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  greeting: { gap: 6, marginBottom: 24 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  ediIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#2B4568', alignItems: 'center', justifyContent: 'center' },
  title: { letterSpacing: -0.8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 16, minHeight: 58, marginBottom: 28 },
  pressed: { opacity: 0.8 },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 24 },
  tile: { flex: 1, padding: 18, minHeight: 152, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, gap: 6 },
  tileHover: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  chip: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  ediCard: { backgroundColor: colors.navy, borderRadius: radius.card, padding: 24, gap: 22, marginBottom: 28 },
  ediCardWide: { flexDirection: 'row', alignItems: 'center', padding: 28 },
  ediLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ediTitle: { marginTop: 12, marginBottom: 8, letterSpacing: -0.4 },
  ediButton: { backgroundColor: colors.primary, borderColor: colors.primary, minWidth: 156 },
  ediButtonMobile: { alignSelf: 'stretch' },
  guide: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  guideIcon: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft },
  guideDescription: { marginTop: 4 },
});

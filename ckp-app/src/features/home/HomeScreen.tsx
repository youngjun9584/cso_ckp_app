import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { openTabRoot, openTabScreen, type TabsNavigation } from '@/components/shell/tab-navigation';
import { APP_TABS, type AppTabName } from '@/components/shell/tabs';
import { AppHeader, Button, Icon, Screen, Text } from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import { useAuth } from '@/lib/auth';
import { colors, focusRing, radius, shadow, spacing, useIsWide } from '@/theme';

const SHORTCUTS: { tab: AppTabName; description: string; number: string; color: string; bg: string }[] = [
  { tab: 'medicines', description: '필요한 의약품을 빠르게 검색하세요', number: '01', color: colors.primary, bg: colors.primarySoft },
  { tab: 'notices', description: '새로운 소식과 안내를 확인하세요', number: '02', color: '#947016', bg: '#FBF4E3' },
  { tab: 'edi', description: '사진 등록부터 제출 내역까지', number: '03', color: '#157E73', bg: colors.tealSoft },
  { tab: 'clients', description: '함께하는 거래처를 관리하세요', number: '04', color: '#6554A4', bg: '#F1EEF9' },
];

export function HomeScreen() {
  const { user } = useAuth();
  const wide = useIsWide();
  const navigation = useNavigation();
  const tabs = () => navigation.getParent<TabsNavigation | undefined>();
  const openNewEdi = () => void openTabScreen(tabs(), 'edi', 'new', '/edi/new', { ignore: ['edi-new-draft'] });

  return <Screen header={<AppHeader title="홈" subtitle="CKP 업무 공간" />} scroll>
    <View style={styles.greeting}>
      <Text variant="caption" tone="primary" weight="bold" style={styles.eyebrow}>오늘의 업무</Text>
      <Text variant="titleLg" role="heading">{user?.name?.trim() ? `${user.name.trim()}님, 안녕하세요.` : '안녕하세요.'}</Text>
      <Text tone="secondary">필요한 업무를 한곳에서, 더 간편하게.</Text>
    </View>

    <View style={[styles.hero, wide && styles.heroWide]}>
      <View pointerEvents="none" style={styles.orbit} />
      <View pointerEvents="none" style={styles.orbitInner} />
      <View style={styles.heroContent}>
        <View style={styles.heroBadge}><View style={styles.dot} /><Text variant="caption" color="#9AE6D8" weight="bold">EDI 사진 등록</Text></View>
        <Text role="heading" variant="titleLg" tone="inverse" style={wide ? styles.heroTitleWide : undefined}>사진으로 간편하게,{ '\n' }순서대로 정확하게.</Text>
        <Text variant="secondary" tone="inverseMuted">거래처 선택부터 사진 제출까지 3단계.{ '\n' }한 번에 최대 30장을 등록할 수 있어요.</Text>
        <Button title="새 EDI 등록" iconRight="arrow-forward" onPress={openNewEdi} size="lg" style={styles.heroButton} />
      </View>
      {wide && <View style={styles.photoIllustration} accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={[styles.mockPhoto, styles.mockBack]}><View style={styles.mockNumber}><Text variant="label" tone="primary">02</Text></View><Icon name="images-outline" size={42} color="#8FA6B9" /></View>
        <View style={[styles.mockPhoto, styles.mockFront]}><View style={styles.mockNumber}><Text variant="label" tone="primary">01</Text></View><Icon name="document-text-outline" size={52} color={colors.primary} /><View style={styles.mockLine} /><View style={[styles.mockLine, { width: '45%' }]} /></View>
        <View style={styles.photoCaption}><Icon name="checkmark-circle" size={18} color="#8BE1CD" /><Text variant="caption" tone="inverse">선택 · 순서 확인 · 등록</Text></View>
      </View>}
    </View>

    <View style={styles.sectionHeader}><Text variant="heading" role="heading">업무 바로가기</Text><Text variant="caption" tone="secondary">필요한 기능만 간결하게</Text></View>
    <View style={[styles.grid, wide && styles.gridWide]}>
      {SHORTCUTS.map((item) => {
        const tab = APP_TABS.find((t) => t.name === item.tab)!;
        return <View key={item.tab} style={{ width: wide ? '25%' : '50%', padding: 6 }}><Pressable
          accessibilityRole="button" accessibilityLabel={`${tab.label}, ${item.description}`}
          onPress={() => void openTabRoot(tabs(), tab)}
          style={(state) => { const { pressed, hovered, focused } = asInteraction(state); return [styles.tile, wide && styles.tileWide, (hovered || pressed) && styles.tileHover, focused && focusRing]; }}>
          <View style={styles.tileTop}><View style={[styles.chip, { backgroundColor: item.bg }]}><Icon name={tab.icon} size={25} color={item.color} /></View><Text variant="caption" tone="muted">{item.number}</Text></View>
          <View style={styles.tileText}><Text variant="heading">{tab.label}</Text><Text variant="secondary" tone="secondary">{item.description}</Text></View>
          <View style={styles.tileBottom}><Text variant="caption" tone="primary" weight="semibold">바로가기</Text><Icon name="arrow-forward" size={17} color={colors.primary} /></View>
        </Pressable></View>;
      })}
    </View>
    <View style={styles.footnote}><Icon name="images-outline" size={18} color={colors.textSecondary} /><Text variant="caption" tone="secondary" style={{ flexShrink: 1 }}>EDI 사진은 선택 후 순서를 바꾸고, 크게 확인한 뒤 제출할 수 있습니다.</Text></View>
  </Screen>;
}

const styles = StyleSheet.create({
  greeting: { gap: 6, marginBottom: 24 }, eyebrow: { letterSpacing: 1.5 },
  hero: { position: 'relative', overflow: 'hidden', backgroundColor: colors.navy, borderRadius: 24, padding: 24, marginBottom: 32 },
  heroWide: { flexDirection: 'row', alignItems: 'center', minHeight: 294, padding: 36 },
  heroContent: { flex: 1, gap: 16, zIndex: 1 },
  heroTitleWide: { fontSize: 32, lineHeight: 44, letterSpacing: -0.8 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  heroButton: { alignSelf: 'flex-start', minWidth: 174, backgroundColor: '#0875AD', borderColor: '#4394BB', marginTop: 4 },
  orbit: { position: 'absolute', width: 440, height: 440, borderRadius: 220, borderWidth: 1, borderColor: 'rgba(130,213,219,0.12)', right: -100, top: -90 },
  orbitInner: { position: 'absolute', width: 330, height: 330, borderRadius: 165, borderWidth: 1, borderColor: 'rgba(130,213,219,0.10)', right: -45, top: -35 },
  photoIllustration: { width: 270, height: 240, marginLeft: 20 },
  mockPhoto: { position: 'absolute', width: 142, height: 174, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 12, ...shadow.raised },
  mockBack: { right: 16, top: 13, backgroundColor: '#D4E4EC', transform: [{ rotate: '12deg' }] },
  mockFront: { left: 22, top: 35, backgroundColor: '#FFFFFF', transform: [{ rotate: '-9deg' }] },
  mockNumber: { position: 'absolute', left: 12, top: 10 },
  mockLine: { height: 4, width: '65%', borderRadius: 2, backgroundColor: '#DCE7EE' },
  photoCaption: { position: 'absolute', right: 12, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }, gridWide: { marginBottom: 8 },
  tile: { flex: 1, padding: 16, minHeight: 208, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, gap: 20, ...shadow.card },
  tileWide: { padding: 22, minHeight: 222 }, tileHover: { borderColor: '#A6C4D8', backgroundColor: '#FCFEFF', ...shadow.raised },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tileText: { gap: 6, flex: 1 }, tileBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footnote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 24 },
});

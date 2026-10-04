/** 거래처 목록 (DESIGN §6.5): 검색 · 카드 목록(넓은 화면 2열) · 당겨서 새로고침 · 거래처 등록 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import {
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  NoResults,
  Screen,
  SearchBar,
  SkeletonRows,
  Text,
  useContentLayout,
} from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import type { ClientSummary } from '@/lib/api';
import { colors, radius, shadow, spacing } from '@/theme';
import { ClientCard } from '../ClientCard';
import { Notice } from '../Notice';
import { flattenClients, useClientList } from '../queries';

const FAB_SPACE = 52 + spacing.lg * 2;

export function ClientListScreen() {
  const { contentStyle, wide, gutter } = useContentLayout();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);
  const q = query.trim();

  const list = useClientList(q);
  const items = flattenClients(list.data?.pages);
  const total = list.data?.pages[0]?.total ?? 0;
  const searching = list.isFetching && list.isPlaceholderData;

  // 넓은 화면 2열: 개수가 홀수면 마지막 카드가 두 칸을 차지하지 않도록 빈 칸을 채운다
  const data: (ClientSummary | null)[] = wide && items.length % 2 === 1 ? [...items, null] : items;

  const openNew = () => router.push('/clients/new');
  const openDetail = (idx: number) => router.push({ pathname: '/clients/[idx]', params: { idx: String(idx) } });

  function clearSearch() {
    setInput('');
    setQuery('');
  }

  async function refresh() {
    setPulling(true);
    try {
      await list.refetch();
    } finally {
      setPulling(false);
    }
  }

  function loadMore() {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
  }

  let empty: ReactNode = null;
  if (list.isPending) empty = <SkeletonRows count={6} />;
  else if (list.isError && !list.data) empty = <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} />;
  else if (q) empty = <NoResults query={q} description="거래처명·대표자·주소·전화번호·사업자등록번호로 검색할 수 있습니다." onClear={clearSearch} />;
  else
    empty = (
      <EmptyState
        icon="business-outline"
        title="등록된 거래처가 없습니다"
        description="거래처를 등록하면 EDI 등록 때 선택할 수 있습니다."
        actionLabel="거래처 등록"
        actionIcon="add"
        onAction={openNew}
      />
    );

  const header = (
    <AppHeader
      title="거래처"
      right={
        wide ? (
          <>
            <IconButton icon="refresh" accessibilityLabel="새로고침" onPress={() => void refresh()} disabled={list.isFetching} />
            <Button title="거래처 등록" icon="add" size="sm" onPress={openNew} />
          </>
        ) : undefined
      }
    />
  );

  return (
    <Screen header={header} padded={false} maxWidth={null}>
      <View style={[contentStyle, styles.searchArea]}>
        <SearchBar
          value={input}
          onChangeText={setInput}
          onDebouncedChange={(text) => setQuery(text.trim())}
          onSubmit={(text) => setQuery(text)}
          onClear={clearSearch}
          loading={searching}
          placeholder="거래처명, 대표자, 전화번호 등"
          accessibilityLabel="거래처 검색 (거래처명·대표자·주소·전화번호·사업자등록번호)"
        />
        {list.data && items.length > 0 ? (
          <Text variant="secondary" tone="secondary" accessibilityLiveRegion="polite">
            {q ? `검색 결과 ${total}곳` : `전체 ${total}곳`}
          </Text>
        ) : null}
        {list.isRefetchError ? <Notice tone="danger" message="목록을 새로 고치지 못했습니다. 잠시 후 다시 시도해 주세요." /> : null}
      </View>

      <FlatList
        key={wide ? 'grid' : 'list'}
        data={data}
        numColumns={wide ? 2 : 1}
        keyExtractor={(item, index) => (item ? String(item.idx) : `spacer-${index}`)}
        renderItem={({ item }) =>
          item ? (
            <ClientCard client={item} onPress={() => openDetail(item.idx)} style={wide ? styles.gridItem : undefined} />
          ) : (
            <View style={styles.gridItem} />
          )
        }
        columnWrapperStyle={wide ? styles.columnWrapper : undefined}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={empty}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : list.isFetchNextPageError ? (
            <View style={styles.footer}>
              <Text variant="secondary" tone="secondary">
                목록을 더 불러오지 못했습니다.
              </Text>
              <Button title="다시 시도" icon="refresh" variant="secondary" size="sm" onPress={() => void list.fetchNextPage()} />
            </View>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void refresh()} colors={[colors.primary]} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={styles.flex}
        contentContainerStyle={[contentStyle, styles.listContent, { paddingBottom: wide ? spacing.xxl : FAB_SPACE }]}
      />

      {!wide ? <RegisterFab onPress={openNew} right={gutter} /> : null}
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/** 모바일 하단 떠 있는 '거래처 등록' 버튼 (엄지 닿는 곳) */
function RegisterFab({ onPress, right }: { onPress: () => void; right: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="거래처 등록"
      style={(state) => {
        const { pressed, hovered } = asInteraction(state);
        return [styles.fab, { right }, (pressed || hovered) && styles.fabPressed];
      }}
    >
      <Icon name="add" size={22} color={colors.white} />
      <Text variant="bodyStrong" color={colors.white}>
        거래처 등록
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  searchArea: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: spacing.xs,
  },
  columnWrapper: {
    gap: spacing.md,
  },
  gridItem: {
    flex: 1,
  },
  separator: {
    height: spacing.md,
  },
  footer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    ...shadow.raised,
  },
  fabPressed: {
    backgroundColor: colors.primaryStrong,
  },
});

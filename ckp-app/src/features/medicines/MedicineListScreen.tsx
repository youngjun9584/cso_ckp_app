/**
 * 의약품 목록·검색 (앱 첫 화면, DESIGN §6.5)
 * - 검색어: 입력 멈춤 350ms 후 또는 검색 키로 검색, 검색 기준(의약품명·제약사·보험코드·전체)
 * - 무한 스크롤(30건씩), '총 N건'
 * - 보기 방식: 카드 / 표 (사용자 선택, 기기에 저장). 고르지 않았으면 모바일 = 카드, 넓은 웹 = 표
 * - 좁은 화면에서 표를 고르면 가로로 스크롤해서 본다
 */
import { useRef, useState, type ReactNode } from 'react';
import { FlatList, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import {
  AppHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  NoResults,
  Screen,
  SearchBar,
  SegmentedControl,
  SkeletonRows,
  Text,
  useContentLayout,
} from '@/components/ui';
import type { MedicineSearchField, MedicineSummary } from '@/lib/api';
import { useFeatures } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { colors, radius, shadow, spacing } from '@/theme';
import { SEARCH_FIELD_OPTIONS, SEARCH_PLACEHOLDER, fieldLabel } from './format';
import { ListFooter } from './ListFooter';
import { MedicineCard } from './MedicineCard';
import { MedicineTableHeader, MedicineTableRow } from './MedicineTable';
import { flattenMedicines, useMedicineList } from './queries';
import { VIEW_MODE_OPTIONS, useMedicineViewMode } from './viewMode';

function CardSeparator() {
  return <View style={styles.separator} />;
}

export function MedicineListScreen() {
  const { wide, contentStyle } = useContentLayout();
  const showFee = useFeatures().medicineFeeVisible;
  const listRef = useRef<FlatList<MedicineSummary>>(null);
  const storedMode = useMedicineViewMode((s) => s.mode);
  const setViewMode = useMedicineViewMode((s) => s.setMode);
  const viewMode = storedMode ?? (wide ? 'table' : 'card');
  const tableView = viewMode === 'table';

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [field, setField] = useState<MedicineSearchField>('name');
  const [pulling, setPulling] = useState(false);

  const list = useMedicineList(query, field);
  const items = flattenMedicines(list.data?.pages);
  const total = list.data?.pages[0]?.total ?? 0;
  const searching = list.isPlaceholderData && list.isFetching;

  function scrollToTop() {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function commit(text: string) {
    const q = text.trim();
    if (q === query) return;
    setQuery(q);
    scrollToTop();
  }

  function clearSearch() {
    setInput('');
    commit('');
  }

  function changeField(next: MedicineSearchField) {
    setField(next);
    // 입력 중이던 검색어도 바로 반영한다
    const q = input.trim();
    if (q !== query) setQuery(q);
    if (q) scrollToTop();
  }

  function openDetail(code: string) {
    router.push({ pathname: '/medicines/[code]', params: { code } });
  }

  function loadMore() {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError && !list.isPlaceholderData) {
      void list.fetchNextPage();
    }
  }

  async function refresh() {
    setPulling(true);
    try {
      await list.refetch();
    } finally {
      setPulling(false);
    }
  }

  const countLine = (
    <View style={styles.countRow} accessibilityLiveRegion="polite">
      {searching ? (
        <Text variant="secondary" tone="muted">
          검색 중…
        </Text>
      ) : list.data ? (
        <Text variant="secondary" tone="secondary">
          {query ? '검색 결과 ' : ''}총{' '}
          <Text variant="secondary" weight="bold">
            {formatNumber(total)}
          </Text>
          건
        </Text>
      ) : null}
    </View>
  );

  const search = (
    <SearchBar
      value={input}
      onChangeText={setInput}
      onSubmit={commit}
      onDebouncedChange={commit}
      placeholder={SEARCH_PLACEHOLDER[field]}
      accessibilityLabel={`의약품 검색 (검색 기준: ${fieldLabel(field)})`}
      loading={searching}
      style={wide ? styles.searchWide : undefined}
    />
  );

  const fieldControl = (
    <SegmentedControl
      options={SEARCH_FIELD_OPTIONS}
      value={field}
      onChange={changeField}
      accessibilityLabel="검색 기준"
      fullWidth={!wide}
    />
  );

  const viewControl = (
    <SegmentedControl
      options={VIEW_MODE_OPTIONS}
      value={viewMode}
      onChange={setViewMode}
      accessibilityLabel="보기 방식"
      fullWidth={false}
    />
  );

  const toolbar = wide ? (
    <View style={[contentStyle, styles.toolbarWide]}>
      {search}
      {fieldControl}
      <View style={styles.flex} />
      {countLine}
      {viewControl}
    </View>
  ) : (
    <View style={[contentStyle, styles.toolbar]}>
      {search}
      {fieldControl}
      <View style={styles.metaRow}>
        {countLine}
        {viewControl}
      </View>
    </View>
  );

  /** 좁은 화면의 표는 가로 스크롤 안에 고정 너비로 그린다 */
  function tableFrame(table: ReactNode) {
    if (wide) return <View style={[contentStyle, styles.tableArea]}>{table}</View>;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.flex} contentContainerStyle={styles.tableScroll}>
        <View style={[styles.tableArea, styles.tableNarrowColumn]}>{table}</View>
      </ScrollView>
    );
  }

  const footer = (
    <ListFooter
      loadingMore={list.isFetchingNextPage}
      error={list.isFetchNextPageError ? list.error : undefined}
      onRetry={() => void list.fetchNextPage()}
      reachedEnd={!list.hasNextPage && items.length > 0}
      endLabel={
        items.length >= 10 ? (query ? '검색 결과를 모두 불러왔습니다' : '모든 의약품을 불러왔습니다') : undefined
      }
    />
  );

  let body;
  if (list.isPending || (list.isPlaceholderData && items.length === 0)) {
    body = tableView ? (
      tableFrame(
        <View
          style={styles.table}
          accessibilityRole="progressbar"
          accessibilityLabel="의약품 목록을 불러오는 중입니다"
          aria-busy
        >
          <MedicineTableHeader showFee={showFee} />
          <View style={styles.tableSkeleton}>
            <SkeletonRows count={8} variant="row" />
          </View>
        </View>,
      )
    ) : (
      <View style={[contentStyle, styles.stateArea]}>
        <LoadingState variant="skeleton" rows={6} label="의약품 목록을 불러오는 중입니다" />
      </View>
    );
  } else if (list.isError && !list.data) {
    body = (
      <View style={contentStyle}>
        <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <View style={contentStyle}>
        {!query ? (
          <EmptyState icon="medkit-outline" title="등록된 의약품이 없습니다." description="관리자가 의약품을 등록하면 이곳에 표시됩니다." />
        ) : field !== 'all' ? (
          <EmptyState
            icon="search-outline"
            title={`'${query}'에 대한 검색 결과가 없습니다.`}
            description={`지금은 '${fieldLabel(field)}' 기준으로 찾았습니다. 검색 기준을 '전체'로 바꾸면 제약사·보험코드·성분까지 함께 찾습니다.`}
            actionLabel="전체 기준으로 다시 검색"
            actionIcon="swap-horizontal"
            onAction={() => changeField('all')}
          />
        ) : (
          <NoResults query={query} description="검색어의 철자를 확인하거나 더 짧은 검색어로 찾아 보세요." onClear={clearSearch} />
        )}
      </View>
    );
  } else if (tableView) {
    body = tableFrame(
      <View style={[styles.table, searching && styles.dimmed]}>
        <MedicineTableHeader showFee={showFee} />
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(m) => m.code}
          renderItem={({ item }) => <MedicineTableRow item={item} showFee={showFee} onPress={openDetail} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={footer}
          style={styles.tableList}
        />
      </View>,
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(m) => m.code}
        renderItem={({ item }) => <MedicineCard item={item} showFee={showFee} onPress={openDetail} />}
        ItemSeparatorComponent={CardSeparator}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={footer}
        contentContainerStyle={[contentStyle, styles.listContent]}
        style={[styles.flex, searching && styles.dimmed]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          Platform.OS !== 'web' ? (
            <RefreshControl refreshing={pulling} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />
          ) : undefined
        }
      />
    );
  }

  return (
    <Screen header={<AppHeader title="의약품" />} padded={false} maxWidth={null}>
      {toolbar}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  toolbar: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  toolbarWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  searchWide: {
    flexBasis: 420,
    flexShrink: 1,
  },
  countRow: {
    minHeight: 20,
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stateArea: {
    paddingTop: spacing.sm,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: spacing.md,
  },
  tableArea: {
    flex: 1,
    paddingBottom: spacing.xxl,
  },
  tableScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  tableNarrowColumn: {
    // 좁은 화면: 열이 잘리지 않도록 고정 너비, 세로는 남은 높이 안에서 표가 스크롤
    width: 760,
  },
  table: {
    // 행이 적으면 내용 높이만큼, 많으면 남은 높이 안에서 스크롤
    flexShrink: 1,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  tableList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  tableSkeleton: {
    paddingHorizontal: spacing.xl,
  },
  dimmed: {
    opacity: 0.55,
  },
});

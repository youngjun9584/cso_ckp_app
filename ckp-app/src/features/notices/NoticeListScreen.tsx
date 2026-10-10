/**
 * 공지사항 목록 (DESIGN §6.5): 중요 공지 먼저(서버 정렬), 제목 검색(검색 키·지우기), 무한 스크롤.
 */
import { useRef, useState } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import {
  AppHeader,
  Button,
  Icon,
  EmptyState,
  ErrorState,
  LoadingState,
  NoResults,
  Screen,
  SearchBar,
  Text,
  useContentLayout,
} from '@/components/ui';
import { ListFooter } from '@/features/medicines/ListFooter';
import type { NoticeSummary } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { colors, spacing } from '@/theme';
import { NoticeCard } from './NoticeCard';
import { flattenNotices, useNoticeList } from './queries';

const MAX_WIDTH = 880;

function Separator() {
  return <View style={styles.separator} />;
}

export function NoticeListScreen() {
  const { wide, contentStyle } = useContentLayout(MAX_WIDTH);
  const listRef = useRef<FlatList<NoticeSummary>>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);

  const list = useNoticeList(query);
  const items = flattenNotices(list.data?.pages);
  const total = list.data?.pages[0]?.total ?? 0;
  const searching = list.isPlaceholderData && list.isFetching;

  function commit(text: string) {
    const q = text.trim();
    if (q === query) return;
    setQuery(q);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function clearSearch() {
    setInput('');
    commit('');
  }

  function openDetail(idx: number) {
    router.push({ pathname: '/notices/[idx]', params: { idx: String(idx) } });
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

  const toolbar = (
    <View style={[contentStyle, styles.toolbar, wide && styles.toolbarWide]}>
      <SearchBar
        value={input}
        onChangeText={setInput}
        onSubmit={commit}
        onDebouncedChange={commit}
        maxLength={100}
        placeholder="공지 제목으로 검색"
        accessibilityLabel="공지사항 제목 검색"
        loading={searching}
        style={wide ? styles.searchWide : undefined}
      />
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
    </View>
  );

  let body;
  if (list.isPending || (list.isPlaceholderData && items.length === 0)) {
    body = (
      <View style={[contentStyle, styles.stateArea]}>
        <LoadingState variant="skeleton" rows={6} label="공지사항을 불러오는 중입니다" />
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
        {query ? (
          <NoResults query={query} description="제목에 들어 있는 다른 낱말로 다시 검색해 보세요." onClear={clearSearch} />
        ) : (
          <EmptyState icon="megaphone-outline" title="등록된 공지사항이 없습니다." description="새 공지가 등록되면 이곳에 표시됩니다." actionLabel="새로고침" actionIcon="refresh-outline" onAction={() => void refresh()} />
        )}
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(n) => String(n.idx)}
        renderItem={({ item }) => <NoticeCard item={item} onPress={openDetail} />}
        ItemSeparatorComponent={Separator}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          <ListFooter
            loadingMore={list.isFetchingNextPage}
            error={list.isFetchNextPageError ? list.error : undefined}
            onRetry={() => void list.fetchNextPage()}
            reachedEnd={!list.hasNextPage}
            endLabel={items.length >= 10 ? (query ? '검색 결과를 모두 불러왔습니다' : '모든 공지사항을 불러왔습니다') : undefined}
          />
        }
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
    <Screen header={<AppHeader title="공지사항" subtitle="새로운 소식과 업무 안내" maxWidth={MAX_WIDTH} right={<Button title="새로고침" icon="refresh-outline" size="sm" variant="ghost" loading={list.isFetching && !list.isFetchingNextPage} onPress={() => void refresh()} />} />} padded={false} maxWidth={null}>
      <View style={[contentStyle, styles.intro]}>
        <View style={styles.introIcon}><Icon name="megaphone-outline" size={23} color={colors.primary} /></View>
        <View style={styles.flex}><Text variant="heading">업무 소식을 확인하세요</Text><Text variant="secondary" tone="secondary">중요 공지는 목록 상단에 표시됩니다.</Text></View>
      </View>
      {toolbar}
      {list.isRefetchError && list.data ? <View style={contentStyle}><ErrorState compact title="최신 공지를 불러오지 못했습니다" message="이전에 불러온 내용입니다. 새로고침해 주세요." onRetry={() => void refresh()} retrying={list.isFetching} /></View> : null}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 24, paddingBottom: 12 },
  introIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, justifyContent: 'center', alignItems: 'center' },
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
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  searchWide: {
    flexBasis: 440,
    flexShrink: 1,
  },
  countRow: {
    minHeight: 20,
    justifyContent: 'center',
  },
  stateArea: {
    paddingTop: spacing.sm,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: spacing.sm + 2,
  },
  dimmed: {
    opacity: 0.55,
  },
});

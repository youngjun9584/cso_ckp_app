import { useEffect, useEffectEvent, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useIsFocused } from 'expo-router';

import {
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonRows,
  Text,
  toast,
  useContentLayout,
} from '@/components/ui';
import {
  MonthNavigator,
  SubmissionCard,
  useCurrentKstMonth,
  useEdiSubmissions,
  useExpiredImageRefetch,
} from '@/features/edi/history';
import { getErrorMessage, type EdiSubmissionSummary } from '@/lib/api';
import { formatYm } from '@/lib/kst';
import { colors, layout, spacing } from '@/theme';

const CELL_GAP = spacing.md;
const isWeb = Platform.OS === 'web';

/** 본문 너비에 따라 카드 열 수 (모바일 1 / 태블릿·넓은 화면 2 / 아주 넓은 화면 3) */
function useColumns(wide: boolean, gutter: number): number {
  const { width } = useWindowDimensions();
  const available = Math.min(width - (wide ? layout.sidebarWidth : 0), layout.contentMaxWidth + gutter * 2) - gutter * 2;
  if (available >= 1060) return 3;
  if (available >= 640) return 2;
  return 1;
}

let lastOpenAt = 0;

/** 상세 열기 — 빠르게 두 번 눌러 상세가 두 번 쌓이는 것을 막는다 */
function openDetail(id: string): void {
  const now = Date.now();
  if (now - lastOpenAt < 700) return;
  lastOpenAt = now;
  router.push({ pathname: '/edi/[id]', params: { id } });
}

function Separator() {
  return <View style={styles.separator} />;
}

/** EDI 탭 첫 화면: 등록월별 제출 내역 */
export default function EdiHistoryScreen() {
  const currentYm = useCurrentKstMonth();
  // null = 항상 현재 달을 따라간다 (달이 바뀌어도 자동 반영)
  const [picked, setPicked] = useState<string | null>(null);
  const ym = picked && picked < currentYm ? picked : currentYm;

  const query = useEdiSubmissions(ym);
  const { contentStyle, gutter, wide } = useContentLayout();
  const columns = useColumns(wide, gutter);
  const listRef = useRef<FlatList<EdiSubmissionSummary>>(null);
  const [pulling, setPulling] = useState(false);
  const onThumbError = useExpiredImageRefetch(query.refetch);

  // 다른 화면(새 등록·상세)에서 돌아오면 오래된 목록만 새로 고친다
  const focused = useIsFocused();
  const seenFocusRef = useRef(false);
  const onRefocus = useEffectEvent(() => {
    if (query.isStale && !query.isFetching) void query.refetch();
  });
  useEffect(() => {
    if (!focused) return;
    if (seenFocusRef.current) onRefocus();
    seenFocusRef.current = true;
  }, [focused]);

  // 페이지 사이에 새 등록이 끼어들면 같은 건이 두 번 올 수 있어 id 로 한 번 더 거른다
  const seen = new Set<string>();
  const items: EdiSubmissionSummary[] = [];
  for (const page of query.data?.pages ?? []) {
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  const total = query.data?.pages[0]?.total ?? 0;
  const monthText = formatYm(ym);

  const changeMonth = (next: string) => {
    setPicked(next >= currentYm ? null : next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  // navigate: 이미 새 등록 화면이 맨 위면 그 화면을 쓴다 → 빠르게 두 번 눌러도 작성 화면이 두 개 쌓이지 않는다
  const openNew = () => router.navigate('/edi/new');

  const refresh = async () => {
    const result = await query.refetch();
    if (result.isError) toast.error(getErrorMessage(result.error));
  };

  const onPullRefresh = async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  const onEndReached = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage();
  };

  // 0건이면 아래 빈 화면 문구가 대신 알려 준다
  const countLabel = query.data && total > 0 ? `${monthText} 등록 ${total}건` : '';

  const listHeader = (
    <View style={[styles.listHeader, wide && styles.listHeaderWide]}>
      <MonthNavigator ym={ym} maxYm={currentYm} onChange={changeMonth} wide={wide} />
      <View style={[styles.countRow, wide && styles.countRowWide]}>
        <Text variant="secondary" tone="secondary" accessibilityLiveRegion="polite">
          {countLabel}
        </Text>
        {isWeb ? (
          <Button
            title="새로 고침"
            variant="ghost"
            size="sm"
            icon="refresh"
            loading={query.isRefetching && !query.isFetchingNextPage}
            disabled={query.isPending}
            onPress={() => void refresh()}
          />
        ) : null}
      </View>
    </View>
  );

  let empty: ReactElement;
  if (query.isPending) {
    empty = (
      <View accessibilityRole="progressbar" accessibilityLabel="등록 내역을 불러오는 중입니다…" accessibilityState={{ busy: true }}>
        <SkeletonRows count={4} variant="card" />
      </View>
    );
  } else if (query.isError) {
    empty = <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  } else {
    empty = (
      <EmptyState
        icon="documents-outline"
        title={`${monthText}에 등록한 EDI가 없습니다.`}
        description="다른 달을 선택하거나 새 EDI를 등록해 주세요."
        actionLabel="새 EDI 등록"
        actionIcon="add"
        onAction={openNew}
      />
    );
  }

  let footer: ReactElement | null = null;
  if (query.isFetchingNextPage) {
    footer = (
      <View style={styles.footer} accessibilityRole="progressbar" accessibilityLabel="목록을 더 불러오는 중입니다…">
        <ActivityIndicator color={colors.primary} />
        <Text variant="secondary" tone="secondary">
          더 불러오는 중…
        </Text>
      </View>
    );
  } else if (query.isFetchNextPageError) {
    footer = (
      <View style={styles.footer}>
        <Text variant="secondary" tone="danger" align="center">
          목록을 더 불러오지 못했습니다.
        </Text>
        <Button title="다시 시도" variant="secondary" size="sm" icon="refresh" onPress={() => void query.fetchNextPage()} />
      </View>
    );
  }

  return (
    <Screen
      padded={false}
      header={
        <AppHeader
          title="등록 내역"
          right={<Button title="새 EDI 등록" icon="add" size="sm" onPress={openNew} />}
        />
      }
    >
      <FlatList
        key={`cols-${columns}`}
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.columnWrapper : undefined}
        renderItem={({ item }) =>
          columns > 1 ? (
            <View style={[styles.gridCell, { width: `${100 / columns}%` }]}>
              <SubmissionCard item={item} fill onPress={() => openDetail(item.id)} onThumbError={onThumbError} />
            </View>
          ) : (
            <SubmissionCard item={item} onPress={() => openDetail(item.id)} onThumbError={onThumbError} />
          )
        }
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={[contentStyle, styles.content]}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshing={isWeb ? undefined : pulling}
        onRefresh={isWeb ? undefined : () => void onPullRefresh()}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  listHeader: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  listHeaderWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    paddingHorizontal: spacing.xs,
  },
  countRowWide: {
    gap: spacing.md,
    paddingHorizontal: 0,
  },
  columnWrapper: {
    marginHorizontal: -CELL_GAP / 2,
  },
  gridCell: {
    paddingHorizontal: CELL_GAP / 2,
  },
  separator: {
    height: CELL_GAP,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
});

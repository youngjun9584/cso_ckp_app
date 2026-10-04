import { useState } from 'react';
import { Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  ImageViewerModal,
  Screen,
  SectionTitle,
  toast,
  type ViewerImage,
} from '@/components/ui';
import {
  DetailSkeleton,
  PhotoGrid,
  SubmissionSummaryCard,
  canViewPhoto,
  reviewStatusLabel,
  useEdiSubmission,
  useExpiredImageRefetch,
} from '@/features/edi/history';
import { ApiError, getApi, getErrorMessage, type EdiPhoto } from '@/lib/api';
import { colors, spacing, useIsWide } from '@/theme';

const isWeb = Platform.OS === 'web';
/** 서명 URL 만료(1시간) 전에 확대 보기를 열면 새 URL 을 미리 받아 둔다 */
const URL_REFRESH_AGE_MS = 45 * 60_000;

function isNotFound(error: unknown): boolean {
  // 형식이 잘못된 id(400)도 사용자에게는 '찾을 수 없음'과 같다
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.status === 404 || error.status === 400);
}

/** EDI 제출 건 상세: 요약 + 사진 격자(서버 순서) + 확대 보기 */
export default function EdiDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id)?.trim() ?? '';
  const wide = useIsWide();
  const query = useEdiSubmission(id);
  const submission = query.data?.submission;
  const onImageError = useExpiredImageRefetch(query.refetch);
  const [viewer, setViewer] = useState({ visible: false, index: 0 });
  const [pulling, setPulling] = useState(false);

  const photos: EdiPhoto[] = [...(submission?.photos ?? [])].sort((a, b) => a.seq - b.seq);
  const viewable = photos.filter(canViewPhoto);
  const api = getApi();
  const viewerImages: ViewerImage[] = viewable.map((p) => ({
    uri: api.resolveUrl(p.imageUrl ?? p.thumbUrl) ?? '',
    label: `${p.seq}번 사진 · ${reviewStatusLabel(p.reviewStatus)}`,
  }));

  const header = <AppHeader title="EDI 등록 상세" subtitle={submission?.clientName} back backHref="/edi" />;

  const openPhoto = (photo: EdiPhoto) => {
    const index = viewable.findIndex((p) => p.seq === photo.seq);
    if (index < 0) return;
    if (Date.now() - query.dataUpdatedAt > URL_REFRESH_AGE_MS) void query.refetch();
    setViewer({ visible: true, index });
  };

  const refresh = async () => {
    const result = await query.refetch();
    if (result.isError && !isNotFound(result.error)) toast.error(getErrorMessage(result.error));
  };

  const onPullRefresh = async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  if (!id || (!submission && isNotFound(query.error))) {
    return (
      <Screen header={header} scroll>
        <EmptyState
          icon="document-outline"
          title="등록 내역을 찾을 수 없습니다."
          description="삭제되었거나 주소가 올바르지 않을 수 있습니다."
          actionLabel="등록 내역으로"
          actionIcon="list-outline"
          onAction={() => router.replace('/edi')}
        />
      </Screen>
    );
  }

  if (!submission) {
    return (
      <Screen header={header} scroll>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <DetailSkeleton wide={wide} />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      scroll
      refreshControl={
        isWeb ? undefined : <RefreshControl refreshing={pulling} onRefresh={() => void onPullRefresh()} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <View style={[styles.layout, wide && styles.layoutWide]}>
        <View style={wide ? styles.side : undefined}>
          <SubmissionSummaryCard submission={submission} labelWidth={wide ? 84 : 96} />
        </View>

        <View style={[styles.main, wide && styles.mainWide]}>
          <SectionTitle
            title={`사진 ${photos.length}장`}
            description="등록한 순서대로 표시합니다. 사진을 누르면 크게 볼 수 있습니다."
            right={
              isWeb ? (
                <Button
                  title="새로 고침"
                  variant="ghost"
                  size="sm"
                  icon="refresh"
                  loading={query.isFetching && !pulling}
                  onPress={() => void refresh()}
                />
              ) : undefined
            }
          />
          {photos.length > 0 ? (
            <PhotoGrid photos={photos} onOpen={openPhoto} onImageError={onImageError} minTileWidth={wide ? 150 : 104} />
          ) : (
            <EmptyState compact icon="images-outline" title="표시할 사진이 없습니다." />
          )}
        </View>
      </View>

      <ImageViewerModal
        images={viewerImages}
        index={viewer.index}
        visible={viewer.visible}
        onClose={() => setViewer((v) => ({ ...v, visible: false }))}
        onIndexChange={(index) => setViewer((v) => ({ ...v, index }))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    gap: spacing.xxl,
  },
  layoutWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  side: {
    width: 340,
  },
  main: {
    gap: spacing.lg,
  },
  mainWide: {
    flex: 1,
    minWidth: 0,
  },
});

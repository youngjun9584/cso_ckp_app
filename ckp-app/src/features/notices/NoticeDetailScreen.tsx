/**
 * 공지사항 상세 (DESIGN §6.5): 제목·작성일·작성자·중요 배지, 본문 HTML, 첨부(없으면 숨김).
 * 본문 폭은 실제 배치 폭을 재서 쓰고(최대 760), 재기 전에는 창 너비로 추정한다.
 */
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ImageViewerModal,
  ListRow,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
  goBack,
  type ViewerImage,
} from '@/components/ui';
import { formatDotDate } from '@/features/medicines/format';
import { isNotFoundError } from '@/features/medicines/queries';
import { getApi, type NoticeDetail } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { colors, layout, radius, spacing, useIsWide } from '@/theme';
import { extractImageSources } from './html-images';
import { openAttachmentUrl } from './links';
import { NoticeHtml } from './NoticeHtml';
import { useNoticeDetail } from './queries';

const MAX_WIDTH = 760;
const BODY_PADDING_MOBILE = spacing.lg;
const BODY_PADDING_WIDE = spacing.xxl;

/** 태그를 뺀 글자나 이미지가 하나라도 있는지 */
function hasContent(html: string, imageCount: number): boolean {
  if (imageCount > 0) return true;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
  return text.length > 0;
}

/** 공지 본문 화면 (불러온 NoticeDetail 을 그린다) */
export function NoticeDetailBody({ notice }: { notice: NoticeDetail }) {
  const wide = useIsWide();
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);

  const bodyPadding = wide ? BODY_PADDING_WIDE : BODY_PADDING_MOBILE;
  const gutter = wide ? layout.gutterWide : layout.gutter;
  const estimated = Math.min(MAX_WIDTH, windowWidth - (wide ? layout.sidebarWidth : 0) - gutter * 2) - bodyPadding * 2 - 2;
  const contentWidth = measuredWidth ?? Math.max(200, estimated);

  const imageSources = extractImageSources(notice.contentHtml);
  const showBody = hasContent(notice.contentHtml, imageSources.length);
  const date = formatDotDate(notice.regYmd);
  const author = notice.author?.trim();
  const api = getApi();

  function openImage(src: string) {
    const index = imageSources.indexOf(src);
    if (index >= 0) {
      setViewer({ images: imageSources.map((uri) => ({ uri })), index });
    } else {
      setViewer({ images: [{ uri: src }], index: 0 });
    }
  }

  return (
    <View style={styles.stack}>
      <Card padded={false} style={styles.article}>
        <View style={[styles.head, { padding: bodyPadding }]}>
          {notice.important ? <Badge label="중요 공지" tone="accent" icon="megaphone-outline" size="md" /> : null}
          <Text variant={wide ? 'titleLg' : 'title'} selectable role="heading">
            {notice.title.trim() || '제목 없는 공지'}
          </Text>
          {date || author ? (
            <View style={styles.meta}>
              {date ? (
                <View style={styles.metaItem} accessible accessibilityLabel={`작성일 ${date}`}>
                  <Icon name="calendar-outline" size={16} color={colors.textMuted} />
                  <Text variant="secondary" tone="secondary">
                    {date}
                  </Text>
                </View>
              ) : null}
              {author ? (
                <View style={styles.metaItem} accessible accessibilityLabel={`작성자 ${author}`}>
                  <Icon name="person-outline" size={16} color={colors.textMuted} />
                  <Text variant="secondary" tone="secondary">
                    {author}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.divider} />
        <View
          style={{ padding: bodyPadding }}
          onLayout={(e) => {
            const width = Math.floor(e.nativeEvent.layout.width - bodyPadding * 2);
            if (width > 0 && width !== measuredWidth) setMeasuredWidth(width);
          }}
        >
          {showBody ? (
            <NoticeHtml html={notice.contentHtml} contentWidth={contentWidth} onImagePress={openImage} />
          ) : (
            <Text variant="body" tone="muted">
              내용이 없습니다.
            </Text>
          )}
        </View>
      </Card>

      {notice.attachments.length > 0 ? (
        <Card padded={false}>
          <View style={styles.attachHead}>
            <SectionTitle title="첨부파일" description={`${notice.attachments.length}개`} />
          </View>
          {notice.attachments.map((file, i) => (
            <ListRow
              key={`${file.url}-${i}`}
              icon="document-attach-outline"
              title={file.name}
              subtitle={formatBytes(file.bytes) || null}
              onPress={() => void openAttachmentUrl(api.resolveUrl(file.url), api.baseUrl)}
              divider={i < notice.attachments.length - 1}
              accessibilityLabel={`첨부파일 ${file.name} 열기`}
            />
          ))}
        </Card>
      ) : null}

      <View style={styles.bottomActions}>
        <Button title="공지사항 목록" variant="secondary" icon="list" onPress={() => router.replace('/notices')} />
      </View>

      <ImageViewerModal
        images={viewer?.images ?? []}
        index={viewer?.index ?? 0}
        visible={viewer !== null}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

function DetailSkeleton() {
  return (
    <Card style={styles.skeleton} accessibilityRole="progressbar" accessibilityLabel="공지사항을 불러오는 중입니다" aria-busy>
      <Skeleton width={72} height={22} radius={radius.pill} />
      <Skeleton width="80%" height={24} />
      <Skeleton width="40%" height={14} />
      <View style={styles.skeletonGap} />
      <Skeleton width="100%" height={14} />
      <Skeleton width="95%" height={14} />
      <Skeleton width="88%" height={14} />
      <Skeleton width="60%" height={14} />
    </Card>
  );
}

export function NoticeDetailScreen({ idx }: { idx: number | null }) {
  const detail = useNoticeDetail(idx);
  const notice = detail.data?.notice;

  let content: ReactNode;
  if (idx === null || (detail.isError && isNotFoundError(detail.error))) {
    content = (
      <EmptyState
        icon="megaphone-outline"
        title="공지사항을 찾을 수 없습니다."
        description="삭제되었거나 주소가 올바르지 않습니다."
        actionLabel="공지사항 목록으로"
        actionIcon="list"
        onAction={() => goBack('/notices')}
      />
    );
  } else if (notice) {
    content = <NoticeDetailBody key={notice.idx} notice={notice} />;
  } else if (detail.isError) {
    content = <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  } else {
    content = <DetailSkeleton />;
  }

  return (
    <Screen header={<AppHeader title="공지 상세" back backHref="/notices" maxWidth={MAX_WIDTH} right={<Button title="새로고침" icon="refresh-outline" size="sm" variant="ghost" disabled={idx === null} loading={detail.isFetching} onPress={() => void detail.refetch()} />} />} scroll maxWidth={MAX_WIDTH}>
      {notice && detail.isRefetchError ? <ErrorState compact title="최신 내용을 불러오지 못했습니다" message="이전에 불러온 내용입니다. 다시 시도해 주세요." onRetry={() => void detail.refetch()} retrying={detail.isFetching} /> : null}
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  article: {
    overflow: 'hidden',
  },
  head: {
    gap: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  attachHead: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  skeleton: {
    gap: spacing.md,
  },
  skeletonGap: {
    height: spacing.sm,
  },
});

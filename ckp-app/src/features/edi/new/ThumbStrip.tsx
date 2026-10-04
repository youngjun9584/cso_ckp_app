/** 최종 순서 썸네일 줄 (1..N) + 사진별 업로드 상태(대기/업로드 중 %/완료/실패) */
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import type { DraftPhoto } from '../draft/types';

export interface ThumbStripProps {
  photos: DraftPhoto[];
  onOpen?: (localId: string) => void;
}

function StatusOverlay({ photo }: { photo: DraftPhoto }) {
  const u = photo.upload;
  if (u.state === 'idle') return null;
  if (u.state === 'uploaded') {
    return (
      <View style={[styles.status, styles.statusDone]}>
        <Icon name="checkmark-circle" size={14} color={colors.white} />
        <Text variant="caption" color={colors.white} weight="semibold">
          완료
        </Text>
      </View>
    );
  }
  if (u.state === 'failed') {
    return (
      <View style={[styles.status, styles.statusFailed]}>
        <Icon name="alert-circle" size={14} color={colors.white} />
        <Text variant="caption" color={colors.white} weight="semibold">
          실패
        </Text>
      </View>
    );
  }
  return (
    <>
      <View style={styles.dim} />
      <View style={[styles.status, styles.statusBusy]}>
        {u.state === 'uploading' ? <ActivityIndicator size="small" color={colors.white} /> : null}
        <Text variant="caption" color={colors.white} weight="semibold">
          {u.state === 'queued' ? '대기' : `${Math.round(u.progress * 100)}%`}
        </Text>
      </View>
      {u.state === 'uploading' ? (
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round(u.progress * 100)}%` }]} />
        </View>
      ) : null}
    </>
  );
}

export function ThumbStrip({ photos, onOpen }: ThumbStripProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.row} accessibilityLabel="등록 순서">
      {photos.map((photo, i) => {
        const seq = i + 1;
        const u = photo.upload;
        const statusLabel =
          u.state === 'uploaded' ? '업로드 완료' : u.state === 'failed' ? '업로드 실패' : u.state === 'uploading' ? `업로드 중 ${Math.round(u.progress * 100)}%` : u.state === 'queued' ? '업로드 대기' : '';
        return (
          <Pressable
            key={photo.localId}
            onPress={() => onOpen?.(photo.localId)}
            disabled={!onOpen || !photo.processed}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${seq}번 사진 ${photo.sourceName}${statusLabel ? `, ${statusLabel}` : ''}`}
            style={styles.item}
          >
            {photo.processed ? (
              <Image source={{ uri: photo.processed.thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={photo.localId} transition={0} />
            ) : null}
            <StatusOverlay photo={photo} />
            <View style={styles.seq}>
              <Text variant="caption" color={colors.white} weight="bold">
                {seq}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const SIZE = 84;

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  item: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: colors.divider,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seq: {
    position: 'absolute',
    top: 4,
    left: 4,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 12,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15,35,66,0.35)',
  },
  status: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    height: 22,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  statusDone: {
    backgroundColor: colors.success,
  },
  statusFailed: {
    backgroundColor: colors.danger,
  },
  statusBusy: {
    backgroundColor: 'rgba(15,35,66,0.75)',
    bottom: 10,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.teal,
  },
});
